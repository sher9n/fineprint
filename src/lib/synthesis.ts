import { prisma } from "./prisma";
import { anthropic, VERIFIER_MODEL, extractUsage, withRetry } from "./anthropic";
import { AnalysisSchema, buildUserMessage, SYSTEM_PROMPT, tryParseJson, type AnalysisJson } from "./analyzer";
import { logCost, remainingBudgetUsd } from "./budget";
import { computeEdge } from "./scoring";
import { llmCallsEnabled } from "./llm-gate";
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
  // Called from the deep-research poll loop as a side-effect of completion; return null silently
  // when LLM is disabled so the poll itself doesn't break (it just won't produce a synthesis row).
  if (!llmCallsEnabled()) return null;
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

Two independent analyses have been done on this market, with deliberately asymmetric inputs:

OPUS — market-aware analyst. Saw the market price, sibling markets in the same event, sibling markets in the same negRisk group, recently resolved similar markets, and the full prediction-market lore (UMA disputes, resolver track record, "Other" fallback conventions, negRisk joint-probability math). Strength: recognising when textual divergence is NOT actionable mispricing because the crowd or the resolver has already corrected for it.

GPT (deep-research) — fact-finder, market-blind. Did NOT see the market price, sibling markets, or any betting-aggregator data. Researched only primary sources (the named resolution source, government and regulatory sites, primary journalism). Strength: independent factual world-state — what has actually happened, what the named source is currently reporting, what the underlying event looks like before anyone has priced it.

Disagreement between them is informative, not noise. Two patterns to recognise:

A. FACTUAL disagreement. GPT has found a primary-source fact (the named source already published a result, the deadline-relevant event has already occurred per AP, the eligibility precondition fails per court record) that Opus's market-aware reading missed or under-weighted. Favor GPT. The crowd or your prior may simply be wrong.

B. STRUCTURAL / INTERPRETIVE disagreement. Opus has anchored on a resolver precedent, sibling-market pricing consistency, or a platform-specific convention (UMA dispute behavior, "Other" fallback firing rate, negRisk joint sum) that GPT did not have access to. Favor Opus. GPT's textual reading is correct in the abstract but the resolver does not operate that way.

${summarizeAnalysisForSynthesis("OPUS (market-aware analyst)", opusAnalysis)}

${summarizeAnalysisForSynthesis("GPT (fact-finder, market-blind)", gptAnalysis)}

YOUR TASK

1. State whether Opus and GPT agree on the IMPLIED BET DIRECTION (where each model's rule_implied_probability sits relative to the market price, and which side each would buy). Note: the raw edge_direction field can be misleading here. It means "which side does the LITERAL reading favor over the VIBE reading?" — a divergence-direction. A confident fact-finder that sees no rules-vs-vibe gap but estimates P(YES) far above price returns edge_direction=NONE while still implicitly recommending YES. Compare implied bet direction, not labels.
2. If they disagree on bet direction, classify the disagreement as FACTUAL (favor GPT) or STRUCTURAL (favor Opus) and explain which specific piece of evidence is decisive. Reference source_findings or reasoning from each by name.
3. If they agree on bet direction (even if one labeled the divergence differently), combine the strongest claim from each: typically Opus's market-structural reading plus GPT's factual world-state.
4. Produce your final verdict. The divergence_score in your output is your judgment of the actionable gap given all the evidence — not a vote count, not an auto-cap on disagreement. An asymmetric disagreement that you have classified is often a HIGHER-confidence signal than naive agreement on a textual reading.
5. Be honest about uncertainty. If neither analysis surfaced strong evidence, say so and score conservatively.

6. WEIGHT PRECEDENT OVER OPTIMISM. If Opus cites multiple resolved sibling precedents pointing the same direction (e.g. 3+ prior variants all resolved NO) and GPT's higher rule_p is driven by "negotiations advancing", "talks are progressing", "momentum", or other news-flow optimism WITHOUT pointing to a concrete qualifying event (a signed agreement, certified result, official enactment), then anchor your final verdict closer to Opus's precedent-aware estimate. Optimistic news coverage almost always exists before recurring questions resolve NO; it is not evidence the resolver will rule differently this time. Departing from a strong precedent base rate requires GPT to have surfaced a CONCRETE QUALIFYING FACT, not a directional vibe.

7. EXCLUSION-CLAUSE CHECK. If the rules carve out a specific category of event ("temporary X does not qualify", "framework MOUs do not count") and the underlying activity GPT describes matches that excluded category, treat that as direct NO evidence even if GPT itself labeled the activity as "progress". The rules are the authority on what counts; GPT can miss the carve-out and you must catch it. This applies symmetrically across multiple deadlines for the same recurring question: if a deadline-X variant of the question would resolve NO under the carve-out, the deadline-Y variant resolves NO too unless the activity has shifted to a qualifying category.

source_findings: 4 to 7 sentences. Lead with whether Opus and GPT agreed; if they disagreed, lead with how you classified the disagreement and which side won. Cite specific claims from each. Mention the most decisive piece of evidence.

Then the literal separator "---JSON---" on its own line, then a single JSON object:
{
  "vibe_interpretation": "<one sentence>",
  "literal_interpretation": "<one sentence>",
  "divergence_type": "date_bound | threshold | ambiguous_source | specific_event | definition_gap | none | other",
  "divergence_score": <integer 0 to 10, your judgment>,
  "edge_direction": "YES | NO | NONE",
  "rule_implied_probability": <0 to 1, or null>,
  "expected_yes_payout_cents": <0 to 100>,
  "expected_no_payout_cents": <0 to 100>,
  "reasoning": "<3 to 5 sentences: the gap, the decisive evidence, why you sided with whichever model, what would change your mind>",
  "verification_steps": ["<concrete check>", "<another>", "<3 to 5 total>"]
}`;

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
