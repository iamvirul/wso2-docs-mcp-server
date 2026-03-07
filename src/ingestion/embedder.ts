import OpenAI from 'openai';
import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';
import axios from 'axios';
import { env } from '../config/env';
import { DocChunk } from './chunker';

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
            case 'gemini':
                return new GeminiEmbeddingProvider();
            case 'voyage':
                return new VoyageEmbeddingProvider();
            case 'openai':
            default:
                return new OpenAIEmbeddingProvider();
        }
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
