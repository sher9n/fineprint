import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { impliedBetSide } from "@/lib/explain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Verification stages exposed via the `verifyStage` filter. Mirrors the values computed below.
const VERIFY_STAGE_VALUES = new Set([
  "initial",
  "opus_only",
  "gpt_only",
  "opus_and_gpt",
  "synthesis_agreed",
  "synthesis_disagreed",
  // "synthesis" is a shortcut alias meaning either synthesis_agreed or synthesis_disagreed
  "synthesis",
]);

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  // category: opportunities (fineprint) | mispricings (world-state). Default opportunities for
  // backwards compatibility with existing UI calls. When category=mispricings we surface markets
  // whose latest current-rules `pass='obvious'` analysis crossed the confidence threshold and has
  // a directional bet side. The `analysis` field returned for mispricings is the obvious one,
  // not the fineprint verifier — both pipelines run on the same 2000-market pool daily but live
  // in their own tabs.
  const category = url.searchParams.get("category") === "mispricings" ? "mispricings" : "opportunities";
  const sort = url.searchParams.get("sort") || "edge";
  // Different default thresholds per category. For mispricings, confidence (stored in
  // divergenceScore) at >=6 corresponds to "meaningful indirect evidence" or stronger.
  const defaultMinScore = category === "mispricings" ? "20" : "20";
  const defaultMinDivergence = category === "mispricings" ? "6" : "4";
  const minScore = parseFloat(url.searchParams.get("minScore") || defaultMinScore);
  const minDivergence = parseInt(url.searchParams.get("minDivergence") || defaultMinDivergence, 10);
  const q = url.searchParams.get("q")?.trim() || "";
  const direction = url.searchParams.get("direction") || "";
  const verifyStageFilter = url.searchParams.get("verifyStage") || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "60", 10), 200);

  const session = await auth();
  const userId = session?.user?.id;

  // Skip markets where the price has effectively collapsed to a decided answer.
  // Catches both truly-resolved-but-stale records and effectively-decided open markets.
  const andClauses: Array<Record<string, unknown>> = [
    { OR: [{ yesPrice: null }, { yesPrice: { gt: 0.01, lt: 0.99 } }] },
    { OR: [{ noPrice: null }, { noPrice: { gt: 0.01, lt: 0.99 } }] },
  ];
  if (q) {
    andClauses.push({
      OR: [{ question: { contains: q, mode: "insensitive" } }, { eventTitle: { contains: q, mode: "insensitive" } }],
    });
  }

  const markets = await prisma.market.findMany({
    where: {
      active: true,
      closed: false,
      OR: [{ endDate: null }, { endDate: { gt: new Date() } }],
      AND: andClauses,
      analyses: { some: {} },
    },
    include: {
      // Small history so we can find the latest of each pass for the current rulesHash
      // (used to compute the synthesis / agreement badge).
      analyses: {
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { votes: true },
      },
    },
    orderBy: { liquidity: "desc" },
    take: 5000,
  });

  const enriched = markets
    .map((m) => {
      const findCurrent = (p: string) => m.analyses.find((x) => x.pass === p && x.rulesHash === m.rulesHash);
      const opusA = findCurrent("opus");
      const gptA = findCurrent("gpt_deep");
      const synthA = findCurrent("synthesis");
      const obviousA = findCurrent("obvious");
      // For mispricings we use the CURRENT-RULES obvious analysis as the headline.
      // For opportunities we use the freshest current-rules analysis among synthesis / opus /
      // gpt_deep / haiku (matching the detail page's selection logic).
      let latest;
      if (category === "mispricings") {
        latest = obviousA;
      } else {
        const currentNonObvious = m.analyses.find((x) => x.pass !== "obvious" && x.rulesHash === m.rulesHash);
        latest = currentNonObvious ?? m.analyses[0];
      }
      // Compare implied bet direction, not raw edge_direction. A GPT fact-finder that returns
      // edge_direction=NONE because there's no rules-vs-vibe gap, yet estimates P(YES) far above
      // the market price, is implicitly recommending YES — and "synthesis_disagreed" would be
      // misleading. See impliedBetSide() docs.
      let verifyStage: string;
      if (synthA) {
        const opusSide = opusA ? impliedBetSide(opusA, opusA.yesPriceAtAnalysis ?? m.yesPrice) : "NONE";
        const gptSide = gptA ? impliedBetSide(gptA, gptA.yesPriceAtAnalysis ?? m.yesPrice) : "NONE";
        const bothDirected = opusSide !== "NONE" && gptSide !== "NONE";
        verifyStage = bothDirected && opusSide === gptSide ? "synthesis_agreed" : "synthesis_disagreed";
      }
      else if (opusA && gptA) verifyStage = "opus_and_gpt";
      else if (opusA) verifyStage = "opus_only";
      else if (gptA) verifyStage = "gpt_only";
      else verifyStage = "initial";
      return { market: m, latest, opusA, gptA, synthA, verifyStage };
    })
    .filter(({ latest, verifyStage }) => {
      if (!latest) return false;
      // Mispricings additionally require a directional bet side from the MODEL, not the
      // EV-math-derived betSide. The model's verdict (stored in edgeDirection) authoritatively
      // says whether it found a >=20pp gap with sufficient confidence. The computed betSide
      // can show YES/NO from tiny positive EV math even when the model said NONE — we ignore
      // that for mispricings filtering. The obvious-pass prompt also clamps to NONE when
      // confidence < 5; the minDivergence param below provides a softer floor.
      if (category === "mispricings") {
        if (latest.pass !== "obvious") return false;
        if (latest.edgeDirection === "NONE") return false;
      }
      if (latest.edgeScore < minScore) return false;
      if (latest.divergenceScore < minDivergence) return false;
      if (direction && latest.betSide !== direction) return false;
      // verifyStage filter only applies to opportunities; ignored for mispricings since the
      // synthesis/opus distinction is fineprint-specific.
      if (category !== "mispricings" && verifyStageFilter && VERIFY_STAGE_VALUES.has(verifyStageFilter)) {
        if (verifyStageFilter === "synthesis") {
          if (verifyStage !== "synthesis_agreed" && verifyStage !== "synthesis_disagreed") return false;
        } else if (verifyStage !== verifyStageFilter) return false;
      }
      return true;
    });

  // foundAt = creation time of the EARLIEST non-initial analysis per market for this category.
  // For opportunities, that's the first opus/gpt/synthesis pass. For mispricings, that's the
  // first 'obvious' pass.
  const ids = enriched.map((e) => e.market.id);
  const foundAtMap = new Map<string, Date>();
  if (ids.length > 0) {
    const groups = await prisma.analysis.groupBy({
      by: ["marketId"],
      where: {
        marketId: { in: ids },
        pass: category === "mispricings" ? { in: ["obvious"] } : { in: ["opus", "gpt_deep", "synthesis"] },
      },
      _min: { createdAt: true },
    });
    for (const g of groups) {
      if (g._min.createdAt) foundAtMap.set(g.marketId, g._min.createdAt);
    }
  }

  enriched.sort((a, b) => {
    if (sort === "edge") return (b.latest?.edgeScore ?? 0) - (a.latest?.edgeScore ?? 0);
    if (sort === "divergence") return (b.latest?.divergenceScore ?? 0) - (a.latest?.divergenceScore ?? 0);
    if (sort === "liquidity") return b.market.liquidity - a.market.liquidity;
    if (sort === "votes") {
      const av = (a.latest?.votes ?? []).reduce((s, v) => s + v.direction, 0);
      const bv = (b.latest?.votes ?? []).reduce((s, v) => s + v.direction, 0);
      return bv - av;
    }
    if (sort === "endDate") {
      return (a.market.endDate?.getTime() ?? Infinity) - (b.market.endDate?.getTime() ?? Infinity);
    }
    if (sort === "recent") {
      // Most recently FOUND on top. Markets without a non-initial pass sort to the bottom.
      const at = foundAtMap.get(a.market.id)?.getTime() ?? 0;
      const bt = foundAtMap.get(b.market.id)?.getTime() ?? 0;
      return bt - at;
    }
    return 0;
  });

  return NextResponse.json({
    category,
    markets: enriched.slice(0, limit).map(({ market, latest, verifyStage }) => {
      const votes = latest?.votes ?? [];
      const upvotes = votes.filter((v) => v.direction > 0).length;
      const downvotes = votes.filter((v) => v.direction < 0).length;
      const myVote = userId ? votes.find((v) => v.userId === userId)?.direction ?? 0 : 0;
      const foundAt = foundAtMap.get(market.id) ?? null;
      return {
        id: market.id,
        slug: market.slug,
        question: market.question,
        eventTitle: market.eventTitle,
        groupItemTitle: market.groupItemTitle,
        yesPrice: market.yesPrice,
        noPrice: market.noPrice,
        liquidity: market.liquidity,
        volume: market.volume,
        endDate: market.endDate,
        imageUrl: market.imageUrl,
        verifyStage,
        foundAt,
        analysis: latest && {
          id: latest.id,
          pass: latest.pass,
          model: latest.model,
          divergenceScore: latest.divergenceScore,
          divergenceType: latest.divergenceType,
          edgeDirection: latest.edgeDirection,
          betSide: latest.betSide,
          priceGap: latest.priceGap,
          directionAgreement: latest.directionAgreement,
          edgeScore: latest.edgeScore,
          ruleImpliedProbability: latest.ruleImpliedProbability,
          expectedYesPayoutCents: latest.expectedYesPayoutCents,
          expectedNoPayoutCents: latest.expectedNoPayoutCents,
          vibeInterpretation: latest.vibeInterpretation,
          literalInterpretation: latest.literalInterpretation,
          createdAt: latest.createdAt,
        },
        votes: { up: upvotes, down: downvotes, mine: myVote },
      };
    }),
    total: enriched.length,
  });
}
