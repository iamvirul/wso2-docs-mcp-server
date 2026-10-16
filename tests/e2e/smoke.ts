/**
 * End-to-end smoke test against the *installed npm package*, not the source tree.
 *
 * Catches failures unit tests cannot see: broken ESM output, missing files in the
 * published tarball, bin wiring, dependency major-version breaks, and schema/SQL drift
 * against a real pgvector database.
 *
 * Required env:
 *   SMOKE_PACKAGE_DIR  absolute path to the installed package (…/node_modules/wso2-docs-mcp-server)
 *   SMOKE_BIN_DIR      absolute path to the consumer's node_modules/.bin
 *   DATABASE_URL       migrated pgvector database
 *
 * Run: npm run test:smoke
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Model download + load happens before the server accepts the handshake.
const REQUEST_TIMEOUT_MS = 300_000;
const EXPECTED_TOOLS = [
    'explain_wso2_concept',
    'get_wso2_guide',
    'list_wso2_products',
    'search_wso2_docs',
];
const SEED = {
    product: 'apim',
    title: 'Smoke Test: Rate Limiting',
    section: 'Throttling policies',
    source_url: 'https://apim.docs.wso2.com/en/latest/smoke-test/rate-limiting/',
    chunk_index: 0,
    content: 'WSO2 API Manager applies rate limiting through subscription and advanced throttling policies.',
    content_hash: 'smoke-test-seed',
};

type EmbedderModule = typeof import('../../src/ingestion/embedder.js');
type VectorStoreModule = typeof import('../../src/vectorstore/pgvector.js');
type TextContent = { type: 'text'; text: string };

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required env var ${name}`);
    return value;
}

function loadFromPackage<T>(packageDir: string, relativePath: string): Promise<T> {
    // Dynamic import of the installed artifact; the type comes from the matching source file.
    return import(pathToFileURL(path.join(packageDir, relativePath)).href) as Promise<T>;
}

function firstText(result: Awaited<ReturnType<Client['callTool']>>): string {
    const content = result.content as TextContent[];
    assert.ok(content.length > 0 && content[0].type === 'text', 'tool returned no text content');
    return content[0].text;
}

function stringEnv(): Record<string, string> {
    // StdioClientTransport only forwards a minimal env by default; the server needs DATABASE_URL etc.
    return Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
    );
}

async function seedOneChunk(packageDir: string): Promise<void> {
    const { EmbedderFactory } = await loadFromPackage<EmbedderModule>(packageDir, 'dist/src/ingestion/embedder.js');
    const { PgVectorStore } = await loadFromPackage<VectorStoreModule>(packageDir, 'dist/src/vectorstore/pgvector.js');

    const embedder = await EmbedderFactory.createAndInit();
    const [embedding] = await embedder.embed([SEED.content]);
    assert.equal(embedding.length, embedder.dimensions, 'embedding dimension mismatch');

    const store = new PgVectorStore();
    try {
        await store.initialize();
        await store.upsertChunks([{ ...SEED, embedding }]);
    } finally {
        await store.close();
    }
}

async function exerciseServer(binDir: string): Promise<void> {
    const transport = new StdioClientTransport({
        command: path.join(binDir, 'wso2-docs-mcp-server'),
        env: stringEnv(),
        stderr: 'inherit',
    });
    const client = new Client({ name: 'ci-smoke', version: '1.0.0' });
    const opts = { timeout: REQUEST_TIMEOUT_MS };

    await client.connect(transport, opts);
    try {
        const { tools } = await client.listTools(undefined, opts);
        assert.deepEqual(tools.map((t) => t.name).sort(), EXPECTED_TOOLS);
        console.log('✔ tools/list returned all expected tools');

        const products: Array<{ id: string }> = JSON.parse(
            firstText(await client.callTool({ name: 'list_wso2_products', arguments: {} }, undefined, opts))
        );
        assert.ok(products.some((p) => p.id === SEED.product), `list_wso2_products missing ${SEED.product}`);
        console.log('✔ list_wso2_products');

        const search = await client.callTool(
            { name: 'search_wso2_docs', arguments: { query: 'How do I configure rate limiting?', product: 'apim', limit: 3 } },
            undefined,
            opts
        );
        assert.notEqual(search.isError, true, `search_wso2_docs errored: ${firstText(search)}`);
        assert.ok(firstText(search).includes(SEED.source_url), 'search_wso2_docs did not return the seeded chunk');
        console.log('✔ search_wso2_docs returned seeded chunk (embedding + pgvector query)');

        const invalid = await client.callTool({ name: 'search_wso2_docs', arguments: { query: '' } }, undefined, opts);
        assert.equal(invalid.isError, true, 'empty query should be rejected by input validation');
        console.log('✔ input validation rejects empty query');
    } finally {
        await client.close();
    }
}

async function main(): Promise<void> {
    const packageDir = requireEnv('SMOKE_PACKAGE_DIR');
    const binDir = requireEnv('SMOKE_BIN_DIR');
    requireEnv('DATABASE_URL');

    await seedOneChunk(packageDir);
    console.log('✔ seeded one chunk via installed package');
    await exerciseServer(binDir);
    console.log('\nSmoke test passed.');
}

main().catch((err: unknown) => {
    console.error('Smoke test failed:', err);
    process.exit(1);
});
