import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set(["open", "won", "lost", "void"]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "auth required" }, { status: 401 });
  const { id } = await params;
  const existing = await prisma.bet.findUnique({ where: { id } });
  if (!existing || existing.userId !== session.user.id) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  const data: { status?: string; pnlUsd?: number; resolvedAt?: Date } = {};
  if (body.status != null) {
    if (typeof body.status !== "string" || !VALID_STATUSES.has(body.status)) {
      return NextResponse.json({ error: "status must be one of: open, won, lost, void" }, { status: 400 });
    }
    data.status = body.status;
    if (body.status !== "open") data.resolvedAt = new Date();
  }
  if (body.pnlUsd != null) {
    const n = Number(body.pnlUsd);
    if (!Number.isFinite(n)) return NextResponse.json({ error: "pnlUsd must be a finite number" }, { status: 400 });
    data.pnlUsd = n;
  }
  const bet = await prisma.bet.update({ where: { id }, data });
  return NextResponse.json({ bet });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "auth required" }, { status: 401 });
  const { id } = await params;
  const existing = await prisma.bet.findUnique({ where: { id } });
  if (!existing || existing.userId !== session.user.id) return NextResponse.json({ error: "not found" }, { status: 404 });
  await prisma.bet.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
