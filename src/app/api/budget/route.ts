import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { dailyBudgetUsd, spentTodayUsd } from "@/lib/budget";
import { todayIstDateString } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [spent, budget] = await Promise.all([spentTodayUsd(), dailyBudgetUsd()]);
  const date = todayIstDateString();
  const breakdown = await prisma.costLog.groupBy({
    by: ["model", "purpose"],
    where: { dateIst: date },
    _sum: { costUsd: true, inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheCreationTokens: true },
  });
  return NextResponse.json({
    dateIst: date,
    spent,
    budget,
    remaining: Math.max(0, budget - spent),
    breakdown: breakdown.map((b) => ({
      model: b.model,
      purpose: b.purpose,
      costUsd: b._sum.costUsd ?? 0,
      inputTokens: b._sum.inputTokens ?? 0,
      outputTokens: b._sum.outputTokens ?? 0,
      cacheReadTokens: b._sum.cacheReadTokens ?? 0,
      cacheCreationTokens: b._sum.cacheCreationTokens ?? 0,
    })),
  });
}
