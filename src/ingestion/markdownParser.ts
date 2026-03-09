import { ParsedPage, ParsedSection } from './parser';

// ── MarkdownParser ────────────────────────────────────────────────────────────

/**
 * Parses raw Markdown into ParsedPage — the same format produced by DocParser
 * from HTML. This means the chunker, embedder, and vector store are all reused
 * without any changes.
 *
 * Handles:
 *  - YAML front-matter (extracts title / description)
 *  - ATX headings (# H1, ## H2, ### H3 …) → ParsedSection boundaries
 *  - Strips Markdown decorations from text (**, *, `code`, [link](url), images)
 *  - Strips HTML tags that sometimes appear inside .md files
 *  - Collapses code fences into a single readable line summary
 */
export class MarkdownParser {

    parse(markdown: string, url: string, filePath?: string): ParsedPage {
        const { frontmatter, body } = extractFrontmatter(markdown);

        // Extract title from front-matter or first h1
        const title =
            frontmatter.title ||
            extractFirstH1(body) ||
            filePathToTitle(filePath ?? url);

        const description = frontmatter.description || '';

        // Split body into sections at heading boundaries
        const sections = parseSections(body);

        // If no headings found, treat the whole body as one section
        if (sections.length === 0) {
            const text = cleanText(body);
            if (text.length > 30) {
                sections.push({ heading: title, text, level: 1 });
            }
        }

        const rawText = sections.map((s) => `${s.heading}\n${s.text}`).join('\n\n');

        return { title: title.trim(), description: description.trim(), sections, rawText };
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface Frontmatter {
    title?: string;
    description?: string;
}

function extractFrontmatter(markdown: string): { frontmatter: Frontmatter; body: string } {
    if (!markdown.startsWith('---')) {
        return { frontmatter: {}, body: markdown };
    }

    const end = markdown.indexOf('\n---', 3);
    if (end === -1) {
        return { frontmatter: {}, body: markdown };
    }

    const yamlBlock = markdown.slice(4, end).trim();
    const body = markdown.slice(end + 4).trim();

    const frontmatter: Frontmatter = {};

    for (const line of yamlBlock.split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const key = line.slice(0, colonIdx).trim().toLowerCase();
        const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (key === 'title') frontmatter.title = value;
        if (key === 'description') frontmatter.description = value;
    }

    return { frontmatter, body };
}

function extractFirstH1(body: string): string | undefined {
    const match = body.match(/^#\s+(.+)$/m);
    return match?.[1]?.trim();
}

function filePathToTitle(path: string): string {
    const base = path.split('/').pop() ?? path;
    return base.replace(/\.md$/, '').replace(/[-_]/g, ' ');
}

function parseSections(body: string): ParsedSection[] {
    const lines = body.split('\n');
    const sections: ParsedSection[] = [];
    let currentHeading = '';
    let currentLevel = 0;
    let buffer: string[] = [];
    let inFence = false;
    let fenceLines: string[] = [];

    const flush = () => {
        const text = buffer.join(' ').replace(/\s+/g, ' ').trim();
        if (text.length > 20) {
            sections.push({ heading: currentHeading, text, level: currentLevel });
        }
        buffer = [];
    };

    for (const rawLine of lines) {
        const line = rawLine.trimEnd();

        // Track code fences — collapse into one line describing the block
        if (line.startsWith('```') || line.startsWith('~~~')) {
            if (!inFence) {
                inFence = true;
                fenceLines = [];
            } else {
                inFence = false;
                // Collapse the code block into a brief text summary
                const code = fenceLines.filter(l => l.trim()).join(' ').slice(0, 200);
                if (code) buffer.push(`[code: ${code}]`);
                fenceLines = [];
            }
            continue;
        }

        if (inFence) {
            fenceLines.push(line);
            continue;
        }

        // Heading detection
        const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
        if (headingMatch) {
            flush();
            currentHeading = cleanText(headingMatch[2]);
            currentLevel = headingMatch[1].length;
            continue;
        }

        // Skip empty lines, HTML comments, image-only lines
        if (!line.trim()) continue;
        if (line.trim().startsWith('<!--')) continue;
        if (/^!\[.*?\]\(.*?\)$/.test(line.trim())) continue;

        const cleaned = cleanText(line);
        if (cleaned.length > 3) {
            buffer.push(cleaned);
        }
    }

    flush();
    return sections;
}

/**
 * Strip Markdown decoration from a line to produce plain readable text.
 */
function cleanText(text: string): string {
    return text
        // Remove HTML tags
        .replace(/<[^>]+>/g, ' ')
        // Convert links to just the link text
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        // Remove images
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        // Remove bold/italic markers
        .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
        .replace(/_{1,3}([^_]+)_{1,3}/g, '$1')
        // Remove inline code markers (keep content)
        .replace(/`([^`]+)`/g, '$1')
        // Remove blockquote markers
        .replace(/^\s*>\s*/gm, '')
        // Remove list markers
        .replace(/^\s*[-*+]\s+/gm, '')
        .replace(/^\s*\d+\.\s+/gm, '')
        // Remove horizontal rules
        .replace(/^[-*_]{3,}$/gm, '')
        // Collapse whitespace
        .replace(/\s+/g, ' ')
        .trim();
}
