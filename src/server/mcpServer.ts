import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PgVectorStore } from '../vectorstore/pgvector';
import { EmbedderFactory } from '../ingestion/embedder';
import { registerTools } from './toolRegistry';
import { env } from '../config/env';

export async function startMcpServer(): Promise<void> {
    // ── Initialize dependencies ──────────────────────────────────────────────────
    const vectorStore = new PgVectorStore();
    await vectorStore.initialize();

    const embeddingProvider = await EmbedderFactory.createAndInit();

    // ── Create MCP server ─────────────────────────────────────────────────────────
    const server = new McpServer({
        name: env.MCP_SERVER_NAME,
        version: env.MCP_SERVER_VERSION,
    });

    // ── Register all tools ─────────────────────────────────────────────────────────
    registerTools(server, { vectorStore, embeddingProvider });

    // ── Connect via stdio ─────────────────────────────────────────────────────────
    const transport = new StdioServerTransport();
    await server.connect(transport);

    // ── Graceful shutdown ─────────────────────────────────────────────────────────
    const shutdown = async (signal: string) => {
        process.stderr.write(`\nReceived ${signal}, shutting down…\n`);
        try {
            await server.close();
            await vectorStore.close();
        } catch (_) { /* ignore */ }
        process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}
