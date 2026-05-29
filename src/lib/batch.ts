import { prisma } from "./prisma";
import { anthropic, HAIKU_MODEL, VERIFIER_MODEL, extractUsage, resolveFirstPassModel } from "./anthropic";
import { logCost, WEB_SEARCH_COST_PER_CALL, remainingBudgetUsd } from "./budget";
import { computeEdge } from "./scoring";
import { AnalysisSchema, ObviousBetSchema, SYSTEM_PROMPT, OBVIOUS_SYSTEM_PROMPT, buildUserMessage, tryParseJson } from "./analyzer";
import { llmCallsEnabled, LLMDisabledError } from "./llm-gate";
import { findSimilarClosedMarkets } from "./embeddings";
import type { Market } from "@prisma/client";

// Effective batch discount applied to this account. The published rate card says 50% off
// for Batch API, but empirical measurement against Anthropic Console billing (2026-05-29:
// $26.81 actual vs $54 predicted at 0.5 for the scenario-a 2000-market Opus+ws run)
// indicates the real discount applied here is ~75%. This may be an automatic volume tier
// or undocumented enterprise rate. If logged costs drift back upward against the dashboard,
// reset to 0.5 and re-investigate. Per-call calibration with inline Opus (2026-05-29) showed
// the non-batch rates ARE accurate as documented; the discrepancy is batch-specific.
const BATCH_DISCOUNT = 0.25;
const VERIFIER_PURPOSE = "verifier_pass";
export const OBVIOUS_PURPOSE = "obvious_pass";
const FIRST_PASS_PURPOSES = new Set(["first_pass", "first_pass_haiku", "first_pass_sonnet"]);

// Skip markets whose price has effectively collapsed. The "edge" is illusory in those cases
// and either side of the trade is a near-100% loss; spending tokens on them is wasted.
const PRICE_LIVE_FILTER = [
  { OR: [{ yesPrice: null }, { yesPrice: { gt: 0.01, lt: 0.99 } }] },
  { OR: [{ noPrice: null }, { noPrice: { gt: 0.01, lt: 0.99 } }] },
];

async function buildMarketContext(market: Market): Promise<string> {
  const sections: string[] = [];

  const eventSiblings = market.eventSlug
    ? await prisma.market.findMany({
        where: { eventSlug: market.eventSlug, id: { not: market.id } },
        orderBy: { liquidity: "desc" },
        take: 12,
      })
    : [];
  if (eventSiblings.length > 0) {
    sections.push("SIBLING MARKETS IN THE SAME EVENT (other outcomes of the same overall question — their pricing shows how the crowd is modeling parallel possibilities):");
    for (const s of eventSiblings) {
      const px = s.yesPrice != null ? `YES ${Math.round(s.yesPrice * 100)}¢` : "?";
      const status = s.closed ? `[CLOSED, resolved ${inferResolution(s)}]` : "[OPEN]";
      const label = s.groupItemTitle || s.question;
      sections.push(`  - ${label}: ${px} ${status}`);
    }
  }

  const negRiskSiblings = market.negRiskMarketId
    ? await prisma.market.findMany({
        where: {
          negRiskMarketId: market.negRiskMarketId,
          id: { not: market.id },
          ...(market.eventSlug ? { eventSlug: { not: market.eventSlug } } : {}),
        },
        orderBy: { liquidity: "desc" },
        take: 6,
      })
    : [];
  if (negRiskSiblings.length > 0) {
    if (sections.length > 0) sections.push("");
    sections.push("RELATED MARKETS (same negRisk group, different question):");
    for (const s of negRiskSiblings) {
      const px = s.yesPrice != null ? `YES ${Math.round(s.yesPrice * 100)}¢` : "?";
      const status = s.closed ? `[CLOSED, resolved ${inferResolution(s)}]` : "[OPEN]";
      sections.push(`  - ${s.question}: ${px} ${status}`);
    }
  }

  // Semantic sibling search via pgvector cosine similarity on Market.embedding. Replaces the
  // old keyword-OR-scoring approach which struggled with common keywords ("United" pulling
  // sports markets) and missed lexical variants ("acquire" vs "purchase" vs "buy"). pgvector
  // returns true topic-relatives regardless of exact wording. Falls through silently if the
  // target market has no embedding yet (e.g. fresh ingest before backfill runs).
  const excludeIds = [...eventSiblings.map((s) => s.id), ...negRiskSiblings.map((s) => s.id)];
  const resolvedSiblings = await findSimilarClosedMarkets(market.id, { limit: 6, excludeIds });
  if (resolvedSiblings.length > 0) {
    if (sections.length > 0) sections.push("");
    sections.push("RECENTLY RESOLVED MARKETS WITH OVERLAPPING TOPIC (the resolver's revealed interpretation — trust precedent over textual reasoning):");
    for (const s of resolvedSiblings) {
      sections.push(`  - "${s.question}" → resolved ${inferResolution(s)}`);
    }
  }

  return sections.length === 0 ? "" : sections.join("\n") + "\n";
}

