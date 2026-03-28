import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov', 'html'],
            include: ['src/**/*.ts'],
            exclude: [
                'src/index.ts',
                'src/config/env.ts',
                'src/ingestion/crawler.ts',      // network I/O
                'src/ingestion/githubFetcher.ts', // network I/O (GitHub API + raw.githubusercontent.com)
                'src/jobs/reindexDocs.ts',       // integration job
                'src/server/mcpServer.ts',        // server bootstrap
                'src/ingestion/embedder.ts'       // 3rd-party API adapters (we test the interface)
            ],
            thresholds: {
                lines: 70,
                branches: 60,
            },
        },
    },
});
