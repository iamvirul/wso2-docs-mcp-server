#!/usr/bin/env node
/**
 * Dynamic schema migration — respects EMBEDDING_DIMENSIONS from .env
 * Run: npm run db:migrate
 */
import { Pool } from 'pg';
import { env } from '../src/config/env';

async function migrate(): Promise<void> {
    const dims = env.EMBEDDING_DIMENSIONS;
    console.log(`\n🗄️  Running schema migration (vector dims: ${dims})…`);

    const pool = new Pool({ connectionString: env.DATABASE_URL });
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        await client.query('CREATE EXTENSION IF NOT EXISTS vector');
        await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

        // Create or update doc_chunks table
        await client.query(`
      CREATE TABLE IF NOT EXISTS doc_chunks (
        id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        product      TEXT        NOT NULL,
        title        TEXT        NOT NULL,
        section      TEXT,
        source_url   TEXT        NOT NULL,
        chunk_index  INTEGER     NOT NULL,
        content      TEXT        NOT NULL,
        content_hash TEXT        NOT NULL,
        embedding    vector(${dims}),
        version      TEXT,
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        updated_at   TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT doc_chunks_unique UNIQUE (source_url, chunk_index)
      )
    `);

        // If table exists with wrong dimension, alter the column
        const colRes = await client.query(`
      SELECT atttypmod FROM pg_attribute a
      JOIN pg_class c ON a.attrelid = c.oid
      WHERE c.relname = 'doc_chunks' AND a.attname = 'embedding' AND atttypmod > 0
    `);

        if (colRes.rows.length > 0) {
            const currentDims = colRes.rows[0].atttypmod;
            if (currentDims !== dims) {
                console.log(`  ⚠️  Dimension mismatch (${currentDims} → ${dims}), recreating embedding column…`);
                await client.query('DROP INDEX IF EXISTS doc_chunks_embedding_idx');
                await client.query(`ALTER TABLE doc_chunks DROP COLUMN IF EXISTS embedding`);
                await client.query(`ALTER TABLE doc_chunks ADD COLUMN embedding vector(${dims})`);
            }
        }

        await client.query(`
      CREATE TABLE IF NOT EXISTS crawl_state (
        url          TEXT        PRIMARY KEY,
        page_hash    TEXT        NOT NULL,
        last_crawled TIMESTAMPTZ DEFAULT NOW(),
        chunk_count  INTEGER     DEFAULT 0
      )
    `);

        await client.query(`
      CREATE INDEX IF NOT EXISTS doc_chunks_embedding_idx
        ON doc_chunks USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
    `);
        await client.query(`CREATE INDEX IF NOT EXISTS doc_chunks_product_idx ON doc_chunks (product)`);
        await client.query(`CREATE INDEX IF NOT EXISTS doc_chunks_url_idx ON doc_chunks (source_url)`);
        await client.query(`CREATE INDEX IF NOT EXISTS doc_chunks_hash_idx ON doc_chunks (content_hash)`);

        await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
      $$ LANGUAGE plpgsql
    `);

        await client.query(`DROP TRIGGER IF EXISTS doc_chunks_updated_at ON doc_chunks`);
        await client.query(`
      CREATE TRIGGER doc_chunks_updated_at
        BEFORE UPDATE ON doc_chunks
        FOR EACH ROW EXECUTE FUNCTION update_updated_at()
    `);

        await client.query('COMMIT');
        console.log(`✅  Migration complete (vector dimensions: ${dims})`);
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

migrate().catch((err) => {
    console.error('❌  Migration failed:', err.message ?? err);
    process.exit(1);
});
