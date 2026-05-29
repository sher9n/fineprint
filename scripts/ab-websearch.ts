/**
 * Web-search comparison: re-run the same 198 markets from the unbiased test with web_search
 * enabled on Sonnet 4.6 (Anthropic batch) and GPT-5.4 flex (OpenAI Responses API). Compare
 * against the existing Opus ground truth.
 *
 * Uses the verifier-style prompt (with sibling-market context) so the comparison is apples-to-
 * apples with how Opus was actually run.
 *
 * Run:
 *   DATABASE_URL='<railway>' npx tsx scripts/ab-websearch.ts <prior-unbiased-report.json>
 */
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import { prisma } from "../src/lib/prisma";
import {
  SYSTEM_PROMPT,
  AnalysisSchema,
  tryParseJson,
  type AnalysisJson,
} from "../src/lib/analyzer";
import { buildVerifierUserMessage } from "../src/lib/batch";
import { computeCost, WEB_SEARCH_COST_PER_CALL } from "../src/lib/budget";
import type { Market } from "@prisma/client";

const priorReportPath = process.argv[2];
if (!priorReportPath) {
  console.error("usage: tsx scripts/ab-websearch.ts <prior-unbiased-report.json>");
  process.exit(1);
}

const SONNET_MODEL = "claude-sonnet-4-6";
const GPT_MODEL = "gpt-5.4";
const OPUS_MODEL = "claude-opus-4-7"; // ground truth, not re-run
const OPENAI_CONCURRENCY = Number(process.env.AB_OPENAI_CONCURRENCY ?? 6);
const MAX_RETRIES = 5;
const OPENAI_WEB_SEARCH_COST_PER_CALL = 0.025; // OpenAI's web_search_preview pricing

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 2 });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

interface ModelResult {
  marketId: string;
  ok: boolean;
  error?: string;
  analysis?: AnalysisJson;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  modelReturned?: string;
  latencyMs?: number;
  retries?: number;
  webSearches?: number;
}

async function pollBatch(batchId: string, label: string): Promise<void> {
  let status = "in_progress";
  let polls = 0;
  while (status !== "ended") {
    await new Promise((r) => setTimeout(r, 20_000));
    polls++;
    try {
      const cur = await anthropic.messages.batches.retrieve(batchId);
      status = cur.processing_status;
      const c = cur.request_counts;
      console.log(`[${label}] poll ${polls} status=${status} succeeded=${c.succeeded} processing=${c.processing} errored=${c.errored}`);
    } catch (e) {
      console.warn(`[${label}] poll ${polls} retrieve failed: ${(e as Error).message.slice(0, 100)}`);
    }
  }
}

function parseVerifierText(fullText: string): AnalysisJson | undefined {
  const parts = fullText.split(/---\s*JSON\s*---/i);
  const jsonText = parts.length >= 2 ? parts.slice(1).join("\n").trim() : fullText;
  try {
    return AnalysisSchema.parse(tryParseJson(jsonText));
  } catch {
    return undefined;
  }
}

