import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────
vi.mock('../../../src/config/env', () => ({
    env: {
        DATABASE_URL: 'postgresql://test',
        CACHE_TTL_SECONDS: 60,
        TOP_K_RESULTS: 5,
        EMBEDDING_PROVIDER: 'openai',
        OPENAI_API_KEY: 'sk-test',
        OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
        GEMINI_API_KEY: 'g',
        GEMINI_EMBEDDING_MODEL: 'text-embedding-004',
        VOYAGE_API_KEY: 'v',
        VOYAGE_EMBEDDING_MODEL: 'voyage-3',
        EMBEDDING_DIMENSIONS: 1536,
        CHUNK_SIZE: 800,
        CHUNK_OVERLAP: 100,
        CRAWL_CONCURRENCY: 2,
        MCP_SERVER_NAME: 'test',
        MCP_SERVER_VERSION: '1.0.0',
    },
}));

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
    McpServer: vi.fn(),
}));

import { registerTools, ToolDeps } from '../../../src/server/toolRegistry';

// ── Mock McpServer that captures registered tools ─────────────────────────────
type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

function createMockServer() {
    const tools = new Map<string, { description: string; handler: ToolHandler }>();
    return {
        tool: vi.fn((name: string, description: string, _schema: unknown, handler: ToolHandler) => {
            tools.set(name, { description, handler });
        }),
        registeredTools: tools,
    } as any;
}

// ── Mock deps ─────────────────────────────────────────────────────────────────
const mockSimilaritySearch = vi.fn();
const mockEmbed = vi.fn();

const deps: ToolDeps = {
    vectorStore: { similaritySearch: mockSimilaritySearch } as any,
    embeddingProvider: { embed: mockEmbed, dimensions: 1536, modelName: 'test-model' },
};

const fakeEmbedding = Array(1536).fill(0.1);
const sampleResult = {
    id: 'u1',
    product: 'apim',
    title: 'API Gateway',
    section: 'Overview',
    source_url: 'https://apim.docs.wso2.com/gateway',
    chunk_index: 0,
    content: 'The API Gateway handles all incoming API requests.',
    version: null,
    score: 0.91,
};

describe('toolRegistry — registerTools()', () => {
    let server: ReturnType<typeof createMockServer>;

    beforeEach(() => {
        vi.clearAllMocks();
        server = createMockServer();
        mockEmbed.mockResolvedValue([fakeEmbedding]);
        mockSimilaritySearch.mockResolvedValue([sampleResult]);
        registerTools(server, deps);
    });

    it('registers exactly 4 tools', () => {
        expect(server.tool).toHaveBeenCalledTimes(4);
    });

    it('registers search_wso2_docs', () => {
        expect(server.registeredTools.has('search_wso2_docs')).toBe(true);
    });

    it('registers get_wso2_guide', () => {
        expect(server.registeredTools.has('get_wso2_guide')).toBe(true);
    });

    it('registers explain_wso2_concept', () => {
        expect(server.registeredTools.has('explain_wso2_concept')).toBe(true);
    });

    it('registers list_wso2_products', () => {
        expect(server.registeredTools.has('list_wso2_products')).toBe(true);
    });
});

describe('search_wso2_docs handler', () => {
    let server: ReturnType<typeof createMockServer>;

    beforeEach(() => {
        vi.clearAllMocks();
        server = createMockServer();
        mockEmbed.mockResolvedValue([fakeEmbedding]);
        mockSimilaritySearch.mockResolvedValue([sampleResult]);
        registerTools(server, deps);
    });

    it('embeds the query and calls similaritySearch', async () => {
        const handler = server.registeredTools.get('search_wso2_docs')!.handler;
        await handler({ query: 'how to deploy API Manager', limit: 3 });

        expect(mockEmbed).toHaveBeenCalledWith(['how to deploy API Manager']);
        expect(mockSimilaritySearch).toHaveBeenCalledWith(fakeEmbedding, { product: undefined, limit: 3 });
    });

    it('returns formatted RAG results with score', async () => {
        const handler = server.registeredTools.get('search_wso2_docs')!.handler;
        const response = await handler({ query: 'gateway', limit: 5 }) as any;
        const parsed = JSON.parse(response.content[0].text);

        expect(parsed[0].title).toBe('API Gateway');
        expect(parsed[0].source_url).toBe('https://apim.docs.wso2.com/gateway');
        expect(typeof parsed[0].score).toBe('number');
        expect(parsed[0].product).toBe('apim');
    });

    it('returns helpful message when no results found', async () => {
        mockSimilaritySearch.mockResolvedValueOnce([]);
        const handler = server.registeredTools.get('search_wso2_docs')!.handler;
        const response = await handler({ query: 'nothing', limit: 5 }) as any;

        expect(response.content[0].text).toContain('npm run crawl');
    });

    it('passes product filter to similaritySearch', async () => {
        const handler = server.registeredTools.get('search_wso2_docs')!.handler;
        await handler({ query: 'publishing APIs', product: 'apim', limit: 5 });

        expect(mockSimilaritySearch).toHaveBeenCalledWith(fakeEmbedding, { product: 'apim', limit: 5 });
    });
});

