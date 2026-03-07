import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const schema = z.object({
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    EMBEDDING_PROVIDER: z.enum(['ollama', 'openai', 'gemini', 'voyage']).default('ollama'),

    OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
    OLLAMA_EMBEDDING_MODEL: z.string().default('nomic-embed-text'),
    // HuggingFace model used when Ollama is not running (ONNX, runs in-process)
    HUGGINGFACE_EMBEDDING_MODEL: z.string().default('Xenova/nomic-embed-text-v1'),

    OPENAI_API_KEY: z.string().optional(),
    OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),

    GEMINI_API_KEY: z.string().optional(),
    GEMINI_EMBEDDING_MODEL: z.string().default('text-embedding-004'),

    VOYAGE_API_KEY: z.string().optional(),
    VOYAGE_EMBEDDING_MODEL: z.string().default('voyage-3'),

    EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(768),

    MCP_SERVER_NAME: z.string().default('wso2-docs-mcp'),
    MCP_SERVER_VERSION: z.string().default('1.0.0'),

    CRAWL_CONCURRENCY: z.coerce.number().int().positive().default(10),
    CHUNK_SIZE: z.coerce.number().int().positive().default(800),
    CHUNK_OVERLAP: z.coerce.number().int().nonnegative().default(100),
    CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
    TOP_K_RESULTS: z.coerce.number().int().positive().default(10),
});

const result = schema.safeParse(process.env);

if (!result.success) {
    console.error('❌  Invalid environment configuration:');
    result.error.errors.forEach((e) =>
        console.error(`   ${e.path.join('.')}: ${e.message}`)
    );
    process.exit(1);
}

export const env = result.data;
export type Env = typeof env;