async function runSonnetWebSearchBatch(markets: Market[]): Promise<Map<string, ModelResult>> {
  console.log(`[sonnet+ws] building verifier prompts for ${markets.length} markets...`);
  const requests = await Promise.all(
    markets.map(async (m) => ({
      custom_id: m.id,
      params: {
        model: SONNET_MODEL,
        max_tokens: 3072,
        system: [{ type: "text" as const, text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 } as any],
        messages: [{ role: "user" as const, content: await buildVerifierUserMessage(m) }],
      },
    })),
  );
  console.log(`[sonnet+ws] submitting batch...`);
  const batch = await anthropic.messages.batches.create({ requests });
  console.log(`[sonnet+ws] batch ${batch.id}`);
  await pollBatch(batch.id, "sonnet+ws");

  const stream = await anthropic.messages.batches.results(batch.id);
  const out = new Map<string, ModelResult>();
  for await (const entry of stream) {
    if (entry.result.type !== "succeeded") {
      out.set(entry.custom_id, { marketId: entry.custom_id, ok: false, error: `type=${entry.result.type}`, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });
      continue;
    }
    const msg = entry.result.message;
    const textBlocks = msg.content.filter((c: { type: string }) => c.type === "text") as { type: "text"; text: string }[];
    const fullText = textBlocks.map((t) => t.text).join("\n");
    let webSearches = 0;
    for (const c of msg.content) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyC = c as any;
      if (anyC.type === "server_tool_use" && anyC.name === "web_search") webSearches++;
    }
    const parsed = parseVerifierText(fullText);
    const u = msg.usage;
    const usage = { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0, cacheReadTokens: u.cache_read_input_tokens ?? 0, cacheCreationTokens: u.cache_creation_input_tokens ?? 0 };
    const cost = computeCost(SONNET_MODEL, usage) * 0.5 + webSearches * WEB_SEARCH_COST_PER_CALL;
    out.set(entry.custom_id, { marketId: entry.custom_id, ok: !!parsed, error: parsed ? undefined : "parse fail", analysis: parsed, costUsd: cost, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheReadTokens: usage.cacheReadTokens, modelReturned: msg.model, webSearches });
  }
  console.log(`[sonnet+ws] parsed ${[...out.values()].filter((r) => r.ok).length}/${out.size}`);
  return out;
}

async function runGptWebSearchConcurrent(markets: Market[]): Promise<Map<string, ModelResult>> {
  console.log(`[gpt5_4+ws] running ${markets.length} concurrent (max ${OPENAI_CONCURRENCY}, retries=${MAX_RETRIES})...`);
  const out = new Map<string, ModelResult>();
  let nextIdx = 0;
  let done = 0;
  let recovered = 0;
  const start = Date.now();

  async function callOnce(market: Market): Promise<ModelResult> {
    const t0 = Date.now();
    let lastErr: { status?: number; message?: string } | null = null;
    const userMsg = await buildVerifierUserMessage(market);
    const input = `${SYSTEM_PROMPT}\n\n${userMsg}`;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = (await openai.responses.create({
          model: GPT_MODEL,
          service_tier: "flex",
          input,
          tools: [{ type: "web_search_preview" } as never],
        })) as any;
        if (attempt > 0) recovered++;
        const text = String(res.output_text ?? "");
        let webSearches = 0;
        if (Array.isArray(res.output)) {
          webSearches = res.output.filter((x: { type: string }) => x.type === "web_search_call").length;
        }
        const parsed = parseVerifierText(text);
        const promptTokens = res.usage?.input_tokens ?? 0;
        const cached = res.usage?.input_tokens_details?.cached_tokens ?? 0;
        const completion = res.usage?.output_tokens ?? 0;
        const usage = { inputTokens: Math.max(0, promptTokens - cached), outputTokens: completion, cacheReadTokens: cached, cacheCreationTokens: 0 };
        const cost = computeCost(GPT_MODEL, usage) * 0.5 + webSearches * OPENAI_WEB_SEARCH_COST_PER_CALL;
        return { marketId: market.id, ok: !!parsed, error: parsed ? undefined : "parse fail", analysis: parsed, costUsd: cost, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheReadTokens: usage.cacheReadTokens, modelReturned: res.model, latencyMs: Date.now() - t0, retries: attempt, webSearches };
      } catch (e) {
        const ex = e as { status?: number; message?: string };
        lastErr = ex;
        const retryable = ex.status === 429 || (ex.status != null && ex.status >= 500);
        if (!retryable || attempt === MAX_RETRIES - 1) break;
        const wait = 1000 * Math.pow(2, attempt) + Math.random() * 500;
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    return { marketId: market.id, ok: false, error: `${lastErr?.status ?? "?"} ${(lastErr?.message ?? "unknown").slice(0, 200)}`, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, latencyMs: Date.now() - t0, retries: MAX_RETRIES };
  }

  async function worker(id: number) {
    while (true) {
      const idx = nextIdx++;
      if (idx >= markets.length) return;
      const r = await callOnce(markets[idx]);
      out.set(markets[idx].id, r);
      done++;
      if (done % 10 === 0 || done === markets.length) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(0);
        console.log(`[gpt5_4+ws] worker ${id}: ${done}/${markets.length} done (${elapsed}s, recovered=${recovered})`);
      }
    }
  }
  await Promise.all(Array.from({ length: OPENAI_CONCURRENCY }, (_, i) => worker(i + 1)));
  console.log(`[gpt5_4+ws] all ${out.size} done in ${((Date.now() - start) / 1000).toFixed(0)}s`);
  return out;
}

