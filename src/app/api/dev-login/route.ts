import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEV_EMAIL = "sherancorera@gmail.com";
const IS_PROD = process.env.NODE_ENV?.toString() === "production";
const SESSION_COOKIE_NAME = IS_PROD ? "__Secure-authjs.session-token" : "authjs.session-token";

export async function POST(req: NextRequest) {
  if (IS_PROD) {
    return NextResponse.json({ error: "disabled in production" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  if (email !== DEV_EMAIL) {
    return NextResponse.json({ error: "not the dev bypass email" }, { status: 403 });
  }

  // Dev bypass: always grant admin since this is local-only
  const user = await prisma.user.upsert({
    where: { email },
    update: { isAdmin: true, emailVerified: new Date() },
    create: { email, isAdmin: true, emailVerified: new Date() },
  });

  const sessionToken = crypto.randomUUID();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: { sessionToken, userId: user.id, expires },
  });

  const res = NextResponse.json({ ok: true, userId: user.id });
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: sessionToken,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires,
    secure: IS_PROD,
  });
  return res;
}
