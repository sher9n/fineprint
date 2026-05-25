import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { pollDeepResearchJobs } from "@/lib/deep-research";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: gate.status });
  try {
    const r = await pollDeepResearchJobs({ limit: 20 });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err).slice(0, 300) }, { status: 500 });
  }
}
