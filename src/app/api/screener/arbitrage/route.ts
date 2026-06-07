import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseGroupItemTitleDate } from "@/lib/explain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * negRisk basket arbitrage candidate flagger.
 *
 * A Polymarket negRisk group is a set of mutually-exclusive outcomes (at most one
 * resolves YES). So across the group the YES prices should sum to ~$1. When the last
 * trades don't:
 *   - sum > 1  -> buy one NO of every leg: costs (N - sum), pays at least (N-1) because
 *                 at most one YES wins, so locks >= (sum - 1). Robust: needs only mutual
 *                 exclusivity, which negRisk guarantees.
 *   - sum < 1  -> buy one YES of every leg: costs `sum`, pays $1 IF the set is exhaustive
 *                 (no hidden "other" outcome). Flagged separately because that assumption
 *                 can fail.
 *
 * Two honest limits, surfaced in the UI: (1) we store last-trade prices, not the order
 * book, so a flagged gap may not be fillable at these prices; (2) the negRisk adapter
 * lets anyone convert a complete set, so real gaps are usually small and short-lived.
 * This is a candidate list to confirm against the live book, not a guaranteed fill.
 * Cross-venue (Kalshi / Manifold) arbitrage is intentionally out of scope for v1.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const minEdge = Math.max(parseFloat(url.searchParams.get("minEdge") || "0.02"), 0.005); // $/basket
  // A real partition mis-price is a SMALL deviation from $1. A large one means the group is
  // incomplete in our data (we hold only some legs) or the last-trade prices are stale on
  // illiquid longshots, not arbitrage. Bound it so the flagger isn't drowned in artifacts.
  const maxDev = Math.min(Math.max(parseFloat(url.searchParams.get("maxDev") || "0.15"), 0.02), 0.5);
  const minLiquidity = parseFloat(url.searchParams.get("minLiquidity") || "1000"); // per leg
  const sort = url.searchParams.get("sort") === "daily" ? "daily" : "total";
  const now = Date.now();

  const markets = await prisma.market.findMany({
    where: { active: true, closed: false, negRiskMarketId: { not: null }, yesPrice: { not: null } },
    select: {
      id: true, slug: true, question: true, eventTitle: true, eventSlug: true,
      groupItemTitle: true, yesPrice: true, noPrice: true, liquidity: true,
      negRiskMarketId: true, endDate: true,
    },
  });

  type Leg = (typeof markets)[number];
  const groups = new Map<string, Leg[]>();
  for (const m of markets) {
    const k = m.negRiskMarketId!;
    const arr = groups.get(k) ?? [];
    arr.push(m);
    groups.set(k, arr);
  }

  const candidates = [];
  for (const [k, legs] of groups) {
    if (legs.length < 2) continue;
    const sum = legs.reduce((s, l) => s + (l.yesPrice ?? 0), 0);
    const gap = sum - 1; // >0 overpriced (buy all NO), <0 underpriced (buy all YES)
    if (Math.abs(gap) < minEdge || Math.abs(gap) > maxDev) continue; // skip artifacts (incomplete group / stale prices)
    const minLegLiq = Math.min(...legs.map((l) => l.liquidity));
    if (minLegLiq < minLiquidity) continue;
    const underpriced = gap < 0;
    const lock = Math.abs(gap);
    const cost = underpriced ? sum : legs.length - sum; // $ to buy one share of every leg
    const totalReturnPct = cost > 0 ? (lock / cost) * 100 : 0;
    // Capital stays committed until the LAST leg resolves, so the daily yield uses the latest
    // resolution across legs (parsing date-series labels like "June 30" where present, else the
    // trading cutoff). Floored at half a day so a near-instant resolution doesn't divide by ~0.
    let maxResMs = -Infinity;
    for (const l of legs) {
      if (l.endDate) maxResMs = Math.max(maxResMs, l.endDate.getTime());
      const gd = parseGroupItemTitleDate(l.groupItemTitle, l.endDate);
      if (gd) maxResMs = Math.max(maxResMs, gd.getTime());
    }
    const daysToResolve = Number.isFinite(maxResMs) ? Math.max(0.5, (maxResMs - now) / 86400000) : null;
    const dailyReturnPct = daysToResolve == null ? null : totalReturnPct / daysToResolve;
    candidates.push({
      negRiskMarketId: k,
      eventTitle: legs[0].eventTitle,
      eventSlug: legs[0].eventSlug,
      outcomes: legs.length,
      yesSum: Math.round(sum * 1000) / 1000,
      direction: underpriced ? "buy_all_yes" : "buy_all_no",
      requiresExhaustive: underpriced, // buy-all-YES only pays $1 if no hidden "other" outcome
      lockPerBasket: Math.round(lock * 1000) / 1000,
      costPerBasket: Math.round(cost * 1000) / 1000,
      totalReturnPct: Math.round(totalReturnPct * 10) / 10,
      daysToResolve: daysToResolve == null ? null : Math.round(daysToResolve * 10) / 10,
      dailyReturnPct: dailyReturnPct == null ? null : Math.round(dailyReturnPct * 100) / 100,
      minLegLiquidity: Math.round(minLegLiq),
      legs: legs
        .map((l) => ({ id: l.id, label: l.groupItemTitle ?? l.question, yesPrice: l.yesPrice, liquidity: Math.round(l.liquidity), endDate: l.endDate }))
        .sort((a, b) => (b.yesPrice ?? 0) - (a.yesPrice ?? 0)),
    });
  }
  candidates.sort((a, b) =>
    sort === "daily"
      ? (b.dailyReturnPct ?? -1) - (a.dailyReturnPct ?? -1)
      : b.totalReturnPct - a.totalReturnPct
  );

  // Robust locks: buy-all-NO on a mutually-exclusive set pays >= N-1 no matter what (holds even
  // if our copy of the group is incomplete or the set is non-exhaustive). The only open risk is
  // fillability at these last-trade prices. Conditional: buy-all-YES only returns $1 if the set is
  // exhaustive, and the sub-$1 gap is usually just the unlisted "other/none" probability, so these
  // are kept separate and clearly caveated rather than presented as locks.
  const locks = candidates.filter((c) => c.direction === "buy_all_no");
  const conditional = candidates.filter((c) => c.direction === "buy_all_yes");

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    params: { minEdge, maxDev, minLiquidity, sort },
    counts: { negRiskGroups: groups.size, locks: locks.length, conditional: conditional.length },
    locks: locks.slice(0, 60),
    conditional: conditional.slice(0, 40),
  });
}
