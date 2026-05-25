import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { reconcileStaleMarkets } from "../src/lib/ingest";

async function main() {
  const before = await prisma.market.aggregate({
    where: { active: true, closed: false },
    _count: true,
  });
  console.log(`Before: ${before._count} markets marked active=true, closed=false in DB.`);

  const start = Date.now();
  // Empty seenIds + far-future cutoff means "re-check every active+open market in the DB".
  const res = await reconcileStaleMarkets({
    seenIds: new Set(),
    cutoff: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    concurrency: 10,
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Reconciliation done in ${elapsed}s.`);
  console.log(`  checked:        ${res.checked}`);
  console.log(`  closed-flipped: ${res.closedFlipped}`);
  console.log(`  updated:        ${res.updated}`);
  console.log(`  errors:         ${res.errors}`);

  const after = await prisma.market.aggregate({
    where: { active: true, closed: false },
    _count: true,
  });
  console.log(`After:  ${after._count} markets still marked active=true, closed=false.`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
