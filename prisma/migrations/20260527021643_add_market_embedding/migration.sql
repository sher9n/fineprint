-- Enable pgvector extension. Idempotent: no-op if already enabled.
CREATE EXTENSION IF NOT EXISTS "vector";

-- Add semantic-embedding column to Market. Nullable: existing rows have no embedding yet;
-- the backfill script will populate them in a separate pass, and new ingest writes will
-- populate on create. 384 dims matches the local sentence-transformer model (Xenova/all-MiniLM-L6-v2)
-- — see src/lib/embeddings.ts. We use a local model instead of OpenAI embeddings because
-- this project's OpenAI access is restricted to deep-research only.
ALTER TABLE "Market" ADD COLUMN IF NOT EXISTS "embedding" vector(384);

-- HNSW index intentionally omitted: pgvector HNSW build allocates shared memory proportional
-- to dataset + parallel workers, and Railway's managed Postgres ran out of /dev/shm on the
-- initial migration ("could not resize shared memory segment ... No space left on device").
-- Sequential scan on the embedding column is acceptable for the verifier-batch sibling-search
-- pattern (one query per analysis, not a hot path). The index can be added in a follow-up
-- migration with SET maintenance_work_mem and max_parallel_maintenance_workers tuned for the
-- environment.
