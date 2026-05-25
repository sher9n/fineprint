import { NextResponse } from "next/server";
import { pollAndIngestBatches } from "@/lib/batch";
import { ensureSettings } from "@/lib/bootstrap";
import { requireAdmin } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: gate.status });
  await ensureSettings();
  try {
    const result = await pollAndIngestBatches();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
