#!/usr/bin/env node
import { startMcpServer } from './server/mcpServer';

startMcpServer().catch((err) => {
    process.stderr.write(`Fatal error: ${err.message}\n`);
    process.exit(1);
});
