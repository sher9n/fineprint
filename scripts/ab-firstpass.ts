/**
 * A/B test: Sonnet 4.6 (Anthropic batch) vs GPT-5.4 (OpenAI flex tier) on first-pass divergence
 * detection. Ground truth = the stored Opus verifier analysis for each market.
 *
 * Reads market sample from whichever DATABASE_URL is set (intended: Railway prod). Does NOT write
 * to the prod Analysis/CostLog/BatchJob tables. Writes a JSON report to ./eval-output/.
 *
 * Run:
 *   DATABASE_URL='<railway url>' npx tsx scripts/ab-firstpass.ts
 * Env knobs:
 *   AB_N_PER_BUCKET (default 100)  — markets per flagged/not-flagged bucket
 *   AB_OPENAI_CONCURRENCY (default 6)
 */
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import { prisma } from "../src/lib/prisma";
import { SYSTEM_PROMPT, buildUserMessage, AnalysisSchema, tryParseJson, type AnalysisJson } from "../src/lib/analyzer";
import { computeCost } from "../src/lib/budget";
import type { Market } from "@prisma/client";

const N_PER_BUCKET = Number(process.env.AB_N_PER_BUCKET ?? 100);
const OPENAI_CONCURRENCY = Number(process.env.AB_OPENAI_CONCURRENCY ?? 6);
const SONNET_MODEL = "claude-sonnet-4-6";
const GPT_MODEL = "gpt-5.4";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 2 });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

interface OpusGroundTruth {
  market: Market;
  opusAnalysis: {
    divergenceScore: number;
    edgeDirection: string;
    ruleImpliedProbability: number | null;
    expectedYesPayoutCents: number | null;
    expectedNoPayoutCents: number | null;
    divergenceType: string;
  };
  opusFlagged: boolean;
}

function isFlagged(divergenceScore: number, ruleP: number | null, yesPrice: number | null): boolean {
  if (divergenceScore < 5) return false;
  if (ruleP == null || yesPrice == null) return false;
  return Math.abs(ruleP - yesPrice) * 100 >= 20;
}

async function sampleMarkets(): Promise<OpusGroundTruth[]> {
  // Pull all Opus verifier analyses (latest per market) along with the market row. The schema's
  // Analysis table stores one row per (market, pass, rulesHash) historically, so we take the most
  // recent opus row per market.
  console.log(`[sample] pulling latest opus analyses from DB...`);
  const opus = await prisma.analysis.findMany({
    where: { pass: "opus" },
    orderBy: { createdAt: "desc" },
    include: { market: true },
  });

  const seenMarkets = new Set<string>();
  const latestPerMarket: typeof opus = [];
  for (const a of opus) {
    if (seenMarkets.has(a.marketId)) continue;
    seenMarkets.add(a.marketId);
    latestPerMarket.push(a);
  }

  const eligible = latestPerMarket.filter((a) => {
    // Need at minimum a yesPrice and rule_p for the priceGap calculation
    if (a.market.yesPrice == null) return false;
    if (a.ruleImpliedProbability == null) return false;
    if (!a.market.description) return false; // empty description = no rules text to audit
    return true;
  });

  const flagged: OpusGroundTruth[] = [];
  const notFlagged: OpusGroundTruth[] = [];
  for (const a of eligible) {
    const wasFlagged = isFlagged(a.divergenceScore, a.ruleImpliedProbability, a.market.yesPrice);
    const gt: OpusGroundTruth = {
      market: a.market,
      opusAnalysis: {
        divergenceScore: a.divergenceScore,
        edgeDirection: a.edgeDirection,
        ruleImpliedProbability: a.ruleImpliedProbability,
        expectedYesPayoutCents: a.expectedYesPayoutCents,
        expectedNoPayoutCents: a.expectedNoPayoutCents,
        divergenceType: a.divergenceType,
      },
      opusFlagged: wasFlagged,
    };
    (wasFlagged ? flagged : notFlagged).push(gt);
  }

  console.log(`[sample] eligible: ${eligible.length} (${flagged.length} flagged, ${notFlagged.length} not)`);
  // Shuffle deterministically (no — let's actually use Math.random for fresh sampling each run).
  const pick = <T>(arr: T[], n: number): T[] => {
    const out: T[] = [];
    const copy = [...arr];
    for (let i = 0; i < n && copy.length > 0; i++) {
      const idx = Math.floor(Math.random() * copy.length);
      out.push(copy.splice(idx, 1)[0]);
    }
    return out;
  };
  const sample = [...pick(flagged, N_PER_BUCKET), ...pick(notFlagged, N_PER_BUCKET)];
  console.log(`[sample] selected: ${sample.length} (${sample.filter((s) => s.opusFlagged).length} flagged)`);
  return sample;
}

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
}

