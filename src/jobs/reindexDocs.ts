import { createHash } from 'crypto';
import { DocCrawler } from '../ingestion/crawler';
import { DocParser } from '../ingestion/parser';
import { DocChunker } from '../ingestion/chunker';
import { EmbedderFactory, embedChunks } from '../ingestion/embedder';
import { PgVectorStore } from '../vectorstore/pgvector';
import { PRODUCTS, ProductConfig } from '../config/constants';
import cron from 'node-cron';

// ── ReindexJob ────────────────────────────────────────────────────────────────

export class ReindexJob {
    private vectorStore: PgVectorStore;
    private parser: DocParser;
    private chunker: DocChunker;

    constructor() {
        this.vectorStore = new PgVectorStore();
        this.parser = new DocParser();
        this.chunker = new DocChunker();
    }

    async initialize(): Promise<void> {
        await this.vectorStore.initialize();
    }

    async close(): Promise<void> {
        await this.vectorStore.close();
    }

    // ── Reindex a single product ──────────────────────────────────────────────────

    async reindexProduct(product: ProductConfig, maxPages?: number): Promise<void> {
        const provider = await EmbedderFactory.createAndInit();
        const crawler = new DocCrawler(product, maxPages);

        console.log(`\n🔄  Reindexing ${product.name}…`);
        let updated = 0;
        let skipped = 0;

        const { total, errors } = await crawler.crawl(async (page) => {
            // ── Hash-based change detection ──────────────────────────────────────────
            const existingHash = await this.vectorStore.getPageHash(page.url);
            if (existingHash === page.contentHash) {
                skipped++;
                return;
            }

            // ── Parse ─────────────────────────────────────────────────────────────────
            const parsed = this.parser.parse(page.html, page.url);
            if (parsed.sections.length === 0) return;

            // ── Chunk ─────────────────────────────────────────────────────────────────
            const chunks = this.chunker.chunk(parsed, {
                product: product.id,
                source_url: page.url,
                title: parsed.title,
                version: product.version,
            });

            if (chunks.length === 0) return;

            // ── Embed ─────────────────────────────────────────────────────────────────
            const embedded = await embedChunks(chunks, provider);

            // ── Delete stale chunks and upsert new ───────────────────────────────────
            await this.vectorStore.deleteBySourceUrl(page.url);
            await this.vectorStore.upsertChunks(
                embedded.map(({ chunk, embedding }) => ({
                    ...chunk,
                    content_hash: createHash('sha256')
                        .update(chunk.content)
                        .digest('hex'),
                    embedding,
                }))
            );

            // ── Update crawl state ───────────────────────────────────────────────────
            await this.vectorStore.setPageHash(page.url, page.contentHash, chunks.length);
            updated++;

            process.stdout.write(
                `  ✓ ${page.url.slice(-70)} (${chunks.length} chunks)\n`
            );
        });

        console.log(
            `\n  ${product.name}: ${updated} updated, ${skipped} unchanged, ${errors} errors (${total} fetched)`
        );
    }

    // ── Reindex all products ──────────────────────────────────────────────────────

    async reindexAll(maxPagesPerProduct?: number): Promise<void> {
        console.log('🚀  Starting full reindex…');
        const start = Date.now();

        for (const product of Object.values(PRODUCTS)) {
            await this.reindexProduct(product, maxPagesPerProduct);
        }

        const stats = await this.vectorStore.getStats();
        console.log(`\n✅  Reindex complete in ${((Date.now() - start) / 1000).toFixed(1)}s`);
        console.log(`   Total chunks: ${stats.totalChunks}`);
        Object.entries(stats.byProduct).forEach(([p, n]) =>
            console.log(`   ${p}: ${n} chunks`)
        );
    }

    // ── Scheduled job ────────────────────────────────────────────────────────────

    scheduleDaily(cronExpression = '0 2 * * *'): void {
        console.log(`⏰  Scheduled reindex: ${cronExpression}`);
        cron.schedule(cronExpression, async () => {
            console.log(`\n[${new Date().toISOString()}] Running scheduled reindex…`);
            try {
                await this.reindexAll();
            } catch (err) {
                console.error('Scheduled reindex failed:', err);
            }
        });
    }
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────

if (require.main === module) {
    const job = new ReindexJob();
    job
        .initialize()
        .then(() => job.reindexAll())
        .then(() => job.close())
        .then(() => process.exit(0))
        .catch((err) => {
            console.error('Reindex failed:', err);
            process.exit(1);
        });
}
