export interface ProductConfig {
    id: string;
    name: string;
    baseUrl: string;
    sitemapUrl: string;
    description: string;
    version?: string;
}

export const PRODUCTS: Record<string, ProductConfig> = {
    apim: {
        id: 'apim',
        name: 'API Manager',
        baseUrl: 'https://apim.docs.wso2.com',
        sitemapUrl: 'https://apim.docs.wso2.com/sitemap.xml',
        description: 'WSO2 API Manager — full lifecycle API management platform',
    },
    choreo: {
        id: 'choreo',
        name: 'Choreo',
        baseUrl: 'https://wso2.com/choreo/docs',
        sitemapUrl: 'https://wso2.com/choreo/docs/sitemap.xml',
        description: 'WSO2 Choreo — cloud-native integration platform',
    },
    ballerina: {
        id: 'ballerina',
        name: 'Ballerina',
        baseUrl: 'https://ballerina.io/learn',
        sitemapUrl: 'https://ballerina.io/sitemap.xml',
        description: 'Ballerina programming language for network-centric applications',
    },
    mi: {
        id: 'mi',
        name: 'Micro Integrator',
        baseUrl: 'https://mi.docs.wso2.com/en/4.4.0',
        sitemapUrl: 'https://mi.docs.wso2.com/en/4.4.0/sitemap.xml',
        description: 'WSO2 Micro Integrator 4.4.0 — lightweight integration engine',
        version: '4.4.0',
    },
    bi: {
        id: 'bi',
        name: 'Ballerina Integrator',
        baseUrl: 'https://bi.docs.wso2.com',
        sitemapUrl: 'https://bi.docs.wso2.com/sitemap.xml',
        description: 'WSO2 Ballerina Integrator — integration via the Ballerina language',
    },
    library: {
        id: 'library',
        name: 'WSO2 Library',
        baseUrl: 'https://wso2.com/library',
        sitemapUrl: 'https://wso2.com/sitemap.xml',
        description: 'WSO2 whitepapers, articles, case studies, and resources',
    },
};

export const PRODUCT_IDS = Object.keys(PRODUCTS) as Array<keyof typeof PRODUCTS>;

export const CRAWLER_DEFAULTS = {
    timeout: 30_000,
    maxRetries: 3,
    retryDelay: 1_000,
} as const;
