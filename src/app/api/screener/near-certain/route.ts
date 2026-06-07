import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { impliedBetSide, parseGroupItemTitleDate } from "@/lib/explain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Near-certain short-hold screener.
 *
 * The opposite end of the product from "biggest mismatch": instead of the model's
 * largest disagreements with the market (which the calibration backtest showed are
 * mostly model errors), this surfaces heavy favorites resolving soon, where the
 * empirical edge is real (in our own backtest, markets priced 95-100c resolved YES
 * 132/132). The bet is the favorite side: small cents of upside, high hit rate,
 * short hold.
 *
 * The fineprint engine is reused here as a SAFETY FILTER, not a pick generator: if
 * our latest current-rules analysis thinks the "obvious" favorite is actually a
 * hidden-rule trap (the model leans the other way), we move it to a separate
 * "a rule might bite" bucket instead of recommending it.
 *
 * No order book is stored, so the entry price here is the last trade. The few-cents
 * edge can be eaten by the bid/ask spread, so this is a candidate list to confirm
 * against the live book, not a fill guarantee.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "30", 10), 1), 365);
  const favFloor = Math.min(Math.max(parseFloat(url.searchParams.get("favFloor") || "0.90"), 0.6), 0.985);
  const favCeil = 0.985; // above this the edge is gone (and effectively resolved)
  const minLiquidity = parseFloat(url.searchParams.get("minLiquidity") || "5000");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "120", 10), 300);

  const now = Date.now();
  const horizon = new Date(now + days * 86400000);

  const candidates = await prisma.market.findMany({
    where: {
      active: true,
      closed: false,
      endDate: { gt: new Date(now), lte: horizon },
      liquidity: { gte: minLiquidity },
      yesPrice: { not: null },
      OR: [
        { yesPrice: { gte: favFloor, lte: favCeil } }, // YES is the heavy favorite
        { yesPrice: { gte: 1 - favCeil, lte: 1 - favFloor } }, // NO is the heavy favorite
      ],
    },
    select: {
      id: true,
      slug: true,
      question: true,
      eventTitle: true,
      groupItemTitle: true,
      imageUrl: true,
      yesPrice: true,
      noPrice: true,
      liquidity: true,
      volume: true,
      endDate: true,
      rulesHash: true,
      analyses: {
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          pass: true,
          rulesHash: true,
          ruleImpliedProbability: true,
          betSide: true,
          edgeDirection: true,
          divergenceScore: true,
          divergenceType: true,
          createdAt: true,
        },
      },
    },
    orderBy: { endDate: "asc" },
    take: 1500,
  });

  const rows = candidates.map((m) => {
    const yes = m.yesPrice!;
    const favoriteSide: "YES" | "NO" = yes >= 0.5 ? "YES" : "NO";
    const favPrice = favoriteSide === "YES" ? yes : m.noPrice ?? 1 - yes;
    const edgeCents = (1 - favPrice) * 100; // profit per share if it resolves as expected
    const returnPct = favPrice > 0 ? ((1 - favPrice) / favPrice) * 100 : 0;

    // Effective resolution date: a date-shaped grouped title (e.g. "June 30") is the real
    // resolution; endDate is only the trading cutoff. Use the later of the two for yield math.
    const groupDate = parseGroupItemTitleDate(m.groupItemTitle, m.endDate);
    const resDate = groupDate && m.endDate && groupDate > m.endDate ? groupDate : m.endDate;
    const daysToResolve = Math.max(0.25, ((resDate?.getTime() ?? now) - now) / 86400000);
    const dailyReturnPct = returnPct / daysToResolve;

    // Safety overlay: the most authoritative current-rules verdict (synthesis > opus > obvious).
    const cur = (p: string) => m.analyses.find((a) => a.pass === p && a.rulesHash === m.rulesHash);
    const a = cur("synthesis") ?? cur("opus") ?? cur("obvious") ?? null;
    const ruleP = a?.ruleImpliedProbability ?? null;
    const modelSide = a ? impliedBetSide({ betSide: a.betSide, edgeDirection: a.edgeDirection, ruleImpliedProbability: ruleP }, yes) : "NONE";
    const modelFavP = ruleP == null ? null : favoriteSide === "YES" ? ruleP : 1 - ruleP;

    let safety: "confirmed" | "soft" | "unverified" | "flagged";
    if (!a || modelFavP == null) safety = "unverified";
    else if (modelSide !== "NONE" && modelSide !== favoriteSide) safety = "flagged"; // model bets the underdog
    else if (modelFavP < 0.6) safety = "flagged"; // model thinks the favorite is much weaker than its price
    else if (modelFavP >= 0.85) safety = "confirmed";
    else safety = "soft";

    return {
      id: m.id,
      slug: m.slug,
      question: m.question,
      eventTitle: m.eventTitle,
      groupItemTitle: m.groupItemTitle,
      imageUrl: m.imageUrl,
      yesPrice: m.yesPrice,
      noPrice: m.noPrice,
      liquidity: m.liquidity,
      volume: m.volume,
      endDate: m.endDate,
      favoriteSide,
      favPriceCents: Math.round(favPrice * 100),
      edgeCents: Math.round(edgeCents * 10) / 10,
      returnPct: Math.round(returnPct * 10) / 10,
      daysToResolve: Math.round(daysToResolve * 10) / 10,
      dailyReturnPct: Math.round(dailyReturnPct * 100) / 100,
      safety,
      model: a
        ? { ruleImpliedProbability: ruleP, modelFavoriteProb: modelFavP, modelSide, divergenceScore: a.divergenceScore, divergenceType: a.divergenceType, pass: a.pass }
        : null,
    };
  });

  // Tradeable = not flagged by the fineprint safety check. Rank by yield per day held
  // (the consistent-money metric), confirmed/soft ahead of unverified at equal yield.
  const rank = { confirmed: 0, soft: 1, unverified: 2 } as Record<string, number>;
  const tradeable = rows
    .filter((r) => r.safety !== "flagged" && r.edgeCents >= 1.5)
    .sort((a, b) => rank[a.safety] - rank[b.safety] || b.dailyReturnPct - a.dailyReturnPct)
    .slice(0, limit);

  // Flagged = "looks certain but a rule may bite" — the fineprint catches, sorted by how
  // strongly the model disagrees with the crowd's near-certainty.
  const flagged = rows
    .filter((r) => r.safety === "flagged")
    .sort((a, b) => (a.model?.modelFavoriteProb ?? 1) - (b.model?.modelFavoriteProb ?? 1))
    .slice(0, 40);

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    params: { days, favFloor, minLiquidity },
    counts: { scanned: candidates.length, tradeable: tradeable.length, flagged: flagged.length },
    tradeable,
    flagged,
  });
}