function inferResolution(market: Market): string {
  try {
    const prices = JSON.parse(market.outcomePrices) as string[];
    const p0 = parseFloat(prices?.[0] ?? "0");
    const p1 = parseFloat(prices?.[1] ?? "0");
    if (p0 >= 0.99) return "YES";
    if (p1 >= 0.99) return "NO";
    return `mixed (${prices?.join("/")})`;
  } catch {
    return "unknown";
  }
}

// (extractTopicKeywords + KEYWORD_STOP removed: replaced by semantic similarity via
// findSimilarClosedMarkets in src/lib/embeddings.ts. Markets are now matched by pgvector
// cosine distance on text-embedding-3-small embeddings rather than lexical keyword overlap.)

export async function buildVerifierUserMessage(market: Market): Promise<string> {
  const context = await buildMarketContext(market);
  const contextBlock = context
    ? `\nMARKET CONTEXT (related Polymarket data — use this to steelman the current market price):\n${context}\n`
    : "";
  return `${buildUserMessage(market)}
${contextBlock}
This is a SECOND-PASS analysis with web search and the sibling-market context above. Before scoring:
1. Web-search the named source, facts in the rules, and current events.
2. STEELMAN the market price using the context above and your web findings. Search for evidence that SUPPORTS the current market price, not only evidence against it.
3. If sibling pricing or resolved precedent supports the market, score divergence LOW (0-4) and edge_direction NONE — even if the rules text technically diverges from the vibe.

Then output IN THIS ORDER:
1. A "source_findings:" paragraph (2-4 sentences on what web search and sibling context revealed).
2. A "steelman:" paragraph (2-4 sentences making the strongest case the CURRENT market price is correct; if you cannot, say so explicitly).
3. The literal separator "---JSON---".
4. A single JSON object matching the analysis schema.

Format STRICTLY: source_findings + steelman BEFORE the separator. JSON ONLY after. No commentary after the JSON.`;
}

export async function submitHaikuBatch(markets: Market[], opts: { purpose?: string; model?: string } = {}): Promise<string> {
  if (!llmCallsEnabled()) throw new LLMDisabledError();
  if (markets.length === 0) throw new Error("no markets to submit");
  const client = anthropic();

  let model = opts.model;
  if (!model) {
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    // Guard against silent Haiku fallback when the operator has selected an OpenAI first-pass.
    // Anthropic batch can only run Anthropic models; scheduler should route to in-line for gpt5_4.
    if (settings?.firstPassModel === "gpt5_4") {
      throw new Error("submitHaikuBatch called with firstPassModel='gpt5_4'; use in-line runFirstPassAnalysis instead");
    }
    model = resolveFirstPassModel(settings?.firstPassModel);
  }

  const requests = markets.map((m) => ({
    custom_id: m.id,
    params: {
      model: model!,
      max_tokens: 1024,
      system: [{ type: "text" as const, text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } }],
      messages: [{ role: "user" as const, content: buildUserMessage(m) }],
    },
  }));

  const batch = await client.messages.batches.create({ requests });

  await prisma.batchJob.create({
    data: {
      anthropicBatchId: batch.id,
      status: batch.processing_status,
      purpose: opts.purpose ?? `first_pass_${model.includes("haiku") ? "haiku" : "sonnet"}`,
      marketIds: JSON.stringify(markets.map((m) => m.id)),
      totalRequests: markets.length,
    },
  });

  return batch.id;
}

