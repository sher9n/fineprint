import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ votes: [] });
  const votes = await prisma.vote.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const markets = await prisma.market.findMany({
    where: { id: { in: votes.map((v) => v.marketId) } },
    select: { id: true, question: true, eventTitle: true, groupItemTitle: true },
  });
  const byId = Object.fromEntries(markets.map((m) => [m.id, m]));
  return NextResponse.json({
    votes: votes.map((v) => ({
      marketId: v.marketId,
      direction: v.direction,
      createdAt: v.createdAt,
      question: byId[v.marketId]?.question ?? "",
      eventTitle: byId[v.marketId]?.eventTitle ?? null,
      groupItemTitle: byId[v.marketId]?.groupItemTitle ?? null,
    })),
  });
}
