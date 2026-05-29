import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Toggle a user's bookmark on a market.
 *   body.bookmarked === true  → create if missing (idempotent)
 *   body.bookmarked === false → delete if present (idempotent)
 * Response: { bookmarked: boolean } reflecting the new state.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "auth required" }, { status: 401 });
  const userId = session.user.id;
  const { id: marketId } = await params;
  const body = await req.json().catch(() => ({}));
  const wantBookmarked = body.bookmarked !== false; // default to true if missing

  const market = await prisma.market.findUnique({ where: { id: marketId }, select: { id: true } });
  if (!market) return NextResponse.json({ error: "market not found" }, { status: 404 });

  if (wantBookmarked) {
    await prisma.bookmark.upsert({
      where: { userId_marketId: { userId, marketId } },
      update: {},
      create: { userId, marketId },
    });
  } else {
    await prisma.bookmark.deleteMany({ where: { userId, marketId } });
  }

  return NextResponse.json({ bookmarked: wantBookmarked });
}
