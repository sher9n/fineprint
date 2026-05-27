import "dotenv/config";
import { prisma } from "../src/lib/prisma";

/**
 * Snapshot of deep-research and synthesis state for a list of market ids. Used to monitor a
 * batch of submissions and decide when results are ready to inspect.
 *
 * Usage:
 *   railway run -- npx tsx scripts/check-deep-research.ts <id> [id...]
 */

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error("usage: check-deep-research.ts <marketId> [more ids...]");
    process.exit(2);
  }

  for (const id of ids) {
    const m = await prisma.market.findUnique({ where: { id } });
    if (!m) {
      console.log(`[${id}] NOT FOUND`);
      continue;
    }
    console.log(`\n=== ${id} ${m.question.slice(0, 80)}`);
    console.log(`    yes/no: ${m.yesPrice} / ${m.noPrice}   rulesHash: ${m.rulesHash}`);

    const job = await prisma.deepResearchJob.findFirst({
      where: { marketId: id },
      orderBy: { submittedAt: "desc" },
    });
    if (job) {
      console.log(`    job: id=${job.id} status=${job.status} submittedAt=${job.submittedAt.toISOString()} completedAt=${job.completedAt?.toISOString() ?? "-"} cost=$${job.costUsd.toFixed(2)}`);
      if (job.errorMessage) console.log(`    error: ${job.errorMessage.slice(0, 200)}`);
    } else {
      console.log(`    job: (none)`);
    }

    const analyses = await prisma.analysis.findMany({
      where: { marketId: id, rulesHash: m.rulesHash, pass: { in: ["opus", "gpt_deep", "synthesis"] } },
      orderBy: { createdAt: "desc" },
    });
    console.log(`    analyses (current rulesHash):`);
    for (const a of analyses.slice(0, 8)) {
      console.log(`      ${a.pass.padEnd(10)} ${a.createdAt.toISOString().slice(0, 19)}  div=${a.divergenceScore}  edgeDir=${a.edgeDirection.padEnd(4)}  betSide=${a.betSide.padEnd(4)}  rule_p=${a.ruleImpliedProbability}  E(yes)=${a.expectedYesPayoutCents}`);
    }
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
