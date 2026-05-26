import { prisma } from "./prisma";
import { openai, DEEP_RESEARCH_MODEL } from "./openai";
import { AnalysisSchema, buildUserMessage, SYSTEM_PROMPT, tryParseJson, type AnalysisJson } from "./analyzer";
import { logCost, remainingDeepResearchBudgetUsd } from "./budget";
import { computeEdge } from "./scoring";
import { runSynthesis } from "./synthesis";
import { llmCallsEnabled, LLMDisabledError } from "./llm-gate";
import type { Market, DeepResearchJob } from "@prisma/client";

const SUBMIT_THRESHOLD_USD = 1.5;

const DEEP_RESEARCH_USER_PROMPT_SUFFIX = `

This is a THIRD-PASS deep research analysis. Use your full web search and reasoning capabilities to:
1. Independently verify the resolution rules and check what the named source is currently saying.
2. Check recent news, social media, and authoritative sources about the underlying event.
3. Find any sibling/precedent markets (on Polymarket or elsewhere) that have already resolved similar questions, and what the resolution criteria established.
4. Consider how the rules will be operationalized at resolution time — not just the textual reading, but the practical interpretation.
5. Identify any facts that change the literal rules reading vs the lay reading of the title.

Then output:
1. A "source_findings" paragraph (3-6 sentences) summarizing what your research revealed and which sources you weighted most.
2. A JSON object matching this schema:
{
  "vibe_interpretation": string,
  "literal_interpretation": string,
  "divergence_type": "date_bound" | "threshold" | "ambiguous_source" | "specific_event" | "definition_gap" | "none" | "other",
  "divergence_score": integer 0-10,
  "edge_direction": "YES" | "NO" | "NONE",
  "rule_implied_probability": number 0-1 or null,
  "expected_yes_payout_cents": number 0-100 or null,
  "expected_no_payout_cents": number 0-100 or null,
  "reasoning": string,
  "verification_steps": string[] (max 8)
}

Format: source_findings paragraph first, then JSON object. Use a clear separator "---JSON---" between them.`;

type ResponseStatus = "queued" | "in_progress" | "completed" | "failed" | "cancelled" | "incomplete";

interface ResponseEnvelope {
  id: string;
  status: ResponseStatus | string;
  output_text?: string;
  output?: Array<{ type: string; content?: Array<{ type: string; text?: string }>; text?: string }>;
  error?: { message?: string; code?: string } | null;
  usage?: { input_tokens?: number; output_tokens?: number };
  model?: string;
}

function extractText(env: ResponseEnvelope): string {
  if (typeof env.output_text === "string" && env.output_text.length > 0) return env.output_text;
  if (Array.isArray(env.output)) {
    const parts: string[] = [];
    for (const item of env.output) {
      if (typeof item.text === "string") parts.push(item.text);
      if (Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c && c.type === "output_text" && typeof c.text === "string") parts.push(c.text);
          else if (c && c.type === "text" && typeof c.text === "string") parts.push(c.text);
        }
      }
    }
    if (parts.length > 0) return parts.join("\n");
  }
  return "";
}

/**
 * Submit a deep-research job for a market via the OpenAI Responses API in background mode.
 *
 * Why not Batch API: the user's OpenAI project doesn't have batch endpoint access to
 * o3-deep-research (verified 2026-05-24 via 403 model_not_found rejection). Responses API in
 * background mode does work, just at full price (no 50% discount). Anthropic batching for the
 * first-pass and Opus verifier is unaffected.
 *
 * Refuses if the market already has a completed gpt_deep Analysis for the current rulesHash
 * (no re-runs in v1), or if there's an in-flight job for it (no double-submit).
 */
export async function submitDeepResearch(market: Market): Promise<DeepResearchJob> {
  if (!llmCallsEnabled()) throw new LLMDisabledError();
  const existingAnalysis = await prisma.analysis.findFirst({
    where: { marketId: market.id, pass: "gpt_deep", rulesHash: market.rulesHash },
    select: { id: true },
  });
  if (existingAnalysis) {
    throw new Error("This market already has a completed deep-research analysis for the current rules.");
  }

  const existingInflight = await prisma.deepResearchJob.findFirst({
    where: {
      marketId: market.id,
      status: { in: ["queued", "in_progress"] },
      rulesHashAtSubmit: market.rulesHash,
    },
    orderBy: { submittedAt: "desc" },
  });
  if (existingInflight) return existingInflight;

  const remaining = await remainingDeepResearchBudgetUsd();
  if (remaining < SUBMIT_THRESHOLD_USD) {
    throw new Error(`Daily deep-research budget too low ($${remaining.toFixed(2)} remaining). Need at least $${SUBMIT_THRESHOLD_USD.toFixed(2)} to submit.`);
  }

  const input = `${SYSTEM_PROMPT}\n\n${buildUserMessage(market)}${DEEP_RESEARCH_USER_PROMPT_SUFFIX}`;
  const client = openai();

  // OpenAI Responses API in background mode. The response id comes back immediately; we poll for completion.
  const res = await client.responses.create({
    model: DEEP_RESEARCH_MODEL,
    input,
    background: true,
    tools: [{ type: "web_search_preview" }],
  });

  if (!res?.id) throw new Error("OpenAI Responses API returned no id");

  return prisma.deepResearchJob.create({
    data: {
      marketId: market.id,
      openaiResponseId: res.id,
      model: DEEP_RESEARCH_MODEL,
      status: typeof res.status === "string" ? res.status : "queued",
      rulesHashAtSubmit: market.rulesHash,
    },
  });
}

/**
 * Poll all in-flight deep-research jobs. On completion, parse, write an Analysis row with
 * pass='gpt_deep', then kick off the synthesis pass.
 */
