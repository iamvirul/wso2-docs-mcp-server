// ── GitHub source configuration ───────────────────────────────────────────────

export interface GitHubDocSource {
    /** GitHub org or user, e.g. 'wso2' */
    owner: string;
    /** Repository name, e.g. 'docs-apim' */
    repo: string;
    /** Default branch, e.g. 'master' or 'main' */
    branch: string;
    /**
     * Path within the repo where .md docs live, e.g. 'en/docs'.
     * Only files under this prefix are fetched.
     */
    docsPath: string;
}

// ── Product configuration ─────────────────────────────────────────────────────

export interface ProductConfig {
    id: string;
    name: string;
    /** Canonical docs-site base URL, used for source_url generation. */
    baseUrl: string;
    /** Sitemap URL — used only when githubSource is absent (web-crawl fallback). */
    sitemapUrl: string;
    description: string;
    version?: string;
    /**
     * When present, content is fetched directly from GitHub (preferred).
     * When absent, the legacy web-crawl path is used.
     */
    githubSource?: GitHubDocSource;
}

export const PRODUCTS: Record<string, ProductConfig> = {
    apim: {
        id: 'apim',
        name: 'API Manager',
        baseUrl: 'https://apim.docs.wso2.com/en/latest',
        sitemapUrl: 'https://apim.docs.wso2.com/sitemap.xml',
        description: 'WSO2 API Manager — full lifecycle API management platform',
        githubSource: {
            owner: 'wso2',
            repo: 'docs-apim',
            branch: 'master',
            docsPath: 'en/docs',
        },
    },
    mi: {
        id: 'mi',
        name: 'Micro Integrator',
        baseUrl: 'https://mi.docs.wso2.com/en/4.4.0',
        sitemapUrl: 'https://mi.docs.wso2.com/en/4.4.0/sitemap.xml',
        description: 'WSO2 Micro Integrator 4.4.0 — lightweight integration engine',
        version: '4.4.0',
        githubSource: {
            owner: 'wso2',
            repo: 'docs-mi',
            branch: 'main',
            docsPath: 'en/docs',
        },
    },
    bi: {
        id: 'bi',
        name: 'Ballerina Integrator',
        baseUrl: 'https://bi.docs.wso2.com/en/latest',
        sitemapUrl: 'https://bi.docs.wso2.com/sitemap.xml',
        description: 'WSO2 Ballerina Integrator — integration via the Ballerina language',
        githubSource: {
            owner: 'wso2',
            repo: 'docs-bi',
            branch: 'main',
            docsPath: 'en/docs',
        },
    },
    choreo: {
        id: 'choreo',
        name: 'Choreo',
        baseUrl: 'https://wso2.com/choreo/docs',
        sitemapUrl: 'https://wso2.com/choreo/docs/sitemap.xml',
        description: 'WSO2 Choreo — cloud-native integration platform',
        githubSource: {
            owner: 'wso2',
            repo: 'docs-choreo-dev',
            branch: 'PE',
            docsPath: 'en/docs',
        },
    },
    ballerina: {
        id: 'ballerina',
        name: 'Ballerina',
        baseUrl: 'https://ballerina.io/learn',
        sitemapUrl: 'https://ballerina.io/sitemap.xml',
        description: 'Ballerina programming language for network-centric applications',
        // No githubSource — website repo has a complex structure; keeps its web-crawl path
    },
    library: {
        id: 'library',
        name: 'WSO2 Library',
        baseUrl: 'https://wso2.com/library',
        sitemapUrl: 'https://wso2.com/sitemap.xml',
        description: 'WSO2 whitepapers, articles, case studies, and resources',
        // No githubSource — no dedicated docs repo; keeps its web-crawl path
    },
};

export const PRODUCT_IDS = Object.keys(PRODUCTS) as Array<keyof typeof PRODUCTS>;

export const CRAWLER_DEFAULTS = {
    timeout: 30_000,
    maxRetries: 3,
    retryDelay: 1_000,
} as const;
