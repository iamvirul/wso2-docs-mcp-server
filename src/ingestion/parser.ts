import * as cheerio from 'cheerio';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ParsedSection {
    heading: string;
    text: string;
    level: number;
}

export interface ParsedPage {
    title: string;
    description: string;
    sections: ParsedSection[];
    rawText: string;
}

// ── DocParser ─────────────────────────────────────────────────────────────────

export class DocParser {
    private static readonly NOISE_SELECTORS = [
        'nav', 'header', 'footer', 'aside',
        '.sidebar', '.navigation', '.breadcrumb', '.cookie-banner',
        '.toc', '.table-of-contents', '.page-nav', '.edit-link',
        '.feedback', '.prev-next', '#disqus_thread', '.comment',
        'script', 'style', 'noscript', 'svg',
        '[aria-hidden="true"]', '[role="navigation"]',
    ].join(', ');

    parse(html: string, url: string): ParsedPage {
        const $ = cheerio.load(html);

        // ── Extract metadata ───────────────────────────────────────────────────────
        const title =
            $('meta[property="og:title"]').attr('content') ||
            $('title').text() ||
            $('h1').first().text() ||
            url;

        const description =
            $('meta[name="description"]').attr('content') ||
            $('meta[property="og:description"]').attr('content') ||
            '';

        // ── Remove noise ───────────────────────────────────────────────────────────
        $(DocParser.NOISE_SELECTORS).remove();
        $('[class*="cookie"]').remove();
        $('[id*="cookie"]').remove();

        // ── Extract main content ───────────────────────────────────────────────────
        const contentEl =
            $('main').first().length
                ? $('main').first()
                : $('article').first().length
                    ? $('article').first()
                    : $('[role="main"]').first().length
                        ? $('[role="main"]').first()
                        : $('body');

        // ── Section extraction ─────────────────────────────────────────────────────
        const sections: ParsedSection[] = [];
        let currentHeading = '';
        let currentLevel = 0;
        let buffer: string[] = [];

        const flush = () => {
            const text = buffer.join(' ').replace(/\s+/g, ' ').trim();
            if (text.length > 20) {
                sections.push({ heading: currentHeading, text, level: currentLevel });
            }
            buffer = [];
        };

        contentEl.find('h1, h2, h3, h4, p, li, pre, code, td, th, dt, dd').each((_, el) => {
            const tag = (el as any).tagName?.toLowerCase() ?? '';
            const text = $(el).text().replace(/\s+/g, ' ').trim();

            if (!text) return;

            if (['h1', 'h2', 'h3', 'h4'].includes(tag)) {
                flush();
                currentHeading = text;
                currentLevel = parseInt(tag[1], 10);
            } else {
                buffer.push(text);
            }
        });
        flush();

        // ── Fallback: plain text from entire content ────────────────────────────────
        if (sections.length === 0) {
            const rawText = contentEl.text().replace(/\s+/g, ' ').trim();
            if (rawText.length > 50) {
                sections.push({ heading: title, text: rawText, level: 1 });
            }
        }

        const rawText = sections.map((s) => `${s.heading}\n${s.text}`).join('\n\n');

        return {
            title: title.trim(),
            description: description.trim(),
            sections,
            rawText,
        };
    }
}
