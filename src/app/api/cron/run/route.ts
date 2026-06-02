import { NextResponse } from "next/server";
import { runIngest } from "@/lib/ingest";
import { ensureSettings } from "@/lib/bootstrap";
import { prisma } from "@/lib/prisma";
import { submitDailyOpusPasses } from "@/lib/batch";
import { requireAdmin } from "@/lib/admin";
import { LLMDisabledError, llmCallsEnabled } from "@/lib/llm-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

// Admin "Run daily" action: the full 05:00 cycle on demand = ingest + the two daily Opus passes
// (verifier + obvious) on their cooldown-picked sets. Mirrors fireDailyRun in the scheduler.
export async function POST() {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: gate.status });
  // Fail fast: this endpoint runs a 5+ minute ingest before reaching any LLM call. Without this
  // upfront check, curl would time out before getting the LLM-disabled error.
  if (!llmCallsEnabled()) {
    return NextResponse.json({ ok: false, error: new LLMDisabledError().message }, { status: 503 });
  }
  await ensureSettings();
  const run = await prisma.ingestRun.create({ data: { kind: "daily", status: "running" } });
  try {
    const ingestRes = await runIngest();
    const res = await submitDailyOpusPasses();
    await prisma.ingestRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status: res.errors.length > 0 ? "partial" : "success",
        errors: res.errors.length > 0 ? res.errors.join(" | ") : null,
        marketsAdded: ingestRes.added,
        marketsUpdated: ingestRes.updated,
        marketsAnalyzed: res.verifierCount + res.obviousCount,
        opusCalls: res.verifierCount + res.obviousCount,
      },
    });
    return NextResponse.json({
      ok: res.errors.length === 0,
      mode: "batch",
      ingest: ingestRes,
      submitted: res.verifierCount + res.obviousCount,
      verifierBatchId: res.verifierBatchId,
      obviousBatchId: res.obviousBatchId,
      errors: res.errors,
    });
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
