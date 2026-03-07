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
- API key for your chosen embedding provider:
  - OpenAI (`sk-…`)
  - Google Gemini (`AIza…`)
  - Voyage AI (`pa-…`)

---

## Quick Start

### 1. Clone and install

```bash
cd "WSO2 Docs MCP Server"
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env: set DATABASE_URL, EMBEDDING_PROVIDER, and the matching API key
```

### 3. Start pgvector

```bash
docker compose up -d
# pgAdmin available at http://localhost:5050 (admin@wso2mcp.local / admin)
```

### 4. Run database migration

```bash
npm run db:migrate
```

> **Note:** Run migration again whenever you change `EMBEDDING_DIMENSIONS` (i.e. switch provider). The script detects and handles dimension changes automatically.

### 5. Index documentation

```bash
# Index all products (takes 15–60 min depending on provider rate limits)
npm run crawl

# Index a single product (faster, great for testing)
npm run crawl -- --product ballerina --limit 20

# Force re-index even unchanged pages
npm run crawl -- --force
```

### 6. Build and start the MCP server

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
        "EMBEDDING_PROVIDER": "openai",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

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

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `EMBEDDING_PROVIDER` | `openai` | `openai` \| `gemini` \| `voyage` |
| `OPENAI_API_KEY` | — | Required if provider = openai |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | OpenAI model name |
| `GEMINI_API_KEY` | — | Required if provider = gemini |
| `GEMINI_EMBEDDING_MODEL` | `text-embedding-004` | Gemini model (768 dims) |
| `VOYAGE_API_KEY` | — | Required if provider = voyage |
| `VOYAGE_EMBEDDING_MODEL` | `voyage-3` | Voyage model (1024 dims) |
| `EMBEDDING_DIMENSIONS` | `1536` | Must match model output dimensions |
| `CRAWL_CONCURRENCY` | `5` | Concurrent HTTP requests during crawl |
| `CHUNK_SIZE` | `800` | Approximate tokens per chunk |
| `CHUNK_OVERLAP` | `100` | Overlap tokens between chunks |
| `CACHE_TTL_SECONDS` | `3600` | In-memory query cache TTL |
| `TOP_K_RESULTS` | `10` | Default search result count |

### Embedding dimension reference

| Provider | Model | Dimensions |
|---|---|---|
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
