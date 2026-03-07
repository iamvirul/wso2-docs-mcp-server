import { Pool } from 'pg';
import { env } from '../config/env';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UpsertChunkInput {
    product: string;
    title: string;
    section?: string;
    source_url: string;
    chunk_index: number;
    content: string;
    content_hash: string;
    embedding: number[];
    version?: string;
}

export interface DocSearchResult {
    id: string;
    product: string;
    title: string;
    section: string | null;
    source_url: string;
    chunk_index: number;
    content: string;
    version: string | null;
    score: number;
}

export interface SimilaritySearchOptions {
    limit?: number;
    product?: string;
    minScore?: number;
}

// ── Simple TTL-aware LRU cache ────────────────────────────────────────────────

class LRUCache<K, V> {
    private cache = new Map<K, { value: V; expiresAt: number }>();

    constructor(private maxSize: number, private ttlMs: number) { }

    get(key: K): V | undefined {
        const entry = this.cache.get(key);
        if (!entry) return undefined;
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return undefined;
        }
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.value;
    }

    set(key: K, value: V): void {
        if (this.cache.has(key)) this.cache.delete(key);
        else if (this.cache.size >= this.maxSize) {
            this.cache.delete(this.cache.keys().next().value!);
        }
        this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    }

    clear(): void {
        this.cache.clear();
    }
}

// ── PgVectorStore ─────────────────────────────────────────────────────────────

export class PgVectorStore {
    private pool: Pool;
    private queryCache: LRUCache<string, DocSearchResult[]>;

    constructor(connectionString?: string) {
        this.pool = new Pool({
            connectionString: connectionString ?? env.DATABASE_URL,
            max: 10,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 5_000,
        });
        this.queryCache = new LRUCache<string, DocSearchResult[]>(
            200,
            env.CACHE_TTL_SECONDS * 1000
        );
    }

    async initialize(): Promise<void> {
        const client = await this.pool.connect();
        try {
            await client.query('SELECT 1');
        } finally {
            client.release();
        }
    }

    async close(): Promise<void> {
        await this.pool.end();
    }

    // ── Upsert ──────────────────────────────────────────────────────────────────

    async upsertChunks(chunks: UpsertChunkInput[]): Promise<void> {
        if (chunks.length === 0) return;
        const BATCH = 50;
        for (let i = 0; i < chunks.length; i += BATCH) {
            await this._upsertBatch(chunks.slice(i, i + BATCH));
        }
        this.queryCache.clear(); // invalidate after writes
    }

    private async _upsertBatch(chunks: UpsertChunkInput[]): Promise<void> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            for (const c of chunks) {
                const vec = `[${c.embedding.join(',')}]`;
                await client.query(
                    `INSERT INTO doc_chunks
             (product, title, section, source_url, chunk_index, content, content_hash, embedding, version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::vector,$9)
           ON CONFLICT (source_url, chunk_index) DO UPDATE SET
             product      = EXCLUDED.product,
             title        = EXCLUDED.title,
             section      = EXCLUDED.section,
             content      = EXCLUDED.content,
             content_hash = EXCLUDED.content_hash,
             embedding    = EXCLUDED.embedding,
             version      = EXCLUDED.version,
             updated_at   = NOW()`,
                    [c.product, c.title, c.section ?? null, c.source_url,
                    c.chunk_index, c.content, c.content_hash, vec, c.version ?? null]
                );
            }
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    // ── Similarity search ────────────────────────────────────────────────────────

    async similaritySearch(
        queryEmbedding: number[],
        opts: SimilaritySearchOptions = {}
    ): Promise<DocSearchResult[]> {
        const limit = opts.limit ?? env.TOP_K_RESULTS;
        const cacheKey = `${queryEmbedding.slice(0, 8).join(',')}-${opts.product ?? '*'}-${limit}`;

        const cached = this.queryCache.get(cacheKey);
        if (cached) return cached;

        const vec = `[${queryEmbedding.join(',')}]`;
        const params: unknown[] = [vec, limit];
        const productClause = opts.product ? `AND product = $${params.push(opts.product)}` : '';

        const { rows } = await this.pool.query<DocSearchResult & { score: number }>(
            `SELECT id, product, title, section, source_url, chunk_index, content, version,
              1 - (embedding <=> $1::vector) AS score
       FROM doc_chunks
       WHERE embedding IS NOT NULL ${productClause}
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
            params
        );

        const results = opts.minScore
            ? rows.filter((r) => r.score >= opts.minScore!)
            : rows;

        this.queryCache.set(cacheKey, results);
        return results;
    }

    // ── Crawl state ──────────────────────────────────────────────────────────────

    async getPageHash(url: string): Promise<string | null> {
        const { rows } = await this.pool.query(
            'SELECT page_hash FROM crawl_state WHERE url = $1',
            [url]
        );
        return rows[0]?.page_hash ?? null;
    }

    async setPageHash(url: string, hash: string, chunkCount: number): Promise<void> {
        await this.pool.query(
            `INSERT INTO crawl_state (url, page_hash, chunk_count)
       VALUES ($1, $2, $3)
       ON CONFLICT (url) DO UPDATE SET
         page_hash    = EXCLUDED.page_hash,
         chunk_count  = EXCLUDED.chunk_count,
         last_crawled = NOW()`,
            [url, hash, chunkCount]
        );
    }

    async getAllCrawledUrls(): Promise<Array<{ url: string; page_hash: string; last_crawled: Date }>> {
        const { rows } = await this.pool.query(
            'SELECT url, page_hash, last_crawled FROM crawl_state ORDER BY last_crawled DESC'
        );
        return rows;
    }

    async deleteBySourceUrl(url: string): Promise<number> {
        const { rowCount } = await this.pool.query(
            'DELETE FROM doc_chunks WHERE source_url = $1',
            [url]
        );
        return rowCount ?? 0;
    }

    async getStats(): Promise<{ totalChunks: number; byProduct: Record<string, number> }> {
        const total = await this.pool.query('SELECT COUNT(*) FROM doc_chunks');
        const byProduct = await this.pool.query(
            'SELECT product, COUNT(*) as count FROM doc_chunks GROUP BY product ORDER BY count DESC'
        );
        const productMap: Record<string, number> = {};
        byProduct.rows.forEach((r) => (productMap[r.product] = parseInt(r.count, 10)));
        return {
            totalChunks: parseInt(total.rows[0].count, 10),
            byProduct: productMap,
        };
    }
}
