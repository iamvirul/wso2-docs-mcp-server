#!/usr/bin/env node
import { Command } from 'commander';
import { createHash } from 'crypto';
import { PRODUCTS, PRODUCT_IDS } from '../src/config/constants';
import { GitHubDocFetcher } from '../src/ingestion/githubFetcher';
import { MarkdownParser } from '../src/ingestion/markdownParser';
import { DocCrawler } from '../src/ingestion/crawler';
import { DocParser } from '../src/ingestion/parser';
import { DocChunker } from '../src/ingestion/chunker';
import { EmbedderFactory, embedChunks } from '../src/ingestion/embedder';
import { PgVectorStore } from '../src/vectorstore/pgvector';

const program = new Command();

program
    .name('crawl')
    .description('Index WSO2 documentation into pgvector (GitHub-native Markdown + web-crawl fallback)')
    .option(
        '-p, --product <id>',
        `Product to index. One of: ${PRODUCT_IDS.join(', ')}. Omit to index all.`
    )
    .option(
        '-l, --limit <n>',
        'Max pages/files per product (useful for testing)',
        parseInt
    )
    .option('--force', 'Re-index even content that has not changed', false)
    .parse(process.argv);

const opts = program.opts<{ product?: string; limit?: number; force: boolean }>();

// ── Validation ─────────────────────────────────────────────────────────────────

if (opts.product && !PRODUCT_IDS.includes(opts.product)) {
    console.error(`Unknown product "${opts.product}". Valid: ${PRODUCT_IDS.join(', ')}`);
    process.exit(1);
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const vectorStore = new PgVectorStore();
    await vectorStore.initialize();

    const chunker = new DocChunker();
    // HTML parser + Markdown parser are both lightweight; create once
    const htmlParser = new DocParser();
    const mdParser = new MarkdownParser();

    // Provider deferred — ONNX native threads must not overlap with network I/O
    let provider: Awaited<ReturnType<typeof EmbedderFactory.createAndInit>> | null = null;

    const targets = opts.product
        ? [PRODUCTS[opts.product]]
        : Object.values(PRODUCTS);

    const globalStart = Date.now();
    let totalChunks = 0;

    for (const product of targets) {
        const isGitHub = !!product.githubSource;

        console.log(
            `\n📚  Indexing ${product.name} via ${isGitHub ? '🐙 GitHub' : '🌐 web-crawl'}`
        );

        const productStart = Date.now();

        interface PendingPage {
            page: { url: string; contentHash: string };
            chunks: ReturnType<typeof chunker.chunk>;
        }
        const pending: PendingPage[] = [];

        // ── Phase 1: Fetch + parse + chunk ───────────────────────────────────────

        if (isGitHub && product.githubSource) {
            // ── GitHub-native path ─────────────────────────────────────────────
            const fetcher = new GitHubDocFetcher(
                product.githubSource,
                product.baseUrl,
                opts.limit,
            );

            await fetcher.fetch(async (file) => {
                if (!opts.force) {
                    const existing = await vectorStore.getPageHash(file.url);
                    if (existing === file.contentHash) {
                        process.stdout.write('.');
                        return;
                    }
                }

                const parsed = mdParser.parse(file.markdown, file.url, file.filePath);
                if (parsed.sections.length === 0) return;

                const chunks = chunker.chunk(parsed, {
                    product: product.id,
                    source_url: file.url,
                    title: parsed.title,
                    version: product.version,
                });
                if (chunks.length === 0) return;

                pending.push({
                    page: { url: file.url, contentHash: file.contentHash },
                    chunks,
                });
            });

        } else {
            // ── Legacy web-crawl path (ballerina, library) ─────────────────────
            const crawler = new DocCrawler(product, opts.limit);

            await crawler.crawl(async (page) => {
                if (!opts.force) {
                    const existing = await vectorStore.getPageHash(page.url);
                    if (existing === page.contentHash) {
                        process.stdout.write('.');
                        return;
                    }
                }

                const parsed = htmlParser.parse(page.html, page.url);
                if (parsed.sections.length === 0) return;

                const chunks = chunker.chunk(parsed, {
                    product: product.id,
                    source_url: page.url,
                    title: parsed.title,
                    version: product.version,
                });
                if (chunks.length === 0) return;

                pending.push({ page, chunks });
            });
        }

        // ── Phase 2: Batch-embed all pending chunks ───────────────────────────
        let productChunks = 0;

        if (pending.length > 0) {
            if (!provider) {
                provider = await EmbedderFactory.createAndInit();
            }
            const allChunks = pending.flatMap((p) => p.chunks);
            const embedded = await embedChunks(allChunks, provider);

            // ── Phase 3: Write to DB (one page at a time) ─────────────────────
            let offset = 0;
            for (const { page, chunks } of pending) {
                const pageEmbedded = embedded.slice(offset, offset + chunks.length);
                offset += chunks.length;

                await vectorStore.deleteBySourceUrl(page.url);
                await vectorStore.upsertChunks(
                    pageEmbedded.map(({ chunk, embedding }) => ({
                        ...chunk,
                        content_hash: createHash('sha256').update(chunk.content).digest('hex'),
                        embedding,
                    }))
                );
                await vectorStore.setPageHash(page.url, page.contentHash, chunks.length);

                productChunks += chunks.length;
                totalChunks += chunks.length;
                process.stdout.write(`\n  ✓ [${chunks.length}] ${page.url.slice(-80)}`);
            }
        }

        const elapsed = ((Date.now() - productStart) / 1000).toFixed(1);
        console.log(
            `\n\n  ${product.name}: ${productChunks} chunks, ${pending.length} pages processed (${elapsed}s)`
        );
    }

    const stats = await vectorStore.getStats();
    await vectorStore.close();

    const totalElapsed = ((Date.now() - globalStart) / 1000).toFixed(1);
    console.log(`\n✅  Done in ${totalElapsed}s — ${totalChunks} chunks written`);
    console.log(`   Total in DB: ${stats.totalChunks} chunks`);
    Object.entries(stats.byProduct).forEach(([p, n]) =>
        console.log(`   ${p}: ${n}`)
    );
}

main().catch((err) => {
    console.error('\n❌ ', err.message ?? err);
    process.exit(1);
});
