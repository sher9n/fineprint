import { NextRequest, NextResponse } from "next/server";
import { runAnalysisPass } from "@/lib/analyzer";
import { ensureSettings } from "@/lib/bootstrap";
import { prisma } from "@/lib/prisma";
import { spentTodayUsd } from "@/lib/budget";
import { pickMarketsForBatch, submitHaikuBatch } from "@/lib/batch";
import { requireAdmin } from "@/lib/admin";
import { LLMDisabledError, llmCallsEnabled } from "@/lib/llm-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: gate.status });
  if (!llmCallsEnabled()) {
    return NextResponse.json({ ok: false, error: new LLMDisabledError().message }, { status: 503 });
  }
  await ensureSettings();
  const body = await req.json().catch(() => ({}));
  const max = typeof body.max === "number" ? body.max : 2000;
  const maxVerify = typeof body.maxVerify === "number" ? body.maxVerify : undefined;
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const useBatch = settings?.batchModeEnabled === true && body.forceSync !== true;

  if (useBatch) {
    try {
      const markets = await pickMarketsForBatch(max);
      if (markets.length === 0) {
        return NextResponse.json({ ok: true, mode: "batch", submitted: 0, message: "nothing to analyze" });
      }
      const batchId = await submitHaikuBatch(markets);
      return NextResponse.json({ ok: true, mode: "batch", batchId, submitted: markets.length });
    } catch (err) {
      if (err instanceof LLMDisabledError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: 503 });
      }
      return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
    }
  }

  const spentBefore = await spentTodayUsd();
  const run = await prisma.ingestRun.create({ data: { kind: "analyze", status: "running" } });
  try {
    const result = await runAnalysisPass({ maxMarkets: max, maxVerify });
    const spentAfter = await spentTodayUsd();
    await prisma.ingestRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status: "success",
        marketsAnalyzed: result.haikuRun,
        haikuCalls: result.haikuRun,
        opusCalls: result.verifierSubmitted,
        totalCostUsd: spentAfter - spentBefore,
      },
    });
    return NextResponse.json({ ok: true, mode: "sync", runId: run.id, ...result });
  } catch (err) {
    await prisma.ingestRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), status: "error", errors: String(err) },
    });
    if (err instanceof LLMDisabledError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
