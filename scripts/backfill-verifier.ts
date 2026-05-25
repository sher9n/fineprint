import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { submitVerifierBatch, pickMarketsForVerifierBatch, pollAndIngestBatches } from "../src/lib/batch";

// Markets already re-verified with the new prompt — skip these
const SKIP = new Set(["1108137", "1130012", "1130016"]);

const POLL_MS = 30_000;
const TIMEOUT_MS = 90 * 60 * 1000;

async function main() {
  const candidates = await pickMarketsForVerifierBatch(300, { force: true });
  const targets = candidates.filter((m) => !SKIP.has(m.id));
  console.log(`Eligible: ${candidates.length} | excluding ${candidates.length - targets.length} already-redone | submitting ${targets.length}`);
  if (targets.length === 0) { await prisma.$disconnect(); return; }

  const batchId = await submitVerifierBatch(targets);
  console.log(`Submitted batch ${batchId}; polling every ${POLL_MS / 1000}s (timeout ${TIMEOUT_MS / 60000}min)...`);

  const job = await prisma.batchJob.findFirstOrThrow({ where: { anthropicBatchId: batchId } });
  const start = Date.now();
  while (true) {
    if (Date.now() - start > TIMEOUT_MS) { console.error("timeout"); process.exit(1); }
    await new Promise((r) => setTimeout(r, POLL_MS));
    await pollAndIngestBatches();
    const j = await prisma.batchJob.findUnique({ where: { id: job.id } });
    if (!j) throw new Error("job vanished");
    const el = Math.round((Date.now() - start) / 1000);
    console.log(`[${el}s] status=${j.status} | succeeded=${j.succeededRequests} failed=${j.failedRequests} cost=$${j.costUsd?.toFixed(2)}`);
    if (j.status === "ended" || j.status === "error" || j.status === "canceled") break;
  }

  const after = await prisma.batchJob.findUnique({ where: { id: job.id } });
  console.log(`\n==== Final ====`);
  console.log(`  status:    ${after?.status}`);
  console.log(`  succeeded: ${after?.succeededRequests}`);
  console.log(`  failed:    ${after?.failedRequests}`);
  console.log(`  cost:      $${after?.costUsd?.toFixed(2)}`);

  // Compare: how many markets flipped from edge != NONE to edge == NONE
  const ids = targets.map((m) => m.id);
  const flipped = await prisma.$queryRawUnsafe<Array<{ marketId: string }>>(`
    WITH latest_by_market AS (
      SELECT DISTINCT ON ("marketId") "marketId", "edgeDirection", "createdAt"
      FROM "Analysis" WHERE pass='opus' AND model='claude-opus-4-7' AND "marketId" IN (${ids.map((x) => `'${x}'`).join(",")})
      ORDER BY "marketId", "createdAt" DESC
    ),
    second_latest AS (
      SELECT a."marketId", a."edgeDirection" AS prev_edge
      FROM "Analysis" a JOIN latest_by_market l ON l."marketId" = a."marketId"
      WHERE a.pass='opus' AND a.model='claude-opus-4-7' AND a."createdAt" < l."createdAt"
      ORDER BY a."marketId", a."createdAt" DESC
    )
    SELECT DISTINCT l."marketId" FROM latest_by_market l
    JOIN second_latest p ON p."marketId" = l."marketId"
    WHERE l."edgeDirection" = 'NONE' AND p.prev_edge != 'NONE';
  `);
  console.log(`\n==== Calibration shift ====`);
  console.log(`  Markets where new verdict flipped to edge=NONE (false-positive caught): ${flipped.length}`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
