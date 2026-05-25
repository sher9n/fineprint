import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { submitVerifierBatch, pickMarketsForVerifierBatch, pollAndIngestBatches } from "../src/lib/batch";
import { VERIFIER_MODEL } from "../src/lib/anthropic";

const LIMIT = Number(process.env.LIMIT ?? 3);
const POLL_INTERVAL_MS = 30_000;
const TIMEOUT_MS = 60 * 60 * 1000;

async function main() {
  console.log(`VERIFIER_MODEL = ${VERIFIER_MODEL}`);
  console.log(`Picking up to ${LIMIT} eligible markets...\n`);

  const markets = await pickMarketsForVerifierBatch(LIMIT);
  if (markets.length === 0) {
    console.log("No markets eligible. Exiting.");
    await prisma.$disconnect();
    return;
  }
  console.log(`Eligible markets (${markets.length}):`);
  for (const m of markets) {
    const label = m.eventTitle && m.groupItemTitle ? `${m.eventTitle} — ${m.groupItemTitle}` : m.question;
    console.log(`  ${m.id}  ${label.slice(0, 80)}`);
  }

  const batchId = await submitVerifierBatch(markets);
  console.log(`\nSubmitted batch ${batchId}\nPolling every ${POLL_INTERVAL_MS / 1000}s until complete (timeout ${TIMEOUT_MS / 60000}min)...\n`);

  const job0 = await prisma.batchJob.findFirst({ where: { anthropicBatchId: batchId } });
  if (!job0) throw new Error("batch job row missing after submit");
  const jobId = job0.id;
  const submittedAt = Date.now();

  let lastStatus = "submitted";
  while (true) {
    if (Date.now() - submittedAt > TIMEOUT_MS) {
      console.error("Timeout waiting for batch.");
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const result = await pollAndIngestBatches();
    const job = await prisma.batchJob.findUnique({ where: { id: jobId } });
    if (!job) throw new Error("job vanished");
    const elapsed = Math.round((Date.now() - submittedAt) / 1000);
    if (job.status !== lastStatus) {
      console.log(`[${elapsed}s] status: ${lastStatus} -> ${job.status}  (poll: checked=${result.checked} ingested=${result.ingested})`);
      lastStatus = job.status;
    } else {
      console.log(`[${elapsed}s] status: ${job.status}`);
    }
    if (job.status === "ended" || job.status === "error" || job.status === "canceled") break;
  }

  const job = await prisma.batchJob.findUnique({ where: { id: jobId } });
  console.log(`\n==== Final BatchJob row ====`);
  console.log(`  status:        ${job?.status}`);
  console.log(`  succeeded:     ${job?.succeededRequests}`);
  console.log(`  failed:        ${job?.failedRequests}`);
  console.log(`  cost:          $${job?.costUsd?.toFixed(4) ?? "?"}`);
  console.log(`  errors:        ${job?.errors ?? "(none)"}`);

  console.log(`\n==== Saved analyses ====`);
  for (const m of markets) {
    const latest = await prisma.analysis.findFirst({
      where: { marketId: m.id, pass: "opus" },
      orderBy: { createdAt: "desc" },
    });
    const label = m.eventTitle && m.groupItemTitle ? `${m.eventTitle} — ${m.groupItemTitle}` : m.question;
    if (!latest) {
      console.log(`\n  ✗ ${label.slice(0, 70)}  (no opus analysis stored)`);
      continue;
    }
    console.log(`\n  ✓ ${label.slice(0, 70)}`);
    console.log(`      model:          ${latest.model}`);
    console.log(`      pass:           ${latest.pass}`);
    console.log(`      divergence:     ${latest.divergenceScore}/10 (${latest.divergenceType})`);
    console.log(`      edge_direction: ${latest.edgeDirection}`);
    console.log(`      bet_side:       ${latest.betSide}`);
    console.log(`      edge_score:     ${latest.edgeScore.toFixed(0)}/100`);
    console.log(`      rule_p:         ${latest.ruleImpliedProbability != null ? latest.ruleImpliedProbability.toFixed(3) : "?"}`);
    console.log(`      yes_payout¢:    ${latest.expectedYesPayoutCents ?? "?"}`);
    console.log(`      no_payout¢:     ${latest.expectedNoPayoutCents ?? "?"}`);
    console.log(`      cost:           $${latest.costUsd.toFixed(4)}`);
    console.log(`      cache_read:     ${latest.cacheReadTokens}`);
    console.log(`      cache_write:    ${latest.cacheCreationTokens}`);
    console.log(`      source_findings:${latest.sourceFindings ? " " + latest.sourceFindings.slice(0, 200) + (latest.sourceFindings.length > 200 ? "…" : "") : " (empty)"}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
