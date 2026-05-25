import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { submitVerifierBatch, pickMarketsForVerifierBatch } from "../src/lib/batch";
import { VERIFIER_MODEL } from "../src/lib/anthropic";

async function main() {
  console.log(`VERIFIER_MODEL = ${VERIFIER_MODEL}`);
  const markets = await pickMarketsForVerifierBatch(200);
  console.log(`Found ${markets.length} markets eligible for verification.`);
  if (markets.length === 0) {
    await prisma.$disconnect();
    return;
  }
  const batchId = await submitVerifierBatch(markets);
  console.log(`Submitted batch ${batchId} with ${markets.length} markets.`);
  console.log(`Scheduler poll (every 5 min) will ingest results when ready.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
