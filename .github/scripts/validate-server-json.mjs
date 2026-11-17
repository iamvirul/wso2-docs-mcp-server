#!/usr/bin/env node
// Validates server.json against package.json and the MCP Registry's publish-time
// constraints, so problems fail in CI instead of in the release's registry job
// (after the npm version is already live and the tag can't be changed).
import { readFileSync } from 'node:fs';

// Registry rejects longer descriptions with HTTP 422 (body.description).
const MAX_DESCRIPTION_LENGTH = 100;

const readJson = (path) => JSON.parse(readFileSync(path, 'utf-8'));
const pkg = readJson('package.json');
const server = readJson('server.json');
const packages = Array.isArray(server.packages) ? server.packages : [];

const errors = [];
const description = typeof server.description === 'string' ? server.description : '';

if (description.length === 0) {
    errors.push('description is missing or empty');
} else if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(`description is ${description.length} chars; the MCP Registry allows at most ${MAX_DESCRIPTION_LENGTH}`);
}
if (server.name !== pkg.mcpName) {
    errors.push(`name "${server.name}" != package.json mcpName "${pkg.mcpName}"`);
}
if (packages.length === 0) {
    errors.push('packages[] is empty');
}
for (const [i, p] of packages.entries()) {
    if (p.registryType === 'npm' && p.identifier !== pkg.name) {
        errors.push(`packages[${i}].identifier "${p.identifier}" != package.json name "${pkg.name}"`);
    }
}
const mismatched = [server.version, ...packages.map((p) => p.version)].filter((v) => v !== pkg.version);
if (mismatched.length > 0) {
    errors.push(`versions [${mismatched.join(', ')}] != package.json version ${pkg.version}`);
}

if (errors.length > 0) {
    for (const e of errors) console.error(`::error file=server.json::${e}`);
    process.exit(1);
}
console.log(`server.json OK (${server.name}@${server.version}, description ${description.length}/${MAX_DESCRIPTION_LENGTH} chars)`);
