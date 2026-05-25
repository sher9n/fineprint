import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "auth required" }, { status: 401 });
  const userId = session.user.id;
  const { id: marketId } = await params;
  const body = await req.json().catch(() => ({}));
  const direction = body.direction === 1 ? 1 : body.direction === -1 ? -1 : 0;

  const market = await prisma.market.findUnique({
    where: { id: marketId },
    include: { analyses: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!market || !market.analyses[0]) return NextResponse.json({ error: "market or analysis not found" }, { status: 404 });
  const analysisId = market.analyses[0].id;

  if (direction === 0) {
    await prisma.vote.deleteMany({ where: { userId, marketId } });
  } else {
    await prisma.vote.upsert({
      where: { userId_marketId: { userId, marketId } },
      update: { direction, analysisId },
      create: { userId, marketId, analysisId, direction },
    });
  }

  const votes = await prisma.vote.findMany({ where: { analysisId } });
  return NextResponse.json({
    up: votes.filter((v) => v.direction > 0).length,
    down: votes.filter((v) => v.direction < 0).length,
    mine: direction,
  });
}
