# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.0]: https://github.com/iamvirul/wso2-docs-mcp-server/releases/tag/v1.0.0
