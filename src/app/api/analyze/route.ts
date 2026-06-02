import { NextRequest, NextResponse } from "next/server";
import { ensureSettings } from "@/lib/bootstrap";
import { submitDailyOpusPasses } from "@/lib/batch";
import { requireAdmin } from "@/lib/admin";
import { LLMDisabledError, llmCallsEnabled } from "@/lib/llm-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

// Admin "Analyze" action: submit the two daily Opus passes (verifier + obvious) on their cooldown-
// picked candidate sets, identical to the 05:00 scheduler run. (Previously this ran a legacy Haiku
// first-pass; that path was retired when the opus-first pipeline took over.)
export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: gate.status });
  if (!llmCallsEnabled()) {
    return NextResponse.json({ ok: false, error: new LLMDisabledError().message }, { status: 503 });
  }
  await ensureSettings();
  const body = await req.json().catch(() => ({}));
  const limit = typeof body.max === "number" ? body.max : undefined;
  try {
    const res = await submitDailyOpusPasses({ limit });
    const submitted = res.verifierCount + res.obviousCount;
    const ok = res.errors.length === 0;
    const status = ok ? 200 : res.errors.some((e) => e.includes("budget")) ? 402 : 500;
    return NextResponse.json(
      {
        ok,
        mode: "batch",
        submitted,
        verifierBatchId: res.verifierBatchId,
        obviousBatchId: res.obviousBatchId,
        errors: res.errors,
        ...(res.errors.length ? { error: res.errors.join("; ") } : {}),
      },
      { status },
    );
  } catch (err) {
    if (err instanceof LLMDisabledError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
