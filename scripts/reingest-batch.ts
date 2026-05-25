import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { pollAndIngestBatches } from "../src/lib/batch";

const BATCH_ID = process.env.BATCH_ID;
if (!BATCH_ID) {
  console.error("set BATCH_ID env var (anthropic batch id)");
  process.exit(1);
}

async function main() {
  const job = await prisma.batchJob.findFirst({ where: { anthropicBatchId: BATCH_ID } });
  if (!job) throw new Error(`no BatchJob row for ${BATCH_ID}`);

  console.log(`Found job ${job.id} (purpose=${job.purpose}, status=${job.status})`);

  // Wipe stale analyses for this batch's markets created since submission
  const markets = JSON.parse(job.marketIds) as string[];
  const stale = await prisma.analysis.deleteMany({
    where: { marketId: { in: markets }, model: "claude-opus-4-7", createdAt: { gte: job.submittedAt } },
  });
  console.log(`Deleted ${stale.count} stale opus-model rows for this batch.`);

  // Wipe cost log entries from the buggy ingest so we don't double-count
  // (we'll re-write them as the new ingest runs)
  const wipedCosts = await prisma.costLog.deleteMany({
    where: { purpose: "verifier_pass_batch", createdAt: { gte: job.submittedAt } },
  });
  console.log(`Deleted ${wipedCosts.count} cost log entries to be rewritten by re-ingest.`);

  // Reset the BatchJob row so pollAndIngestBatches re-processes it
  await prisma.batchJob.update({
    where: { id: job.id },
    data: { status: "in_progress", succeededRequests: 0, failedRequests: 0, costUsd: 0, endedAt: null, errors: null },
  });
  console.log(`Reset batch job to in_progress. Triggering pollAndIngestBatches...`);

  const r = await pollAndIngestBatches();
  console.log(`Poll result: checked=${r.checked} ingested=${r.ingested}`);

  const after = await prisma.batchJob.findUnique({ where: { id: job.id } });
  console.log(`\n==== After re-ingest ====`);
  console.log(`  status:        ${after?.status}`);
  console.log(`  succeeded:     ${after?.succeededRequests}`);
  console.log(`  failed:        ${after?.failedRequests}`);
  console.log(`  cost (logged): $${after?.costUsd?.toFixed(4)}`);

  const opusToday = await prisma.analysis.count({
    where: { pass: "opus", model: "claude-opus-4-7", marketId: { in: markets } },
  });
  console.log(`  opus rows in DB for these markets: ${opusToday}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
