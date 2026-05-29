/**
 * Re-run the GPT-5.4 path for markets that failed in a prior ab-firstpass report (typically 5xx
 * from the flex queue). Patches the report in place and re-computes metrics. Anthropic results
 * are left untouched.
 *
 * Run:
 *   DATABASE_URL='<railway url>' npx tsx scripts/ab-firstpass-rerun-failures.ts <report.json>
 */
import "dotenv/config";
import OpenAI from "openai";
import * as fs from "fs";
import { SYSTEM_PROMPT, buildUserMessage, AnalysisSchema, tryParseJson, type AnalysisJson } from "../src/lib/analyzer";
import { computeCost } from "../src/lib/budget";
import { prisma } from "../src/lib/prisma";

const reportPath = process.argv[2];
if (!reportPath) {
  console.error("usage: tsx scripts/ab-firstpass-rerun-failures.ts <report.json>");
  process.exit(1);
}

const GPT_MODEL = "gpt-5.4";
const MAX_RETRIES = 5;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

interface MarketResult {
  ok: boolean;
  error?: string;
  analysis?: AnalysisJson;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  modelReturned?: string;
  latencyMs?: number;
  marketId?: string;
  retries?: number;
}

interface ReportEntry {
  marketId: string;
  question: string;
  yesPrice: number | null;
  opus: {
    divergenceScore: number;
    edgeDirection: string;
    ruleImpliedProbability: number | null;
    expectedYesPayoutCents: number | null;
    expectedNoPayoutCents: number | null;
    divergenceType: string;
  };
  opusFlagged: boolean;
  sonnet: MarketResult | null;
  gpt5_4: MarketResult | null;
}

async function callGptOnce(marketId: string, market: import("@prisma/client").Market): Promise<MarketResult> {
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
      const cost = computeCost(res.model || GPT_MODEL, usage) * 0.5;
      return {
        marketId,
        ok: !!parsed,
        error: parseErr,
        analysis: parsed,
        costUsd: cost,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        modelReturned: res.model,
        latencyMs: Date.now() - t0,
        retries: attempt,
      };
    } catch (e) {
      const ex = e as { status?: number; message?: string };
      lastErr = ex;
      const retryable = ex.status === 429 || (ex.status != null && ex.status >= 500);
      if (!retryable || attempt === MAX_RETRIES - 1) break;
      const wait = 1000 * Math.pow(2, attempt) + Math.random() * 500;
      console.log(`[rerun] ${marketId} ${ex.status} retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(wait)}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  return {
    marketId,
    ok: false,
    error: `${lastErr?.status ?? "?"} ${(lastErr?.message ?? "unknown").slice(0, 200)}`,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    latencyMs: Date.now() - t0,
    retries: MAX_RETRIES,
  };
}

async function main() {
  const report = JSON.parse(fs.readFileSync(reportPath, "utf-8")) as {
    perMarket: ReportEntry[];
    metrics: Record<string, unknown>;
    config: Record<string, unknown>;
    runAt: string;
  };

  const failed = report.perMarket.filter((e) => !e.gpt5_4 || !e.gpt5_4.ok);
  console.log(`[rerun] ${failed.length} failed markets to re-run`);

  let nextIdx = 0;
  let done = 0;
  let recovered = 0;
  const CONCURRENCY = 8;

  async function worker(id: number) {
    while (true) {
      const idx = nextIdx++;
      if (idx >= failed.length) return;
      const entry = failed[idx];
      const market = await prisma.market.findUnique({ where: { id: entry.marketId } });
      if (!market) {
        console.warn(`[rerun] market ${entry.marketId} not found, skipping`);
        done++;
        continue;
      }
      const result = await callGptOnce(entry.marketId, market);
      entry.gpt5_4 = result;
      if (result.ok) recovered++;
      done++;
      if (done % 5 === 0 || done === failed.length) {
        console.log(`[rerun] worker ${id}: ${done}/${failed.length} done, ${recovered} recovered`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));

  console.log(`\n[rerun] recovered ${recovered}/${failed.length}`);

  // Recompute metrics
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
      const dx = xs[i] - meanX;
      const dy = ys[i] - meanY;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }
    const den = Math.sqrt(denX * denY);
    return den === 0 ? 0 : num / den;
  }

  function computeMetrics(label: string, side: "sonnet" | "gpt5_4") {
    let ok = 0, failedC = 0, parseFailedC = 0, tp = 0, fp = 0, tn = 0, fn = 0;
    let dirAgree = 0, dirCount = 0;
    const rulePDeltas: number[] = [];
    const modelDivs: number[] = [];
    const opusDivs: number[] = [];
    let totalCost = 0, totalLatency = 0, latencyCount = 0;
    for (const e of report.perMarket) {
      const r = e[side];
      if (!r) { failedC++; continue; }
      totalCost += r.costUsd ?? 0;
      if (r.latencyMs != null) { totalLatency += r.latencyMs; latencyCount++; }
      if (!r.ok || !r.analysis) {
        failedC++;
        if (r.error?.includes("no json") || r.error?.includes("Expected") || r.error?.includes("Invalid")) parseFailedC++;
        continue;
      }
      ok++;
      const a = r.analysis;
      const modelFlagged = isFlagged(a.divergence_score, a.rule_implied_probability, e.yesPrice);
      const opusFlagged = e.opusFlagged;
      if (opusFlagged && modelFlagged) tp++;
      else if (!opusFlagged && modelFlagged) fp++;
      else if (!opusFlagged && !modelFlagged) tn++;
      else fn++;
      if (e.opus.edgeDirection !== "NONE" && a.edge_direction !== "NONE") {
        dirCount++;
        if (e.opus.edgeDirection === a.edge_direction) dirAgree++;
      }
      if (e.opus.ruleImpliedProbability != null && a.rule_implied_probability != null) {
        rulePDeltas.push(Math.abs(e.opus.ruleImpliedProbability - a.rule_implied_probability));
      }
      modelDivs.push(a.divergence_score);
      opusDivs.push(e.opus.divergenceScore);
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
      ok, failed: failedC, parseFailed: parseFailedC,
      flagAgreement: { tp, fp, tn, fn },
      precision, recall, f1,
      directionAgreement,
      rulePMae,
      divScoreCorrelation,
      divScoreMae,
      totalCostUsd: totalCost,
      avgCostUsd: ok + failedC === 0 ? 0 : totalCost / (ok + failedC),
      avgLatencyMs: latencyCount === 0 ? undefined : totalLatency / latencyCount,
    };
  }

  report.metrics = {
    sonnet: computeMetrics("Sonnet 4.6 (batch)", "sonnet"),
    gpt5_4: computeMetrics("GPT-5.4 (flex, with retries)", "gpt5_4"),
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n[rerun] report updated: ${reportPath}\n`);

  function printM(m: ReturnType<typeof computeMetrics>) {
    console.log(`=== ${m.label} ===`);
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
  printM(report.metrics.sonnet as ReturnType<typeof computeMetrics>);
  printM(report.metrics.gpt5_4 as ReturnType<typeof computeMetrics>);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
