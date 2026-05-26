import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { submitDeepResearch } from "@/lib/deep-research";
import { LLMDisabledError } from "@/lib/llm-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "auth required" }, { status: 401 });
  if (!session.user.isAdmin) return NextResponse.json({ error: "Deep research is admin-only." }, { status: 403 });
  const { id } = await params;
  const market = await prisma.market.findUnique({ where: { id } });
  if (!market) return NextResponse.json({ error: "Market not found." }, { status: 404 });
  // ?force=1 lets admins re-run on a market that already has a gpt_deep row for the current
  // rulesHash. Used after a prompt change to compare old vs new output on the same rules. Still
  // blocked by the inflight guard inside submitDeepResearch (never double-submit).
  const force = new URL(req.url).searchParams.get("force") === "1";
  try {
    const job = await submitDeepResearch(market, { force });
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
    if (err instanceof LLMDisabledError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 503 });
    }
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
