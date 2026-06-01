import { NextRequest, NextResponse } from "next/server";
import { refreshSurfacedMarketPrices } from "@/lib/refresh";
import { requireAdmin } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

/**
 * Manual / on-demand trigger for the hourly market price+status refresh, run on prod (internal DB).
 * Does the same targeted Gamma fetches the scheduler runs hourly, so freshly-resolved markets fall
 * out of the feed immediately instead of waiting for the next ingest. Auth: an admin session OR a
 * CRON_SECRET header. No LLM involved, so no kill-switch gate.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const secretOk = !!secret && req.headers.get("x-cron-secret") === secret;
  if (!secretOk) {
    const gate = await requireAdmin();
    if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: gate.status });
  }
  const body = await req.json().catch(() => ({}));
  const limit = typeof body.limit === "number" ? Math.max(1, Math.min(3000, body.limit)) : undefined;
  try {
    const r = await refreshSurfacedMarketPrices({ limit });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
