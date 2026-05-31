import { prisma } from "./prisma";
import { fetchMarketById, normalize } from "./polymarket";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 1 }, () => worker()));
}

/**
 * Refresh the live price + open/closed status of the markets that can currently surface in the
 * feed (active, not closed, with an escalated analysis). Runs hourly so cards don't show stale
 * prices or already-resolved markets between the once-a-day 05:00 ingest. This is a TARGETED set
 * of single-market Gamma fetches, not the full ingest. Resolved/decided markets (price collapses
 * to ~0/100c, or Polymarket flips them closed) then fall out of the feed via its existing
 * price/closed filter, and cards reflect the current price. Only price + status are updated; rules
 * and analyses are left to the daily ingest. Per-market failures are swallowed (retried next hour).
 */
export async function refreshSurfacedMarketPrices(opts: { limit?: number; concurrency?: number } = {}): Promise<{
  checked: number;
  updated: number;
  nowClosed: number;
  errors: number;
}> {
  const limit = opts.limit ?? 800;
  // Modest concurrency + retry-with-backoff: Gamma rate-limits bursts (a concurrency-6 sweep over
  // 800 markets errored ~half), and a partial refresh leaves stale cards. 3 in flight with up to
  // two retries keeps the error rate low while still finishing in ~2 min.
  const concurrency = opts.concurrency ?? 3;
  const markets = await prisma.market.findMany({
    where: { active: true, closed: false, analyses: { some: { pass: { in: ["opus", "synthesis", "gpt_deep", "obvious"] } } } },
    select: { id: true },
    orderBy: { liquidity: "desc" },
    take: limit,
  });
  let updated = 0;
  let nowClosed = 0;
  let errors = 0;
  await mapWithConcurrency(markets, concurrency, async (mk) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const raw = await fetchMarketById(mk.id);
        if (!raw) return;
        const n = normalize(raw);
        if (!n) return;
        await prisma.market.update({
          where: { id: mk.id },
          data: { yesPrice: n.yesPrice, noPrice: n.noPrice, active: n.active, closed: n.closed, lastIngestedAt: new Date() },
        });
        updated++;
        if (n.closed) nowClosed++;
        return;
      } catch {
        if (attempt < 2) {
          await sleep(400 * (attempt + 1));
          continue;
        }
        errors++;
      }
    }
  });
  return { checked: markets.length, updated, nowClosed, errors };
}