export async function pollDeepResearchJobs(opts: { limit?: number } = {}): Promise<{
  polled: number;
  completed: number;
  failed: number;
  stillRunning: number;
}> {
  const inflight = await prisma.deepResearchJob.findMany({
    where: { status: { in: ["queued", "in_progress"] } },
    orderBy: { submittedAt: "asc" },
    take: opts.limit ?? 50,
  });

  let polled = 0;
  let completed = 0;
  let failed = 0;
  let stillRunning = 0;
  const client = openai();

  for (const job of inflight) {
    polled++;
    try {
      const env = (await client.responses.retrieve(job.openaiResponseId)) as unknown as ResponseEnvelope;
      const status = env.status;
      await prisma.deepResearchJob.update({
        where: { id: job.id },
        data: { lastPolledAt: new Date(), status },
      });

      if (status === "queued" || status === "in_progress") {
        stillRunning++;
        continue;
      }

      if (status === "failed" || status === "cancelled" || status === "incomplete") {
        failed++;
        await prisma.deepResearchJob.update({
          where: { id: job.id },
          data: {
            status,
            errorMessage: env.error?.message ?? `status=${status}`,
            completedAt: new Date(),
          },
        });
        continue;
      }

      if (status === "completed") {
        const text = extractText(env);
        const inputTokens = env.usage?.input_tokens ?? 0;
        const outputTokens = env.usage?.output_tokens ?? 0;

        const market = await prisma.market.findUnique({ where: { id: job.marketId } });
        if (!market) {
          await prisma.deepResearchJob.update({
            where: { id: job.id },
            data: { status: "failed", errorMessage: "market deleted before completion", completedAt: new Date() },
          });
          failed++;
          continue;
        }

        // Idempotency: if a previous poll cycle already logged cost (e.g. parsing failed last time
        // and we're retrying after a parser fix), reuse the recorded amount instead of double-billing.
        const cost = job.costUsd > 0
          ? job.costUsd
          : await logCost({
              model: env.model ?? job.model,
              purpose: "gpt_deep_research",
              inputTokens,
              outputTokens,
            });

        // Parse: source_findings then JSON
        const parts = text.split(/---\s*JSON\s*---/i);
        let sourceFindings: string;
        let jsonText: string;
        if (parts.length >= 2) {
          sourceFindings = parts[0].trim();
          jsonText = parts.slice(1).join("\n").trim();
        } else {
          const jsonStart = text.lastIndexOf("{");
          sourceFindings = jsonStart > 0 ? text.slice(0, jsonStart).trim() : "";
          jsonText = jsonStart >= 0 ? text.slice(jsonStart) : text;
        }

        let parsed: AnalysisJson;
        try {
          parsed = AnalysisSchema.parse(tryParseJson(jsonText));
        } catch (err) {
          await prisma.deepResearchJob.update({
            where: { id: job.id },
            data: {
              status: "failed",
              errorMessage: `parse error: ${String(err).slice(0, 300)}`,
              completedAt: new Date(),
              costUsd: cost,
              inputTokens,
              outputTokens,
            },
          });
          failed++;
          continue;
        }

        const scored = computeEdge({
          divergenceScore: parsed.divergence_score,
          edgeDirection: parsed.edge_direction,
          yesPrice: market.yesPrice,
          noPrice: market.noPrice,
          liquidity: market.liquidity,
          endDate: market.endDate,
          ruleImpliedProbability: parsed.rule_implied_probability,
          expectedYesPayoutCents: parsed.expected_yes_payout_cents,
          expectedNoPayoutCents: parsed.expected_no_payout_cents,
          pass: "opus",
        });

        await prisma.analysis.create({
          data: {
            marketId: market.id,
            rulesHash: market.rulesHash,
            pass: "gpt_deep",
            model: env.model ?? job.model,
            vibeInterpretation: parsed.vibe_interpretation,
            literalInterpretation: parsed.literal_interpretation,
            divergenceType: parsed.divergence_type,
            divergenceScore: parsed.divergence_score,
            edgeDirection: parsed.edge_direction,
            ruleImpliedProbability: parsed.rule_implied_probability,
            expectedYesPayoutCents: parsed.expected_yes_payout_cents,
            expectedNoPayoutCents: parsed.expected_no_payout_cents,
            verificationSteps: JSON.stringify(parsed.verification_steps),
            reasoning: parsed.reasoning,
            sourceFindings,
            yesPriceAtAnalysis: market.yesPrice,
            noPriceAtAnalysis: market.noPrice,
            liquidityAtAnalysis: market.liquidity,
            edgeScore: scored.edgeScore,
            betSide: scored.betSide,
            priceGap: scored.priceGap,
            directionAgreement: scored.directionAgreement,
            costUsd: cost,
            inputTokens,
            outputTokens,
          },
        });

        await prisma.deepResearchJob.update({
          where: { id: job.id },
          data: {
            status: "completed",
            completedAt: new Date(),
            costUsd: cost,
            inputTokens,
            outputTokens,
          },
        });
        completed++;

        // Kick off synthesis. Best-effort; if it fails it doesn't roll back the gpt_deep row.
        try {
          await runSynthesis(market);
        } catch (err) {
          console.error(`[deep-research] synthesis after job ${job.id} failed:`, String(err).slice(0, 300));
        }
      }
    } catch (err) {
      console.error(`[deep-research] poll error for job ${job.id}:`, String(err).slice(0, 300));
      // Don't mark failed on transient poll errors; just record the error message and try again next cycle.
      await prisma.deepResearchJob.update({
        where: { id: job.id },
        data: { lastPolledAt: new Date(), errorMessage: String(err).slice(0, 500) },
      });
    }
  }

  return { polled, completed, failed, stillRunning };
}
