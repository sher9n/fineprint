import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session?.user?.id;

  // Don't eager-include votes on all 20 analyses just to strip them on output. We only need
  // votes for the latest analysis. The bookmark + my-bet check can run in parallel with the
  // market fetch.
  const [market, bookmark] = await Promise.all([
    prisma.market.findUnique({
      where: { id },
      include: {
        analyses: { orderBy: { createdAt: "desc" }, take: 20 },
        bets: { where: userId ? { userId } : { id: "__none__" }, orderBy: { placedAt: "desc" } },
      },
    }),
    userId ? prisma.bookmark.findUnique({ where: { userId_marketId: { userId, marketId: id } } }) : Promise.resolve(null),
  ]);
  if (!market) return NextResponse.json({ error: "not found" }, { status: 404 });

  const latest = market.analyses[0];
  const latestVotes = latest
    ? await prisma.vote.findMany({ where: { analysisId: latest.id }, select: { userId: true, direction: true } })
    : [];
  const upvotes = latestVotes.filter((v) => v.direction > 0).length;
  const downvotes = latestVotes.filter((v) => v.direction < 0).length;
  const myVote = userId ? latestVotes.find((v) => v.userId === userId)?.direction ?? 0 : 0;

  return NextResponse.json({
    market,
    votes: { up: upvotes, down: downvotes, mine: myVote },
    bookmarked: !!bookmark,
  });
}
