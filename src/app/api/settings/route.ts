import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureSettings } from "@/lib/bootstrap";
import { requireAdmin } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSettings();
  const s = await prisma.settings.findUnique({ where: { id: 1 } });
  return NextResponse.json({ settings: s });
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: gate.status });
  await ensureSettings();
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid json body" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if ("autoTradeEnabled" in body) data.autoTradeEnabled = body.autoTradeEnabled === true;
  if ("batchModeEnabled" in body) data.batchModeEnabled = body.batchModeEnabled === true;
  if ("firstPassModel" in body) {
    if (body.firstPassModel !== "haiku" && body.firstPassModel !== "sonnet" && body.firstPassModel !== "gpt5_4") {
      return NextResponse.json({ error: "firstPassModel must be 'haiku', 'sonnet', or 'gpt5_4'" }, { status: 400 });
    }
    data.firstPassModel = body.firstPassModel;
  }
  if ("haikuConcurrency" in body) {
    if (!isFiniteNum(body.haikuConcurrency)) return NextResponse.json({ error: "haikuConcurrency must be a number" }, { status: 400 });
    data.haikuConcurrency = clamp(Math.floor(body.haikuConcurrency), 1, 16);
  }
  if ("dailyBudgetUsd" in body) {
    if (!isFiniteNum(body.dailyBudgetUsd)) return NextResponse.json({ error: "dailyBudgetUsd must be a number" }, { status: 400 });
    data.dailyBudgetUsd = clamp(body.dailyBudgetUsd, 0, 10000);
  }
  if ("minDivergenceScore" in body) {
    if (!isFiniteNum(body.minDivergenceScore)) return NextResponse.json({ error: "minDivergenceScore must be a number" }, { status: 400 });
    data.minDivergenceScore = clamp(Math.floor(body.minDivergenceScore), 0, 10);
  }
  if ("minLiquidityUsd" in body) {
    if (!isFiniteNum(body.minLiquidityUsd)) return NextResponse.json({ error: "minLiquidityUsd must be a number" }, { status: 400 });
    data.minLiquidityUsd = clamp(body.minLiquidityUsd, 0, 10_000_000);
  }
  if ("minDaysToEnd" in body) {
    if (!isFiniteNum(body.minDaysToEnd)) return NextResponse.json({ error: "minDaysToEnd must be a number" }, { status: 400 });
    data.minDaysToEnd = clamp(Math.floor(body.minDaysToEnd), 0, 3650);
  }
  if ("maxDaysToEnd" in body) {
    if (!isFiniteNum(body.maxDaysToEnd)) return NextResponse.json({ error: "maxDaysToEnd must be a number" }, { status: 400 });
    data.maxDaysToEnd = clamp(Math.floor(body.maxDaysToEnd), 0, 3650);
  }

  if (isFiniteNum(data.minDaysToEnd) && isFiniteNum(data.maxDaysToEnd) && (data.minDaysToEnd as number) > (data.maxDaysToEnd as number)) {
    return NextResponse.json({ error: "minDaysToEnd must be <= maxDaysToEnd" }, { status: 400 });
  }

  const s = await prisma.settings.update({ where: { id: 1 }, data });
  return NextResponse.json({ settings: s });
}
