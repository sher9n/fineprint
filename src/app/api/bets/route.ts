import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ bets: [] });
  const bets = await prisma.bet.findMany({
    where: { userId: session.user.id },
    orderBy: { placedAt: "desc" },
    include: { market: true },
  });
  return NextResponse.json({ bets });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "auth required" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  const { marketId, analysisId, side, priceAtBet, sizeUsd, rationale } = body as Record<string, unknown>;
  if (!marketId || !side || priceAtBet == null || sizeUsd == null) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  const sideUpper = String(side).toUpperCase();
  if (sideUpper !== "YES" && sideUpper !== "NO") {
    return NextResponse.json({ error: "side must be YES or NO" }, { status: 400 });
  }
  const price = Number(priceAtBet);
  const size = Number(sizeUsd);
  if (!Number.isFinite(price) || price < 0 || price > 1) {
    return NextResponse.json({ error: "priceAtBet must be a number between 0 and 1" }, { status: 400 });
  }
  if (!Number.isFinite(size) || size <= 0) {
    return NextResponse.json({ error: "sizeUsd must be a positive number" }, { status: 400 });
  }
  const marketExists = await prisma.market.findUnique({ where: { id: String(marketId) }, select: { id: true } });
  if (!marketExists) return NextResponse.json({ error: "market not found" }, { status: 404 });
  const bet = await prisma.bet.create({
    data: {
      userId: session.user.id,
      marketId: String(marketId),
      analysisId: analysisId ? String(analysisId) : null,
      side: sideUpper,
      priceAtBet: price,
      sizeUsd: size,
      rationale: rationale ? String(rationale) : null,
      auto: false,
    },
  });
  return NextResponse.json({ bet });
}
