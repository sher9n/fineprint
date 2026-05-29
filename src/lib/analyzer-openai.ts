import type { Market } from "@prisma/client";
import { openai, OPENAI_FIRST_PASS_MODEL, OPENAI_FIRST_PASS_SERVICE_TIER, type OpenAIServiceTier } from "./openai";
import { logCost, remainingBudgetUsd } from "./budget";
import { llmCallsEnabled, LLMDisabledError } from "./llm-gate";
import {
  SYSTEM_PROMPT,
  buildUserMessage,
  AnalysisSchema,
  tryParseJson,
  type AnalysisJson,
} from "./analyzer";

export interface OpenAIFirstPassResult {
  analysis: AnalysisJson;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number };
  costUsd: number;
  model: string;
}

export interface RunOpenAIFirstPassOpts {
  model?: string;
  serviceTier?: OpenAIServiceTier;
  purpose?: string;
  skipBudgetGate?: boolean;
  skipCostLog?: boolean;
}

export async function runOpenAIFirstPass(
  market: Market,
  opts: RunOpenAIFirstPassOpts = {}
): Promise<OpenAIFirstPassResult | null> {
  if (!llmCallsEnabled()) throw new LLMDisabledError();

  if (!opts.skipBudgetGate) {
    const remaining = await remainingBudgetUsd();
    if (remaining <= 0.02) return null;
  }

  const model = opts.model ?? OPENAI_FIRST_PASS_MODEL;
  const serviceTier = opts.serviceTier ?? OPENAI_FIRST_PASS_SERVICE_TIER;

  // Flex tier has measured ~38% raw 5xx rate in observation. 5 retries with exponential backoff
  // recovered >99% of failures in the A/B harness — see scripts/ab-firstpass-rerun-failures.ts.
  const maxRetries = 5;
  const client = openai();
  let res: Awaited<ReturnType<typeof client.chat.completions.create>> | null = null;
  let lastErr: { status?: number; message?: string } | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      res = await client.chat.completions.create({
        model,
        service_tier: serviceTier,
        max_completion_tokens: 1024,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserMessage(market) },
        ],
        response_format: { type: "json_object" },
      });
      break;
    } catch (e) {
      const ex = e as { status?: number; message?: string };
      lastErr = ex;
      const retryable = ex.status === 429 || (ex.status != null && ex.status >= 500);
      if (!retryable || attempt === maxRetries - 1) throw e;
      const wait = 1000 * Math.pow(2, attempt) + Math.random() * 500;
      console.warn(`[gpt-5.4 first-pass] ${ex.status} retry ${attempt + 1}/${maxRetries} in ${Math.round(wait)}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  if (!res) throw new Error(`openai first-pass exhausted retries: ${lastErr?.status} ${lastErr?.message}`);

  const text = res.choices[0]?.message?.content ?? "";
  if (!text.trim()) return null;

  let parsed: AnalysisJson;
  try {
    parsed = AnalysisSchema.parse(tryParseJson(text));
  } catch (e) {
    console.error("[gpt-5.4 first-pass] parse fail", e, text.slice(0, 200));
    return null;
  }

  const promptTokens = res.usage?.prompt_tokens ?? 0;
  const cachedTokens = res.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const completionTokens = res.usage?.completion_tokens ?? 0;
  const usage = {
    inputTokens: Math.max(0, promptTokens - cachedTokens),
    outputTokens: completionTokens,
    cacheReadTokens: cachedTokens,
    cacheCreationTokens: 0,
  };

  // Flex tier is 50% off across the board, mirroring the Anthropic batch discount pattern in
  // budget.ts. logCost takes the standard pricing entry and applies discountFactor.
  const discountFactor = serviceTier === "flex" ? 0.5 : 1.0;

  const resolvedModel = res.model || model;
  let cost = 0;
  if (!opts.skipCostLog) {
    cost = await logCost({
      model: resolvedModel,
      purpose: opts.purpose ?? "first_pass",
      ...usage,
      discountFactor,
    });
  } else {
    // For the A/B test we want the computed cost but not the DB row. Use the same math as
    // logCost without the side effect.
    const { computeCost } = await import("./budget");
    cost = computeCost(resolvedModel, usage) * discountFactor;
  }

  return { analysis: parsed, usage, costUsd: cost, model: resolvedModel };
}
