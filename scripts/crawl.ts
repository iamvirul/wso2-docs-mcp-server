#!/usr/bin/env tsx
import { Command } from 'commander';
import { createHash } from 'crypto';
import { PRODUCTS, PRODUCT_IDS } from '../src/config/constants';
import { DocCrawler } from '../src/ingestion/crawler';
import { DocParser } from '../src/ingestion/parser';
import { DocChunker } from '../src/ingestion/chunker';
import { EmbedderFactory, embedChunks } from '../src/ingestion/embedder';
import { PgVectorStore } from '../src/vectorstore/pgvector';

const program = new Command();

program
    .name('crawl')
    .description('Crawl and index WSO2 documentation into pgvector')
    .option(
        '-p, --product <id>',
        `Product to crawl. One of: ${PRODUCT_IDS.join(', ')}. Omit to crawl all.`
    )
    .option(
        '-l, --limit <n>',
        'Max pages per product (useful for testing)',
        parseInt
    )
    .option('--force', 'Re-index even pages whose content has not changed', false)
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

    const parser = new DocParser();
    const chunker = new DocChunker();
    const provider = EmbedderFactory.create();

    const targets = opts.product
        ? [PRODUCTS[opts.product]]
        : Object.values(PRODUCTS);

    const globalStart = Date.now();
    let totalChunks = 0;

    for (const product of targets) {
        console.log(`\n📚  Crawling ${product.name} (${product.baseUrl})`);
        const crawler = new DocCrawler(product, opts.limit);
        const productStart = Date.now();
        let productChunks = 0;

        const { total, errors } = await crawler.crawl(async (page) => {
            // ── Skip unchanged pages unless --force ──────────────────────────────────
            if (!opts.force) {
                const existing = await vectorStore.getPageHash(page.url);
                if (existing === page.contentHash) {
                    process.stdout.write('.');
                    return;
                }
            }

            // ── Parse ─────────────────────────────────────────────────────────────────
            const parsed = parser.parse(page.html, page.url);
            if (parsed.sections.length === 0) return;

            // ── Chunk ─────────────────────────────────────────────────────────────────
            const chunks = chunker.chunk(parsed, {
                product: product.id,
                source_url: page.url,
                title: parsed.title,
                version: product.version,
            });
            if (chunks.length === 0) return;

            // ── Embed ─────────────────────────────────────────────────────────────────
            const embedded = await embedChunks(chunks, provider);

            // ── Upsert ───────────────────────────────────────────────────────────────
            await vectorStore.deleteBySourceUrl(page.url);
            await vectorStore.upsertChunks(
                embedded.map(({ chunk, embedding }) => ({
                    ...chunk,
                    content_hash: createHash('sha256').update(chunk.content).digest('hex'),
                    embedding,
                }))
            );

            await vectorStore.setPageHash(page.url, page.contentHash, chunks.length);

            productChunks += chunks.length;
            totalChunks += chunks.length;
            process.stdout.write(`\n  ✓ [${chunks.length}] ${page.url.slice(-80)}`);
        });

        const elapsed = ((Date.now() - productStart) / 1000).toFixed(1);
        console.log(
            `\n\n  ${product.name}: ${productChunks} chunks, ${total} pages fetched, ${errors} errors (${elapsed}s)`
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