async function runSonnetBatch(samples: OpusGroundTruth[]): Promise<Map<string, ModelResult>> {
  console.log(`[sonnet] submitting batch of ${samples.length} markets to Anthropic...`);
  const requests = samples.map((s) => ({
    custom_id: s.market.id,
    params: {
      model: SONNET_MODEL,
      max_tokens: 1024,
      system: [{ type: "text" as const, text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } }],
      messages: [{ role: "user" as const, content: buildUserMessage(s.market) }],
    },
  }));

  const batch = await anthropic.messages.batches.create({ requests });
  console.log(`[sonnet] batch ${batch.id} submitted, polling...`);

  // Poll every 20s until terminal.
  let lastStatus = batch.processing_status;
  let polls = 0;
  while (lastStatus !== "ended") {
    await new Promise((r) => setTimeout(r, 20_000));
    polls++;
    try {
      const cur = await anthropic.messages.batches.retrieve(batch.id);
      lastStatus = cur.processing_status;
      const counts = cur.request_counts;
      console.log(
        `[sonnet] poll ${polls} status=${lastStatus} succeeded=${counts.succeeded} processing=${counts.processing} errored=${counts.errored}`
      );
    } catch (e) {
      console.warn(`[sonnet] poll ${polls} retrieve failed: ${(e as Error).message}`);
    }
  }

  console.log(`[sonnet] streaming results...`);
  const stream = await anthropic.messages.batches.results(batch.id);
  const out = new Map<string, ModelResult>();

  for await (const entry of stream) {
    const customId = entry.custom_id;
    if (entry.result.type !== "succeeded") {
      out.set(customId, {
        marketId: customId,
        ok: false,
        error: `result type=${entry.result.type}`,
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
      });
      continue;
    }
    const msg = entry.result.message;
    const text = msg.content.find((c: { type: string }) => c.type === "text") as
      | { type: "text"; text: string }
      | undefined;
    if (!text) {
      out.set(customId, {
        marketId: customId,
        ok: false,
        error: "no text content",
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
      });
      continue;
    }

    let parsed: AnalysisJson | undefined;
    let parseErr: string | undefined;
    try {
      parsed = AnalysisSchema.parse(tryParseJson(text.text));
    } catch (e) {
      parseErr = (e as Error).message.slice(0, 120);
    }

    const u = msg.usage;
    const usage = {
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
    };
    // Anthropic batch discount = 50% off all four categories.
    const cost = computeCost(SONNET_MODEL, usage) * 0.5;

    out.set(customId, {
      marketId: customId,
      ok: !!parsed,
      error: parseErr,
      analysis: parsed,
      costUsd: cost,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      modelReturned: msg.model,
    });
  }
  console.log(`[sonnet] parsed ${[...out.values()].filter((r) => r.ok).length}/${out.size} successfully`);
  return out;
}

