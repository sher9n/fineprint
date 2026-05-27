import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { prisma } from "./prisma";
import type { Market } from "@prisma/client";

/**
 * Local sentence-transformer embedding via @huggingface/transformers (ONNX runtime in Node).
 *
 * Why local instead of an API: OpenAI's text-embedding-3 / ada-002 are gated behind a
 * project-access permission this OpenAI project doesn't have (verified 2026-05-27). Local
 * inference avoids that dependency entirely, costs nothing per call, and the all-MiniLM-L6-v2
 * model is competitive with OpenAI text-embedding-3-small on STS benchmarks for short text
 * (which is what market questions are).
 *
 * Model: Xenova/all-MiniLM-L6-v2, 384 dims, ~22MB, ~10-50ms per text on CPU. Downloaded from
 * HF Hub on first call, then cached locally in node_modules/.cache or platform cache dir.
 */
export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIMS = 384;

let _pipeline: FeatureExtractionPipeline | null = null;
async function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (_pipeline) return _pipeline;
  _pipeline = (await pipeline("feature-extraction", EMBEDDING_MODEL)) as FeatureExtractionPipeline;
  return _pipeline;
}

/**
 * Build the topic string we embed. Intentionally tight: the user-facing label (event +
 * outcome) when present, else the question. We deliberately omit the description because
 * it's largely boilerplate ("This market will resolve YES if...") and would smear the
 * embedding toward generic resolution-rules language instead of the actual topic.
 */
export function buildEmbeddingText(market: Pick<Market, "question" | "eventTitle" | "groupItemTitle">): string {
  if (market.eventTitle && market.groupItemTitle) {
    return `${market.eventTitle}: ${market.groupItemTitle}`;
  }
  return market.question;
}

/**
 * Embed a single text string. For the backfill use embedBatch instead.
 */
export async function embedText(text: string): Promise<number[]> {
  const [v] = await embedBatch([text]);
  return v;
}

/**
 * Batched embedding. The pipeline natively supports passing an array; we mean-pool and
 * L2-normalize so cosine similarity behaves like a clean similarity score.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const pipe = await getPipeline();
  const result = await pipe(texts, { pooling: "mean", normalize: true });
  // The output Tensor has shape [batch, dims]. Reshape into per-row arrays.
  const flat = result.data as Float32Array;
  const dims = EMBEDDING_DIMS;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    out.push(Array.from(flat.slice(i * dims, (i + 1) * dims)));
  }
  return out;
}

/**
 * Serialize an embedding vector for raw-SQL insertion into a pgvector column.
 * Format: '[v1,v2,v3,...]' as the literal pgvector accepts.
 */
export function vectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

/**
 * Find Markets that need embeddings (embedding IS NULL) and embed them in batches.
 * Idempotent: skips Markets that already have a non-null embedding. Used by:
 *   - The one-shot backfill script (large limit) to populate history.
 *   - The daily scheduler (modest limit) to catch newly-ingested markets.
 *
 * Returns counts so callers can report progress.
 */
