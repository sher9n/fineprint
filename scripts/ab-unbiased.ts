/**
 * Unbiased A/B: Sonnet 4.6 vs GPT-5.4 vs Opus 4.7 (verifier) on a FRESH sample of active markets.
 * Stratified by prefilter score so we cover the production decision space. Opus verifier is the
 * ground truth (same as production treats it).
 *
 * Cost: ~$65 at 200 markets ($60 Opus verifier + $5 first-pass).
 *
 * Run:
 *   DATABASE_URL='<railway>' npx tsx scripts/ab-unbiased.ts
 *
 * Env knobs:
 *   AB_TOTAL (default 200)             total sample size, distributed across score bands
 *   AB_OPENAI_CONCURRENCY (default 8)
 *   AB_MAX_RETRIES (default 5)         OpenAI 5xx retries
 */
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import { prisma } from "../src/lib/prisma";
import {
  SYSTEM_PROMPT,
  buildUserMessage,
  AnalysisSchema,
  tryParseJson,
  type AnalysisJson,
} from "../src/lib/analyzer";
import { buildVerifierUserMessage } from "../src/lib/batch";
import { computeCost, WEB_SEARCH_COST_PER_CALL } from "../src/lib/budget";
import { prefilter } from "../src/lib/prefilter";
import type { Market } from "@prisma/client";

const AB_TOTAL = Number(process.env.AB_TOTAL ?? 200);
const OPENAI_CONCURRENCY = Number(process.env.AB_OPENAI_CONCURRENCY ?? 8);
const MAX_RETRIES = Number(process.env.AB_MAX_RETRIES ?? 5);

const SONNET_MODEL = "claude-sonnet-4-6";
const GPT_MODEL = "gpt-5.4";
const OPUS_MODEL = "claude-opus-4-7";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 2 });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// =========================================================================================
// Sampling: fresh active markets, stratified by prefilter score band so we cover the spectrum
// =========================================================================================
async function sampleMarkets(total: number): Promise<{ market: Market; prefilterScore: number; band: string }[]> {
  console.log(`[sample] pulling active markets for stratified sample...`);
  const all = await prisma.market.findMany({
    where: {
      active: true,
      closed: false,
      OR: [{ endDate: null }, { endDate: { gt: new Date() } }],
      description: { not: "" },
      liquidity: { gte: 5000 },
    },
    orderBy: { liquidity: "desc" },
    take: 10000,
  });
  console.log(`[sample] candidate pool: ${all.length} markets`);

  const scored = all
    .map((m) => ({ market: m, pf: prefilter(m) }))
    .filter((x) => x.pf.score >= 3 && x.market.yesPrice != null);

  console.log(`[sample] passing prefilter (score >= 3): ${scored.length}`);

  const high = scored.filter((x) => x.pf.score >= 7);
  const med = scored.filter((x) => x.pf.score >= 4 && x.pf.score < 7);
  const low = scored.filter((x) => x.pf.score === 3);
  console.log(`[sample] band sizes: high(>=7)=${high.length} med(4-6)=${med.length} low(=3)=${low.length}`);

  // Distribute total budget proportionally to band size, but with a floor so each band is represented.
  const wantHigh = Math.round(total * 0.35);
  const wantMed = Math.round(total * 0.35);
  const wantLow = total - wantHigh - wantMed;

  const pick = <T>(arr: T[], n: number): T[] => {
    const out: T[] = [];
    const copy = [...arr];
    for (let i = 0; i < n && copy.length > 0; i++) {
      const idx = Math.floor(Math.random() * copy.length);
      out.push(copy.splice(idx, 1)[0]);
    }
    return out;
  };

  const sample = [
    ...pick(high, wantHigh).map((x) => ({ market: x.market, prefilterScore: x.pf.score, band: "high" as const })),
    ...pick(med, wantMed).map((x) => ({ market: x.market, prefilterScore: x.pf.score, band: "med" as const })),
    ...pick(low, wantLow).map((x) => ({ market: x.market, prefilterScore: x.pf.score, band: "low" as const })),
  ];
  console.log(`[sample] selected ${sample.length} (high=${sample.filter((s) => s.band === "high").length} med=${sample.filter((s) => s.band === "med").length} low=${sample.filter((s) => s.band === "low").length})`);
  return sample;
}

