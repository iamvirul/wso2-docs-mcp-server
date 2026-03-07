import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock env ──────────────────────────────────────────────────────────────────
vi.mock('../../../src/config/env', () => ({
    env: {
        CHUNK_SIZE: 100,
        CHUNK_OVERLAP: 20,
        EMBEDDING_PROVIDER: 'openai',
        OPENAI_API_KEY: 'sk-test',
        DATABASE_URL: 'postgresql://test',
        CACHE_TTL_SECONDS: 60,
        TOP_K_RESULTS: 5,
        EMBEDDING_DIMENSIONS: 1536,
        MCP_SERVER_NAME: 'test',
        MCP_SERVER_VERSION: '1.0.0',
        CRAWL_CONCURRENCY: 2,
        OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
        GEMINI_API_KEY: undefined,
        GEMINI_EMBEDDING_MODEL: 'text-embedding-004',
        VOYAGE_API_KEY: undefined,
        VOYAGE_EMBEDDING_MODEL: 'voyage-3',
    },
}));

import { DocChunker } from '../../../src/ingestion/chunker';
import { ParsedPage } from '../../../src/ingestion/parser';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * CHUNK_SIZE=100 tokens → ~400 chars minimum.
 * Each text must be > 80 chars (~20 tokens) to pass the minimum filter.
 */
const SHORT = 'Content about WSO2 API Manager authentication and authorization mechanisms and security policies.'; // ~96 chars
const MEDIUM = 'Content about WSO2 API Manager authentication and authorization mechanisms. '.repeat(3);
const LONG = 'This section covers the deployment of WSO2 API Manager in Kubernetes environments. '.repeat(50);

const makePage = (
    sections: Array<{ heading: string; text: string; level?: number }>
): ParsedPage => ({
    title: 'Test Page',
    description: 'A test page',
    sections: sections.map((s) => ({ level: s.level ?? 2, heading: s.heading, text: s.text })),
    rawText: sections.map((s) => s.text).join('\n'),
});

const defaultOpts = {
    product: 'apim',
    source_url: 'https://apim.docs.wso2.com/page',
    title: 'Test Page',
};

describe('DocChunker', () => {
    let chunker: DocChunker;

    beforeEach(() => {
        chunker = new DocChunker();
    });

    describe('chunk() — metadata', () => {
        it('assigns correct product, title, source_url, and section', () => {
            const page = makePage([{ heading: 'Overview', text: MEDIUM }]);
            const chunks = chunker.chunk(page, defaultOpts);
            expect(chunks.length).toBeGreaterThan(0);
            expect(chunks[0].product).toBe('apim');
            expect(chunks[0].title).toBe('Test Page');
            expect(chunks[0].source_url).toBe('https://apim.docs.wso2.com/page');
            expect(chunks[0].section).toBe('Overview');
        });

        it('assigns sequential chunk_index starting at 0', () => {
            const page = makePage([{ heading: 'Auth', text: LONG }]);
            const chunks = chunker.chunk(page, defaultOpts);
            chunks.forEach((c, i) => expect(c.chunk_index).toBe(i));
        });

        it('includes version when provided', () => {
            const page = makePage([{ heading: 'Section', text: MEDIUM }]);
            const chunks = chunker.chunk(page, { ...defaultOpts, version: '4.4.0' });
            expect(chunks.length).toBeGreaterThan(0);
            expect(chunks[0].version).toBe('4.4.0');
        });

        it('leaves version undefined when not provided', () => {
            const page = makePage([{ heading: 'Sec', text: MEDIUM }]);
            const chunks = chunker.chunk(page, defaultOpts);
            if (chunks.length > 0) {
                expect(chunks[0].version).toBeUndefined();
            }
        });
    });

    describe('chunk() — splitting behaviour', () => {
        it('returns one chunk for sections within the size limit', () => {
            // SHORT text is well under 100-token limit
            const page = makePage([{ heading: 'Intro', text: SHORT }]);
            const chunks = chunker.chunk(page, defaultOpts);
            expect(chunks.length).toBe(1);
        });

        it('splits long text into multiple chunks', () => {
            const page = makePage([{ heading: 'BigSection', text: LONG }]);
            const chunks = chunker.chunk(page, defaultOpts);
            expect(chunks.length).toBeGreaterThan(1);
        });

        it('all chunks from the same section reference the same heading', () => {
            const page = makePage([{ heading: 'Deployment', text: LONG }]);
            const chunks = chunker.chunk(page, defaultOpts);
            chunks.forEach((c) => expect(c.section).toBe('Deployment'));
        });

        it('skips sections with text shorter than 20 tokens (~80 chars)', () => {
            const page = makePage([
                { heading: 'Tiny', text: 'Hi.' },
                { heading: 'Real', text: MEDIUM },
            ]);
            const chunks = chunker.chunk(page, defaultOpts);
            const sections = chunks.map((c) => c.section);
            expect(sections).not.toContain('Tiny');
            expect(sections).toContain('Real');
        });

        it('returns empty array for page with no meaningful sections', () => {
            const page = makePage([{ heading: 'X', text: 'Ok.' }]);
            expect(chunker.chunk(page, defaultOpts)).toHaveLength(0);
        });

        it('handles multiple sections independently', () => {
            const page = makePage([
                { heading: 'SectionA', text: MEDIUM },
                { heading: 'SectionB', text: MEDIUM },
            ]);
            const chunks = chunker.chunk(page, defaultOpts);
            const headings = [...new Set(chunks.map((c) => c.section))];
            expect(headings).toContain('SectionA');
            expect(headings).toContain('SectionB');
        });
    });

    describe('chunk() — content', () => {
        it('chunk content is non-empty', () => {
            const page = makePage([{ heading: 'S', text: MEDIUM }]);
            const chunks = chunker.chunk(page, defaultOpts);
            chunks.forEach((c) => expect(c.content.trim().length).toBeGreaterThan(0));
        });
    });
});
