-- WSO2 Docs MCP Server — pgvector schema
-- NOTE: The default vector(1536) suits OpenAI text-embedding-3-small.
-- For Gemini (768 dims) or Voyage-3 (1024 dims) run:  npm run db:migrate
-- which regenerates the schema using your EMBEDDING_DIMENSIONS env var.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Main document chunks table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS doc_chunks (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product      TEXT        NOT NULL,
  title        TEXT        NOT NULL,
  section      TEXT,
  source_url   TEXT        NOT NULL,
  chunk_index  INTEGER     NOT NULL,
  content      TEXT        NOT NULL,
  content_hash TEXT        NOT NULL,
  embedding    vector(1536),
  version      TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT doc_chunks_unique UNIQUE (source_url, chunk_index)
);

-- IVFFlat index for fast approximate nearest-neighbour search
CREATE INDEX IF NOT EXISTS doc_chunks_embedding_idx
  ON doc_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Metadata indexes
CREATE INDEX IF NOT EXISTS doc_chunks_product_idx    ON doc_chunks (product);
CREATE INDEX IF NOT EXISTS doc_chunks_url_idx        ON doc_chunks (source_url);
CREATE INDEX IF NOT EXISTS doc_chunks_hash_idx       ON doc_chunks (content_hash);

-- ── Crawl state for incremental updates ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS crawl_state (
  url          TEXT        PRIMARY KEY,
  page_hash    TEXT        NOT NULL,
  last_crawled TIMESTAMPTZ DEFAULT NOW(),
  chunk_count  INTEGER     DEFAULT 0
);

-- ── Auto-update updated_at ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS doc_chunks_updated_at ON doc_chunks;
CREATE TRIGGER doc_chunks_updated_at
  BEFORE UPDATE ON doc_chunks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