// =========================================================================================
// Result shape (same for all three models)
// =========================================================================================
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

// =========================================================================================
// Anthropic batch helpers
// =========================================================================================
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

async function runSonnetBatch(samples: { market: Market }[]): Promise<Map<string, ModelResult>> {
  console.log(`[sonnet] submitting batch of ${samples.length}...`);
  const requests = samples.map(({ market }) => ({
    custom_id: market.id,
    params: {
      model: SONNET_MODEL,
      max_tokens: 1024,
      system: [{ type: "text" as const, text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } }],
      messages: [{ role: "user" as const, content: buildUserMessage(market) }],
    },
  }));
  const batch = await anthropic.messages.batches.create({ requests });
  console.log(`[sonnet] batch ${batch.id} submitted`);
  await pollBatch(batch.id, "sonnet");

  const stream = await anthropic.messages.batches.results(batch.id);
  const out = new Map<string, ModelResult>();
  for await (const entry of stream) {
    if (entry.result.type !== "succeeded") {
      out.set(entry.custom_id, { marketId: entry.custom_id, ok: false, error: `type=${entry.result.type}`, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });
      continue;
    }
    const msg = entry.result.message;
    const text = msg.content.find((c: { type: string }) => c.type === "text") as { type: "text"; text: string } | undefined;
    if (!text) {
      out.set(entry.custom_id, { marketId: entry.custom_id, ok: false, error: "no text", costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });
      continue;
    }
    let parsed: AnalysisJson | undefined;
    let parseErr: string | undefined;
    try { parsed = AnalysisSchema.parse(tryParseJson(text.text)); }
    catch (e) { parseErr = (e as Error).message.slice(0, 120); }
    const u = msg.usage;
    const usage = { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0, cacheReadTokens: u.cache_read_input_tokens ?? 0, cacheCreationTokens: u.cache_creation_input_tokens ?? 0 };
    const cost = computeCost(SONNET_MODEL, usage) * 0.5; // batch discount
    out.set(entry.custom_id, { marketId: entry.custom_id, ok: !!parsed, error: parseErr, analysis: parsed, costUsd: cost, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheReadTokens: usage.cacheReadTokens, modelReturned: msg.model });
  }
  console.log(`[sonnet] parsed ${[...out.values()].filter((r) => r.ok).length}/${out.size}`);
  return out;
}

async function runOpusVerifierBatch(samples: { market: Market }[]): Promise<Map<string, ModelResult>> {
  console.log(`[opus] building verifier prompts (with sibling-market context)...`);
  const requests = await Promise.all(
    samples.map(async ({ market }) => ({
      custom_id: market.id,
      params: {
        model: OPUS_MODEL,
        max_tokens: 3072,
        system: [{ type: "text" as const, text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 } as never],
        messages: [{ role: "user" as const, content: await buildVerifierUserMessage(market) }],
      },
    })),
  );
  console.log(`[opus] submitting verifier batch of ${samples.length}...`);
  const batch = await anthropic.messages.batches.create({ requests });
  console.log(`[opus] batch ${batch.id} submitted`);
  await pollBatch(batch.id, "opus");

  const stream = await anthropic.messages.batches.results(batch.id);
  const out = new Map<string, ModelResult>();
  for await (const entry of stream) {
    if (entry.result.type !== "succeeded") {
      out.set(entry.custom_id, { marketId: entry.custom_id, ok: false, error: `type=${entry.result.type}`, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });
      continue;
    }
    const msg = entry.result.message;
    // Verifier returns: source_findings + steelman + ---JSON--- + JSON. Same parser shape as production.
    const textBlocks = msg.content.filter((c: { type: string }) => c.type === "text") as { type: "text"; text: string }[];
    const fullText = textBlocks.map((t) => t.text).join("\n");
    const parts = fullText.split(/---\s*JSON\s*---/i);
    const jsonText = parts.length >= 2 ? parts.slice(1).join("\n").trim() : fullText;

    let webSearches = 0;
    for (const c of msg.content) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyC = c as any;
      if (anyC.type === "server_tool_use" && anyC.name === "web_search") webSearches++;
    }

    let parsed: AnalysisJson | undefined;
    let parseErr: string | undefined;
    try { parsed = AnalysisSchema.parse(tryParseJson(jsonText)); }
    catch (e) { parseErr = (e as Error).message.slice(0, 120); }
    const u = msg.usage;
    const usage = { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0, cacheReadTokens: u.cache_read_input_tokens ?? 0, cacheCreationTokens: u.cache_creation_input_tokens ?? 0 };
    const cost = computeCost(OPUS_MODEL, usage) * 0.5 + webSearches * WEB_SEARCH_COST_PER_CALL;
    out.set(entry.custom_id, { marketId: entry.custom_id, ok: !!parsed, error: parseErr, analysis: parsed, costUsd: cost, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheReadTokens: usage.cacheReadTokens, modelReturned: msg.model, webSearches });
  }
  console.log(`[opus] parsed ${[...out.values()].filter((r) => r.ok).length}/${out.size}`);
  return out;
}

