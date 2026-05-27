import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { fetchAllClosedMarkets, normalize, type NormalizedMarket } from "../src/lib/polymarket";
import { bulkUpsertMarkets } from "../src/lib/ingest";

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
  let written = 0;
  let errors = 0;
  let normSkipped = 0;
  const start = Date.now();

  async function bulkUpsertWithRetry(batch: NormalizedMarket[]): Promise<void> {
    if (batch.length === 0) return;
    const maxAttempts = 5;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const r = await bulkUpsertMarkets(batch);
        written += r.written;
        return;
      } catch (err) {
        lastErr = err;
        const msg = String(err);
        const transient = msg.includes("ETIMEDOUT") || msg.includes("P1001") || msg.includes("ECONNRESET") || msg.includes("Connection terminated") || msg.includes("read ECONN");
        if (!transient || attempt === maxAttempts - 1) break;
        const delay = 1000 * Math.pow(2, attempt) + Math.random() * 500;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    errors += batch.length;
    console.error(`  bulk upsert of ${batch.length} failed:`, String(lastErr).slice(0, 200));
  }

  // Per-page bulk upsert via the onPage callback. ON-CONFLICT-DO-UPDATE in one round-trip
  // collapses ~100 per-row round-trips into one (~100x speedup over the public proxy). Each
  // page persists immediately so a crash leaves partial progress in the DB; re-run picks up
  // where we left off (idempotent).
  await fetchAllClosedMarkets({
    maxPages,
    onPage: async (page) => {
      pages++;
      const batch: NormalizedMarket[] = [];
      for (const raw of page) {
        const n = normalize(raw);
        if (!n) { normSkipped++; continue; }
        if (!n.description || n.description.length < 30) { normSkipped++; continue; }
        batch.push(n);
      }
      await bulkUpsertWithRetry(batch);
      if (pages % 20 === 1 || page.length < 100) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`  page ${pages}: ${page.length} fetched (cumulative: ${written} written, ${errors} errors, ${normSkipped} skipped, ${elapsed}s)`);
      }
    },
  });

  const after = await prisma.market.count({ where: { closed: true } });
  const totalSec = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n[backfill-closed] DONE in ${totalSec}s.`);
  console.log(`  written:  ${written}`);
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