export async function embedPendingMarkets(opts: { limit?: number; batchSize?: number; onProgress?: (done: number, total: number) => void } = {}): Promise<{ embedded: number; errors: number; remaining: number }> {
  const batchSize = Math.max(1, Math.min(opts.batchSize ?? 64, 256));
  const limit = opts.limit ?? 200000;

  const rows = await prisma.$queryRaw<Array<{ id: string; question: string; eventTitle: string | null; groupItemTitle: string | null }>>`
    SELECT id, question, "eventTitle", "groupItemTitle"
    FROM "Market"
    WHERE embedding IS NULL
    ORDER BY "lastIngestedAt" DESC
    LIMIT ${limit}
  `;

  let embedded = 0;
  let errors = 0;
  const total = rows.length;

  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const texts = chunk.map((r) => buildEmbeddingText(r));

    const maxAttempts = 5;
    let succeeded = false;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const vectors = await embedBatch(texts);
        // Single bulk UPDATE per batch instead of N concurrent per-row UPDATEs. The latter
        // hammers connection pools and times out over Railway's public proxy. This stamps all
        // N rows in one round-trip using a VALUES + JOIN pattern.
        const valuesClauses: string[] = [];
        const params: unknown[] = [];
        chunk.forEach((r, idx) => {
          params.push(r.id);
          params.push(vectorLiteral(vectors[idx]));
          const idP = `$${idx * 2 + 1}`;
          const vP = `$${idx * 2 + 2}`;
          valuesClauses.push(`(${idP}, ${vP}::vector)`);
        });
        const sql = `
          UPDATE "Market" m SET embedding = v.embedding
          FROM (VALUES ${valuesClauses.join(",")}) AS v(id, embedding)
          WHERE m.id = v.id
        `;
        await prisma.$executeRawUnsafe(sql, ...params);
        embedded += chunk.length;
        succeeded = true;
        break;
      } catch (err) {
        const msg = String(err);
        const transient = msg.includes("ETIMEDOUT") || msg.includes("P1001") || msg.includes("ECONNRESET") || msg.includes("Connection terminated") || msg.includes("read ECONN");
        if (!transient || attempt === maxAttempts - 1) {
          errors += chunk.length;
          console.error(`[embed] batch failed (${chunk.length} markets) after attempt ${attempt + 1}:`, msg.slice(0, 200));
          break;
        }
        const delay = 1000 * Math.pow(2, attempt) + Math.random() * 500;
        console.warn(`[embed] batch transient error: ${msg.slice(0, 80)} — retry ${attempt + 1}/${maxAttempts - 1} in ${Math.round(delay)}ms`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    if (!succeeded) {
      // Already counted in errors above; just continue
    }
    opts.onProgress?.(Math.min(i + batchSize, rows.length), total);
  }

  const remaining = total === limit ? await pendingEmbeddingCount() : 0;
  return { embedded, errors, remaining };
}

export async function pendingEmbeddingCount(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ c: bigint }>>`SELECT COUNT(*)::bigint AS c FROM "Market" WHERE embedding IS NULL`;
  return Number(rows[0]?.c ?? 0);
}

/**
 * Find the K most-similar closed markets to a given target market via cosine similarity on
 * pgvector. Returns Market rows that have a non-null embedding, ordered by similarity (closest
 * first). Empty if the target market itself has no embedding.
 *
 * Implementation note: we do this in two queries instead of one SELECT *. Prisma can't
 * deserialize the pgvector type when returned by raw SQL ("Failed to deserialize column of
 * type 'vector'"), so we first get the K nearest market ids via raw SQL (where we need the
 * <=> operator), then fetch the actual Market rows via Prisma's normal findMany (which knows
 * to skip Unsupported columns). Both queries are indexed and fast.
 */
export async function findSimilarClosedMarkets(targetMarketId: string, opts: { limit?: number; excludeIds?: string[] } = {}): Promise<Market[]> {
  const limit = opts.limit ?? 6;
  const exclude = [targetMarketId, ...(opts.excludeIds ?? [])];

  const targetRow = await prisma.$queryRaw<Array<{ embedding: string | null }>>`
    SELECT embedding::text AS embedding FROM "Market" WHERE id = ${targetMarketId}
  `;
  const targetEmbedding = targetRow[0]?.embedding;
  if (!targetEmbedding) return [];

  const excludePlaceholders = exclude.map((_, i) => `$${i + 2}`).join(",");
  const idSql = `
    SELECT id FROM "Market"
    WHERE closed = true AND embedding IS NOT NULL AND id NOT IN (${excludePlaceholders})
    ORDER BY embedding <=> $1::vector
    LIMIT ${limit}
  `;
  const idRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(idSql, targetEmbedding, ...exclude);
  const ids = idRows.map((r) => r.id);
  if (ids.length === 0) return [];

  const markets = await prisma.market.findMany({ where: { id: { in: ids } } });
  // Preserve similarity ordering from the raw query (findMany doesn't guarantee order).
  const byId = new Map(markets.map((m) => [m.id, m]));
  return ids.map((id) => byId.get(id)).filter((m): m is Market => !!m);
}