// =========================================================================================
// OpenAI GPT-5.4 flex with retries
// =========================================================================================
async function runGptFlexConcurrent(samples: { market: Market }[]): Promise<Map<string, ModelResult>> {
  console.log(`[gpt5_4] running ${samples.length} concurrent (max ${OPENAI_CONCURRENCY}, retries=${MAX_RETRIES})...`);
  const out = new Map<string, ModelResult>();
  let nextIdx = 0;
  let done = 0;
  let recovered = 0;
  const start = Date.now();

  async function callOnce(marketId: string, market: Market): Promise<ModelResult> {
    const t0 = Date.now();
    let lastErr: { status?: number; message?: string } | null = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const res = await openai.chat.completions.create({
          model: GPT_MODEL,
          service_tier: "flex",
          max_completion_tokens: 1024,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildUserMessage(market) },
          ],
          response_format: { type: "json_object" },
        });
        if (attempt > 0) recovered++;
        const text = res.choices[0]?.message?.content ?? "";
        let parsed: AnalysisJson | undefined;
        let parseErr: string | undefined;
        try { parsed = AnalysisSchema.parse(tryParseJson(text)); }
        catch (e) { parseErr = (e as Error).message.slice(0, 120); }
        const promptTokens = res.usage?.prompt_tokens ?? 0;
        const cached = res.usage?.prompt_tokens_details?.cached_tokens ?? 0;
        const completion = res.usage?.completion_tokens ?? 0;
        const usage = { inputTokens: Math.max(0, promptTokens - cached), outputTokens: completion, cacheReadTokens: cached, cacheCreationTokens: 0 };
        const cost = computeCost(res.model || GPT_MODEL, usage) * 0.5;
        return { marketId, ok: !!parsed, error: parseErr, analysis: parsed, costUsd: cost, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheReadTokens: usage.cacheReadTokens, modelReturned: res.model, latencyMs: Date.now() - t0, retries: attempt };
      } catch (e) {
        const ex = e as { status?: number; message?: string };
        lastErr = ex;
        const retryable = ex.status === 429 || (ex.status != null && ex.status >= 500);
        if (!retryable || attempt === MAX_RETRIES - 1) break;
        const wait = 1000 * Math.pow(2, attempt) + Math.random() * 500;
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    return { marketId, ok: false, error: `${lastErr?.status ?? "?"} ${(lastErr?.message ?? "unknown").slice(0, 200)}`, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, latencyMs: Date.now() - t0, retries: MAX_RETRIES };
  }

  async function worker(id: number) {
    while (true) {
      const idx = nextIdx++;
      if (idx >= samples.length) return;
      const r = await callOnce(samples[idx].market.id, samples[idx].market);
      out.set(samples[idx].market.id, r);
      done++;
      if (done % 20 === 0 || done === samples.length) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(0);
        console.log(`[gpt5_4] worker ${id}: ${done}/${samples.length} done (${elapsed}s, retries-recovered=${recovered})`);
      }
    }
  }
  await Promise.all(Array.from({ length: OPENAI_CONCURRENCY }, (_, i) => worker(i + 1)));
  console.log(`[gpt5_4] all ${out.size} done in ${((Date.now() - start) / 1000).toFixed(0)}s`);
  return out;
}

