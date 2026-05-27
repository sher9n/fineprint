-- Enable pgvector extension. Idempotent: no-op if already enabled.
CREATE EXTENSION IF NOT EXISTS "vector";

-- Add semantic-embedding column to Market. Nullable: existing rows have no embedding yet;
-- the backfill script will populate them in a separate pass, and new ingest writes will
-- populate on create. 384 dims matches the local sentence-transformer model (Xenova/all-MiniLM-L6-v2)
-- — see src/lib/embeddings.ts. We use a local model instead of OpenAI embeddings because
-- this project's OpenAI access is restricted to deep-research only.
ALTER TABLE "Market" ADD COLUMN "embedding" vector(384);

-- HNSW index for fast cosine-similarity nearest-neighbor lookup. Used by buildMarketContext
-- when finding sibling-by-topic precedent markets.
CREATE INDEX "Market_embedding_hnsw_idx"
  ON "Market" USING hnsw ("embedding" vector_cosine_ops);
