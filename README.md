# WSO2 Docs MCP Server

A production-ready **Model Context Protocol (MCP)** server that provides AI assistants (Claude Desktop, Claude Code, Cursor, VS Code) with semantic search over WSO2 documentation via Retrieval-Augmented Generation (RAG).

## Documentation Sources

| Product | URL |
|---|---|
| API Manager | https://apim.docs.wso2.com |
| Micro Integrator | https://mi.docs.wso2.com/en/4.4.0 |
| Choreo | https://wso2.com/choreo/docs |
| Ballerina | https://ballerina.io/learn |
| Ballerina Integrator | https://bi.docs.wso2.com |
| WSO2 Library | https://wso2.com/library |

## Prerequisites

- **Node.js** ≥ 20
- **Docker** (for pgvector)
- **Embeddings** — no API key required by default:
  - **[Ollama](https://ollama.com)** (recommended) — runs locally, model auto-downloaded on first run
  - If Ollama is not running, the server automatically falls back to **HuggingFace ONNX** (in-process, also downloads automatically)
  - Cloud providers are also supported: OpenAI, Google Gemini, Voyage AI

---

## Quick Start

### 1. Clone and install

```bash
cd "WSO2 Docs MCP Server"
npm install
```

### 2. Start Ollama (optional but recommended)

[Install Ollama](https://ollama.com) and start it:

```bash
ollama serve
```

> **No Ollama?** Skip this step. The server detects Ollama is not running and automatically falls back to HuggingFace ONNX inference — the model downloads on first use with no extra setup.

### 3. Configure environment

```bash
cp .env.example .env
# Defaults work out of the box with Ollama.
# Only edit if using a cloud provider (OpenAI / Gemini / Voyage).
```

### 4. Start pgvector

```bash
docker compose up -d
# pgAdmin available at http://localhost:5050 (admin@wso2mcp.local / admin)
```

### 5. Run database migration

```bash
npm run db:migrate
```

> **Note:** Run migration again whenever you change `EMBEDDING_DIMENSIONS` (i.e. switch embedding provider). The script detects and handles dimension changes automatically.

### 6. Index documentation

```bash
# Index all products
# On first run the embedding model is downloaded automatically (Ollama or HuggingFace)
npm run crawl

# Index a single product (faster, great for testing)
npm run crawl -- --product ballerina --limit 20

# Force re-index even unchanged pages
npm run crawl -- --force
```

### 7. Build and start the MCP server

```bash
npm run build
npm start
```

For development (no build step):
```bash
npm run dev
```

---

## Client Configuration

> Replace `/ABSOLUTE/PATH/TO/WSO2 Docs MCP Server` with your actual project path.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "wso2-docs": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/WSO2 Docs MCP Server/dist/index.js"],
      "env": {
        "DATABASE_URL": "postgresql://wso2mcp:wso2mcp@localhost:5432/wso2docs",
        "EMBEDDING_PROVIDER": "ollama"
      }
    }
  }
}
```

> Using a cloud provider instead? Add the appropriate key, e.g. `"EMBEDDING_PROVIDER": "openai", "OPENAI_API_KEY": "sk-..."`.


### Claude Code

```bash
# After npm run build
claude mcp add wso2-docs --transport stdio -- \
  node "/ABSOLUTE/PATH/TO/WSO2 Docs MCP Server/dist/index.js"

# Verify
claude mcp list
```

See `config-examples/claude_code.sh` for a convenience script.

### Cursor

Create `.cursor/mcp.json` in your project root — see `config-examples/cursor_mcp.json`.

### VS Code

Create `.vscode/mcp.json` — see `config-examples/vscode_mcp.json`.

---

## MCP Tools

| Tool | Description |
|---|---|
| `search_wso2_docs` | Semantic search across all products. Optional `product` and `limit` filters. |
| `get_wso2_guide` | Search within a specific product (`apim`, `mi`, `choreo`, `ballerina`, `bi`, `library`). |
| `explain_wso2_concept` | Broad concept search across all products, returns 8 top results. |
| `list_wso2_products` | Returns all supported products with IDs and base URLs. |

### Example response

```json
[
  {
    "title": "Deploying WSO2 API Manager",
    "snippet": "WSO2 API Manager can be deployed in various topologies…",
    "source_url": "https://apim.docs.wso2.com/en/latest/install-and-setup/...",
    "product": "apim",
    "section": "Deployment Patterns",
    "score": 0.8712
  }
]
```

---

## Local Embeddings

The default `EMBEDDING_PROVIDER=ollama` runs entirely on your machine with no API key. The startup sequence is:

```
Is Ollama running?
├── Yes → Is model present?
│         ├── Yes → Ready (instant)
│         └── No  → Pull via Ollama (streamed, runs once)
└── No  → Download ONNX model from HuggingFace Hub (~250 MB, cached after first run)
           and run inference in-process via @huggingface/transformers