// =========================================================================================
// Metrics: each model vs Opus ground truth
// =========================================================================================
function isFlagged(divergenceScore: number, ruleP: number | null, yesPrice: number | null): boolean {
  if (divergenceScore < 5) return false;
  if (ruleP == null || yesPrice == null) return false;
  return Math.abs(ruleP - yesPrice) * 100 >= 20;
}

function pearson(xs: number[], ys: number[]): number {
  if (xs.length === 0) return 0;
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX, dy = ys[i] - meanY;
    num += dx * dy; denX += dx * dx; denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

interface Metrics {
  label: string;
  ok: number; failed: number;
  flagAgreement: { tp: number; fp: number; tn: number; fn: number };
  precision: number; recall: number; f1: number;
  directionAgreement: number;
  rulePMae: number;
  divScoreCorrelation: number;
  divScoreMae: number;
  totalCostUsd: number;
  avgCostUsd: number;
  avgLatencyMs?: number;
}

function computeMetrics(
  label: string,
  candidate: Map<string, ModelResult>,
  groundTruth: Map<string, ModelResult>,
  samples: { market: Market }[]
): Metrics {
  let ok = 0, failed = 0;
  let tp = 0, fp = 0, tn = 0, fn = 0;
  let dirAgree = 0, dirCount = 0;
  const rulePDeltas: number[] = [];
  const cDivs: number[] = [];
  const gDivs: number[] = [];
  let totalCost = 0, totalLatency = 0, latencyCount = 0;

  for (const { market } of samples) {
    const c = candidate.get(market.id);
    const g = groundTruth.get(market.id);
    if (c) {
      totalCost += c.costUsd;
      if (c.latencyMs != null) { totalLatency += c.latencyMs; latencyCount++; }
    }
    if (!c || !c.ok || !c.analysis) { failed++; continue; }
    if (!g || !g.ok || !g.analysis) continue; // can't score without ground truth
    ok++;
    const ca = c.analysis, ga = g.analysis;
    const cFlag = isFlagged(ca.divergence_score, ca.rule_implied_probability, market.yesPrice);
    const gFlag = isFlagged(ga.divergence_score, ga.rule_implied_probability, market.yesPrice);
    if (gFlag && cFlag) tp++;
    else if (!gFlag && cFlag) fp++;
    else if (!gFlag && !cFlag) tn++;
    else fn++;

    if (ga.edge_direction !== "NONE" && ca.edge_direction !== "NONE") {
      dirCount++;
      if (ga.edge_direction === ca.edge_direction) dirAgree++;
    }
    if (ga.rule_implied_probability != null && ca.rule_implied_probability != null) {
      rulePDeltas.push(Math.abs(ga.rule_implied_probability - ca.rule_implied_probability));
    }
    cDivs.push(ca.divergence_score);
    gDivs.push(ga.divergence_score);
  }

  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const dirAgreement = dirCount === 0 ? 0 : dirAgree / dirCount;
  const rulePMae = rulePDeltas.length === 0 ? 0 : rulePDeltas.reduce((a, b) => a + b, 0) / rulePDeltas.length;
  const divCorr = pearson(cDivs, gDivs);
  const divDeltas = cDivs.map((d, i) => Math.abs(d - gDivs[i]));
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
  };
}

function printMetrics(m: Metrics) {
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
  console.log(`  avg cost per call:     $${m.avgCostUsd.toFixed(5)}`);
  if (m.avgLatencyMs != null) console.log(`  avg latency:           ${(m.avgLatencyMs / 1000).toFixed(1)}s`);
}

