import { prisma } from "./prisma";
import { todayIstDateString } from "./time";

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number;
  cacheWritePerMillion: number;
}

export const PRICING: Record<string, ModelPricing> = {
  "claude-haiku-4-5-20251001": {
    inputPerMillion: 1.0,
    outputPerMillion: 5.0,
    cacheReadPerMillion: 0.1,
    cacheWritePerMillion: 1.25,
  },
  "claude-opus-4-7": {
    // Verified from platform.claude.com/docs/en/about-claude/pricing 2026-05-29.
    // Anthropic dropped Opus pricing 3x at the 4.5+ generation; previous numbers ($15/$75)
    // were Opus 4.1 rates and produced ~3x cost over-reporting on Opus rows in CostLog.
    inputPerMillion: 5.0,
    outputPerMillion: 25.0,
    cacheReadPerMillion: 0.5,
    cacheWritePerMillion: 6.25,
  },
  "claude-sonnet-4-6": {
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
  },
  // OpenAI o3-deep-research pricing (approximate; OpenAI may revise). Cache fields unused.
  "o3-deep-research": {
    inputPerMillion: 10.0,
    outputPerMillion: 40.0,
    cacheReadPerMillion: 0,
    cacheWritePerMillion: 0,
  },
  // OpenAI gpt-5.4 standard tier pricing. Flex tier = same numbers with discountFactor=0.5
  // passed to logCost (mirrors the Anthropic batch pattern). Longest-prefix lookup handles
  // dated snapshots like gpt-5.4-2026-03-05.
  "gpt-5.4": {
    inputPerMillion: 2.5,
    outputPerMillion: 15.0,
    cacheReadPerMillion: 0.25,
    cacheWritePerMillion: 0,
  },
};

// Purposes that count against the separate Deep Research budget (not the main LLM budget).
export const DEEP_RESEARCH_PURPOSES = new Set(["gpt_deep_research"]);

function lookupPricing(model: string): ModelPricing | null {
  // Exact match first.
  if (PRICING[model]) return PRICING[model];
  // OpenAI dated snapshots (e.g. "o3-deep-research-2025-06-26") and Anthropic dated ids fall back
  // to the longest prefix that matches a known model. Prevents cost-recording bugs when providers
  // return a more specific id than what we registered.
  let bestKey: string | null = null;
  for (const key of Object.keys(PRICING)) {
    if (model.startsWith(key) && (!bestKey || key.length > bestKey.length)) bestKey = key;
  }
  return bestKey ? PRICING[bestKey] : null;
}

export function computeCost(
  model: string,
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number }
): number {
  const p = lookupPricing(model);
  if (!p) {
    console.warn(`[budget] no pricing entry for model '${model}' — cost recorded as 0`);
    return 0;
  }
  // Cache accounting heuristic: when cache_read > 0, treat cache_creation as informational
  // (Anthropic populates both fields per-request in batch responses, but only bills cache
  // creation once per cache, not per-request). When cache_read = 0, this is a true first
  // write (in-line first call within a cache window), and cache_creation is billable.
  //
  // Verified against an isolated Sonnet call 2026-05-29 (request msg_017dqT1hgcDBvZqXHW5TKTh2):
  // cache_creation=7635, cache_read=0, so cache_creation IS the actual billable write.
  // For batched responses where both are populated, cache_creation is suppressed here to
  // avoid the ~3x over-reporting we saw against Anthropic Console totals.
  const inputCost = (usage.inputTokens * p.inputPerMillion) / 1_000_000;
  const outputCost = (usage.outputTokens * p.outputPerMillion) / 1_000_000;
  const cacheReadTokens = usage.cacheReadTokens ?? 0;
  const cacheReadCost = (cacheReadTokens * p.cacheReadPerMillion) / 1_000_000;
  const cacheCreationTokens = usage.cacheCreationTokens ?? 0;
  const cacheWriteCost =
    cacheReadTokens > 0
      ? 0
      : (cacheCreationTokens * p.cacheWritePerMillion) / 1_000_000;
  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}

// Anthropic web_search tool. The listed price is $10/1000 calls, but observed billing on the
// Anthropic Console is ~$0.0002/call effective (most tool_use blocks don't translate to billed
// queries, or volume tier kicks in). Kept here as a small constant for budgeting; not a major
// contributor to total spend at our volumes.
export const WEB_SEARCH_COST_PER_CALL = 0.0003;

export async function spentTodayUsd(): Promise<number> {
  const date = todayIstDateString();
  const rows = await prisma.costLog.findMany({
    where: { dateIst: date, purpose: { notIn: Array.from(DEEP_RESEARCH_PURPOSES) } },
  });
  return rows.reduce((s, r) => s + r.costUsd, 0);
}

export async function spentTodayDeepResearchUsd(): Promise<number> {
  const date = todayIstDateString();
  const rows = await prisma.costLog.findMany({
    where: { dateIst: date, purpose: { in: Array.from(DEEP_RESEARCH_PURPOSES) } },
  });
  return rows.reduce((s, r) => s + r.costUsd, 0);
}

export async function dailyBudgetUsd(): Promise<number> {
  const s = await prisma.settings.findUnique({ where: { id: 1 } });
  return s?.dailyBudgetUsd ?? parseFloat(process.env.DAILY_LLM_BUDGET_USD ?? "20");
}

export async function dailyDeepResearchBudgetUsd(): Promise<number> {
  const s = await prisma.settings.findUnique({ where: { id: 1 } });
  const fromSettings = (s as { dailyDeepResearchBudgetUsd?: number } | null)?.dailyDeepResearchBudgetUsd;
  return fromSettings ?? parseFloat(process.env.DAILY_DEEP_RESEARCH_BUDGET_USD ?? "50");
}

export async function remainingBudgetUsd(): Promise<number> {
  const [spent, budget] = await Promise.all([spentTodayUsd(), dailyBudgetUsd()]);
  return Math.max(0, budget - spent);
}

export async function remainingDeepResearchBudgetUsd(): Promise<number> {
  const [spent, budget] = await Promise.all([spentTodayDeepResearchUsd(), dailyDeepResearchBudgetUsd()]);
  return Math.max(0, budget - spent);
}

export async function logCost(args: {
  model: string;
  purpose: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  extraUsd?: number;
  discountFactor?: number;
}): Promise<number> {
  const base = computeCost(args.model, args);
  const discounted = base * (args.discountFactor ?? 1.0);
  const totalUsd = discounted + (args.extraUsd ?? 0);
  await prisma.costLog.create({
    data: {
      dateIst: todayIstDateString(),
      model: args.model,
      purpose: args.purpose,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      cacheReadTokens: args.cacheReadTokens ?? 0,
      cacheCreationTokens: args.cacheCreationTokens ?? 0,
      costUsd: totalUsd,
    },
  });
  return totalUsd;
}
