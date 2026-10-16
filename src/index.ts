#!/usr/bin/env node
import { startMcpServer } from './server/mcpServer.js';

startMcpServer().catch((err: unknown) => {
    // Connection failures (e.g. ECONNREFUSED) surface as AggregateError with an empty message.
    const detail = err instanceof Error
        ? err.message || (err as NodeJS.ErrnoException).code || err.name
        : String(err);
    process.stderr.write(`Fatal error: ${detail}\n`);
    process.exit(1);
});
