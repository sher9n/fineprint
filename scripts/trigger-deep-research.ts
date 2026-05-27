import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { submitDeepResearch } from "../src/lib/deep-research";

/**
 * Admin-only utility: trigger GPT deep research for one or more market ids by calling
 * submitDeepResearch directly. Bypasses the HTTP route's auth gate, which is intended for
 * UI clicks. Use this only from a trusted environment (your laptop, with railway env loaded
 * for prod runs).
 *
 * Usage:
 *   railway run -- npx tsx scripts/trigger-deep-research.ts <marketId> [marketId...]
 *
 * Flags via env:
 *   FORCE=1  pass through to submitDeepResearch so it bypasses the "already has a gpt_deep
 *            row for current rulesHash" guard (used to re-test on prompt changes).
 */

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error("usage: trigger-deep-research.ts <marketId> [more ids...]");
    process.exit(2);
  }
  const force = process.env.FORCE === "1";

  for (const id of ids) {
    const m = await prisma.market.findUnique({ where: { id } });
    if (!m) {
      console.error(`[${id}] not found in DB`);
      continue;
    }
    console.log(`[${id}] ${m.question.slice(0, 80)}`);
    try {
      const job = await submitDeepResearch(m, { force });
      console.log(`  submitted: jobId=${job.id} openaiId=${job.openaiResponseId} status=${job.status}`);
    } catch (err) {
      console.error(`  submit failed:`, String(err).slice(0, 250));
    }
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
