import { prisma } from "./prisma";
import { anthropic, VERIFIER_MODEL, extractUsage, withRetry } from "./anthropic";
import { AnalysisSchema, buildUserMessage, SYSTEM_PROMPT, tryParseJson, type AnalysisJson } from "./analyzer";
import { logCost, remainingBudgetUsd } from "./budget";
import { computeEdge } from "./scoring";
import type { Market, Analysis } from "@prisma/client";

const SYNTHESIS_THRESHOLD_USD = 0.15;

function summarizeAnalysisForSynthesis(label: string, a: Analysis): string {
  const steps = (() => {
    try {
      const arr = a.verificationSteps ? (JSON.parse(a.verificationSteps) as string[]) : [];
      return arr.map((s, i) => `  ${i + 1}. ${s}`).join("\n");
    } catch {
      return "";
    }
  })();
  return `==== ${label} (model: ${a.model}) ====
vibe_interpretation: ${a.vibeInterpretation}
literal_interpretation: ${a.literalInterpretation}
divergence_type: ${a.divergenceType}
divergence_score: ${a.divergenceScore}/10
edge_direction: ${a.edgeDirection}
recommended bet side: ${a.betSide}
rule_implied_probability: ${a.ruleImpliedProbability ?? "null"}
expected_yes_payout_cents: ${a.expectedYesPayoutCents ?? "null"}
expected_no_payout_cents: ${a.expectedNoPayoutCents ?? "null"}

reasoning:
${a.reasoning}

source_findings:
${a.sourceFindings ?? "(none provided)"}

verification_steps:
${steps}`;
}

/**
 * Run Opus to synthesize the latest opus + gpt_deep analyses into a final verdict.
 * Writes a new Analysis row with pass='synthesis'. Returns null if synthesis can't run
 * (missing prerequisites, budget, parse failure).
 */
export async function runSynthesis(market: Market): Promise<Analysis | null> {
  const opusAnalysis = await prisma.analysis.findFirst({
    where: { marketId: market.id, pass: "opus", rulesHash: market.rulesHash },
    orderBy: { createdAt: "desc" },
  });
  const gptAnalysis = await prisma.analysis.findFirst({
    where: { marketId: market.id, pass: "gpt_deep", rulesHash: market.rulesHash },
    orderBy: { createdAt: "desc" },
  });
  if (!opusAnalysis || !gptAnalysis) return null;

  const remaining = await remainingBudgetUsd();
  if (remaining < SYNTHESIS_THRESHOLD_USD) return null;

  const client = anthropic();

  const userPrompt = `${buildUserMessage(market)}

Two independent analyses have already been done on this market. Your job is to SYNTHESIZE them into a final verdict.

${summarizeAnalysisForSynthesis("OPUS (Claude, web-search verifier)", opusAnalysis)}

${summarizeAnalysisForSynthesis("GPT (OpenAI deep-research)", gptAnalysis)}

Your synthesis must:
1. Identify where the two analyses AGREE (same edge_direction, similar divergence_score, similar interpretation).
2. Identify where they DISAGREE, and explain which side is more credible and why. Cite specifics from each.
3. Produce a final verdict that is YOUR considered judgment, not just a vote-count of the two.
4. If the two analyses disagree on edge_direction, the divergence_score in your output should drop (max 5) unless you can clearly explain why one is wrong.
5. Be honest about uncertainty. If both analyses identified weak evidence, say so.

In the source_findings paragraph (3-6 sentences), briefly summarize what the synthesis revealed about agreement and disagreement.

Then the JSON. Use this schema:
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

  const res = await withRetry(
    () =>
      client.messages.create({
        model: VERIFIER_MODEL,
        max_tokens: 2048,
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userPrompt }],
      }),
    { label: "synthesis", attempts: 3 }
  );

  const usage = extractUsage(res.usage);
  const cost = await logCost({
    model: VERIFIER_MODEL,
    purpose: "synthesis",
    ...usage,
  });

  const textBlocks = res.content.filter((c) => c.type === "text") as { type: "text"; text: string }[];
  const fullText = textBlocks.map((t) => t.text).join("\n");
  if (!fullText.trim()) return null;

  const parts = fullText.split(/---\s*JSON\s*---/i);
  let sourceFindings: string;
  let jsonText: string;
  if (parts.length >= 2) {
    sourceFindings = parts[0].trim();
    jsonText = parts.slice(1).join("\n").trim();
  } else {
    const jsonStart = fullText.lastIndexOf("{");
    sourceFindings = jsonStart > 0 ? fullText.slice(0, jsonStart).trim() : "";
    jsonText = jsonStart >= 0 ? fullText.slice(jsonStart) : fullText;
  }

  let parsed: AnalysisJson;
  try {
    parsed = AnalysisSchema.parse(tryParseJson(jsonText));
  } catch (err) {
    console.error("synthesis parse fail", err, fullText.slice(0, 300));
    return null;
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

  return prisma.analysis.create({
    data: {
      marketId: market.id,
      rulesHash: market.rulesHash,
      pass: "synthesis",
      model: VERIFIER_MODEL,
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
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
    },
  });
}

/**
 * Public helper: are Opus and GPT in agreement on edge_direction for this market's current rules?
 * Returns null if either analysis is missing. Doesn't run the synthesis pass.
 */
export async function modelAgreementState(marketId: string, rulesHash: string): Promise<"agree" | "disagree" | null> {
  const opus = await prisma.analysis.findFirst({
    where: { marketId, pass: "opus", rulesHash },
    orderBy: { createdAt: "desc" },
    select: { edgeDirection: true },
  });
  const gpt = await prisma.analysis.findFirst({
    where: { marketId, pass: "gpt_deep", rulesHash },
    orderBy: { createdAt: "desc" },
    select: { edgeDirection: true },
  });
  if (!opus || !gpt) return null;
  return opus.edgeDirection === gpt.edgeDirection ? "agree" : "disagree";
}
