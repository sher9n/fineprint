import { NextRequest, NextResponse } from "next/server";
import { pickMarketsForPass, submitVerifierBatch, submitObviousBatch } from "@/lib/batch";
import { ensureSettings } from "@/lib/bootstrap";
import { requireAdmin } from "@/lib/admin";
import { LLMDisabledError, llmCallsEnabled } from "@/lib/llm-gate";
import { prisma } from "@/lib/prisma";

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
 * Runs BOTH passes by default (verifier/opus + obvious/world-state), mirroring fireDailyRun: each
 * pass picks its OWN candidate set via pickMarketsForPass on its own cooldown (verifier long, obvious
 * short), selecting markets that lack a current analysis for that pass (the errored tail of a
 * credit-interrupted run is exactly that). Pass {"passes":["verifier"]} to scope to a single pass, or
 * {"marketIds":[...]} to run the requested passes on an exact set (bypasses the cooldown picker).
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
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const body = await req.json().catch(() => ({}));
  const cap = settings?.dailyMarketCap ?? 3200;
  const limit = typeof body.limit === "number" ? Math.max(1, Math.min(5000, body.limit)) : cap;
  // Optional explicit target set. Passing {"marketIds":[...]} runs the requested passes on exactly
  // those markets (bypassing the cooldown picker) -- e.g. to fill a known per-pass gap.
  const marketIds: string[] | null =
    Array.isArray(body.marketIds) && body.marketIds.length
      ? body.marketIds.filter((x: unknown): x is string => typeof x === "string").slice(0, 5000)
      : null;
  const passes: ("verifier" | "obvious")[] =
    Array.isArray(body.passes) && body.passes.length
      ? body.passes.filter((p: unknown): p is "verifier" | "obvious" => p === "verifier" || p === "obvious")
      : ["verifier", "obvious"];
  try {
    const explicit = marketIds ? await prisma.market.findMany({ where: { id: { in: marketIds } } }) : null;
    if (explicit && explicit.length === 0) {
      return NextResponse.json({ ok: true, verifierCount: 0, obviousCount: 0, message: "none of the given marketIds matched a market" });
    }
    // Each requested pass picks its own set (or uses the explicit set) and submits independently so
    // one failure (e.g. a budget gate) doesn't abort the other, mirroring fireDailyRun.
    const errors: string[] = [];
    let verifierBatchId: string | undefined;
    let obviousBatchId: string | undefined;
    let verifierCount = 0;
    let obviousCount = 0;
    if (passes.includes("verifier")) {
      const set = explicit ?? await pickMarketsForPass({ pass: "opus", maxAgeHours: settings?.verifierCooldownHours ?? 144, limit });
      verifierCount = set.length;
      if (set.length > 0) {
        try { verifierBatchId = await submitVerifierBatch(set); }
        catch (e) { errors.push(`verifier: ${String(e instanceof Error ? e.message : e)}`); }
      }
    }
    if (passes.includes("obvious")) {
      const set = explicit ?? await pickMarketsForPass({ pass: "obvious", maxAgeHours: settings?.obviousCooldownHours ?? 48, limit });
      obviousCount = set.length;
      if (set.length > 0) {
        try { obviousBatchId = await submitObviousBatch(set); }
        catch (e) { errors.push(`obvious: ${String(e instanceof Error ? e.message : e)}`); }
      }
    }
    const ok = errors.length === 0;
    const status = ok ? 200 : errors.some((e) => e.includes("budget")) ? 402 : 500;
    return NextResponse.json({ ok, verifierCount, obviousCount, passes, verifierBatchId, obviousBatchId, errors }, { status });
  } catch (err) {
    if (err instanceof LLMDisabledError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 503 });
    }
    const msg = String(err instanceof Error ? err.message : err);
    const status = msg.includes("budget") ? 402 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
