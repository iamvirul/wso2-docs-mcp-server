import { describe, it, expect } from 'vitest';
import { DocParser } from '../../../src/ingestion/parser';

const parser = new DocParser();

describe('DocParser', () => {
    describe('parse() — title extraction', () => {
        it('extracts title from og:title meta', () => {
            const html = `<html>
        <head><meta property="og:title" content="API Manager Docs"></head>
        <body><main><h1>Other Heading</h1><p>Some content here</p></main></body>
      </html>`;
            expect(parser.parse(html, 'https://example.com').title).toBe('API Manager Docs');
        });

        it('falls back to <title> tag when no og:title', () => {
            const html = `<html>
        <head><title>My Page Title</title></head>
        <body><main><p>Content here for parsing purposes</p></main></body>
      </html>`;
            expect(parser.parse(html, 'https://example.com').title).toBe('My Page Title');
        });

        it('falls back to first h1 when no meta or title', () => {
            const html = `<html><body><main><h1>Page Heading</h1><p>content</p></main></body></html>`;
            expect(parser.parse(html, 'https://example.com').title).toBe('Page Heading');
        });

        it('uses URL as last-resort title', () => {
            const url = 'https://example.com/page';
            const html = `<html><body><main><p>Some enough content here</p></main></body></html>`;
            expect(parser.parse(html, url).title.length).toBeGreaterThan(0);
        });
    });

    describe('parse() — description extraction', () => {
        it('extracts meta description', () => {
            const html = `<html>
        <head><meta name="description" content="A great guide to WSO2"></head>
        <body><main><p>content</p></main></body>
      </html>`;
            expect(parser.parse(html, 'https://example.com').description).toBe('A great guide to WSO2');
        });

        it('falls back to og:description', () => {
            const html = `<html>
        <head><meta property="og:description" content="OG description"></head>
        <body><main><p>content</p></main></body>
      </html>`;
            expect(parser.parse(html, 'https://example.com').description).toBe('OG description');
        });

        it('returns empty string when no description found', () => {
            const html = `<html><body><main><p>content</p></main></body></html>`;
            expect(parser.parse(html, 'https://example.com').description).toBe('');
        });
    });

    describe('parse() — noise removal', () => {
        it('removes <nav> content', () => {
            const html = `<html><body>
        <nav>Home | Docs | Blog</nav>
        <main><p>Real content lives here</p></main>
      </body></html>`;
            const result = parser.parse(html, 'https://example.com');
            const allText = result.sections.map((s) => s.text).join(' ');
            expect(allText).not.toContain('Home | Docs | Blog');
        });

        it('removes <footer> content', () => {
            const html = `<html><body>
        <main><p>Main content here to extract</p></main>
        <footer>Copyright 2024 WSO2</footer>
      </body></html>`;
            const result = parser.parse(html, 'https://example.com');
            const allText = result.sections.map((s) => s.text).join(' ');
            expect(allText).not.toContain('Copyright 2024');
        });

        it('removes <header> content', () => {
            const html = `<html><body>
        <header>Site Header Logo</header>
        <main><p>Real page content here</p></main>
      </body></html>`;
            const result = parser.parse(html, 'https://example.com');
            const allText = result.sections.map((s) => s.text).join(' ');
            expect(allText).not.toContain('Site Header Logo');
        });

        it('removes <script> tags', () => {
            const html = `<html><body><main>
        <script>alert("xss attack")</script>
        <p>Clean content here</p>
      </main></body></html>`;
            const allText = parser.parse(html, 'https://example.com').sections.map((s) => s.text).join(' ');
            expect(allText).not.toContain('alert');
        });

        it('removes <style> tags', () => {
            const html = `<html><body><main>
        <style>.nav { color: red; }</style>
        <p>Readable text content here</p>
      </main></body></html>`;
            const allText = parser.parse(html, 'https://example.com').sections.map((s) => s.text).join(' ');
            expect(allText).not.toContain('color: red');
        });
    });

    describe('parse() — section extraction', () => {
        it('extracts sections by heading hierarchy', () => {
            const html = `<html><body><main>
        <h2>Introduction</h2>
        <p>This is the introduction section with enough text.</p>
        <h2>Configuration</h2>
        <p>This is the configuration section with enough text.</p>
      </main></body></html>`;
            const { sections } = parser.parse(html, 'https://example.com');
            const headings = sections.map((s) => s.heading);
            expect(headings).toContain('Introduction');
            expect(headings).toContain('Configuration');
        });

        it('assigns correct heading level', () => {
            const html = `<html><body><main>
        <h1>Top Level</h1><p>Content for the top-level section.</p>
        <h3>Sub Sub</h3><p>More content text for sub-sub heading.</p>
        <h2>End Section</h2><p>Final content flushes the h3 above.</p>
      </main></body></html>`;
            const { sections } = parser.parse(html, 'https://example.com');
            const h1 = sections.find((s) => s.heading === 'Top Level');
            const h3 = sections.find((s) => s.heading === 'Sub Sub');
            expect(h1?.level).toBe(1);
            expect(h3?.level).toBe(3);
        });

        it('prefers <main> over <body> for content extraction', () => {
            const html = `<html><body>
        <div class="sidebar">Sidebar noise text here</div>
        <main><p>Main area content text here</p></main>
      </body></html>`;
            const { sections } = parser.parse(html, 'https://example.com');
            const allText = sections.map((s) => s.text).join(' ');
            expect(allText).not.toContain('Sidebar noise');
        });

        it('falls back to plain text when no headings found', () => {
            const html = `<html><body><main>
        <p>No headings but this paragraph has enough content to be a valid section worth including.</p>
      </main></body></html>`;
            const { sections } = parser.parse(html, 'https://example.com');
            expect(sections.length).toBeGreaterThan(0);
        });

        it('populates rawText field', () => {
            const html = `<html><body><main>
        <h2>Section</h2><p>Some text content here.</p>
      </main></body></html>`;
            const { rawText } = parser.parse(html, 'https://example.com');
            expect(rawText.length).toBeGreaterThan(0);
        });
    });
});
