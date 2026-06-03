import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
function ist(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d) + " IST";
}
async function main() {
  const runs = await prisma.ingestRun.findMany({ where: { kind: "scheduled" }, orderBy: { startedAt: "desc" }, take: 2 });
  console.log("### Last scheduled runs");
  for (const r of runs) console.log(`  [${r.status}] start=${ist(r.startedAt)} fin=${ist(r.finishedAt)} added=${r.marketsAdded} updated=${r.marketsUpdated} analyzed=${r.marketsAnalyzed}${r.errors ? "  errors=" + r.errors.slice(0, 160) : ""}`);

  const batches = await prisma.batchJob.findMany({ where: { anthropicBatchId: { in: ["msgbatch_0141YYfCpS4yFwxSBE6mN3pV", "msgbatch_017C2qw34dowdzpEDh64daR1"] } } });
  console.log("\n### Today's 05:00 batches");
  for (const b of batches) console.log(`  [${b.purpose}/${b.status}] total=${b.totalRequests} ok=${b.succeededRequests} fail=${b.failedRequests} cost=$${b.costUsd.toFixed(2)} end=${ist(b.endedAt)}`);

  const since = new Date("2026-06-02T18:30:00.000Z"); // 2026-06-03 00:00 IST
  const byPass = await prisma.analysis.groupBy({ by: ["pass"], where: { createdAt: { gte: since } }, _count: true });
  console.log("\n### Analyses created today (IST) by pass");
  for (const p of byPass) console.log(`  ${p.pass}: ${p._count}`);
}
main().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); }).finally(() => prisma.$disconnect());
