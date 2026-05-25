import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { submitDeepResearch } from "@/lib/deep-research";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "auth required" }, { status: 401 });
  if (!session.user.isAdmin) return NextResponse.json({ error: "Deep research is admin-only." }, { status: 403 });
  const { id } = await params;
  const market = await prisma.market.findUnique({ where: { id } });
  if (!market) return NextResponse.json({ error: "Market not found." }, { status: 404 });
  try {
    const job = await submitDeepResearch(market);
    return NextResponse.json({
      ok: true,
      job: {
        id: job.id,
        openaiResponseId: job.openaiResponseId,
        model: job.model,
        status: job.status,
        submittedAt: job.submittedAt,
      },
    });
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    const status = msg.includes("budget") ? 402 : msg.includes("already") ? 409 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.isAdmin) return NextResponse.json({ error: "admin only" }, { status: 403 });
  const { id } = await params;
  const market = await prisma.market.findUnique({ where: { id } });
  if (!market) return NextResponse.json({ error: "Market not found." }, { status: 404 });
  const latestJob = await prisma.deepResearchJob.findFirst({
    where: { marketId: id },
    orderBy: { submittedAt: "desc" },
  });
  const existingAnalysis = await prisma.analysis.findFirst({
    where: { marketId: id, pass: "gpt_deep", rulesHash: market.rulesHash },
    select: { id: true, createdAt: true },
  });
  return NextResponse.json({
    market: { id: market.id, rulesHash: market.rulesHash },
    latestJob,
    hasCompletedForCurrentRules: !!existingAnalysis,
    existingAnalysis,
  });
}
