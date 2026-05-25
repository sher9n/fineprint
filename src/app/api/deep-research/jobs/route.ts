import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";
import { spentTodayDeepResearchUsd, dailyDeepResearchBudgetUsd } from "@/lib/budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: gate.status });

  const jobs = await prisma.deepResearchJob.findMany({
    orderBy: { submittedAt: "desc" },
    take: 100,
    include: { market: { select: { id: true, question: true, eventTitle: true, groupItemTitle: true } } },
  });
  const [spent, budget] = await Promise.all([spentTodayDeepResearchUsd(), dailyDeepResearchBudgetUsd()]);

  return NextResponse.json({
    jobs: jobs.map((j) => ({
      id: j.id,
      marketId: j.marketId,
      marketQuestion: j.market.eventTitle && j.market.groupItemTitle
        ? `${j.market.eventTitle} — ${j.market.groupItemTitle}`
        : j.market.question,
      openaiResponseId: j.openaiResponseId,
      model: j.model,
      status: j.status,
      costUsd: j.costUsd,
      errorMessage: j.errorMessage,
      submittedAt: j.submittedAt,
      lastPolledAt: j.lastPolledAt,
      completedAt: j.completedAt,
    })),
    budget: {
      spentToday: spent,
      dailyBudget: budget,
      remaining: Math.max(0, budget - spent),
    },
  });
}
