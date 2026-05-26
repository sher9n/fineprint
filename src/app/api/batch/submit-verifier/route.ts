import { NextRequest, NextResponse } from "next/server";
import { submitVerifierBatch, pickMarketsForVerifierBatch } from "@/lib/batch";
import { ensureSettings } from "@/lib/bootstrap";
import { requireAdmin } from "@/lib/admin";
import { LLMDisabledError, llmCallsEnabled } from "@/lib/llm-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: gate.status });
  // Surface the LLM kill-switch up front so the user sees a clear 503 instead of a misleading
  // "no markets eligible" success when candidates exist but we just can't submit them.
  if (!llmCallsEnabled()) {
    return NextResponse.json({ ok: false, error: new LLMDisabledError().message }, { status: 503 });
  }
  await ensureSettings();
  const body = await req.json().catch(() => ({}));
  const limit = typeof body.limit === "number" ? Math.max(1, Math.min(200, body.limit)) : 50;

  try {
    const markets = await pickMarketsForVerifierBatch(limit);
    if (markets.length === 0) {
      return NextResponse.json({ ok: true, submitted: 0, message: "no markets eligible for verification" });
    }
    const batchId = await submitVerifierBatch(markets);
    return NextResponse.json({ ok: true, batchId, submitted: markets.length, marketIds: markets.map((m) => m.id) });
  } catch (err) {
    if (err instanceof LLMDisabledError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