// Per-market budget-gate estimate for Opus verifier with web_search. Calibrated against
// real Anthropic Console billing (2026-05-29 small + large calibration runs): real per-call
// floats $0.013-$0.0144 depending on web_search count and batch size. Gate at $0.03 gives
// ~2x headroom over the high end while leaving room for normal variability. Includes a 10%
// safety margin over CostLog estimates which tend to under-predict by 5-10%.
const VERIFIER_COST_ESTIMATE_PER_MARKET = 0.03;

export async function submitVerifierBatch(markets: Market[], opts: { purpose?: string } = {}): Promise<string> {
  if (!llmCallsEnabled()) throw new LLMDisabledError();
  if (markets.length === 0) throw new Error("no markets to submit");
  const remaining = await remainingBudgetUsd();
  const estimated = markets.length * VERIFIER_COST_ESTIMATE_PER_MARKET;
  if (remaining < estimated) {
    throw new Error(`budget gate: $${remaining.toFixed(2)} remaining < $${estimated.toFixed(2)} estimated for ${markets.length} markets`);
  }
  const client = anthropic();
  const model = VERIFIER_MODEL;

  const requests = await Promise.all(
    markets.map(async (m) => ({
      custom_id: m.id,
      params: {
        model,
        max_tokens: 3072,
        system: [{ type: "text" as const, text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 } as never],
        messages: [{ role: "user" as const, content: await buildVerifierUserMessage(m) }],
      },
    })),
  );

  const batch = await client.messages.batches.create({ requests });

  await prisma.batchJob.create({
    data: {
      anthropicBatchId: batch.id,
      status: batch.processing_status,
      purpose: opts.purpose ?? VERIFIER_PURPOSE,
      marketIds: JSON.stringify(markets.map((m) => m.id)),
      totalRequests: markets.length,
    },
  });

  return batch.id;
}

/**
 * Submit an OBVIOUS-BET batch (world-state mispricing pass). Runs Opus 4.7 + web_search on
 * the same kind of input as the verifier but with a different system prompt focused on
 * "is the current world state already determining the outcome?" rather than "do the rules
 * have a gap?" Output schema is different (ObviousBetSchema) and ingestion writes
 * Analysis rows with pass='obvious'.
 *
 * No sibling-market context in the user message — the obvious-bets prompt deliberately
 * looks at primary sources, not at sibling Polymarket pricing.
 */
export async function submitObviousBatch(markets: Market[], opts: { purpose?: string } = {}): Promise<string> {
  if (!llmCallsEnabled()) throw new LLMDisabledError();
  if (markets.length === 0) throw new Error("no markets to submit");
  const remaining = await remainingBudgetUsd();
  const estimated = markets.length * VERIFIER_COST_ESTIMATE_PER_MARKET;
  if (remaining < estimated) {
    throw new Error(`budget gate: $${remaining.toFixed(2)} remaining < $${estimated.toFixed(2)} estimated for ${markets.length} markets`);
  }
  const client = anthropic();
  const model = VERIFIER_MODEL;

  const requests = markets.map((m) => ({
    custom_id: m.id,
    params: {
      model,
      max_tokens: 2048,
      system: [{ type: "text" as const, text: OBVIOUS_SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 } as never],
      messages: [{ role: "user" as const, content: buildUserMessage(m) }],
    },
  }));

  const batch = await client.messages.batches.create({ requests });

  await prisma.batchJob.create({
    data: {
      anthropicBatchId: batch.id,
      status: batch.processing_status,
      purpose: opts.purpose ?? OBVIOUS_PURPOSE,
      marketIds: JSON.stringify(markets.map((m) => m.id)),
      totalRequests: markets.length,
    },
  });

  return batch.id;
}

