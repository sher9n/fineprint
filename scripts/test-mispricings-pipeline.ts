/**
 * End-to-end smoke for the obvious-bets / mispricings daily pipeline. Picks 30 markets via the
 * production picker, submits the obvious Anthropic batch via the production submitter, lets the
 * Railway scheduler poll + ingest, then verifies new pass='obvious' Analysis rows exist.
 *
 * Run:
 *   DATABASE_URL='<railway>' npx tsx scripts/test-mispricings-pipeline.ts
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { pickMarketsForOpusFirstPass, submitObviousBatch } from "../src/lib/batch";

async function main() {
  console.log("[mispricings-test] picking 30 eligible markets...");
  const markets = await pickMarketsForOpusFirstPass(30);
  console.log(`[mispricings-test] picked ${markets.length} markets`);
  if (markets.length === 0) {
    console.log("[mispricings-test] no markets; bailing");
    return;
  }

  console.log("[mispricings-test] submitting obvious batch via production submitter...");
  const batchId = await submitObviousBatch(markets);
  console.log(`[mispricings-test] batch submitted: ${batchId}`);
  console.log(`\nMonitor:`);
  console.log(`  Anthropic Console > Batches > ${batchId}`);
  console.log(`  When ended, production Railway scheduler will poll/ingest within 5 min.`);
  console.log(`\nVerify ingestion:`);
  console.log(`  - BatchJob row: SELECT status, "succeededRequests" FROM "BatchJob" WHERE "anthropicBatchId" = '${batchId}';`);
  console.log(`  - Analysis rows: SELECT COUNT(*) FROM "Analysis" WHERE pass = 'obvious' AND "createdAt" > NOW() - INTERVAL '1 hour';`);
  console.log(`  - API: curl 'https://fineprint-production-a553.up.railway.app/api/markets?category=mispricings&minDivergence=5'`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
