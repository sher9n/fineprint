import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session?.user?.id;

  const market = await prisma.market.findUnique({
    where: { id },
    include: {
      analyses: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { votes: true },
      },
      bets: { where: userId ? { userId } : { id: "__none__" }, orderBy: { placedAt: "desc" } },
    },
  });
  if (!market) return NextResponse.json({ error: "not found" }, { status: 404 });

  const latest = market.analyses[0];
  const votes = latest?.votes ?? [];
  const upvotes = votes.filter((v) => v.direction > 0).length;
  const downvotes = votes.filter((v) => v.direction < 0).length;
  const myVote = userId ? votes.find((v) => v.userId === userId)?.direction ?? 0 : 0;

  return NextResponse.json({
    market: {
      ...market,
      analyses: market.analyses.map((a) => ({ ...a, votes: undefined })),
    },
    votes: { up: upvotes, down: downvotes, mine: myVote },
  });
}
