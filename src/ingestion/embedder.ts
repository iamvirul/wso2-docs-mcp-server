import OpenAI from 'openai';
import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';
import axios from 'axios';
import type { Readable } from 'stream';
import { env } from '../config/env';
import { DocChunk } from './chunker';

// ── Ollama API types ──────────────────────────────────────────────────────────

interface OllamaTagsResponse {
    models: Array<{ name: string }>;
}

interface OllamaEmbedResponse {
    embeddings: number[][];
}

interface OllamaPullChunk {
    status: string;
    total?: number;
    completed?: number;
}

// ── Provider Interface ────────────────────────────────────────────────────────

export interface EmbeddingProvider {
    embed(texts: string[]): Promise<number[][]>;
    readonly dimensions: number;
    readonly modelName: string;
}

export interface ChunkWithEmbedding {
    chunk: DocChunk;
    embedding: number[];
}

// ── HuggingFace Local Provider (ONNX, in-process, no server required) ────────

class HuggingFaceLocalEmbeddingProvider implements EmbeddingProvider {
    // Typed as unknown to avoid importing the heavy type at module load time;
    // the actual pipeline is loaded lazily via dynamic import.
    private extractor: unknown = null;
    readonly dimensions: number;
    readonly modelName: string;

    constructor() {
        this.modelName = env.HUGGINGFACE_EMBEDDING_MODEL;
        this.dimensions = env.EMBEDDING_DIMENSIONS;
    }

    /**
     * Downloads (once) and loads the ONNX model into memory.
     * Subsequent calls are no-ops once the extractor is initialized.
     */
    async initialize(): Promise<void> {
        if (this.extractor !== null) return;

        process.stderr.write(
            `  Loading HuggingFace model "${this.modelName}" via ONNX (downloads on first run)…\n`
        );

        // Dynamic import keeps the heavy @huggingface/transformers out of the
        // module graph until it is actually needed.
        const { pipeline } = await import('@huggingface/transformers');
        this.extractor = await pipeline('feature-extraction', this.modelName, {
            dtype: 'fp32',
        });

        process.stderr.write(`  HuggingFace model "${this.modelName}" ready.\n`);
    }

    async embed(texts: string[]): Promise<number[][]> {
        if (this.extractor === null) {
            throw new Error('HuggingFaceLocalEmbeddingProvider not initialized — call initialize() first.');
        }

        const BATCH = 16; // conservative for in-process ONNX inference
        const results: number[][] = [];
        const extractor = this.extractor as (
            input: string[],
            options: { pooling: string; normalize: boolean }
        ) => Promise<{ tolist(): number[][] }>;

        for (let i = 0; i < texts.length; i += BATCH) {
            const batch = texts.slice(i, i + BATCH);
            const output = await extractor(batch, { pooling: 'mean', normalize: true });
            results.push(...output.tolist());
        }

        return results;
    }
}

// ── Ollama Provider (local, no API key required) ──────────────────────────────
// Falls back to HuggingFace local ONNX inference when Ollama is not running.

class OllamaEmbeddingProvider implements EmbeddingProvider {
    private readonly baseUrl: string;
    readonly dimensions: number;
    readonly modelName: string;
    /** Non-null when Ollama was unreachable at startup and we fell back to HF. */
    private hfFallback: HuggingFaceLocalEmbeddingProvider | null = null;

    constructor() {
        this.baseUrl = env.OLLAMA_BASE_URL;
        this.modelName = env.OLLAMA_EMBEDDING_MODEL;
        this.dimensions = env.EMBEDDING_DIMENSIONS;
    }