export async function pollAndIngestBatches(): Promise<{ checked: number; ingested: number }> {
  const inflight = await prisma.batchJob.findMany({
    where: { status: { in: ["submitted", "in_progress", "canceling"] } },
  });
  if (inflight.length === 0) return { checked: 0, ingested: 0 };

  const client = anthropic();
  let ingested = 0;

  for (const job of inflight) {
    try {
      const batch = await client.messages.batches.retrieve(job.anthropicBatchId);
      if (batch.processing_status !== "ended") {
        await prisma.batchJob.update({
          where: { id: job.id },
          data: { status: batch.processing_status },
        });
        continue;
      }

      const ingestedCount = await ingestBatchResults(job.id, job.anthropicBatchId, job.purpose);
      ingested += ingestedCount;
    } catch (err) {
      console.error(`[batch ${job.anthropicBatchId}] poll failed:`, String(err).slice(0, 200));
      // Don't mark "error" — could be transient (network blip, Anthropic 5xx).
      // Leave status so next poll retries. Record the error for visibility.
      await prisma.batchJob.update({
        where: { id: job.id },
        data: { errors: String(err).slice(0, 500) },
      });
    }
  }
  return { checked: inflight.length, ingested };
}

async function ingestBatchResults(jobId: string, anthropicBatchId: string, purpose: string): Promise<number> {
  const client = anthropic();
  const stream = await client.messages.batches.results(anthropicBatchId);
  const isVerifier = purpose === VERIFIER_PURPOSE;
  const isObvious = purpose === OBVIOUS_PURPOSE;
  const pass: "haiku" | "opus" | "obvious" = isObvious ? "obvious" : isVerifier ? "opus" : "haiku";

  let succeeded = 0;
  let failed = 0;
  let totalCost = 0;

  for await (const entry of stream) {
    const marketId = entry.custom_id;
    const market = await prisma.market.findUnique({ where: { id: marketId } });
    if (!market) {
      failed++;
      continue;
    }

    if (entry.result.type !== "succeeded") {
      failed++;
      if (isVerifier) await prisma.market.update({ where: { id: market.id }, data: { verifyFailures: { increment: 1 } } });
      console.error(`[batch ${anthropicBatchId}] market ${marketId} ${entry.result.type}`);
      continue;
    }

    const message = entry.result.message;
    const usage = extractUsage(message.usage);
    const model = message.model || (isVerifier || isObvious ? VERIFIER_MODEL : HAIKU_MODEL);

    let webSearches = 0;
    if (isVerifier || isObvious) {
      for (const c of message.content) {
        const anyC = c as unknown as { type?: string; name?: string };
        if (anyC.type === "server_tool_use" && anyC.name === "web_search") webSearches++;
      }
    }
    const extraUsd = webSearches * WEB_SEARCH_COST_PER_CALL;

    const discountedCost = await logCost({
      model,
      purpose: `${purpose}_batch`,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      discountFactor: BATCH_DISCOUNT,
      extraUsd,
    });
    totalCost += discountedCost;

    const textBlocks = message.content.filter((c) => c.type === "text") as { type: "text"; text: string }[];
    const fullText = textBlocks.map((t) => t.text).join("\n");
    if (!fullText.trim()) {
      failed++;
      if (isVerifier) await prisma.market.update({ where: { id: market.id }, data: { verifyFailures: { increment: 1 } } });
      continue;
    }

    // OBVIOUS pass writes Analysis rows using a different schema. We map ObviousBet fields onto
    // the existing Analysis columns:
    //   divergenceScore         <- confidence (0-10)
    //   ruleImpliedProbability  <- true_p_yes
    //   edgeDirection           <- obvious_bet_side
    //   sourceFindings          <- source_findings paragraph
    //   verificationSteps       <- JSON-stringified key_facts
    //   divergenceType          <- "world_state" (fixed sentinel)
    // The vibe/literal interpretation fields are populated with terse market-price-vs-truth
    // statements so the existing UI doesn't render blanks.
    if (isObvious) {
      let parsed;
      try {
        parsed = ObviousBetSchema.parse(tryParseJson(fullText));
      } catch (e) {
        failed++;
        console.error(`[batch ${anthropicBatchId}] obvious parse fail ${marketId}:`, String(e).slice(0, 200));
        continue;
      }

      // Defense-in-depth: the prompt says clamp to NONE when confidence < 5 OR the gap
      // |true_p_yes - market_yes_price| < 0.20. Enforce both server-side in case the model
      // strays. SpaceX example 2026-05-29 — model returned obvious=NONE with conf 7 because
      // the gap was only 3pp; without enforcement the EV math would still surface a YES bet.
      const trueP = parsed.true_p_yes ?? market.yesPrice ?? 0.5;
      const marketYes = market.yesPrice ?? 0.5;
      const gap = Math.abs(trueP - marketYes);
      const betSideRaw = (parsed.confidence < 5 || gap < 0.20) ? "NONE" : parsed.obvious_bet_side;
      const expectedYesPayoutCents = parsed.true_p_yes != null ? parsed.true_p_yes * 100 : null;
      const expectedNoPayoutCents = parsed.true_p_yes != null ? (1 - parsed.true_p_yes) * 100 : null;

      const scored = computeEdge({
        divergenceScore: parsed.confidence,
        edgeDirection: betSideRaw,
        yesPrice: market.yesPrice,
        noPrice: market.noPrice,
        liquidity: market.liquidity,
        endDate: market.endDate,
        ruleImpliedProbability: parsed.true_p_yes,
        expectedYesPayoutCents,
        expectedNoPayoutCents,
        pass: "opus", // scoring rubric: treat obvious like a verified-quality signal
      });

      const yesMarketPct = market.yesPrice != null ? (market.yesPrice * 100).toFixed(1) : "?";
      const truePct = parsed.true_p_yes != null ? (parsed.true_p_yes * 100).toFixed(1) : "?";

      // When the model intent is NONE (no actionable mispricing), force betSide to NONE and
      // zero the edgeScore. computeEdge otherwise sets betSide from EV math and can produce
      // a "Buy YES at 90¢ for +3% return" recommendation even when the model intentionally
      // declined to flag the market. The model's verdict is authoritative for obvious-pass.
      const finalBetSide = betSideRaw === "NONE" ? "NONE" : scored.betSide;
      const finalEdgeScore = betSideRaw === "NONE" ? 0 : scored.edgeScore;

      await prisma.analysis.create({
        data: {
          marketId: market.id,
          rulesHash: market.rulesHash,
          pass: "obvious",
          model,
          vibeInterpretation: `Market prices YES at ${yesMarketPct}%`,
          literalInterpretation: `World-state evidence suggests YES at ${truePct}%`,
          divergenceType: "world_state",
          divergenceScore: parsed.confidence,
          edgeDirection: betSideRaw,
          ruleImpliedProbability: parsed.true_p_yes,
          expectedYesPayoutCents,
          expectedNoPayoutCents,
          verificationSteps: JSON.stringify(parsed.key_facts),
          reasoning: parsed.reasoning,
          sourceFindings: parsed.source_findings || null,
          yesPriceAtAnalysis: market.yesPrice,
          noPriceAtAnalysis: market.noPrice,
          liquidityAtAnalysis: market.liquidity,
          edgeScore: finalEdgeScore,
          betSide: finalBetSide,
          priceGap: scored.priceGap,
          directionAgreement: scored.directionAgreement,
          costUsd: discountedCost,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheCreationTokens: usage.cacheCreationTokens,
        },
      });
      succeeded++;
      continue;
    }

    let parsed;
    let sourceFindings: string | null = null;

    if (isVerifier) {
      const parts = fullText.split(/---\s*JSON\s*---/i);
      let jsonText: string;
      if (parts.length >= 2) {
        sourceFindings = parts[0].trim() || null;
        jsonText = parts.slice(1).join("\n").trim();
      } else {
        const jsonStart = fullText.lastIndexOf("{");
        sourceFindings = jsonStart > 0 ? fullText.slice(0, jsonStart).trim() || null : null;
        jsonText = jsonStart >= 0 ? fullText.slice(jsonStart) : fullText;
      }
      try {
        parsed = AnalysisSchema.parse(tryParseJson(jsonText));
      } catch (e) {
        failed++;
        await prisma.market.update({ where: { id: market.id }, data: { verifyFailures: { increment: 1 } } });
        console.error(`[batch ${anthropicBatchId}] verifier parse fail ${marketId}:`, String(e).slice(0, 200));
        continue;
      }
    } else {
      try {
        parsed = AnalysisSchema.parse(tryParseJson(fullText));
      } catch {
        failed++;
        continue;
      }
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
      pass: pass as "haiku" | "opus",
    });

    await prisma.analysis.create({
      data: {
        marketId: market.id,
        rulesHash: market.rulesHash,
        pass,
        model,
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
        costUsd: discountedCost,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
      },
    });
    if (isVerifier && market.verifyFailures > 0) {
      await prisma.market.update({ where: { id: market.id }, data: { verifyFailures: 0 } });
    }
    succeeded++;
  }

  await prisma.batchJob.update({
    where: { id: jobId },
    data: {
      status: "ended",
      endedAt: new Date(),
      succeededRequests: succeeded,
      failedRequests: failed,
      costUsd: totalCost,
    },
  });

  return succeeded;
}

