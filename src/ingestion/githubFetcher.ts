import axios from 'axios';
import { createHash } from 'crypto';
import pLimit from 'p-limit';
import { GitHubDocSource } from '../config/constants';

// ── Types ─────────────────────────────────────────────────────────────────────

/** A fetched Markdown file from GitHub, drop-in replacement for CrawledPage */
export interface FetchedFile {
    url: string;          // canonical docs-site URL for this page
    filePath: string;     // repo-relative path, e.g. en/docs/api-gateway/overview.md
    markdown: string;     // raw Markdown content
    contentHash: string;  // SHA-256 of content (stable change-detection key)
    fetchedAt: Date;
}

interface GitTreeItem {
    path: string;
    type: 'blob' | 'tree';
    sha: string;
    size?: number;
}

// ── GitHubDocFetcher ──────────────────────────────────────────────────────────

/**
 * Fetches Markdown documentation from a public WSO2 GitHub repository.
 *
 * Strategy:
 *   1. One GitHub API call: GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1
 *      → lists every file in the repo as a flat array (no N+1 dir traversal)
 *   2. Filter to .md files inside `docsPath`, excluding noise dirs (assets, images, includes)
 *   3. Fetch each file from raw.githubusercontent.com in parallel (unlimited, no auth needed)
 *   4. Map file paths to canonical docs-site URLs using the product's baseUrl
 */
export class GitHubDocFetcher {
    private readonly client = axios.create({
        timeout: 30_000,
        headers: {
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'WSO2-Docs-MCP-Server/1.1 (+https://github.com/iamvirul/wso2-docs-mcp-server)',
        },
    });

    // Parallel fetch concurrency for raw file downloads
    private readonly limit = pLimit(20);

    // Paths to skip — these are not doc content
    private static readonly SKIP_PATTERNS = [
        '/assets/', '/images/', '/img/', '/static/',
        '/includes/', '/overrides/', '/theme/',
        'page-not-found', 'index.md',
    ];

    constructor(
        private readonly source: GitHubDocSource,
        private readonly baseUrl: string,
        private readonly maxFiles?: number,
    ) { }

    // ── Public API ────────────────────────────────────────────────────────────

    async fetch(
        onFile: (file: FetchedFile) => Promise<void>
    ): Promise<{ total: number; errors: number }> {
        const allPaths = await this.listMarkdownFiles();
        const paths = this.maxFiles ? allPaths.slice(0, this.maxFiles) : allPaths;

        console.log(`  [github] ${this.source.owner}/${this.source.repo}: ${paths.length} .md files found`);

        let errors = 0;

        const tasks = paths.map((filePath) =>
            this.limit(async () => {
                try {
                    const file = await this.fetchFile(filePath);
                    if (file) await onFile(file);
                } catch (err) {
                    errors++;
                    console.error(`  [github] Error fetching ${filePath}:`, (err as Error).message);
                }
            })
        );

        await Promise.all(tasks);
        return { total: paths.length - errors, errors };
    }

    // ── Private: List all .md files via Git Trees API ─────────────────────────

    private async listMarkdownFiles(): Promise<string[]> {
        const { owner, repo, branch, docsPath } = this.source;

        // Use the Git Trees API with recursive=1 to get all files in one request
        const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;

        const res = await this.client.get<{ tree: GitTreeItem[]; truncated: boolean }>(url);

        if (res.data.truncated) {
            console.warn(`  [github] Warning: tree response truncated for ${owner}/${repo}. Some files may be missed.`);
        }

        return res.data.tree
            .filter((item) => {
                if (item.type !== 'blob') return false;
                if (!item.path.endsWith('.md')) return false;
                if (!item.path.startsWith(docsPath + '/')) return false;
                if (GitHubDocFetcher.SKIP_PATTERNS.some((p) => item.path.includes(p))) return false;
                return true;
            })
            .map((item) => item.path);
    }

    // ── Private: Fetch a single .md file from raw.githubusercontent.com ───────

    private async fetchFile(filePath: string): Promise<FetchedFile | null> {
        const { owner, repo, branch } = this.source;
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;

        const res = await this.client.get<string>(rawUrl, {
            headers: { Accept: 'text/plain' },
            responseType: 'text',
        });

        const markdown = res.data;
        if (!markdown || markdown.trim().length < 50) return null;

        const contentHash = createHash('sha256').update(markdown).digest('hex');
        const url = this.filePathToDocUrl(filePath);

        return {
            url,
            filePath,
            markdown,
            contentHash,
            fetchedAt: new Date(),
        };
    }

    // ── Private: Map repo file path → canonical docs-site URL ─────────────────

    /**
     * Convert a repo-relative file path to the public docs URL.
     *
     * Example (docs-apim, docsPath = 'en/docs', baseUrl = 'https://apim.docs.wso2.com'):
     *   en/docs/api-gateway/overview.md  →  https://apim.docs.wso2.com/en/latest/api-gateway/overview/
     *
     * Example (docs-mi, docsPath = 'en/docs', baseUrl = 'https://mi.docs.wso2.com/en/4.4.0'):
     *   en/docs/install-and-setup/install.md  →  https://mi.docs.wso2.com/en/4.4.0/install-and-setup/install/
     */
    private filePathToDocUrl(filePath: string): string {
        const { docsPath } = this.source;

        // Strip the docsPath prefix (e.g. 'en/docs/')
        let relative = filePath.startsWith(docsPath + '/')
            ? filePath.slice(docsPath.length + 1)
            : filePath;

        // Strip .md extension
        relative = relative.replace(/\.md$/, '');

        // Remove trailing /index
        relative = relative.replace(/\/index$/, '');

        const base = this.baseUrl.replace(/\/$/, '');
        return `${base}/${relative}/`;
    }
}
