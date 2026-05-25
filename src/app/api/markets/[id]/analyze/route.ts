import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { analyzeAndStore } from "@/lib/analyzer";
import { auth } from "@/lib/auth";
import { remainingBudgetUsd } from "@/lib/budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "auth required" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  // Reject unknown pass values explicitly. Silently coercing to "haiku" would burn LLM budget
  // on a caller that probably has a bug. Omitted pass defaults to "haiku" (the cheap option).
  const passRaw = body?.pass;
  let pass: "haiku" | "opus";
  if (passRaw == null) pass = "haiku";
  else if (passRaw === "haiku" || passRaw === "opus") pass = passRaw;
  else return NextResponse.json({ error: `Invalid pass '${String(passRaw)}'. Use 'haiku' or 'opus'.` }, { status: 400 });
  if (pass === "opus" && !session.user.isAdmin) {
    return NextResponse.json({ error: "Verifier (opus) re-runs are admin-only." }, { status: 403 });
  }
  const market = await prisma.market.findUnique({ where: { id } });
  if (!market) return NextResponse.json({ error: "Market not found." }, { status: 404 });

  const remaining = await remainingBudgetUsd();
  const threshold = pass === "opus" ? 0.15 : 0.05;
  if (remaining < threshold) {
    return NextResponse.json(
      { ok: false, error: `Daily LLM budget exhausted ($${remaining.toFixed(2)} remaining). Try again tomorrow or raise the budget in Pipeline settings.` },
      { status: 402 }
    );
  }

  try {
    const a = await analyzeAndStore(market, pass);
    if (!a) {
      return NextResponse.json(
        { ok: false, error: pass === "opus" ? "Verifier returned no usable result (parse error or API failure)." : "Analyzer returned no usable result." },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true, analysis: a });
  } catch (err) {
    console.error(`[/api/markets/${id}/analyze] failed:`, err);
    return NextResponse.json({ ok: false, error: `Internal error: ${String(err).slice(0, 200)}` }, { status: 500 });
  }
}
