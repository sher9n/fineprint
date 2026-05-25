import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";
import { confidenceLabel, divergenceTypeLabel } from "@/lib/explain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BetWithAnalysis {
  status: string;
  side: string;
  sizeUsd: number;
  priceAtBet: number;
  pnlUsd: number | null;
  analysisId: string | null;
}

interface AnalysisRow {
  id: string;
  divergenceScore: number;
  divergenceType: string;
}

export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: gate.status });

  const bets = await prisma.bet.findMany({ orderBy: { placedAt: "desc" } });
  const analysisIds = Array.from(new Set(bets.map((b) => b.analysisId).filter(Boolean) as string[]));
  const analyses = analysisIds.length
    ? await prisma.analysis.findMany({ where: { id: { in: analysisIds } }, select: { id: true, divergenceScore: true, divergenceType: true } })
    : [];
  const aById = Object.fromEntries(analyses.map((a) => [a.id, a])) as Record<string, AnalysisRow>;

  const resolved = bets.filter((b) => b.status === "won" || b.status === "lost") as unknown as BetWithAnalysis[];
  const won = resolved.filter((b) => b.status === "won");
  const lost = resolved.filter((b) => b.status === "lost");

  const pnlUsd = resolved.reduce((s, b) => {
    if (b.status === "won") return s + (b.pnlUsd ?? b.sizeUsd / b.priceAtBet - b.sizeUsd);
    if (b.status === "lost") return s - (b.pnlUsd != null ? -b.pnlUsd : b.sizeUsd);
    return s;
  }, 0);

  const bySideMap: Record<string, { won: number; lost: number }> = {};
  for (const b of resolved) {
    const key = b.side;
    if (!bySideMap[key]) bySideMap[key] = { won: 0, lost: 0 };
    if (b.status === "won") bySideMap[key].won++;
    else bySideMap[key].lost++;
  }
  const bySide = Object.entries(bySideMap).map(([side, { won, lost }]) => ({
    side,
    won,
    lost,
    winRate: won + lost > 0 ? won / (won + lost) : 0,
  }));

  const byMismatchMap: Record<string, { won: number; lost: number }> = {};
  for (const b of resolved) {
    const a = b.analysisId ? aById[b.analysisId] : null;
    const label = a ? confidenceLabel(a.divergenceScore).label : "Unknown";
    if (!byMismatchMap[label]) byMismatchMap[label] = { won: 0, lost: 0 };
    if (b.status === "won") byMismatchMap[label].won++;
    else byMismatchMap[label].lost++;
  }
  const byMismatchLevel = Object.entries(byMismatchMap).map(([level, { won, lost }]) => ({
    level,
    won,
    lost,
    winRate: won + lost > 0 ? won / (won + lost) : 0,
  }));

  const byTypeMap: Record<string, { won: number; lost: number }> = {};
  for (const b of resolved) {
    const a = b.analysisId ? aById[b.analysisId] : null;
    const label = a ? divergenceTypeLabel(a.divergenceType).short : "Unknown";
    if (!byTypeMap[label]) byTypeMap[label] = { won: 0, lost: 0 };
    if (b.status === "won") byTypeMap[label].won++;
    else byTypeMap[label].lost++;
  }
  const byDivergenceType = Object.entries(byTypeMap).map(([type, { won, lost }]) => ({
    type,
    won,
    lost,
    winRate: won + lost > 0 ? won / (won + lost) : 0,
  }));

  const allVotes = await prisma.vote.findMany();
  const upTotal = allVotes.filter((v) => v.direction > 0).length;
  const downTotal = allVotes.filter((v) => v.direction < 0).length;

  // Net votes by edge score band
  const analysesForVotes = await prisma.analysis.findMany({
    where: { id: { in: Array.from(new Set(allVotes.map((v) => v.analysisId))) } },
    select: { id: true, edgeScore: true },
  });
  const edgeById = Object.fromEntries(analysesForVotes.map((a) => [a.id, a.edgeScore]));
  const bandMap: Record<string, { net: number; count: number }> = {
    "Strong (70+)": { net: 0, count: 0 },
    "Solid (50-70)": { net: 0, count: 0 },
    "Worth a look (30-50)": { net: 0, count: 0 },
    "Marginal (<30)": { net: 0, count: 0 },
  };
  for (const v of allVotes) {
    const score = edgeById[v.analysisId] ?? 0;
    const band = score >= 70 ? "Strong (70+)" : score >= 50 ? "Solid (50-70)" : score >= 30 ? "Worth a look (30-50)" : "Marginal (<30)";
    bandMap[band].net += v.direction;
    bandMap[band].count++;
  }
  const netByEdge = Object.entries(bandMap)
    .map(([band, { net, count }]) => ({ band, net, count }))
    .filter((b) => b.count > 0);

  return NextResponse.json({
    totalBets: bets.length,
    resolved: resolved.length,
    open: bets.filter((b) => b.status === "open").length,
    won: won.length,
    lost: lost.length,
    winRate: resolved.length > 0 ? won.length / resolved.length : 0,
    pnlUsd,
    bySide,
    byMismatchLevel,
    byDivergenceType,
    votes: { up: upTotal, down: downTotal, netByEdge },
  });
}
