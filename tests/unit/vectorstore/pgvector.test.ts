import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist Pool mock fns using vi.hoisted ──────────────────────────────────────
const mocks = vi.hoisted(() => {
    const mockConnect = vi.fn();
    const mockPoolQuery = vi.fn();
    const mockEnd = vi.fn().mockResolvedValue(undefined);
    return { mockConnect, mockPoolQuery, mockEnd };
});

// ── Mock env ──────────────────────────────────────────────────────────────────
vi.mock('../../../src/config/env', () => ({
    env: {
        DATABASE_URL: 'postgresql://test',
        CACHE_TTL_SECONDS: 60,
        TOP_K_RESULTS: 5,
        EMBEDDING_PROVIDER: 'openai',
        OPENAI_API_KEY: 'sk-test',
        OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
        GEMINI_API_KEY: 'g-test',
        GEMINI_EMBEDDING_MODEL: 'text-embedding-004',
        VOYAGE_API_KEY: 'v-test',
        VOYAGE_EMBEDDING_MODEL: 'voyage-3',
        EMBEDDING_DIMENSIONS: 1536,
        CHUNK_SIZE: 800,
        CHUNK_OVERLAP: 100,
        CRAWL_CONCURRENCY: 2,
        MCP_SERVER_NAME: 'test',
        MCP_SERVER_VERSION: '1.0.0',
    },
}));

// ── Mock pg: Pool as a proper class constructor ───────────────────────────────
vi.mock('pg', () => ({
    Pool: class MockPool {
        connect = mocks.mockConnect;
        query = mocks.mockPoolQuery;
        end = mocks.mockEnd;
    },
}));

import { PgVectorStore, UpsertChunkInput } from '../../../src/vectorstore/pgvector';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeChunk = (overrides: Partial<UpsertChunkInput> = {}): UpsertChunkInput => ({
    product: 'apim', title: 'Test Doc', section: 'Overview',
    source_url: 'https://example.com/page', chunk_index: 0,
    content: 'Some content about API Manager.', content_hash: 'abc123',
    embedding: Array(1536).fill(0.1),
    ...overrides,
});

function makeClientMock(queryImpl?: ReturnType<typeof vi.fn>) {
    return {
        query: queryImpl ?? vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        release: vi.fn(),
    };
}

