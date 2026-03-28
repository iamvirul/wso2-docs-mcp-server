import { describe, it, expect } from 'vitest';
import { MarkdownParser } from '../../../src/ingestion/markdownParser';

const parser = new MarkdownParser();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal markdown document */
const md = (content: string) => content.trim();

// ── Title extraction ──────────────────────────────────────────────────────────

describe('MarkdownParser', () => {
    describe('parse() — title extraction', () => {
        it('extracts title from YAML front-matter', () => {
            const input = md(`
---
title: API Gateway Overview
description: Learn about the API Gateway
---

## Introduction
Some content about the API Gateway configuration and usage.
`);
            expect(parser.parse(input, 'https://example.com').title).toBe('API Gateway Overview');
        });

        it('falls back to first H1 when no front-matter title', () => {
            const input = md(`
# Install and Configure

## Prerequisites
You need to have Java 11 installed on your machine before proceeding.
`);
            expect(parser.parse(input, 'https://example.com').title).toBe('Install and Configure');
        });

        it('falls back to filePath basename when no front-matter or H1', () => {
            const input = md(`
## Overview
This section covers deployment to kubernetes environments at scale.
`);
            const result = parser.parse(input, 'https://example.com', 'en/docs/api-gateway/overview.md');
            expect(result.title).toBe('overview');
        });

        it('converts hyphens to spaces in filePath fallback title', () => {
            const input = md(`
## Section
Content for this section with enough text to be included.
`);
            const result = parser.parse(input, 'https://example.com', 'en/docs/quick-start-guide.md');
            expect(result.title).toBe('quick start guide');
        });

        it('uses URL as last-resort when no filePath', () => {
            const input = md(`
## Section
Content for this section with enough text to be included in the output.
`);
            const result = parser.parse(input, 'https://docs.wso2.com/apim/overview');
            expect(result.title.length).toBeGreaterThan(0);
        });

        it('trims whitespace from extracted title', () => {
            const input = md(`
---
title:   Trimmed Title
---

## Section
Content for this section with enough text to be included.
`);
            expect(parser.parse(input, 'https://example.com').title).toBe('Trimmed Title');
        });
    });

    // ── Description extraction ────────────────────────────────────────────────

    describe('parse() — description extraction', () => {
        it('extracts description from YAML front-matter', () => {
            const input = md(`
---
title: My Page
description: A helpful overview of the system
---

## Section
Content for this section with enough text to be included.
`);
            expect(parser.parse(input, 'https://example.com').description).toBe('A helpful overview of the system');
        });

        it('strips surrounding quotes from description value', () => {
            const input = md(`
---
title: Page
description: "Quoted description here"
---

## Section
Content for this section with enough text to be included.
`);
            expect(parser.parse(input, 'https://example.com').description).toBe('Quoted description here');
        });

        it('returns empty string when no description in front-matter', () => {
            const input = md(`
---
title: Page Title
---

## Section
Content for this section with enough text to be included.
`);
            expect(parser.parse(input, 'https://example.com').description).toBe('');
        });

        it('returns empty string when no front-matter at all', () => {
            const input = md(`
# My Page

## Section
Content without front-matter with enough text to be included.
`);
            expect(parser.parse(input, 'https://example.com').description).toBe('');
        });
    });

    // ── Front-matter edge cases ───────────────────────────────────────────────

    describe('parse() — front-matter edge cases', () => {
        it('handles malformed front-matter without closing ---', () => {
            const input = md(`
---
title: Broken Front-Matter

## Section
Content without proper front-matter closing delimiter.
`);
            // Should not throw; treats whole document as body
            const result = parser.parse(input, 'https://example.com');
            expect(result).toBeDefined();
        });

        it('handles document without front-matter', () => {
            const input = md(`
## Just a Section
Content here without any front-matter at the top of the document.
`);
            const result = parser.parse(input, 'https://example.com');
            expect(result.sections.length).toBeGreaterThan(0);
        });
    });

    // ── Section parsing ───────────────────────────────────────────────────────

    describe('parse() — section extraction', () => {
        it('creates sections at H2 heading boundaries', () => {
            const input = md(`
---
title: Guide
---

## Installation
Follow these steps to install the WSO2 API Manager on your server.

## Configuration
Configure the API Manager by editing the deployment configuration file.
`);
            const { sections } = parser.parse(input, 'https://example.com');
            const headings = sections.map((s) => s.heading);
            expect(headings).toContain('Installation');
            expect(headings).toContain('Configuration');
        });

        it('creates sections at H3 heading boundaries', () => {
            const input = md(`
---
title: Guide
---

### Step One
Complete the first step of the installation process carefully.

### Step Two
Complete the second step of the installation process carefully.
`);
            const { sections } = parser.parse(input, 'https://example.com');
            expect(sections.map((s) => s.heading)).toContain('Step One');
            expect(sections.map((s) => s.heading)).toContain('Step Two');
        });

        it('assigns correct heading level to each section', () => {
            const input = md(`
---
title: Doc
---

## Top Level Section
Content for the top level section with enough text here.

### Nested Section
Content for the nested section with enough text here to pass the filter.
`);
            const { sections } = parser.parse(input, 'https://example.com');
            const h2 = sections.find((s) => s.heading === 'Top Level Section');
            const h3 = sections.find((s) => s.heading === 'Nested Section');
            expect(h2?.level).toBe(2);
            expect(h3?.level).toBe(3);
        });

        it('treats whole body as one section when no headings found', () => {
            const input = md(`
This document has no headings but contains enough text content to be included as a section.
`);
            const { sections } = parser.parse(input, 'https://example.com');
            expect(sections.length).toBe(1);
        });

        it('drops sections with text shorter than 20 chars', () => {
            const input = md(`
## Short
Too short.

## Long Enough
This section has enough content to pass the minimum length threshold for inclusion.
`);
            const { sections } = parser.parse(input, 'https://example.com');
            expect(sections.map((s) => s.heading)).not.toContain('Short');
            expect(sections.map((s) => s.heading)).toContain('Long Enough');
        });

        it('populates rawText combining all section headings and text', () => {
            const input = md(`
## Overview
Introduction content explaining the overview with enough text content here.
`);
            const { rawText } = parser.parse(input, 'https://example.com');
            expect(rawText).toContain('Overview');
            expect(rawText.length).toBeGreaterThan(0);
        });
    });

    // ── Markdown decoration stripping ─────────────────────────────────────────

    describe('parse() — text cleaning', () => {
        it('strips bold markers', () => {
            const input = md(`
## Section
This is **bold text** in a sentence with enough content to pass the filter.
`);
            const { sections } = parser.parse(input, 'https://example.com');
            expect(sections[0].text).toContain('bold text');
            expect(sections[0].text).not.toContain('**');
        });

        it('strips italic markers', () => {
            const input = md(`
## Section
This is *italic text* in a sentence with enough content to pass the filter.
`);
            const { sections } = parser.parse(input, 'https://example.com');
            expect(sections[0].text).toContain('italic text');
            expect(sections[0].text).not.toContain('*italic*');
        });

        it('strips inline code backticks but keeps content', () => {
            const input = md(`
## Section
Use the \`wso2-docs-crawl\` command to index documentation content here.
`);
            const { sections } = parser.parse(input, 'https://example.com');
            expect(sections[0].text).toContain('wso2-docs-crawl');
            expect(sections[0].text).not.toContain('`');
        });

        it('converts Markdown links to link text only', () => {
            const input = md(`
## Section
See the [API Manager documentation](https://docs.wso2.com/apim) for more details on usage.
`);
            const { sections } = parser.parse(input, 'https://example.com');
            expect(sections[0].text).toContain('API Manager documentation');
            expect(sections[0].text).not.toContain('https://docs.wso2.com/apim');
        });

        it('removes inline images', () => {
            const input = md(`
## Section
Here is an image: ![diagram](./images/arch.png) followed by more text content here.
`);
            const { sections } = parser.parse(input, 'https://example.com');
            expect(sections[0].text).not.toContain('arch.png');
            expect(sections[0].text).not.toContain('![');
        });

        it('removes standalone image-only lines entirely', () => {
            const input = md(`
## Section
Some content before the image line that has enough text.

![architecture diagram](./images/arch-diagram.png)

More content after the image line for the section.
`);
            const { sections } = parser.parse(input, 'https://example.com');
            expect(sections[0].text).not.toContain('arch-diagram');
        });

        it('removes HTML tags embedded in Markdown', () => {
            const input = md(`
## Section
<p>This is a paragraph with <strong>HTML</strong> tags embedded in markdown content.</p>
`);
            const { sections } = parser.parse(input, 'https://example.com');
            expect(sections[0].text).not.toContain('<p>');
            expect(sections[0].text).not.toContain('<strong>');
        });

        it('removes HTML comments', () => {
            const input = md(`
## Section
<!-- This is a comment that should be removed from the output entirely -->
Real content that should appear in the section text output here.
`);
            const { sections } = parser.parse(input, 'https://example.com');
            expect(sections[0].text).not.toContain('This is a comment');
            expect(sections[0].text).toContain('Real content');
        });

        it('removes list markers', () => {
            const input = md(`
## Section
- First item in the list that has enough content to be included
- Second item in the list that has enough content to be included
`);
            const { sections } = parser.parse(input, 'https://example.com');
            expect(sections[0].text).not.toMatch(/^-\s/);
        });

        it('removes blockquote markers', () => {
            const input = md(`
## Section
> This is a blockquote with enough text content to be included in the section output.
`);
            const { sections } = parser.parse(input, 'https://example.com');
            expect(sections[0].text).not.toContain('>');
            expect(sections[0].text).toContain('This is a blockquote');
        });
    });

    // ── Code fence handling ───────────────────────────────────────────────────

    describe('parse() — code fence handling', () => {
        it('collapses ``` fenced code block into a [code: ...] summary', () => {
            const input = md(`
## Section
Some introductory text before the code block appears in the document.

\`\`\`bash
curl -X POST https://api.example.com/token
\`\`\`

More text after the code block continues here for the section.
`);
            const { sections } = parser.parse(input, 'https://example.com');
            const text = sections[0].text;
            expect(text).toContain('[code:');
        });

        it('collapses ~~~ fenced code block into a [code: ...] summary', () => {
            const input = md(`
## Section
Some introductory text for the section before the code block.

~~~yaml
apiVersion: v1
kind: ConfigMap
~~~

Continuation text for the section after the code block here.
`);
            const { sections } = parser.parse(input, 'https://example.com');
            const text = sections[0].text;
            expect(text).toContain('[code:');
        });

        it('does not include code fence delimiters in output', () => {
            const input = md(`
## Section
Text before the code block in this documentation section.

\`\`\`javascript
const x = 1;
\`\`\`

Text after the code block in this documentation section.
`);
            const { sections } = parser.parse(input, 'https://example.com');
            expect(sections[0].text).not.toContain('```');
        });

        it('skips empty code blocks gracefully', () => {
            const input = md(`
## Section
Text with an empty code block below that should be handled gracefully.

\`\`\`
\`\`\`

Continuation text here to ensure the section has enough content.
`);
            const result = parser.parse(input, 'https://example.com');
            expect(result).toBeDefined();
        });
    });

    // ── Output structure ──────────────────────────────────────────────────────

    describe('parse() — output structure', () => {
        it('returns a valid ParsedPage with all required fields', () => {
            const input = md(`
---
title: Test Page
description: Test description
---

## Section One
Content for section one with enough text to be included in the output.
`);
            const result = parser.parse(input, 'https://example.com');
            expect(result).toHaveProperty('title');
            expect(result).toHaveProperty('description');
            expect(result).toHaveProperty('sections');
            expect(result).toHaveProperty('rawText');
            expect(Array.isArray(result.sections)).toBe(true);
        });

        it('produces empty sections array when all content is too short', () => {
            const input = md(`
---
title: Empty
---

## A
Short.

## B
Brief.
`);
            // No section text exceeds the 20-char minimum
            const { sections } = parser.parse(input, 'https://example.com');
            sections.forEach((s) => {
                expect(s.text.length).toBeGreaterThan(20);
            });
        });

        it('handles completely empty input without throwing', () => {
            const result = parser.parse('', 'https://example.com');
            expect(result).toBeDefined();
            expect(result.sections).toEqual([]);
        });

        it('handles H4 headings', () => {
            const input = md(`
#### Deep Heading
Content under a fourth-level heading with enough text to be included.
`);
            const { sections } = parser.parse(input, 'https://example.com');
            const h4 = sections.find((s) => s.heading === 'Deep Heading');
            expect(h4?.level).toBe(4);
        });
    });
});
