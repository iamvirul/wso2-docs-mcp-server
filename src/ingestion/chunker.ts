import { env } from '../config/env';
import { ParsedPage } from './parser';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DocChunk {
    product: string;
    title: string;
    section: string;
    source_url: string;
    chunk_index: number;
    content: string;
    version?: string;
}

interface ChunkerOptions {
    chunkSize?: number;   // approximate token count
    chunkOverlap?: number;
    product: string;
    source_url: string;
    title: string;
    version?: string;
}

// ── DocChunker ────────────────────────────────────────────────────────────────

export class DocChunker {
    private chunkSize: number;
    private chunkOverlap: number;

    constructor() {
        this.chunkSize = env.CHUNK_SIZE;
        this.chunkOverlap = env.CHUNK_OVERLAP;
    }

    chunk(page: ParsedPage, opts: ChunkerOptions): DocChunk[] {
        const chunks: DocChunk[] = [];
        let chunkIdx = 0;
        let prevTail = '';

        for (const section of page.sections) {
            if (!section.text.trim()) continue;

            const fullText = section.text.trim();
            const subChunks = this.splitIntoChunks(fullText, prevTail);

            for (const text of subChunks) {
                if (tokens(text) < 20) continue; // skip very short fragments
                chunks.push({
                    product: opts.product,
                    title: opts.title,
                    section: section.heading || opts.title,
                    source_url: opts.source_url,
                    chunk_index: chunkIdx++,
                    content: text.trim(),
                    version: opts.version,
                });
            }

            // carry tail for overlap into the next section
            if (fullText.length > 0) {
                prevTail = tailOf(fullText, this.chunkOverlap);
            }
        }

        return chunks;
    }

    private splitIntoChunks(text: string, leadingOverlap: string): string[] {
        if (tokens(text) <= this.chunkSize) {
            return [leadingOverlap ? leadingOverlap + ' ' + text : text];
        }

        // Split by sentence boundaries
        const sentences = text
            .split(/(?<=[.!?])\s+/)
            .filter((s) => s.trim().length > 0);

        const chunks: string[] = [];
        let current = leadingOverlap ? leadingOverlap + ' ' : '';

        for (const sentence of sentences) {
            const appended = current + sentence + ' ';
            if (tokens(appended) > this.chunkSize && current.trim()) {
                chunks.push(current.trim());
                // overlap: carry tail into next chunk
                current = tailOf(current, this.chunkOverlap) + ' ' + sentence + ' ';
            } else {
                current = appended;
            }
        }

        if (current.trim()) {
            chunks.push(current.trim());
        }

        return chunks.length > 0 ? chunks : [text];
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Approximate token count (1 token ≈ 4 chars) */
function tokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/** Return the last `overlapTokens` worth of text from a string */
function tailOf(text: string, overlapTokens: number): string {
    const chars = overlapTokens * 4;
    return text.length <= chars ? text : text.slice(-chars);
}