    /**
     * Checks Ollama reachability:
     * - Ollama running + model present  → ready immediately
     * - Ollama running + model missing  → pulls the model via Ollama
     * - Ollama not running              → falls back to HuggingFace local ONNX
     */
    async ensureModel(): Promise<void> {
        const ollamaUp = await this.isOllamaReachable();

        if (!ollamaUp) {
            process.stderr.write(
                `  Ollama not running at ${this.baseUrl} — falling back to HuggingFace local ONNX inference.\n`
            );
            this.hfFallback = new HuggingFaceLocalEmbeddingProvider();
            await this.hfFallback.initialize();
            return;
        }

        const modelPresent = await this.isModelPresent();
        if (!modelPresent) {
            await this.pullModel();
        }
    }

    private async isOllamaReachable(): Promise<boolean> {
        try {
            await axios.get(`${this.baseUrl}/api/tags`, { timeout: 3_000 });
            return true;
        } catch {
            return false;
        }
    }

    private async isModelPresent(): Promise<boolean> {
        const response = await axios.get<OllamaTagsResponse>(`${this.baseUrl}/api/tags`);
        return response.data.models.some(
            (m) => m.name === this.modelName || m.name === `${this.modelName}:latest`
        );
    }

    private async pullModel(): Promise<void> {
        process.stderr.write(`  Pulling Ollama model "${this.modelName}" — this runs once…\n`);

        const response = await axios.post<Readable>(
            `${this.baseUrl}/api/pull`,
            { name: this.modelName, stream: true },
            { responseType: 'stream' }
        );

        await new Promise<void>((resolve, reject) => {
            let lastStatus = '';
            response.data.on('data', (raw: Buffer) => {
                const lines = raw.toString().split('\n').filter(Boolean);
                for (const line of lines) {
                    try {
                        const chunk: OllamaPullChunk = JSON.parse(line);
                        if (chunk.status !== lastStatus) {
                            process.stderr.write(`  [ollama pull] ${chunk.status}\n`);
                            lastStatus = chunk.status;
                        }
                    } catch {
                        // ignore non-JSON lines
                    }
                }
            });
            response.data.on('end', resolve);
            response.data.on('error', reject);
        });

        process.stderr.write(`  Model "${this.modelName}" ready.\n`);
    }

    async embed(texts: string[]): Promise<number[][]> {
        if (this.hfFallback !== null) {
            return this.hfFallback.embed(texts);
        }

        const BATCH = 32;
        const results: number[][] = [];

        for (let i = 0; i < texts.length; i += BATCH) {
            const batch = texts.slice(i, i + BATCH);
            const response = await withRetry(() =>
                axios.post<OllamaEmbedResponse>(
                    `${this.baseUrl}/api/embed`,
                    { model: this.modelName, input: batch }
                )
            );
            results.push(...response.data.embeddings);
        }

        return results;
    }
}

// ── OpenAI Provider ────────────────────────────────────────────────────────────

class OpenAIEmbeddingProvider implements EmbeddingProvider {
    private client: OpenAI;
    readonly dimensions: number;
    readonly modelName: string;

    constructor() {
        if (!env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai');
        }
        this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
        this.modelName = env.OPENAI_EMBEDDING_MODEL;
        this.dimensions = env.EMBEDDING_DIMENSIONS;
    }

    async embed(texts: string[]): Promise<number[][]> {
        const BATCH = 100;
        const results: number[][] = [];

        for (let i = 0; i < texts.length; i += BATCH) {
            const batch = texts.slice(i, i + BATCH);
            const response = await withRetry(() =>
                this.client.embeddings.create({
                    model: this.modelName,
                    input: batch,
                    ...(this.modelName.includes('3') && { dimensions: this.dimensions }),
                })
            );
            results.push(...response.data.map((d) => d.embedding));
        }

        return results;
    }
}

// ── Google Gemini Provider ─────────────────────────────────────────────────────

class GeminiEmbeddingProvider implements EmbeddingProvider {
    private genAI: GoogleGenerativeAI;
    readonly dimensions: number;
    readonly modelName: string;

    constructor() {
        if (!env.GEMINI_API_KEY) {
            throw new Error('GEMINI_API_KEY is required when EMBEDDING_PROVIDER=gemini');
        }
        this.genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
        this.modelName = env.GEMINI_EMBEDDING_MODEL;
        this.dimensions = env.EMBEDDING_DIMENSIONS;
    }