async function runGptFlexConcurrent(samples: OpusGroundTruth[]): Promise<Map<string, ModelResult>> {
  console.log(`[gpt5_4] running ${samples.length} markets concurrently (max ${OPENAI_CONCURRENCY})...`);
  const out = new Map<string, ModelResult>();

  let nextIdx = 0;
  let done = 0;
  const start = Date.now();

  async function worker(workerId: number) {
    while (true) {
      const idx = nextIdx++;
      if (idx >= samples.length) return;
      const s = samples[idx];
      const t0 = Date.now();
      try {
        const res = await openai.chat.completions.create({
          model: GPT_MODEL,
          service_tier: "flex",
          max_completion_tokens: 1024,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildUserMessage(s.market) },
          ],
          response_format: { type: "json_object" },
        });
        const latency = Date.now() - t0;
        const text = res.choices[0]?.message?.content ?? "";
        let parsed: AnalysisJson | undefined;
        let parseErr: string | undefined;
        try {
          parsed = AnalysisSchema.parse(tryParseJson(text));
        } catch (e) {
          parseErr = (e as Error).message.slice(0, 120);
        }
        const promptTokens = res.usage?.prompt_tokens ?? 0;
        const cached = res.usage?.prompt_tokens_details?.cached_tokens ?? 0;
        const completion = res.usage?.completion_tokens ?? 0;
        const usage = {
          inputTokens: Math.max(0, promptTokens - cached),
          outputTokens: completion,
          cacheReadTokens: cached,
          cacheCreationTokens: 0,
        };
        // Flex tier discount = 50% off, mirrored from batch pattern.
        const cost = computeCost(res.model || GPT_MODEL, usage) * 0.5;
        out.set(s.market.id, {
          marketId: s.market.id,
          ok: !!parsed,
          error: parseErr,
          analysis: parsed,
          costUsd: cost,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          modelReturned: res.model,
          latencyMs: latency,
        });
      } catch (e) {
        const status = (e as { status?: number }).status;
        out.set(s.market.id, {
          marketId: s.market.id,
          ok: false,
          error: `${status ?? "?"} ${(e as Error).message.slice(0, 200)}`,
          costUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          latencyMs: Date.now() - t0,
        });
      }
      done++;
      if (done % 10 === 0 || done === samples.length) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(0);
        console.log(`[gpt5_4] worker ${workerId}: ${done}/${samples.length} done (${elapsed}s elapsed)`);
      }
    }
  }

  await Promise.all(Array.from({ length: OPENAI_CONCURRENCY }, (_, i) => worker(i + 1)));
  console.log(`[gpt5_4] all ${out.size} done in ${((Date.now() - start) / 1000).toFixed(0)}s`);
  return out;
}

interface ModelMetrics {
  label: string;
  ok: number;
  failed: number;
  parseFailed: number;
  flagAgreement: { tp: number; fp: number; tn: number; fn: number };
  precision: number;
  recall: number;
  f1: number;
  directionAgreement: number; // 0-1
  rulePMae: number; // mean |model.rule_p - opus.rule_p|
  divScoreCorrelation: number; // Pearson r
  divScoreMae: number;
  totalCostUsd: number;
  avgCostUsd: number;
  avgLatencyMs?: number;
}

