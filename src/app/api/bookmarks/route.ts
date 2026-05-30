import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { impliedBetSide } from "@/lib/explain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * List of markets bookmarked by the signed-in user. Returns the same shape as
 * /api/markets so the existing OpportunityCard can render the rows
 * directly. Includes BOTH the freshest fineprint analysis AND the obvious analysis
 * when available so the user can see whichever signal exists. Headline analysis
 * (the `analysis` field) is whichever was created most recently.
 */
export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "auth required" }, { status: 401 });
  const userId = session.user.id;

  const bookmarks = await prisma.bookmark.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      market: {
        include: {
          // No eager vote include — we fetch votes once per page slice (latest analyses only)
          // after we've decided which markets to render. Heavy TEXT fields (reasoning,
          // sourceFindings, verificationSteps) excluded — cards don't render them.
          analyses: {
            orderBy: { createdAt: "desc" },
            take: 8,
            select: {
              id: true,
              pass: true,
              model: true,
              rulesHash: true,
              divergenceScore: true,
              divergenceType: true,
              edgeDirection: true,
              betSide: true,
              priceGap: true,
              directionAgreement: true,
              edgeScore: true,
              ruleImpliedProbability: true,
              expectedYesPayoutCents: true,
              expectedNoPayoutCents: true,
              vibeInterpretation: true,
              literalInterpretation: true,
              yesPriceAtAnalysis: true,
              createdAt: true,
            },
          },
        },
      },
    },
  });

  // foundAt = creation time of the EARLIEST escalated/verified pass per market (opus/gpt/
  // synthesis, or obvious for mispricings). Mirrors /api/markets so saved cards show the same
  // "Found ... IST" discovery stamp. groupBy over all analyses, not just the latest slice.
  const foundAtMap = new Map<string, Date>();
  const bookmarkedMarketIds = bookmarks.map((b) => b.market.id);
  if (bookmarkedMarketIds.length > 0) {
    const groups = await prisma.analysis.groupBy({
      by: ["marketId"],
      where: { marketId: { in: bookmarkedMarketIds }, pass: { in: ["opus", "gpt_deep", "synthesis", "obvious"] } },
      _min: { createdAt: true },
    });
    for (const g of groups) if (g._min.createdAt) foundAtMap.set(g.marketId, g._min.createdAt);
  }

  // Pull votes for the headline (latest current-rules) analysis of each bookmarked market in
  // one round-trip rather than includeing them on every analysis row.
  type VoteRow = { userId: string; direction: number; analysisId: string };
  const latestAnalysisIds: string[] = [];
  for (const { market: m } of bookmarks) {
    const current = m.analyses.filter((x) => x.rulesHash === m.rulesHash);
    const a = current[0] ?? m.analyses[0];
    if (a) latestAnalysisIds.push(a.id);
  }
  const voteRows: VoteRow[] = latestAnalysisIds.length
    ? await prisma.vote.findMany({ where: { analysisId: { in: latestAnalysisIds } }, select: { userId: true, direction: true, analysisId: true } })
    : [];
  const votesByAnalysisId = new Map<string, VoteRow[]>();
  for (const v of voteRows) {
    const arr = votesByAnalysisId.get(v.analysisId) ?? [];
    arr.push(v);
    votesByAnalysisId.set(v.analysisId, arr);
  }

  const markets = bookmarks.map(({ market: m, createdAt: bookmarkedAt }) => {
    const findCurrent = (p: string) => m.analyses.find((x) => x.pass === p && x.rulesHash === m.rulesHash);
    const opusA = findCurrent("opus");
    const gptA = findCurrent("gpt_deep");
    const synthA = findCurrent("synthesis");
    const obviousA = findCurrent("obvious");
    // Use the freshest current-rules analysis as the headline. Matches the detail-page logic.
    const currentAnalyses = m.analyses.filter((x) => x.rulesHash === m.rulesHash);
    const latest = currentAnalyses[0] ?? m.analyses[0];

    let verifyStage = "initial";
    if (synthA) {
      const opusSide = opusA ? impliedBetSide(opusA, opusA.yesPriceAtAnalysis ?? m.yesPrice) : "NONE";
      const gptSide = gptA ? impliedBetSide(gptA, gptA.yesPriceAtAnalysis ?? m.yesPrice) : "NONE";
      const bothDirected = opusSide !== "NONE" && gptSide !== "NONE";
      verifyStage = bothDirected && opusSide === gptSide ? "synthesis_agreed" : "synthesis_disagreed";
    } else if (opusA && gptA) verifyStage = "opus_and_gpt";
    else if (opusA) verifyStage = "opus_only";
    else if (gptA) verifyStage = "gpt_only";

    const votes = latest ? votesByAnalysisId.get(latest.id) ?? [] : [];
    const upvotes = votes.filter((v) => v.direction > 0).length;
    const downvotes = votes.filter((v) => v.direction < 0).length;
    const myVote = votes.find((v) => v.userId === userId)?.direction ?? 0;

    return {
      id: m.id,
      slug: m.slug,
      question: m.question,
      eventTitle: m.eventTitle,
      groupItemTitle: m.groupItemTitle,
      yesPrice: m.yesPrice,
      noPrice: m.noPrice,
      liquidity: m.liquidity,
      volume: m.volume,
      endDate: m.endDate,
      imageUrl: m.imageUrl,
      verifyStage,
      foundAt: foundAtMap.get(m.id) ?? null,
      bookmarkedAt,
      hasObvious: !!obviousA,
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
  });

  return NextResponse.json({ markets, total: markets.length });
}