    async embed(texts: string[]): Promise<number[][]> {
        const BATCH = 100;
        const results: number[][] = [];
        const model = this.genAI.getGenerativeModel({ model: this.modelName });

        for (let i = 0; i < texts.length; i += BATCH) {
            const batch = texts.slice(i, i + BATCH);
            const response = await withRetry(() =>
                model.batchEmbedContents({
                    requests: batch.map((text) => ({
                        content: { parts: [{ text }], role: 'user' as const },
                        taskType: TaskType.RETRIEVAL_DOCUMENT,
                    })),
                })
            );
            results.push(...response.embeddings.map((e) => e.values));
        }

        return results;
    }
}

// ── Voyage AI Provider (REST) ──────────────────────────────────────────────────

class VoyageEmbeddingProvider implements EmbeddingProvider {
    private readonly apiKey: string;
    private readonly baseUrl = 'https://api.voyageai.com/v1';
    readonly dimensions: number;
    readonly modelName: string;

    constructor() {
        if (!env.VOYAGE_API_KEY) {
            throw new Error('VOYAGE_API_KEY is required when EMBEDDING_PROVIDER=voyage');
        }
        this.apiKey = env.VOYAGE_API_KEY;
        this.modelName = env.VOYAGE_EMBEDDING_MODEL;
        this.dimensions = env.EMBEDDING_DIMENSIONS;
    }

    async embed(texts: string[]): Promise<number[][]> {
        const BATCH = 128;
        const results: number[][] = [];

        for (let i = 0; i < texts.length; i += BATCH) {
            const batch = texts.slice(i, i + BATCH);
            const response = await withRetry(() =>
                axios.post<{ data: Array<{ embedding: number[] }> }>(
                    `${this.baseUrl}/embeddings`,
                    { input: batch, model: this.modelName, input_type: 'document' },
                    { headers: { Authorization: `Bearer ${this.apiKey}` } }
                )
            );
            results.push(...response.data.data.map((d) => d.embedding));
        }

        return results;
    }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export class EmbedderFactory {
    static create(): EmbeddingProvider {
        switch (env.EMBEDDING_PROVIDER) {
            case 'ollama':
                return new OllamaEmbeddingProvider();
            case 'gemini':
                return new GeminiEmbeddingProvider();
            case 'voyage':
                return new VoyageEmbeddingProvider();
            case 'openai':
            default:
                return new OpenAIEmbeddingProvider();
        }
    }

    /**
     * Creates the provider and, for Ollama, ensures the model is downloaded.
     * Call this at startup instead of `create()` when auto-pull is desired.
     */
    static async createAndInit(): Promise<EmbeddingProvider> {
        const provider = EmbedderFactory.create();
        if (provider instanceof OllamaEmbeddingProvider) {
            await provider.ensureModel();
        }
        return provider;
    }
}

// ── Batch embed helper ────────────────────────────────────────────────────────

export async function embedChunks(
    chunks: DocChunk[],
    provider: EmbeddingProvider
): Promise<ChunkWithEmbedding[]> {
    if (chunks.length === 0) return [];
    const texts = chunks.map((c) => `${c.title}\n${c.section}\n${c.content}`);
    const embeddings = await provider.embed(texts);
    return chunks.map((chunk, i) => ({ chunk, embedding: embeddings[i] }));
}

// ── Retry helper ──────────────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err: any) {
            const status = err?.status ?? err?.response?.status;
            const retryable = status === 429 || status === 503 || status === 500;
            if (retryable && attempt < maxRetries) {
                const delay = Math.pow(2, attempt) * 1000 + Math.random() * 200;
                console.warn(`  Embedding rate-limited, retrying in ${Math.round(delay)}ms…`);
                await sleep(delay);
                continue;
            }
            throw err;
        }
    }
    throw new Error('Max retries exceeded');
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
