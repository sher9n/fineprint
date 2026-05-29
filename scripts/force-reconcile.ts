/**
 * One-shot reconciliation of all stale open markets. Calls reconcileStaleMarkets directly
 * against Railway prod, no waiting for the next 5am IST ingest.
 *
 * Use after fixing a reconcile bug (like the fetchMarketById/closed-listing one on 2026-05-29)
 * to flush the backlog of markets that should have been closed but were silently skipped.
 *
 * Run:
 *   DATABASE_URL='<railway>' npx tsx scripts/force-reconcile.ts
 */
import "dotenv/config";
import { reconcileStaleMarkets } from "../src/lib/ingest";
import { prisma } from "../src/lib/prisma";

async function main() {
  const dbUrl = process.env.DATABASE_URL || "";
  const dbHost = dbUrl.includes("zephyr") ? "Railway prod" : dbUrl.split("@")[1]?.split("/")[0] ?? "unknown";
  console.log(`[force-reconcile] DB: ${dbHost}`);

  // Snapshot before
  const before = await prisma.market.count({
    where: { active: true, closed: false, lastIngestedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
  console.log(`[force-reconcile] stale-over-24h before: ${before}`);

  const cutoff = new Date();
  console.log(`[force-reconcile] running reconcileStaleMarkets (seenIds empty, cutoff=now)...`);
  const t0 = Date.now();
  const r = await reconcileStaleMarkets({ seenIds: new Set(), cutoff, concurrency: 8 });
  const elapsedS = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n[force-reconcile] DONE in ${elapsedS}s:`);
  console.log(`  checked:        ${r.checked}`);
  console.log(`  updated:        ${r.updated}`);
  console.log(`  closed-flipped: ${r.closedFlipped}`);
  console.log(`  errors:         ${r.errors}`);

  const after = await prisma.market.count({
    where: { active: true, closed: false, lastIngestedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
  console.log(`\n[force-reconcile] stale-over-24h after: ${after}  (delta: ${after - before})`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