export async function pickMarketsForBatch(limit = 2000, opts: { force?: boolean; matchModel?: string } = {}): Promise<Market[]> {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const minLiq = settings?.minLiquidityUsd ?? 5000;
  const activeModel = opts.matchModel ?? resolveFirstPassModel(settings?.firstPassModel);

  const inflightIds = await inflightMarketIds(FIRST_PASS_PURPOSES);

  const markets = await prisma.market.findMany({
    where: {
      active: true,
      closed: false,
      liquidity: { gte: minLiq },
      OR: [{ endDate: null }, { endDate: { gt: new Date() } }],
      AND: PRICE_LIVE_FILTER,
    },
    include: { analyses: { where: { pass: "haiku" }, orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { liquidity: "desc" },
    take: 5000,
  });

  const needed = (opts.force ? markets : markets.filter((m) => {
    const last = m.analyses[0];
    if (!last) return true;
    if (last.rulesHash !== m.rulesHash) return true;
    if (last.model !== activeModel) return true;
    const ageH = (Date.now() - last.createdAt.getTime()) / (1000 * 60 * 60);
    return ageH > 24;
  })).filter((m) => !inflightIds.has(m.id));

  return needed.slice(0, limit);
}

/**
 * Pick markets for the Opus + web_search "first-pass" (Scenario A). Unlike pickMarketsForBatch
 * (Sonnet-style triage) and pickMarketsForVerifierBatch (escalation-based), this picks ALL
 * eligible markets ranked by prefilter score + liquidity. We rely on the prefilter and liquidity
 * floor to bound volume — there's no separate first-pass to gate against.
 *
 * Recency check looks for any Opus analysis matching the current rulesHash within 24h.
 */
export async function pickMarketsForOpusFirstPass(limit = 2000): Promise<Market[]> {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const minLiq = settings?.minLiquidityUsd ?? 10000;
  const inflightIds = await inflightMarketIds(new Set([VERIFIER_PURPOSE]));

  const { prefilter } = await import("./prefilter");

  const markets = await prisma.market.findMany({
    where: {
      active: true,
      closed: false,
      liquidity: { gte: minLiq },
      OR: [{ endDate: null }, { endDate: { gt: new Date() } }],
      AND: PRICE_LIVE_FILTER,
    },
    include: { analyses: { where: { pass: "opus" }, orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { liquidity: "desc" },
    take: 10000,
  });

  const ranked = markets
    .filter((m) => !inflightIds.has(m.id))
    .filter((m) => {
      const last = m.analyses[0];
      if (!last) return true;
      if (last.rulesHash !== m.rulesHash) return true;
      const ageH = (Date.now() - last.createdAt.getTime()) / (1000 * 60 * 60);
      return ageH > 24;
    })
    .map((m) => ({ market: m, pre: prefilter(m) }))
    .filter((x) => x.pre.pass)
    .sort((a, b) => b.pre.score - a.pre.score || b.market.liquidity - a.market.liquidity);

  return ranked.slice(0, limit).map((x) => x.market);
}

export async function pickMarketsForVerifierBatch(limit = 100, opts: { force?: boolean } = {}): Promise<Market[]> {
  const inflightIds = await inflightMarketIds(new Set([VERIFIER_PURPOSE]));

  const candidates = await prisma.market.findMany({
    where: {
      active: true,
      closed: false,
      verifyFailures: { lt: 3 },
      OR: [{ endDate: null }, { endDate: { gt: new Date() } }],
      AND: PRICE_LIVE_FILTER,
      analyses: {
        some: { pass: "haiku", divergenceScore: { gte: 5 }, edgeScore: { gte: 20 } },
      },
    },
    include: { analyses: { orderBy: { createdAt: "desc" } } },
    take: 1000,
  });

  return candidates
    .map((m) => {
      const latestHaiku = m.analyses.find((a) => a.pass === "haiku");
      const latestOpus = m.analyses.find((a) => a.pass === "opus");
      return { market: m, latestHaiku, latestOpus };
    })
    .filter(({ market, latestHaiku, latestOpus }) => {
      if (inflightIds.has(market.id)) return false;
      if (!latestHaiku) return false;
      if (latestHaiku.divergenceScore < 5 || latestHaiku.edgeScore < 20) return false;
      if (latestHaiku.rulesHash !== market.rulesHash) return false;
      if (opts.force) return true;
      if (!latestOpus) return true;
      if (latestOpus.rulesHash !== market.rulesHash) return true;
      if (latestOpus.model !== VERIFIER_MODEL) return true;
      return latestHaiku.createdAt.getTime() > latestOpus.createdAt.getTime();
    })
    .sort((a, b) => (b.latestHaiku?.edgeScore ?? 0) - (a.latestHaiku?.edgeScore ?? 0))
    .slice(0, limit)
    .map(({ market }) => market);
}

async function inflightMarketIds(purposes: Set<string>): Promise<Set<string>> {
  const jobs = await prisma.batchJob.findMany({
    where: {
      status: { in: ["submitted", "in_progress", "canceling"] },
      purpose: { in: Array.from(purposes) },
    },
    select: { marketIds: true },
  });
  const ids = new Set<string>();
  for (const j of jobs) {
    try {
      const arr = JSON.parse(j.marketIds) as string[];
      for (const id of arr) ids.add(id);
    } catch (e) {
      console.error(`[inflightMarketIds] malformed marketIds JSON in BatchJob; skipping. Will cause duplicate submission risk:`, String(e).slice(0, 200));
    }
  }
  return ids;
}
