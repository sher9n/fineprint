import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { submitVerifierBatch, pollAndIngestBatches } from "../src/lib/batch";

const TARGETS = ["1108137", "1130012", "1130016"];
const POLL_MS = 30_000;
const TIMEOUT_MS = 60 * 60 * 1000;

async function main() {
  const markets = await prisma.market.findMany({ where: { id: { in: TARGETS } } });
  if (markets.length !== TARGETS.length) {
    console.error(`expected ${TARGETS.length} markets, found ${markets.length}`);
    process.exit(1);
  }

  console.log("Old Opus verdicts (latest pre-fix):");
  for (const id of TARGETS) {
    const old = await prisma.analysis.findFirst({
      where: { marketId: id, pass: "opus", model: "claude-opus-4-7" },
      orderBy: { createdAt: "desc" },
    });
    if (!old) { console.log(`  ${id}: (no prior opus)`); continue; }
    console.log(`  ${id} | div=${old.divergenceScore} | edge=${old.edgeDirection} | bet=${old.betSide} | rule_p=${old.ruleImpliedProbability?.toFixed(2) ?? "?"}`);
  }

  const batchId = await submitVerifierBatch(markets);
  console.log(`\nSubmitted batch ${batchId}; polling every ${POLL_MS / 1000}s...`);

  const job = await prisma.batchJob.findFirstOrThrow({ where: { anthropicBatchId: batchId } });
  const start = Date.now();
  while (true) {
    if (Date.now() - start > TIMEOUT_MS) { console.error("timeout"); process.exit(1); }
    await new Promise((r) => setTimeout(r, POLL_MS));
    await pollAndIngestBatches();
    const j = await prisma.batchJob.findUnique({ where: { id: job.id } });
    if (!j) throw new Error("job vanished");
    const el = Math.round((Date.now() - start) / 1000);
    console.log(`[${el}s] status=${j.status}`);
    if (j.status === "ended" || j.status === "error" || j.status === "canceled") break;
  }

  console.log("\nNew verdicts:");
  for (const m of markets) {
    const a = await prisma.analysis.findFirst({
      where: { marketId: m.id, pass: "opus", model: "claude-opus-4-7" },
      orderBy: { createdAt: "desc" },
    });
    if (!a) { console.log(`  ${m.id}: (no new opus)`); continue; }
    const title = (m.eventTitle && m.groupItemTitle) ? `${m.eventTitle} — ${m.groupItemTitle}` : m.question;
    console.log(`\n  ${m.id}  ${title.slice(0, 70)}`);
    console.log(`    div=${a.divergenceScore}/10  edge=${a.edgeDirection}  bet=${a.betSide}  edge_score=${a.edgeScore.toFixed(0)}/100`);
    console.log(`    rule_p=${a.ruleImpliedProbability?.toFixed(3) ?? "?"}  yes_pay=${a.expectedYesPayoutCents}¢  no_pay=${a.expectedNoPayoutCents}¢`);
    console.log(`    source+steelman: ${(a.sourceFindings || "(empty)").slice(0, 300).replace(/\n/g, " ")}…`);
    console.log(`    reasoning: ${(a.reasoning || "").slice(0, 250).replace(/\n/g, " ")}…`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
