import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { embedPendingMarkets, pendingEmbeddingCount } from "../src/lib/embeddings";

/**
 * One-shot embedding backfill. Generates text-embedding-3-small vectors for every Market
 * whose embedding column is NULL. Idempotent: re-running picks up only the still-pending rows.
 *
 * Usage:
 *   npx tsx scripts/backfill-embeddings.ts
 *
 * Against prod (one-time after deploy + Prisma migration):
 *   DATABASE_URL='<prod connection string>' npx tsx scripts/backfill-embeddings.ts
 *
 * Cost estimate: ~60K markets × ~30 tokens × $0.02/M = ~$0.04. Trivial.
 * Throughput: batch of 100 markets per OpenAI request, ~600 requests for 60K markets.
 * Realistic wall time: 5-15 minutes depending on OpenAI latency.
 */

async function main() {
  const limit = parseInt(process.env.EMBED_LIMIT ?? "100000", 10);
  const batchSize = parseInt(process.env.EMBED_BATCH_SIZE ?? "100", 10);

  const pendingBefore = await pendingEmbeddingCount();
  console.log(`[backfill-embeddings] pending BEFORE: ${pendingBefore}`);
  if (pendingBefore === 0) {
    console.log("Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  const start = Date.now();
  let lastLog = start;
  const res = await embedPendingMarkets({
    limit,
    batchSize,
    onProgress: (done, total) => {
      const now = Date.now();
      if (now - lastLog > 5000 || done === total) {
        const sec = ((now - start) / 1000).toFixed(1);
        const rate = done > 0 ? (done / ((now - start) / 1000)).toFixed(1) : "0";
        console.log(`  ${done}/${total} embedded (${sec}s elapsed, ${rate}/s)`);
        lastLog = now;
      }
    },
  });

  const pendingAfter = await pendingEmbeddingCount();
  const totalSec = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n[backfill-embeddings] DONE in ${totalSec}s.`);
  console.log(`  embedded: ${res.embedded}`);
  console.log(`  errors:   ${res.errors}`);
  console.log(`  pending BEFORE: ${pendingBefore}`);
  console.log(`  pending AFTER:  ${pendingAfter}  (${pendingAfter > 0 ? "re-run to finish" : "all done"})`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
