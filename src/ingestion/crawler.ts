import axios from 'axios';
import * as cheerio from 'cheerio';
import { createHash } from 'crypto';
import pLimit from 'p-limit';
import { env } from '../config/env';
import { ProductConfig, CRAWLER_DEFAULTS } from '../config/constants';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CrawledPage {
    url: string;
    html: string;
    contentHash: string;
    fetchedAt: Date;
}

// ── DocCrawler ────────────────────────────────────────────────────────────────

export class DocCrawler {
    private visited = new Set<string>();
    private limit = pLimit(env.CRAWL_CONCURRENCY);
    private client = axios.create({
        timeout: CRAWLER_DEFAULTS.timeout,
        headers: {
            'User-Agent': 'WSO2-Docs-MCP-Crawler/1.0 (+https://github.com/iamvirul/wso2-docs-mcp-server)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
        },
        // Decompress gzip/br automatically
        decompress: true,
        maxContentLength: 10 * 1024 * 1024, // 10 MB cap per page
    });

    constructor(private product: ProductConfig, private maxPages?: number) { }

    // ── Public API ───────────────────────────────────────────────────────────────

    async crawl(
        onPage: (page: CrawledPage) => Promise<void>
    ): Promise<{ total: number; errors: number }> {
        this.visited.clear();
        const urls = await this.discoverUrls();
        console.log(`  [${this.product.id}] Found ${urls.length} URLs to crawl`);

        const limited = this.maxPages ? urls.slice(0, this.maxPages) : urls;
        let errors = 0;

        const tasks = limited.map((url) =>
            this.limit(async () => {
                try {
                    const page = await this.fetchPage(url);
                    if (page) await onPage(page);
                } catch (err) {
                    errors++;
                    console.error(`  [${this.product.id}] Error fetching ${url}:`, (err as Error).message);
                }
            })
        );

        await Promise.all(tasks);
        return { total: limited.length - errors, errors };
    }

    // ── URL Discovery ────────────────────────────────────────────────────────────

    private async discoverUrls(): Promise<string[]> {
        try {
            const fromSitemap = await this.parseSitemap(this.product.sitemapUrl);
            if (fromSitemap.length > 0) {
                return this.filterUrls(fromSitemap);
            }
        } catch (_) {
            console.warn(`  [${this.product.id}] Sitemap unavailable, falling back to crawl`);
        }
        return this.crawlNavLinks(this.product.baseUrl);
    }

    private async parseSitemap(sitemapUrl: string, depth = 0): Promise<string[]> {
        if (depth > 2) return [];
        const res = await this._fetch(sitemapUrl);
        if (!res) return [];

        const $ = cheerio.load(res, { xmlMode: true });
        const urls: string[] = [];

        // Sitemap index — recurse into child sitemaps
        const sitemapLocs = $('sitemap > loc').toArray().map((el) => $(el).text().trim());
        if (sitemapLocs.length > 0) {
            const nested = await Promise.all(
                sitemapLocs.map((loc) => this.parseSitemap(loc, depth + 1))
            );
            return nested.flat();
        }

        // Regular sitemap
        $('url > loc').each((_, el) => {
            const url = $(el).text().trim();
            if (url) urls.push(url);
        });

        return urls;
    }

    private async crawlNavLinks(startUrl: string): Promise<string[]> {
        const toVisit = [startUrl];
        const found: string[] = [];
        const base = new URL(startUrl);

        while (toVisit.length > 0 && found.length < 500) {
            const url = toVisit.shift()!;
            if (this.visited.has(url)) continue;
            this.visited.add(url);

            const html = await this._fetch(url);
            if (!html) continue;
            found.push(url);

            const $ = cheerio.load(html);
            $('a[href]').each((_, el) => {
                const href = $(el).attr('href') ?? '';
                try {
                    const abs = new URL(href, url).href.split('#')[0];
                    if (
                        abs.startsWith(base.origin) &&
                        !this.visited.has(abs) &&
                        !abs.endsWith('.pdf') &&
                        !abs.endsWith('.zip')
                    ) {
                        toVisit.push(abs);
                    }
                } catch (_) { /* invalid URL */ }
            });
        }

        return found;
    }

    // ── Fetch ────────────────────────────────────────────────────────────────────

    private async fetchPage(url: string): Promise<CrawledPage | null> {
        const html = await this._fetch(url);
        if (!html) return null;

        // Respect noindex
        const $ = cheerio.load(html);
        const robots = $('meta[name="robots"]').attr('content') ?? '';
        if (robots.includes('noindex')) return null;

        const contentHash = createHash('sha256').update(html).digest('hex');
        return { url, html, contentHash, fetchedAt: new Date() };
    }

    private async _fetch(url: string): Promise<string | null> {
        for (let attempt = 0; attempt <= CRAWLER_DEFAULTS.maxRetries; attempt++) {
            try {
                const res = await this.client.get(url);
                if (typeof res.data === 'string') return res.data;
                return null;
            } catch (err: any) {
                const status = err?.response?.status;
                if (status === 404 || status === 403 || status === 410) return null;
                if (attempt < CRAWLER_DEFAULTS.maxRetries) {
                    await sleep(CRAWLER_DEFAULTS.retryDelay * Math.pow(2, attempt));
                    continue;
                }
                throw err;
            }
        }
        return null;
    }

    private filterUrls(urls: string[]): string[] {
        const base = this.product.baseUrl.toLowerCase();
        const unique = [...new Set(urls)];
        return unique.filter((u) => {
            const lower = u.toLowerCase();
            return (
                lower.startsWith(base) &&
                !lower.endsWith('.pdf') &&
                !lower.endsWith('.zip') &&
                !lower.includes('/assets/') &&
                !lower.includes('/images/')
            );
        });
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
