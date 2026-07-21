# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.3] - 2026-07-21

## [1.3.2] - 2026-07-06

### Dependencies

- **node-cron** `4.5.0` -> `4.6.0`
- **@types/node** `26.0.1` -> `26.1.0`
- **tsx** `4.22.4` -> `4.23.0`
- **github/codeql-action/init** `4.36.2` -> `4.36.3`
- **github/codeql-action/analyze** `4.36.2` -> `4.36.3`

## [1.3.1] - 2026-06-29

### Changed

- **README**: Added project disclaimer and additional detail sections to README.md.
- **LICENSE**: Updated copyright year and owner.

### Fixed

- **package.json**: Resolved npm pkg lint warnings surfaced by `npm pkg fix`.
- **CI**: Upgraded all workflows to Node 22 (required by `commander@15`) and added `--ignore-scripts` to `npm ci` to prevent `onnxruntime-node` binary download timeouts in GitHub Actions.

### Dependencies

- **openai** `6.44.0` -> `6.45.0`
- **@types/node** `26.0.0` -> `26.0.1`

## [1.3.0] - 2026-06-25

### Added

- **WSO2 Identity Server (IS) Support**: Added `is` as a supported product with GitHub-native ingestion from WSO2's Identity Server documentation repository (`wso2/docs-is`). Covers the full IS docs tree including concepts, guides, references, and deploy sections.
- **Dependabot**: Added `.github/dependabot.yml` for automated npm dependency update PRs on a weekly schedule.

### Changed

- **Architecture Diagram**: Replaced the Mermaid flowchart in `README.md` with a standalone SVG (`docs/architecture.svg`) for consistent rendering across GitHub, npm, and all documentation viewers — Mermaid has inconsistent support outside of GitHub markdown.
- **README**: Updated documentation sources table to include WSO2 Identity Server and refreshed the architecture section to reference the new SVG diagram.

### Fixed

- **IS Ingestion**: `githubFetcher.ts` now skips the `/apis/` directory in the IS repository. These files are Redoc template wrappers that contain no extractable text content, resulting in empty chunks being indexed.

### Internal

