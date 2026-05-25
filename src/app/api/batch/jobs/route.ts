import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: gate.status });
  const jobs = await prisma.batchJob.findMany({ orderBy: { submittedAt: "desc" }, take: 50 });
  return NextResponse.json({ jobs });
}