function pearson(xs: number[], ys: number[]): number {
  if (xs.length === 0) return 0;
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

function computeMetrics(label: string, results: Map<string, ModelResult>, samples: OpusGroundTruth[]): ModelMetrics {
  let okCount = 0;
  let failCount = 0;
  let parseFailCount = 0;
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  let dirAgree = 0;
  let dirCount = 0;
  const rulePDeltas: number[] = [];
  const modelDivs: number[] = [];
  const opusDivs: number[] = [];
  let totalCost = 0;
  let totalLatency = 0;
  let latencyCount = 0;

  for (const s of samples) {
    const r = results.get(s.market.id);
    if (!r) {
      failCount++;
      continue;
    }
    totalCost += r.costUsd;
    if (r.latencyMs != null) {
      totalLatency += r.latencyMs;
      latencyCount++;
    }
    if (!r.ok || !r.analysis) {
      failCount++;
      if (r.error?.includes("no json") || r.error?.includes("Expected") || r.error?.includes("Invalid")) parseFailCount++;
      continue;
    }
    okCount++;
    const a = r.analysis;
    const modelFlagged = isFlagged(a.divergence_score, a.rule_implied_probability, s.market.yesPrice);
    const opusFlagged = s.opusFlagged;
    if (opusFlagged && modelFlagged) tp++;
    else if (!opusFlagged && modelFlagged) fp++;
    else if (!opusFlagged && !modelFlagged) tn++;
    else fn++;

    if (s.opusAnalysis.edgeDirection !== "NONE" && a.edge_direction !== "NONE") {
      dirCount++;
      if (s.opusAnalysis.edgeDirection === a.edge_direction) dirAgree++;
    }

    if (s.opusAnalysis.ruleImpliedProbability != null && a.rule_implied_probability != null) {
      rulePDeltas.push(Math.abs(s.opusAnalysis.ruleImpliedProbability - a.rule_implied_probability));
    }
    modelDivs.push(a.divergence_score);
    opusDivs.push(s.opusAnalysis.divergenceScore);
  }

  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const directionAgreement = dirCount === 0 ? 0 : dirAgree / dirCount;
  const rulePMae = rulePDeltas.length === 0 ? 0 : rulePDeltas.reduce((a, b) => a + b, 0) / rulePDeltas.length;
  const divScoreCorrelation = pearson(modelDivs, opusDivs);
  const divDeltas = modelDivs.map((d, i) => Math.abs(d - opusDivs[i]));
  const divScoreMae = divDeltas.length === 0 ? 0 : divDeltas.reduce((a, b) => a + b, 0) / divDeltas.length;

  return {
    label,
    ok: okCount,
    failed: failCount,
    parseFailed: parseFailCount,
    flagAgreement: { tp, fp, tn, fn },
    precision,
    recall,
    f1,
    directionAgreement,
    rulePMae,
    divScoreCorrelation,
    divScoreMae,
    totalCostUsd: totalCost,
    avgCostUsd: okCount + failCount === 0 ? 0 : totalCost / (okCount + failCount),
    avgLatencyMs: latencyCount === 0 ? undefined : totalLatency / latencyCount,
  };
}

function printMetrics(m: ModelMetrics) {
  console.log(`\n=== ${m.label} ===`);
  console.log(`  parsed:                ${m.ok}/${m.ok + m.failed}  (parse fails: ${m.parseFailed})`);
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

async function main() {
  const dbUrl = process.env.DATABASE_URL || "";
  const dbHost = dbUrl.includes("zephyr") ? "Railway prod (read-only)" : dbUrl.split("@")[1]?.split("/")[0] ?? "unknown";
  console.log(`[ab-firstpass] DB: ${dbHost}`);
  console.log(`[ab-firstpass] sample: ${N_PER_BUCKET} flagged + ${N_PER_BUCKET} not-flagged = ${N_PER_BUCKET * 2} markets`);
  console.log(`[ab-firstpass] models: ${SONNET_MODEL} (batch) vs ${GPT_MODEL} (flex)\n`);

  const samples = await sampleMarkets();
  if (samples.length === 0) {
    console.error("[ab-firstpass] no samples; bailing");
    return;
  }

  // Submit Anthropic batch first (it kicks off immediately and runs server-side), then run OpenAI
  // concurrently in the foreground. When OpenAI finishes, the script polls the Anthropic batch
  // until it's done. This overlaps both as much as possible.
  const sonnetPromise = runSonnetBatch(samples);
  const gptPromise = runGptFlexConcurrent(samples);

  const [sonnetResults, gptResults] = await Promise.all([sonnetPromise, gptPromise]);

  const sonnetMetrics = computeMetrics(`Sonnet 4.6 (batch)`, sonnetResults, samples);
  const gptMetrics = computeMetrics(`GPT-5.4 (flex)`, gptResults, samples);

  printMetrics(sonnetMetrics);
  printMetrics(gptMetrics);

  console.log(`\n=== HEAD TO HEAD ===`);
  console.log(`F1:                  Sonnet ${(sonnetMetrics.f1 * 100).toFixed(1)}%  vs  GPT-5.4 ${(gptMetrics.f1 * 100).toFixed(1)}%`);
  console.log(`Cost per call:       Sonnet $${sonnetMetrics.avgCostUsd.toFixed(5)}  vs  GPT-5.4 $${gptMetrics.avgCostUsd.toFixed(5)}`);
  console.log(`Total test cost:     Sonnet $${sonnetMetrics.totalCostUsd.toFixed(3)}  vs  GPT-5.4 $${gptMetrics.totalCostUsd.toFixed(3)}`);

  // Save full report
  const outDir = path.join(process.cwd(), "eval-output");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(outDir, `ab-firstpass-${stamp}.json`);
  const report = {
    runAt: new Date().toISOString(),
    config: { nPerBucket: N_PER_BUCKET, sonnetModel: SONNET_MODEL, gptModel: GPT_MODEL, openaiConcurrency: OPENAI_CONCURRENCY },
    metrics: { sonnet: sonnetMetrics, gpt5_4: gptMetrics },
    perMarket: samples.map((s) => ({
      marketId: s.market.id,
      question: s.market.eventTitle && s.market.groupItemTitle ? `${s.market.eventTitle}: ${s.market.groupItemTitle}` : s.market.question,
      yesPrice: s.market.yesPrice,
      opus: s.opusAnalysis,
      opusFlagged: s.opusFlagged,
      sonnet: sonnetResults.get(s.market.id),
      gpt5_4: gptResults.get(s.market.id),
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
