import { NextRequest, NextResponse } from "next/server";
import { pickMarketsForOpusFirstPass, submitVerifierBatch, submitObviousBatch } from "@/lib/batch";
import { ensureSettings } from "@/lib/bootstrap";
import { requireAdmin } from "@/lib/admin";
import { LLMDisabledError, llmCallsEnabled } from "@/lib/llm-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Railway runs a persistent Node server (not serverless), so this can run for the couple of
// minutes the context-build + submit needs.
export const maxDuration = 800;

/**
 * Manual / recovery trigger for the daily passes, RUN ON PROD so it uses the internal Postgres
 * instead of the flaky public proxy. The proxy can't sustain the per-market pgvector context-build
 * at volume, which is why local recovery kept dropping its connection; this endpoint does the same
 * work inside the prod container where the DB is local and fast.
 *
 * Runs BOTH passes by default (verifier/opus + obvious/world-state) on the same picked set, mirroring
 * fireDailyRun, so a credit-interrupted daily run can be fully recovered: pickMarketsForOpusFirstPass
 * selects the markets still lacking a current opus analysis (the errored tail), and both passes re-run
 * on them in one shot. Pass {"passes":["verifier"]} to scope to a single pass.
 *
 * Auth: either an admin session (UI), OR a CRON_SECRET header (so it can be curl'd / scheduled
 * without a browser session). The budget gate inside each submitter still caps spend.
 *
 *   curl -X POST -H "x-cron-secret: $CRON_SECRET" -H 'content-type: application/json' \
 *     -d '{"limit":2000}' https://<host>/api/admin/run-verifier-pool
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
  const limit = typeof body.limit === "number" ? Math.max(1, Math.min(2000, body.limit)) : 2000;
  const passes: ("verifier" | "obvious")[] =
    Array.isArray(body.passes) && body.passes.length
      ? body.passes.filter((p: unknown): p is "verifier" | "obvious" => p === "verifier" || p === "obvious")
      : ["verifier", "obvious"];
  try {
    const markets = await pickMarketsForOpusFirstPass(limit);
    if (markets.length === 0) {
      return NextResponse.json({ ok: true, submitted: 0, message: "no markets eligible (none lack a current opus analysis)" });
    }
    // Submit each requested pass independently so one failure (e.g. a budget gate) doesn't abort the
    // other, mirroring fireDailyRun's per-batch error handling.
    const errors: string[] = [];
    let verifierBatchId: string | undefined;
    let obviousBatchId: string | undefined;
    if (passes.includes("verifier")) {
      try { verifierBatchId = await submitVerifierBatch(markets); }
      catch (e) { errors.push(`verifier: ${String(e instanceof Error ? e.message : e)}`); }
    }
    if (passes.includes("obvious")) {
      try { obviousBatchId = await submitObviousBatch(markets); }
      catch (e) { errors.push(`obvious: ${String(e instanceof Error ? e.message : e)}`); }
    }
    const ok = errors.length === 0;
    const status = ok ? 200 : errors.some((e) => e.includes("budget")) ? 402 : 500;
    return NextResponse.json({ ok, submitted: markets.length, passes, verifierBatchId, obviousBatchId, errors }, { status });
  } catch (err) {
    if (err instanceof LLMDisabledError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 503 });
    }
    const msg = String(err instanceof Error ? err.message : err);
    const status = msg.includes("budget") ? 402 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
