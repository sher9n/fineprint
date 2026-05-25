import { prisma } from "./prisma";
import { anthropic, HAIKU_MODEL, VERIFIER_MODEL, extractUsage, resolveFirstPassModel } from "./anthropic";
import { logCost, WEB_SEARCH_COST_PER_CALL, remainingBudgetUsd } from "./budget";
import { computeEdge } from "./scoring";
import { AnalysisSchema, SYSTEM_PROMPT, buildUserMessage, tryParseJson } from "./analyzer";
import type { Market } from "@prisma/client";

const BATCH_DISCOUNT = 0.5;
const VERIFIER_PURPOSE = "verifier_pass";
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

  const keywords = extractTopicKeywords(`${market.question} ${market.description}`);
  if (keywords.length > 0) {
    const seenIds = new Set([market.id, ...eventSiblings.map((s) => s.id), ...negRiskSiblings.map((s) => s.id)]);
    const resolvedSiblings = await prisma.market.findMany({
      where: {
        closed: true,
        id: { notIn: Array.from(seenIds) },
        OR: keywords.slice(0, 5).map((kw) => ({ question: { contains: kw, mode: "insensitive" as const } })),
      },
      orderBy: { updatedAt: "desc" },
      take: 6,
    });
    if (resolvedSiblings.length > 0) {
      if (sections.length > 0) sections.push("");
      sections.push("RECENTLY RESOLVED MARKETS WITH OVERLAPPING TOPIC (the resolver's revealed interpretation — trust precedent over textual reasoning):");
      for (const s of resolvedSiblings) {
        sections.push(`  - "${s.question}" → resolved ${inferResolution(s)}`);
      }
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

function extractTopicKeywords(text: string): string[] {
  const stop = new Set(["This", "That", "Will", "With", "From", "Resolution", "Polymarket", "Source", "Resolves", "Yes", "No", "Other", "Market", "Trade", "Date", "Time"]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[^A-Za-z]+/)) {
    if (raw.length < 4) continue;
    if (!/^[A-Z]/.test(raw)) continue;
    if (stop.has(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
    if (out.length >= 8) break;
  }
  return out;
}

async function buildVerifierUserMessage(market: Market): Promise<string> {
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
  if (markets.length === 0) throw new Error("no markets to submit");
  const client = anthropic();

  let model = opts.model;
  if (!model) {
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
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

const VERIFIER_COST_ESTIMATE_PER_MARKET = 0.30;

export async function submitVerifierBatch(markets: Market[], opts: { purpose?: string } = {}): Promise<string> {
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
  const pass: "haiku" | "opus" = isVerifier ? "opus" : "haiku";

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
    const model = message.model || (isVerifier ? VERIFIER_MODEL : HAIKU_MODEL);

    let webSearches = 0;
    if (isVerifier) {
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
      pass,
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
