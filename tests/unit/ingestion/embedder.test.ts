import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock env ──────────────────────────────────────────────────────────────────
vi.mock('../../../src/config/env', () => ({
    env: {
        EMBEDDING_PROVIDER: 'openai',
        OPENAI_API_KEY: 'sk-test-key',
        OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
        GEMINI_API_KEY: 'gemini-test-key',
        GEMINI_EMBEDDING_MODEL: 'text-embedding-004',
        VOYAGE_API_KEY: 'voyage-test-key',
        VOYAGE_EMBEDDING_MODEL: 'voyage-3',
        EMBEDDING_DIMENSIONS: 1536,
        DATABASE_URL: 'postgresql://test',
        CACHE_TTL_SECONDS: 60,
        TOP_K_RESULTS: 5,
        MCP_SERVER_NAME: 'test',
        MCP_SERVER_VERSION: '1.0.0',
        CRAWL_CONCURRENCY: 2,
        CHUNK_SIZE: 800,
        CHUNK_OVERLAP: 100,
    },
}));

// ── Mock all 3rd-party SDKs (prevents real network/auth in tests) ─────────────
vi.mock('openai', () => ({ default: vi.fn() }));
vi.mock('@google/generative-ai', () => ({
    GoogleGenerativeAI: vi.fn(),
    TaskType: { RETRIEVAL_DOCUMENT: 'RETRIEVAL_DOCUMENT' },
}));
vi.mock('axios', () => ({
    default: { post: vi.fn(), create: vi.fn().mockReturnValue({ get: vi.fn() }) },
}));

import { embedChunks, EmbeddingProvider } from '../../../src/ingestion/embedder';
import { DocChunk } from '../../../src/ingestion/chunker';

// ── Lightweight stub provider (avoids new OpenAI() constructor issues) ────────
const fakeEmbedding = Array(1536).fill(0.1);

function makeProvider(embeds: number[][]): EmbeddingProvider {
    return {
        embed: vi.fn().mockResolvedValue(embeds),
        dimensions: 1536,
        modelName: 'test-model',
    };
}

const sampleChunks: DocChunk[] = [
    {
        product: 'apim', title: 'API Manager Overview', section: 'Introduction',
        source_url: 'https://apim.docs.wso2.com/overview', chunk_index: 0,
        content: 'WSO2 API Manager is a full lifecycle API management solution.',
    },
    {
        product: 'apim', title: 'API Manager Overview', section: 'Features',
        source_url: 'https://apim.docs.wso2.com/overview', chunk_index: 1,
        content: 'It supports rate limiting, OAuth 2.0, and API analytics dashboards.',
    },
];

describe('EmbeddingProvider interface contract', () => {
    it('embed returns a 2D array of numbers', async () => {
        const provider = makeProvider([fakeEmbedding]);
        const result = await provider.embed(['hello world']);
        expect(Array.isArray(result)).toBe(true);
        expect(Array.isArray(result[0])).toBe(true);
        expect(result[0]).toHaveLength(1536);
    });

    it('dimensions and modelName are accessible', () => {
        const provider = makeProvider([]);
        expect(typeof provider.dimensions).toBe('number');
        expect(typeof provider.modelName).toBe('string');
    });
});

describe('embedChunks()', () => {
    it('returns empty array for empty input without calling provider', async () => {
        const provider = makeProvider([]);
        const result = await embedChunks([], provider);
        expect(result).toHaveLength(0);
        expect(provider.embed).not.toHaveBeenCalled();
    });

    it('calls provider.embed with one text per chunk', async () => {
        const provider = makeProvider(sampleChunks.map(() => fakeEmbedding));
        await embedChunks(sampleChunks, provider);
        expect(provider.embed).toHaveBeenCalledOnce();
        const texts: string[] = (provider.embed as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(texts).toHaveLength(2);
    });

    it('prepends title, section, and content with newlines', async () => {
        const provider = makeProvider(sampleChunks.map(() => fakeEmbedding));
        await embedChunks(sampleChunks, provider);
        const texts: string[] = (provider.embed as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(texts[0]).toContain('API Manager Overview');
        expect(texts[0]).toContain('Introduction');
        expect(texts[0]).toContain('WSO2 API Manager');
    });

    it('returns one ChunkWithEmbedding per input chunk', async () => {
        const provider = makeProvider(sampleChunks.map(() => fakeEmbedding));
        const result = await embedChunks(sampleChunks, provider);
        expect(result).toHaveLength(2);
        expect(result[0].chunk).toBe(sampleChunks[0]);
        expect(result[0].embedding).toEqual(fakeEmbedding);
        expect(result[1].chunk).toBe(sampleChunks[1]);
        expect(result[1].embedding).toEqual(fakeEmbedding);
    });

    it('handles a single chunk', async () => {
        const single = [sampleChunks[0]];
        const provider = makeProvider([fakeEmbedding]);
        const result = await embedChunks(single, provider);
        expect(result).toHaveLength(1);
        expect(result[0].chunk.product).toBe('apim');
    });

    it('preserves chunk order in output', async () => {
        const embeddings = [Array(1536).fill(0.1), Array(1536).fill(0.2)];
        const provider = makeProvider(embeddings);
        const result = await embedChunks(sampleChunks, provider);
        expect(result[0].embedding[0]).toBeCloseTo(0.1);
        expect(result[1].embedding[0]).toBeCloseTo(0.2);
    });
});
