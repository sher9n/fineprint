import { prisma } from "./prisma";

export async function ensureSettings() {
  await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      autoTradeEnabled: false,
      batchModeEnabled: false,
      haikuConcurrency: 5,
      dailyBudgetUsd: parseFloat(process.env.DAILY_LLM_BUDGET_USD ?? "20"),
      minDivergenceScore: 6,
      minLiquidityUsd: 5000,
      minDaysToEnd: 2,
      maxDaysToEnd: 120,
    },
  });
}
