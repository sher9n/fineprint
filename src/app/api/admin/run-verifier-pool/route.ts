import { NextRequest, NextResponse } from "next/server";
import { pickMarketsForOpusFirstPass, submitVerifierBatch } from "@/lib/batch";
import { ensureSettings } from "@/lib/bootstrap";
import { requireAdmin } from "@/lib/admin";
import { LLMDisabledError, llmCallsEnabled } from "@/lib/llm-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Railway runs a persistent Node server (not serverless), so this can run for the couple of
// minutes the context-build + submit needs.
export const maxDuration = 800;

/**
 * Manual / recovery trigger for the daily verifier (opus / fineprint) batch, RUN ON PROD so it uses
 * the internal Postgres instead of the flaky public proxy. The proxy can't sustain the per-market
 * pgvector context-build at volume, which is why local recovery kept dropping its connection; this
 * endpoint does the same work inside the prod container where the DB is local and fast.
 *
 * Auth: either an admin session (UI), OR a CRON_SECRET header (so it can be curl'd / scheduled
 * without a browser session). The budget gate inside submitVerifierBatch still caps spend.
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
  try {
    const markets = await pickMarketsForOpusFirstPass(limit);
    if (markets.length === 0) {
      return NextResponse.json({ ok: true, submitted: 0, message: "no markets eligible for the verifier pass" });
    }
    const batchId = await submitVerifierBatch(markets);
    return NextResponse.json({ ok: true, batchId, submitted: markets.length });
  } catch (err) {
    if (err instanceof LLMDisabledError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 503 });
    }
    const msg = String(err instanceof Error ? err.message : err);
    const status = msg.includes("budget") ? 402 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
