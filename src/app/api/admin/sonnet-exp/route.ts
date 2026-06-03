import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { submitVerifierBatch, VERIFIER_EXP_PURPOSE } from "@/lib/batch";
import { SONNET_MODEL } from "@/lib/anthropic";
import { ensureSettings } from "@/lib/bootstrap";
import { requireAdmin } from "@/lib/admin";
import { LLMDisabledError, llmCallsEnabled } from "@/lib/llm-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Sibling-context build for hundreds of markets needs the prod-internal DB, so allow the couple of
// minutes it takes (same reason as run-verifier-pool).
export const maxDuration = 800;

/**
 * Model A/B experiment: re-run an EXISTING verifier batch's exact market set through the same verifier
 * pipe (SYSTEM_PROMPT + web_search + pgvector siblings) but on Sonnet 4.6 instead of Opus 4.8.
 *
 * Pass {"fromBatchId":"msgbatch_..."} to clone that batch's market set. The Sonnet results ingest
 * (via the normal poller) under pass='sonnet_exp', which NO production query surfaces, so the live
 * feed and the daily cooldown pickers are untouched. Compare against pass='opus' afterwards.
 *
 * Auth: admin session OR x-cron-secret. Budget gate inside submitVerifierBatch still applies.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const secretOk = !!secret && req.headers.get("x-cron-secret") === secret;
  if (!secretOk) {
    const gate = await requireAdmin();
    if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: gate.status });
  }
  if (!llmCallsEnabled()) {
    return NextResponse.json({ ok: false, error: new LLMDisabledError().message }, { status: 503 });
  }
  await ensureSettings();
  const body = await req.json().catch(() => ({}));
  const fromBatchId = typeof body.fromBatchId === "string" ? body.fromBatchId : null;
  if (!fromBatchId) {
    return NextResponse.json({ error: "fromBatchId required (the Anthropic batch id whose market set to clone)" }, { status: 400 });
  }
  const src = await prisma.batchJob.findUnique({ where: { anthropicBatchId: fromBatchId } });
  if (!src) {
    return NextResponse.json({ error: `source batch ${fromBatchId} not found` }, { status: 404 });
  }
  let ids: string[];
  try {
    ids = JSON.parse(src.marketIds);
  } catch {
    return NextResponse.json({ error: "source batch marketIds unparseable" }, { status: 500 });
  }
  const markets = await prisma.market.findMany({ where: { id: { in: ids } } });
  try {
    const batchId = await submitVerifierBatch(markets, { model: SONNET_MODEL, purpose: VERIFIER_EXP_PURPOSE });
    return NextResponse.json({
      ok: true,
      model: SONNET_MODEL,
      sourceBatch: fromBatchId,
      sourcePurpose: src.purpose,
      sourceMarkets: ids.length,
      submitted: markets.length,
      batchId,
      pass: "sonnet_exp",
    });
  } catch (err) {
    if (err instanceof LLMDisabledError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 503 });
    }
    const msg = String(err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("budget") ? 402 : 500 });
  }
}