// Metrics
function isFlagged(divergenceScore: number, ruleP: number | null, yesPrice: number | null): boolean {
  if (divergenceScore < 5) return false;
  if (ruleP == null || yesPrice == null) return false;
  return Math.abs(ruleP - yesPrice) * 100 >= 20;
}

function pearson(xs: number[], ys: number[]): number {
  if (xs.length === 0) return 0;
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; denX += dx * dx; denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

interface PriorOpusResult {
  marketId: string;
  ok: boolean;
  analysis?: AnalysisJson;
  costUsd: number;
}

interface PriorEntry {
  marketId: string;
  question: string;
  yesPrice: number | null;
  band: string;
  prefilterScore: number;
  opus?: PriorOpusResult;
  sonnet?: { ok: boolean; analysis?: AnalysisJson; costUsd: number };
  gpt5_4?: { ok: boolean; analysis?: AnalysisJson; costUsd: number };
}

function computeMetricsAgainstOpus(label: string, results: Map<string, ModelResult>, prior: PriorEntry[]) {
  let ok = 0, failed = 0;
  let tp = 0, fp = 0, tn = 0, fn = 0;
  let dirAgree = 0, dirCount = 0;
  const rulePDeltas: number[] = [];
  const cDivs: number[] = [];
  const oDivs: number[] = [];
  let totalCost = 0, totalLatency = 0, latencyCount = 0;
  let totalWebSearches = 0;

  for (const e of prior) {
    const candidate = results.get(e.marketId);
    if (candidate) {
      totalCost += candidate.costUsd;
      if (candidate.latencyMs != null) { totalLatency += candidate.latencyMs; latencyCount++; }
      if (candidate.webSearches != null) totalWebSearches += candidate.webSearches;
    }
    const opus = e.opus;
    if (!opus?.ok || !opus.analysis) continue;
    if (!candidate || !candidate.ok || !candidate.analysis) { failed++; continue; }
    ok++;
    const ca = candidate.analysis, oa = opus.analysis;
    const cFlag = isFlagged(ca.divergence_score, ca.rule_implied_probability, e.yesPrice);
    const oFlag = isFlagged(oa.divergence_score, oa.rule_implied_probability, e.yesPrice);
    if (oFlag && cFlag) tp++;
    else if (!oFlag && cFlag) fp++;
    else if (!oFlag && !cFlag) tn++;
    else fn++;
    if (oa.edge_direction !== "NONE" && ca.edge_direction !== "NONE") {
      dirCount++;
      if (oa.edge_direction === ca.edge_direction) dirAgree++;
    }
    if (oa.rule_implied_probability != null && ca.rule_implied_probability != null) {
      rulePDeltas.push(Math.abs(oa.rule_implied_probability - ca.rule_implied_probability));
    }
    cDivs.push(ca.divergence_score);
    oDivs.push(oa.divergence_score);
  }

  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const dirAgreement = dirCount === 0 ? 0 : dirAgree / dirCount;
  const rulePMae = rulePDeltas.length === 0 ? 0 : rulePDeltas.reduce((a, b) => a + b, 0) / rulePDeltas.length;
  const divCorr = pearson(cDivs, oDivs);
  const divDeltas = cDivs.map((d, i) => Math.abs(d - oDivs[i]));
  const divMae = divDeltas.length === 0 ? 0 : divDeltas.reduce((a, b) => a + b, 0) / divDeltas.length;

  return {
    label, ok, failed,
    flagAgreement: { tp, fp, tn, fn },
    precision, recall, f1,
    directionAgreement: dirAgreement,
    rulePMae, divScoreCorrelation: divCorr, divScoreMae: divMae,
    totalCostUsd: totalCost,
    avgCostUsd: ok + failed === 0 ? 0 : totalCost / (ok + failed),
    avgLatencyMs: latencyCount === 0 ? undefined : totalLatency / latencyCount,
    totalWebSearches,
    avgWebSearches: ok + failed === 0 ? 0 : totalWebSearches / (ok + failed),
  };
}

function printMetrics(m: ReturnType<typeof computeMetricsAgainstOpus>) {
  console.log(`\n=== ${m.label} ===`);
  console.log(`  parsed:                ${m.ok}/${m.ok + m.failed}`);
  console.log(`  precision vs opus:     ${(m.precision * 100).toFixed(1)}%   (tp=${m.flagAgreement.tp} fp=${m.flagAgreement.fp})`);
  console.log(`  recall vs opus:        ${(m.recall * 100).toFixed(1)}%   (tp=${m.flagAgreement.tp} fn=${m.flagAgreement.fn})`);
  console.log(`  F1:                    ${(m.f1 * 100).toFixed(1)}%`);
  console.log(`  direction agreement:   ${(m.directionAgreement * 100).toFixed(1)}%`);
  console.log(`  rule_p MAE:            ${m.rulePMae.toFixed(3)}`);
  console.log(`  div_score Pearson r:   ${m.divScoreCorrelation.toFixed(3)}`);
  console.log(`  div_score MAE:         ${m.divScoreMae.toFixed(2)}`);
  console.log(`  total cost:            $${m.totalCostUsd.toFixed(3)}`);
  console.log(`  avg cost per call:     $${m.avgCostUsd.toFixed(4)}`);
  console.log(`  avg web searches:      ${m.avgWebSearches.toFixed(2)}`);
  if (m.avgLatencyMs != null) console.log(`  avg latency:           ${(m.avgLatencyMs / 1000).toFixed(1)}s`);
}

async function main() {
  console.log(`[ab-websearch] loading prior report: ${priorReportPath}`);
  const prior = JSON.parse(fs.readFileSync(priorReportPath, "utf-8")) as { perMarket: PriorEntry[] };
  const marketIds = prior.perMarket.map((e) => e.marketId);
  console.log(`[ab-websearch] ${marketIds.length} markets in prior report`);

  const markets = await prisma.market.findMany({ where: { id: { in: marketIds } } });
  console.log(`[ab-websearch] fetched ${markets.length} market rows`);
  const marketsById = new Map(markets.map((m) => [m.id, m]));
  const ordered = marketIds.map((id) => marketsById.get(id)).filter((m): m is Market => !!m);
  console.log(`[ab-websearch] ${ordered.length} markets after ordering match\n`);

  const [sonnetResults, gptResults] = await Promise.all([
    runSonnetWebSearchBatch(ordered),
    runGptWebSearchConcurrent(ordered),
  ]);

  const sonnetWsMetrics = computeMetricsAgainstOpus("Sonnet 4.6 + web_search (batch, verifier prompt)", sonnetResults, prior.perMarket);
  const gptWsMetrics = computeMetricsAgainstOpus("GPT-5.4 + web_search (flex, verifier prompt)", gptResults, prior.perMarket);
  printMetrics(sonnetWsMetrics);
  printMetrics(gptWsMetrics);

  // Compare with prior (no-web-search) results
  console.log(`\n=== HEAD TO HEAD (incl. prior no-ws results) ===`);
  const priorSonnet = computeMetricsAgainstOpus("Sonnet (no ws, prior)", new Map(prior.perMarket.map((e) => [e.marketId, { marketId: e.marketId, ok: e.sonnet?.ok ?? false, analysis: e.sonnet?.analysis, costUsd: e.sonnet?.costUsd ?? 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }])), prior.perMarket);
  const priorGpt = computeMetricsAgainstOpus("GPT-5.4 (no ws, prior)", new Map(prior.perMarket.map((e) => [e.marketId, { marketId: e.marketId, ok: e.gpt5_4?.ok ?? false, analysis: e.gpt5_4?.analysis, costUsd: e.gpt5_4?.costUsd ?? 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }])), prior.perMarket);
  console.log(`F1 (vs Opus):       Sonnet no-ws ${(priorSonnet.f1 * 100).toFixed(1)}%  Sonnet+ws ${(sonnetWsMetrics.f1 * 100).toFixed(1)}%   |   GPT no-ws ${(priorGpt.f1 * 100).toFixed(1)}%  GPT+ws ${(gptWsMetrics.f1 * 100).toFixed(1)}%`);
  console.log(`Precision:          Sonnet no-ws ${(priorSonnet.precision * 100).toFixed(1)}%  Sonnet+ws ${(sonnetWsMetrics.precision * 100).toFixed(1)}%   |   GPT no-ws ${(priorGpt.precision * 100).toFixed(1)}%  GPT+ws ${(gptWsMetrics.precision * 100).toFixed(1)}%`);
  console.log(`Recall:             Sonnet no-ws ${(priorSonnet.recall * 100).toFixed(1)}%  Sonnet+ws ${(sonnetWsMetrics.recall * 100).toFixed(1)}%   |   GPT no-ws ${(priorGpt.recall * 100).toFixed(1)}%  GPT+ws ${(gptWsMetrics.recall * 100).toFixed(1)}%`);
  console.log(`Direction agree:    Sonnet no-ws ${(priorSonnet.directionAgreement * 100).toFixed(1)}%  Sonnet+ws ${(sonnetWsMetrics.directionAgreement * 100).toFixed(1)}%   |   GPT no-ws ${(priorGpt.directionAgreement * 100).toFixed(1)}%  GPT+ws ${(gptWsMetrics.directionAgreement * 100).toFixed(1)}%`);
  console.log(`rule_p MAE:         Sonnet no-ws ${priorSonnet.rulePMae.toFixed(3)}  Sonnet+ws ${sonnetWsMetrics.rulePMae.toFixed(3)}   |   GPT no-ws ${priorGpt.rulePMae.toFixed(3)}  GPT+ws ${gptWsMetrics.rulePMae.toFixed(3)}`);
  console.log(`Cost per call:      Sonnet+ws $${sonnetWsMetrics.avgCostUsd.toFixed(4)}  GPT+ws $${gptWsMetrics.avgCostUsd.toFixed(4)}  (Opus baseline ~$0.21)`);

  // Save
  const outDir = path.join(process.cwd(), "eval-output");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(outDir, `ab-websearch-${stamp}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        priorReport: priorReportPath,
        config: { sonnetModel: SONNET_MODEL, gptModel: GPT_MODEL, opusModel: OPUS_MODEL, openaiConcurrency: OPENAI_CONCURRENCY, maxRetries: MAX_RETRIES, openaiWsCostPerCall: OPENAI_WEB_SEARCH_COST_PER_CALL },
        metrics: { sonnet_ws: sonnetWsMetrics, gpt5_4_ws: gptWsMetrics, sonnet_prior: priorSonnet, gpt5_4_prior: priorGpt },
        perMarket: prior.perMarket.map((e) => ({
          marketId: e.marketId,
          question: e.question,
          yesPrice: e.yesPrice,
          band: e.band,
          opus: e.opus,
          sonnet_no_ws: e.sonnet,
          gpt5_4_no_ws: e.gpt5_4,
          sonnet_ws: sonnetResults.get(e.marketId),
          gpt5_4_ws: gptResults.get(e.marketId),
        })),
      },
      null,
      2
    )
  );
  console.log(`\nReport written: ${outPath}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