// =========================================================================================
// Main
// =========================================================================================
async function main() {
  const dbUrl = process.env.DATABASE_URL || "";
  const dbHost = dbUrl.includes("zephyr") ? "Railway prod (read-only)" : dbUrl.split("@")[1]?.split("/")[0] ?? "unknown";
  console.log(`[ab-unbiased] DB: ${dbHost}`);
  console.log(`[ab-unbiased] sample: ${AB_TOTAL} markets stratified by prefilter score`);
  console.log(`[ab-unbiased] models: ${SONNET_MODEL} (batch) + ${GPT_MODEL} (flex) + ${OPUS_MODEL} (verifier batch)`);
  console.log(`[ab-unbiased] ground truth: ${OPUS_MODEL} verifier with web_search\n`);

  const samples = await sampleMarkets(AB_TOTAL);
  if (samples.length === 0) {
    console.error("[ab-unbiased] no samples; bailing");
    return;
  }

  // Save sample to a checkpoint file so we can recover if anything dies mid-run.
  const outDir = path.join(process.cwd(), "eval-output");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const checkpointPath = path.join(outDir, `ab-unbiased-${stamp}-sample.json`);
  fs.writeFileSync(checkpointPath, JSON.stringify({ samples: samples.map((s) => ({ id: s.market.id, band: s.band, score: s.prefilterScore })) }, null, 2));
  console.log(`[ab-unbiased] sample checkpoint: ${checkpointPath}\n`);

  // Launch all three in parallel. Anthropic batches kick off server-side and run while OpenAI
  // flex calls run in the foreground.
  const [sonnetResults, gptResults, opusResults] = await Promise.all([
    runSonnetBatch(samples),
    runGptFlexConcurrent(samples),
    runOpusVerifierBatch(samples),
  ]);

  const sonnetMetrics = computeMetrics("Sonnet 4.6 (batch, first-pass)", sonnetResults, opusResults, samples);
  const gptMetrics = computeMetrics("GPT-5.4 (flex, first-pass)", gptResults, opusResults, samples);

  printMetrics(sonnetMetrics);
  printMetrics(gptMetrics);

  // Also report Opus stats for reference
  const opusOk = [...opusResults.values()].filter((r) => r.ok).length;
  const opusTotalCost = [...opusResults.values()].reduce((s, r) => s + r.costUsd, 0);
  const opusFlagged = samples.filter((s) => {
    const r = opusResults.get(s.market.id);
    return r?.ok && r.analysis && isFlagged(r.analysis.divergence_score, r.analysis.rule_implied_probability, s.market.yesPrice);
  }).length;
  console.log(`\n=== Opus 4.7 (verifier, ground truth) ===`);
  console.log(`  parsed:                ${opusOk}/${opusResults.size}`);
  console.log(`  flagged markets:       ${opusFlagged} / ${opusOk}  (${opusOk ? Math.round((opusFlagged / opusOk) * 100) : 0}%)`);
  console.log(`  total cost:            $${opusTotalCost.toFixed(2)}`);

  console.log(`\n=== HEAD TO HEAD (unbiased sample) ===`);
  console.log(`F1:               Sonnet ${(sonnetMetrics.f1 * 100).toFixed(1)}%  vs  GPT-5.4 ${(gptMetrics.f1 * 100).toFixed(1)}%`);
  console.log(`Precision:        Sonnet ${(sonnetMetrics.precision * 100).toFixed(1)}%  vs  GPT-5.4 ${(gptMetrics.precision * 100).toFixed(1)}%`);
  console.log(`Recall:           Sonnet ${(sonnetMetrics.recall * 100).toFixed(1)}%  vs  GPT-5.4 ${(gptMetrics.recall * 100).toFixed(1)}%`);
  console.log(`Cost per call:    Sonnet $${sonnetMetrics.avgCostUsd.toFixed(5)}  vs  GPT-5.4 $${gptMetrics.avgCostUsd.toFixed(5)}`);

  // Full report
  const outPath = path.join(outDir, `ab-unbiased-${stamp}.json`);
  const report = {
    runAt: new Date().toISOString(),
    config: { abTotal: AB_TOTAL, sonnetModel: SONNET_MODEL, gptModel: GPT_MODEL, opusModel: OPUS_MODEL, openaiConcurrency: OPENAI_CONCURRENCY, maxRetries: MAX_RETRIES },
    metrics: { sonnet: sonnetMetrics, gpt5_4: gptMetrics, opusFlagRate: opusOk ? opusFlagged / opusOk : 0, opusTotalCost },
    perMarket: samples.map((s) => ({
      marketId: s.market.id,
      question: s.market.eventTitle && s.market.groupItemTitle ? `${s.market.eventTitle}: ${s.market.groupItemTitle}` : s.market.question,
      yesPrice: s.market.yesPrice,
      band: s.band,
      prefilterScore: s.prefilterScore,
      sonnet: sonnetResults.get(s.market.id),
      gpt5_4: gptResults.get(s.market.id),
      opus: opusResults.get(s.market.id),
    })),
  };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nReport written: ${outPath}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