```

Both paths use `nomic-embed-text` / `Xenova/nomic-embed-text-v1` by default and produce identical 768-dim vectors, so you can switch between them without re-indexing.

### Hardware acceleration (HuggingFace ONNX fallback)

When Ollama is not available, the server auto-detects the best compute backend:

| Machine | Detection | ONNX dtype | Batch size | Throughput |
|---|---|---|---|---|
| Apple Silicon (M1/M2/M3/M4) | `process.arch === 'arm64'` | `q8` INT8 | 32 | ~9 ms/chunk |
| NVIDIA GPU | `nvidia-smi` probe | `fp32` | 64 | GPU-dependent |
| All others | fallback | `q8` INT8 | 16 | ~10 ms/chunk |

**Why `q8` on Apple Silicon instead of CoreML/Metal?**
CoreML compiles Metal shaders on first use (~20 min cold-start). For the typical chunk sizes produced by this server (6–20 chunks per page), the CPU↔GPU transfer overhead eliminates any inference gain. INT8 quantized inference on ARM NEON SIMD is consistently **~100× faster than fp32 CPU** with zero cold-start cost.

**Benchmark (Apple M-chip, `Xenova/nomic-embed-text-v1`):**
```
fp32 CPU (before): ~1,000 ms/chunk   (68 chunks ≈ 68 s of embedding)
q8  ARM NEON:          ~9 ms/chunk   (68 chunks ≈  0.6 s of embedding)  ← ~100× speedup
```

> **Note:** For small crawls (≤ 10 pages) total wall-clock time is dominated by network I/O
> (HTTPS fetches to docs sites), so the end-to-end improvement is modest. The embedding
> speedup becomes significant at scale — crawling 500+ pages where embedding previously
> accounted for hours of runtime. For best crawl performance, run Ollama (`ollama serve`)
> which parallelises inference natively and has no per-chunk overhead.

---

## Environment Variables

### Core

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL connection string (required) |
| `EMBEDDING_PROVIDER` | `ollama` | `ollama` \| `openai` \| `gemini` \| `voyage` |
| `EMBEDDING_DIMENSIONS` | `768` | Must match model output dimensions |
| `CRAWL_CONCURRENCY` | `5` | Concurrent HTTP requests during crawl |
| `CHUNK_SIZE` | `800` | Approximate tokens per chunk |
| `CHUNK_OVERLAP` | `100` | Overlap tokens between chunks |
| `CACHE_TTL_SECONDS` | `3600` | In-memory query cache TTL |
| `TOP_K_RESULTS` | `10` | Default search result count |

### Ollama (default)

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_EMBEDDING_MODEL` | `nomic-embed-text` | Model pulled and used via Ollama |
| `HUGGINGFACE_EMBEDDING_MODEL` | `Xenova/nomic-embed-text-v1` | ONNX fallback when Ollama is not running |

### Cloud providers

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | — | Required if `EMBEDDING_PROVIDER=openai` |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | OpenAI model |
| `GEMINI_API_KEY` | — | Required if `EMBEDDING_PROVIDER=gemini` |
| `GEMINI_EMBEDDING_MODEL` | `text-embedding-004` | Gemini model |
| `VOYAGE_API_KEY` | — | Required if `EMBEDDING_PROVIDER=voyage` |
| `VOYAGE_EMBEDDING_MODEL` | `voyage-3` | Voyage model |

### Embedding dimension reference

| Provider | Model | Dimensions |
|---|---|---|
| Ollama / HuggingFace | `nomic-embed-text` / `Xenova/nomic-embed-text-v1` | **768** (default) |
| Ollama / HuggingFace | `mxbai-embed-large` / `Xenova/mxbai-embed-large-v1` | 1024 |
| Ollama / HuggingFace | `all-minilm` / `Xenova/all-MiniLM-L6-v2` | 384 |
| OpenAI | `text-embedding-3-small` | 1536 |
| OpenAI | `text-embedding-3-large` | 3072 |
| Gemini | `text-embedding-004` | 768 |
| Voyage | `voyage-3` | 1024 |
| Voyage | `voyage-3-lite` | 512 |

---

## Scheduled Re-indexing

```bash
# Run a one-off re-index (checks hashes, skips unchanged pages)
npm run reindex

# Or from the project directory using node-cron (runs daily at 2 AM)
DATABASE_URL=... node -e "
  const { ReindexJob } = require('./dist/jobs/reindexDocs');
  const job = new ReindexJob();
  job.initialize().then(() => job.scheduleDaily());
"
```

---

## Project Structure

```
src/
  config/          env.ts · constants.ts
  vectorstore/     pgvector.ts · schema.sql
  ingestion/       crawler.ts · parser.ts · chunker.ts · embedder.ts
  server/          mcpServer.ts · toolRegistry.ts
  jobs/            reindexDocs.ts
  index.ts
scripts/
  crawl.ts         CLI ingestion pipeline
  migrate.ts       Dynamic schema migration
config-examples/   claude_desktop.json · claude_code.sh · cursor_mcp.json · vscode_mcp.json
docker-compose.yml
.env.example
```

---

## Development

```bash
# Type-check
npx tsc --noEmit

# Run crawl with tsx (no build needed)
npm run crawl -- --product ballerina --limit 5

# Run server in dev mode
npm run dev
```