describe('get_wso2_guide handler', () => {
    let server: ReturnType<typeof createMockServer>;

    beforeEach(() => {
        vi.clearAllMocks();
        server = createMockServer();
        mockEmbed.mockResolvedValue([fakeEmbedding]);
        mockSimilaritySearch.mockResolvedValue([sampleResult]);
        registerTools(server, deps);
    });

    it('forces product filter and limit=5', async () => {
        const handler = server.registeredTools.get('get_wso2_guide')!.handler;
        await handler({ topic: 'OAuth setup', product: 'apim' });

        expect(mockSimilaritySearch).toHaveBeenCalledWith(fakeEmbedding, { product: 'apim', limit: 5 });
    });

    it('prefixes query with product name', async () => {
        const handler = server.registeredTools.get('get_wso2_guide')!.handler;
        await handler({ topic: 'publish API', product: 'apim' });

        const queryText = mockEmbed.mock.calls[0][0][0];
        expect(queryText).toContain('API Manager');
        expect(queryText).toContain('publish API');
    });
});

describe('explain_wso2_concept handler', () => {
    let server: ReturnType<typeof createMockServer>;

    beforeEach(() => {
        vi.clearAllMocks();
        server = createMockServer();
        mockEmbed.mockResolvedValue([fakeEmbedding]);
        mockSimilaritySearch.mockResolvedValue([sampleResult]);
        registerTools(server, deps);
    });

    it('searches limit=8 across all products', async () => {
        const handler = server.registeredTools.get('explain_wso2_concept')!.handler;
        await handler({ concept: 'mediation' });

        expect(mockSimilaritySearch).toHaveBeenCalledWith(fakeEmbedding, { limit: 8 });
    });

    it('returns context with concept field', async () => {
        const handler = server.registeredTools.get('explain_wso2_concept')!.handler;
        const response = await handler({ concept: 'rate limiting' }) as any;
        const parsed = JSON.parse(response.content[0].text);

        expect(parsed.concept).toBe('rate limiting');
        expect(Array.isArray(parsed.context)).toBe(true);
    });
});

describe('list_wso2_products handler', () => {
    let server: ReturnType<typeof createMockServer>;

    beforeEach(() => {
        vi.clearAllMocks();
        server = createMockServer();
        registerTools(server, deps);
    });

    it('returns all 6 products', async () => {
        const handler = server.registeredTools.get('list_wso2_products')!.handler;
        const response = await handler({}) as any;
        const products = JSON.parse(response.content[0].text);

        expect(products).toHaveLength(6);
    });

    it('each product has id, name, description, base_url', async () => {
        const handler = server.registeredTools.get('list_wso2_products')!.handler;
        const response = await handler({}) as any;
        const products = JSON.parse(response.content[0].text);

        products.forEach((p: any) => {
            expect(p.id).toBeTruthy();
            expect(p.name).toBeTruthy();
            expect(p.description).toBeTruthy();
            expect(p.base_url).toMatch(/^https:\/\//);
        });
    });

    it('does not call embeddingProvider or vectorStore', async () => {
        const handler = server.registeredTools.get('list_wso2_products')!.handler;
        await handler({});
        expect(mockEmbed).not.toHaveBeenCalled();
        expect(mockSimilaritySearch).not.toHaveBeenCalled();
    });
});