- Removed AI-generated decorative separator comments across all source files (`src/`, `scripts/`, `tests/`) to keep the codebase clean and human-managed.
- **ESM conversion**: Converted the project from CommonJS to native ESM (`"type": "module"` in `package.json`, `module: ESNext` + `moduleResolution: bundler` in `tsconfig.json`). Required by `commander` v15 and `node-cron` v4, which are both ESM-only. `moduleResolution: bundler` avoids `.js` extension requirements on relative imports and is compatible with both TypeScript 5.x and 6.x.
- `src/jobs/reindexDocs.ts`: replaced `require.main === module` (CJS-only) with `process.argv[1] === fileURLToPath(import.meta.url)`.
- Code scanning alerts resolved: added explicit `permissions` blocks to CI and release workflows; removed useless conditional from CodeQL workflow (alerts #2, #3, #6). Fixed duplicate `permissions` key in `ci.yml` introduced by the autofix.

### Dependencies

- **TypeScript** `5.9.3` → `6.0.3`
- **openai** `4.104.0` → `6.44.0`
- **@huggingface/transformers** `3.8.1` → `4.2.0`
- **commander** `12.1.0` → `15.0.0`
- **dotenv** `16.6.1` → `17.4.2`
- **node-cron** `3.0.3` → `4.5.0`
- **@types/node** `20.19.37` → `26.0.0`
- **actions/checkout** `v4` → `v7`
- **actions/setup-node** `v4` → `v6`
- **actions/upload-artifact** `v4` → `v7`
- **softprops/action-gh-release** `v2` → `v3`

## [1.2.0] - 2026-03-29

### Added

- **GitHub-Native Ingestion**: Fetches raw Markdown directly from WSO2's public GitHub repositories via the Git Trees API — one API call lists the entire repo tree, then files are fetched in parallel from `raw.githubusercontent.com`. Eliminates web-scraping noise, HTML parsing overhead, and rate-limit issues for products with dedicated docs repos.
- **MarkdownParser**: New `src/ingestion/markdownParser.ts` — pure YAML front-matter + ATX heading parser that produces the same `ParsedPage` / `ParsedSection[]` format as the existing HTML `DocParser`, enabling the rest of the pipeline (chunker, embedder, pgvector) to be reused unchanged.
- **Dual-Ingestion Pipeline**: Products with GitHub repos (`apim`, `mi`, `bi`, `choreo`, `ballerina`) are ingested via `GitHubDocFetcher` + `MarkdownParser`; products without (`library`) continue to use the `DocCrawler` + `DocParser` web-crawl path.
- **Architecture diagram**: Added Mermaid flowchart to README illustrating the dual-ingestion architecture.

### Changed

- `scripts/crawl.ts` updated to route each product through the correct ingestion path (GitHub or web-crawl) based on the presence of a `githubSource` field in `PRODUCTS`.
- `src/config/constants.ts` extended with `GitHubDocSource` type and `githubSource` config for all GitHub-hosted products.
- README updated with dual-ingestion architecture section and corrected npm install setup guide.

### Fixed

- Mermaid architecture diagram in README had a malformed code-fence closing tag (` ```bash ` instead of ` ``` `), causing a parse error on GitHub.

## [1.1.0] - 2026-03-08

### Added

- **Claude Code MCP Integration**: Added `config-examples/claude_code.sh` with ready-to-use scripts for adding the WSO2 Docs MCP server to Claude Code via stdio transport
- **Claude Desktop MCP Integration**: Added `config-examples/claude_desktop.sh` with scripts for integrating with Claude Desktop
- **Claude Code Configuration**: Added `CLAUDE_CODE_CONFIG.md` with detailed instructions and best practices for configuring the MCP server in Claude Code
- **Claude Desktop Configuration**: Added `CLAUDE_DESKTOP_CONFIG.md` with detailed instructions for Claude Desktop integration
- **GitHub Actions**: Added `CLAUDE_CODE_CONFIG.md` and `CLAUDE_DESKTOP_CONFIG.md` to the repository

### Changed

- **Version**: Updated from 1.0.0 to 1.1.0
- **Package Files**: Updated `package.json` and `CHANGELOG.md` to reflect the new version
- **Documentation**: Added comprehensive integration guides for Claude Code and Claude Desktop

## [1.0.0] - 2026-03-07

### Added

- Initial production-ready release of the WSO2 Docs MCP Server
- RAG pipeline: crawl → parse → chunk → embed → pgvector store → semantic search
- MCP server with `search_wso2_docs` and `explain_wso2_concept` tools over stdio transport
- **Ollama** as the default local embedding provider (zero-cost, private, no API key required)
- **HuggingFace ONNX** (Xenova/nomic-embed-text-v1) as automatic fallback when Ollama is not running
- Hardware acceleration auto-detection for HuggingFace ONNX inference:
  - Apple Silicon (M1/M2/M3/M4): q8 INT8 quantized model via ARM NEON — ~9 ms/chunk (~100x faster than fp32 CPU)
  - NVIDIA GPU: fp32 via CUDA execution provider — batch size 64
  - Generic CPU: q8 INT8 quantized via SIMD (SSE4/AVX2) — batch size 16
- OpenAI, Google Gemini, and Voyage AI embedding providers as cloud alternatives
- Three-phase batched crawl pipeline decoupling network I/O from ONNX inference to prevent native thread conflicts (SIGABRT)
- Concurrent page fetching with p-limit (concurrency 10), gzip/br decompression, connection reuse
- pgvector store with content-hash deduplication — re-indexing skips unchanged pages
- Daily cron-based automatic re-index job
- `scripts/crawl.ts` CLI with `--product`, `--limit`, and `--force` flags
- `scripts/migrate.ts` for database schema migrations with dimension-aware embedding column management
- GitHub Actions CI (type-check, tests, build on every push/PR)
- GitHub Actions release workflow: tag `v*.*.*` triggers npm publish + GitHub Release creation
- Docker Compose setup for PostgreSQL + pgvector
- Comprehensive Vitest test suite
- Config examples for Claude Code and Claude Desktop MCP integration

### Changed

- Default embedding provider switched from OpenAI to Ollama for local-first, private-by-default operation
- Default embedding dimensions changed from 1536 (OpenAI ada-002) to 768 (nomic-embed-text-v1)
- Crawler concurrency increased from 5 to 10 concurrent requests

### Fixed

- ONNX Runtime native thread conflict with concurrent HTTP+gzip threads (mutex lock failed / SIGABRT at exit code 134) — resolved by deferring provider initialization to after all network I/O completes
- MCP server entry point path corrected (`dist/src/index.js` not `dist/index.js`) due to `tsconfig.json` `rootDir: "."`

[1.3.3]: https://github.com/iamvirul/wso2-docs-mcp-server/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/iamvirul/wso2-docs-mcp-server/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/iamvirul/wso2-docs-mcp-server/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/iamvirul/wso2-docs-mcp-server/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/iamvirul/wso2-docs-mcp-server/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/iamvirul/wso2-docs-mcp-server/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/iamvirul/wso2-docs-mcp-server/releases/tag/v1.0.0
