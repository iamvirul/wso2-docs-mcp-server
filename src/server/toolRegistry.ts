import { DocSearchResult } from '../vectorstore/pgvector';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PgVectorStore } from '../vectorstore/pgvector';
import { EmbeddingProvider } from '../ingestion/embedder';
import { z } from 'zod';
import { PRODUCTS } from '../config/constants';

// ── Hoisted schemas (prevents TS2589 deep type instantiation) ─────────────────

const productEnum = z.enum(['apim', 'choreo', 'ballerina', 'mi', 'bi', 'library']);

const searchDocsSchema = {
    query: z.string().min(1).describe('Natural language search query'),
    product: productEnum.optional().describe('Filter to a specific WSO2 product'),
    limit: z.number().int().min(1).max(20).optional().describe('Max results (default 5)'),
};

const getGuideSchema = {
    topic: z.string().min(1).describe('Topic or concept to look up'),
    product: productEnum.describe('WSO2 product to search within'),
};

const explainConceptSchema = {
    concept: z.string().min(1).describe('The WSO2 concept, feature, or term to explain'),
};

// ── Types shared across tools ─────────────────────────────────────────────────

export interface ToolDeps {
    vectorStore: PgVectorStore;
    embeddingProvider: EmbeddingProvider;
}

export interface RagResult {
    title: string;
    snippet: string;
    source_url: string;
    product: string;
    section: string | null;
    score: number;
}

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerTools(server: McpServer, deps: ToolDeps): void {
    registerSearchDocs(server, deps);
    registerGetGuide(server, deps);
    registerExplainConcept(server, deps);
    registerListProducts(server);
}

// ── search_wso2_docs ──────────────────────────────────────────────────────────

function registerSearchDocs(server: McpServer, deps: ToolDeps): void {
    // @ts-ignore: TS2589 — MCP SDK deeply nested overload triggers false positive
    server.tool(
        'search_wso2_docs',
        'Semantically search across all indexed WSO2 documentation and return the most relevant sections with metadata and source URLs.',
        searchDocsSchema,
        async ({ query, product, limit }) => {
            const embedding = (await deps.embeddingProvider.embed([query]))[0];
            const results = await deps.vectorStore.similaritySearch(embedding, {
                product,
                limit: limit ?? 5,
            });

            if (results.length === 0) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: 'No results found. The documentation index may be empty. Run `npm run crawl` to index the documentation.',
                        },
                    ],
                };
            }

            const formatted = toRagResults(results);
            return {
                content: [{ type: 'text' as const, text: JSON.stringify(formatted, null, 2) }],
            };
        }
    );
}

// ── get_wso2_guide ────────────────────────────────────────────────────────────

function registerGetGuide(server: McpServer, deps: ToolDeps): void {
    // @ts-ignore: TS2589 — MCP SDK deeply nested overload triggers false positive
    server.tool(
        'get_wso2_guide',
        'Retrieve documentation sections focused on a specific WSO2 product and topic.',
        getGuideSchema,
        async ({ topic, product }) => {
            const query = `${PRODUCTS[product]?.name ?? product}: ${topic}`;
            const embedding = (await deps.embeddingProvider.embed([query]))[0];
            const results = await deps.vectorStore.similaritySearch(embedding, {
                product,
                limit: 5,
            });

            if (results.length === 0) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `No documentation found for "${topic}" in ${product}. Ensure the product is indexed by running: npm run crawl -- --product ${product}`,
                        },
                    ],
                };
            }

            const formatted = toRagResults(results);
            return {
                content: [{ type: 'text' as const, text: JSON.stringify(formatted, null, 2) }],
            };
        }
    );
}

// ── explain_wso2_concept ──────────────────────────────────────────────────────

function registerExplainConcept(server: McpServer, deps: ToolDeps): void {
    // @ts-ignore: TS2589 — MCP SDK deeply nested overload triggers false positive
    server.tool(
        'explain_wso2_concept',
        'Retrieve comprehensive documentation context for a WSO2 concept, searched across all products.',
        explainConceptSchema,
        async ({ concept }) => {
            const embedding = (await deps.embeddingProvider.embed([concept]))[0];
            const results = await deps.vectorStore.similaritySearch(embedding, {
                limit: 8,
            });

            if (results.length === 0) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `No documentation found for concept: "${concept}". Run \`npm run crawl\` to index documentation first.`,
                        },
                    ],
                };
            }

            const formatted = toRagResults(results);
            const response = {
                concept,
                context: formatted,
                note: 'Use the source_url links to access full documentation pages.',
            };

            return {
                content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
            };
        }
    );
}

// ── list_wso2_products ────────────────────────────────────────────────────────

function registerListProducts(server: McpServer): void {
    // @ts-ignore: TS2589 — MCP SDK deeply nested overload triggers false positive
    server.tool(
        'list_wso2_products',
        'List all supported WSO2 documentation sources with their product IDs and base URLs.',
        {},
        async () => {
            const products = Object.values(PRODUCTS).map((p) => ({
                id: p.id,
                name: p.name,
                description: p.description,
                base_url: p.baseUrl,
                ...(p.version && { version: p.version }),
            }));

            return {
                content: [{ type: 'text' as const, text: JSON.stringify(products, null, 2) }],
            };
        }
    );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toRagResults(results: DocSearchResult[]): RagResult[] {
    return results.map((r) => ({
        title: r.title,
        snippet: r.content.length > 800 ? r.content.slice(0, 800) + '…' : r.content,
        source_url: r.source_url,
        product: r.product,
        section: r.section,
        score: parseFloat(r.score.toFixed(4)),
    }));
}
