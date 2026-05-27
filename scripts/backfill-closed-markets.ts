import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { fetchAllClosedMarkets, normalize, type NormalizedMarket } from "../src/lib/polymarket";
import { upsertMarket } from "../src/lib/ingest";

/**
 * One-shot backfill: pull historical CLOSED markets from Polymarket Gamma and upsert into our DB.
 *
 * Why: the verifier's "resolvedSiblings" query in src/lib/batch.ts looks for closed markets with
 * overlapping keywords so Opus can reason about resolver precedent ("the resolver has answered a
 * near-identical question before — here's how"). For markets that resolved BEFORE we started
 * ingesting in May 2026, those rows aren't in the DB and the precedent signal silently drops.
 * This script seeds that history.
 *
 * Idempotent: re-running just upserts and reports stable counts. Bounded by maxPages env to keep
 * a runaway from blowing through Gamma's rate limits.
 *
 * Usage:
 *   npx tsx scripts/backfill-closed-markets.ts
 *
 * Against prod DB (one-time after deploy):
 *   DATABASE_URL='<prod connection string>' npx tsx scripts/backfill-closed-markets.ts
 *
 * Env knobs:
 *   BACKFILL_MAX_PAGES   (default 200)   each page is 100 markets (Gamma's hard cap)
 */

async function main() {
  const maxPages = parseInt(process.env.BACKFILL_MAX_PAGES ?? "200", 10);
  console.log(`[backfill-closed] target: up to ${maxPages} pages of 100 closed markets each (${maxPages * 100} max).`);

  const before = await prisma.market.count({ where: { closed: true } });
  console.log(`[backfill-closed] DB closed-market count BEFORE: ${before}`);

  let pages = 0;
  const start = Date.now();
  const raws = await fetchAllClosedMarkets({
    maxPages,
    onPage: (page) => {
      pages++;
      if (pages % 20 === 1 || page.length < 100) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`  page ${pages}: ${page.length} markets (${elapsed}s elapsed)`);
      }
    },
  });
  const fetchSec = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[backfill-closed] fetched ${raws.length} closed markets from Gamma in ${fetchSec}s.`);

  const normalized: NormalizedMarket[] = [];
  let normSkipped = 0;
  for (const raw of raws) {
    const n = normalize(raw);
    if (!n) { normSkipped++; continue; }
    if (!n.description || n.description.length < 30) { normSkipped++; continue; }
    normalized.push(n);
  }
  console.log(`[backfill-closed] ${normalized.length} normalized, ${normSkipped} skipped (no desc / no id).`);

  let created = 0;
  let updated = 0;
  let errors = 0;
  const upStart = Date.now();
  // Sequential upserts. Postgres can take heavier concurrency but the Gamma fetch is the
  // bottleneck; serial keeps logging readable and avoids burning DB connections.
  for (const n of normalized) {
    try {
      const r = await upsertMarket(n);
      if (r.created) created++;
      else updated++;
    } catch (err) {
      errors++;
      console.error(`  upsert ${n.id} failed:`, String(err).slice(0, 200));
    }
    if ((created + updated) % 250 === 0 && (created + updated) > 0) {
      const sec = ((Date.now() - upStart) / 1000).toFixed(1);
      console.log(`  progress: ${created} created, ${updated} updated, ${errors} errors (${sec}s)`);
    }
  }

  const after = await prisma.market.count({ where: { closed: true } });
  const totalSec = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n[backfill-closed] DONE in ${totalSec}s.`);
  console.log(`  created:  ${created}`);
  console.log(`  updated:  ${updated}`);
  console.log(`  errors:   ${errors}`);
  console.log(`  skipped:  ${normSkipped}`);
  console.log(`  DB closed-market count BEFORE: ${before}`);
  console.log(`  DB closed-market count AFTER:  ${after}  (+${after - before})`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