describe('PgVectorStore', () => {
    let store: PgVectorStore;

    beforeEach(() => {
        mocks.mockConnect.mockReset();
        mocks.mockPoolQuery.mockReset();
        mocks.mockEnd.mockReset();

        mocks.mockConnect.mockResolvedValue(makeClientMock());
        mocks.mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
        mocks.mockEnd.mockResolvedValue(undefined);

        store = new PgVectorStore('postgresql://test');
    });

    describe('initialize()', () => {
        it('connects to pool and runs SELECT 1 for connectivity', async () => {
            await store.initialize();
            expect(mocks.mockConnect).toHaveBeenCalledOnce();
            const client = await mocks.mockConnect.mock.results[0].value;
            expect(client.query).toHaveBeenCalledWith('SELECT 1');
            expect(client.release).toHaveBeenCalledOnce();
        });
    });

    describe('close()', () => {
        it('ends the pool', async () => {
            await store.close();
            expect(mocks.mockEnd).toHaveBeenCalledOnce();
        });
    });

    describe('upsertChunks()', () => {
        it('does nothing for empty array', async () => {
            await store.upsertChunks([]);
            expect(mocks.mockConnect).not.toHaveBeenCalled();
        });

        it('wraps upsert in BEGIN/COMMIT transaction', async () => {
            await store.upsertChunks([makeChunk()]);
            const client = await mocks.mockConnect.mock.results[0].value;
            const calls = client.query.mock.calls.map((args: any[]) => args[0] as string);
            expect(calls).toContain('BEGIN');
            expect(calls).toContain('COMMIT');
        });

        it('rolls back on INSERT error', async () => {
            const clientQuery = vi.fn()
                .mockResolvedValueOnce(undefined)
                .mockRejectedValueOnce(new Error('DB error'));
            mocks.mockConnect.mockResolvedValue(makeClientMock(clientQuery));

            await expect(store.upsertChunks([makeChunk()])).rejects.toThrow('DB error');
            const client = await mocks.mockConnect.mock.results[0].value;
            const calls = client.query.mock.calls.map((args: any[]) => args[0] as string);
            expect(calls).toContain('ROLLBACK');
        });

        it('processes 110 chunks in 3 separate batches of 50', async () => {
            mocks.mockConnect.mockResolvedValue(makeClientMock());
            const chunks = Array.from({ length: 110 }, (_, i) => makeChunk({ chunk_index: i }));
            await store.upsertChunks(chunks);
            expect(mocks.mockConnect).toHaveBeenCalledTimes(3);
        });
    });

    describe('similaritySearch()', () => {
        it('returns results from pool.query', async () => {
            mocks.mockPoolQuery.mockResolvedValueOnce({
                rows: [{
                    id: 'u1', product: 'apim', title: 'API Gateway', section: 'Overview',
                    source_url: 'https://example.com', chunk_index: 0,
                    content: 'Content text', version: null, score: 0.92,
                }],
            });
            const results = await store.similaritySearch(Array(1536).fill(0.1), { limit: 5 });
            expect(results).toHaveLength(1);
            expect(results[0].score).toBe(0.92);
            expect(results[0].product).toBe('apim');
        });

        it('includes product filter clause when product is specified', async () => {
            mocks.mockPoolQuery.mockResolvedValueOnce({ rows: [] });
            await store.similaritySearch(Array(1536).fill(0.1), { product: 'choreo', limit: 5 });
            expect(mocks.mockPoolQuery.mock.calls[0][0]).toContain('product = $');
        });

        it('returns cached result on 2nd identical call (LRU cache)', async () => {
            const mockRows = [{
                id: '1', product: 'apim', title: 'T', section: null,
                source_url: 'u', chunk_index: 0, content: 'c', version: null, score: 0.8,
            }];
            mocks.mockPoolQuery.mockResolvedValueOnce({ rows: mockRows });
            const embedding = Array(1536).fill(0.1);
            await store.similaritySearch(embedding, { limit: 5 });
            const second = await store.similaritySearch(embedding, { limit: 5 });
            expect(mocks.mockPoolQuery).toHaveBeenCalledTimes(1);
            expect(second).toHaveLength(1);
        });
    });

    describe('crawl state', () => {
        it('getPageHash returns null when URL not found', async () => {
            mocks.mockPoolQuery.mockResolvedValueOnce({ rows: [] });
            expect(await store.getPageHash('https://unknown.com')).toBeNull();
        });

        it('getPageHash returns stored hash', async () => {
            mocks.mockPoolQuery.mockResolvedValueOnce({ rows: [{ page_hash: 'deadbeef' }] });
            expect(await store.getPageHash('https://example.com')).toBe('deadbeef');
        });

        it('setPageHash issues INSERT … ON CONFLICT upsert', async () => {
            await store.setPageHash('https://example.com', 'abc', 5);
            const sql: string = mocks.mockPoolQuery.mock.calls[0][0];
            expect(sql).toContain('INSERT INTO crawl_state');
            expect(sql).toContain('ON CONFLICT');
        });
    });

    describe('deleteBySourceUrl()', () => {
        it('issues DELETE query and returns rowCount', async () => {
            mocks.mockPoolQuery.mockResolvedValueOnce({ rowCount: 3 });
            const count = await store.deleteBySourceUrl('https://example.com/page');
            expect(count).toBe(3);
            expect(mocks.mockPoolQuery.mock.calls[0][0]).toContain('DELETE FROM doc_chunks');
        });
    });

    describe('getStats()', () => {
        it('returns totalChunks and byProduct breakdown', async () => {
            mocks.mockPoolQuery
                .mockResolvedValueOnce({ rows: [{ count: '42' }] })
                .mockResolvedValueOnce({ rows: [{ product: 'apim', count: '30' }, { product: 'choreo', count: '12' }] });
            const stats = await store.getStats();
            expect(stats.totalChunks).toBe(42);
            expect(stats.byProduct['apim']).toBe(30);
            expect(stats.byProduct['choreo']).toBe(12);
        });
    });
});
