/**
 * Pilot: Shape B combined Opus+ws prompt — one call analyses BOTH fineprint divergence AND
 * world-state mispricing, returns both verdicts in one JSON.
 *
 * Compares against:
 *   1. The production Opus verifier analysis already stored in DB (fineprint baseline)
 *   2. The standalone obvious-bets pilot output (mispricing baseline)
 *
 * Sample: 50 markets from the 2026-05-29 obvious-bets pilot that ALSO have a current-rules
 * Opus verifier analysis. We can compare both sections of the combined output against
 * single-purpose baselines run on the SAME markets.
 *
 * Cost: ~$2.50 inline (50 calls × ~$0.05 with longer output).
 *
 * Run:
 *   DATABASE_URL='<railway>' npx tsx scripts/pilot-combined-pass.ts <pilot-json-path>
 */
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import { prisma } from "../src/lib/prisma";
import { tryParseJson, AnalysisSchema, buildUserMessage } from "../src/lib/analyzer";
import { computeCost, WEB_SEARCH_COST_PER_CALL } from "../src/lib/budget";
import type { Market } from "@prisma/client";

const OPUS_MODEL = "claude-opus-4-7";
const SAMPLE_SIZE = 50;
const CONCURRENCY = 6;
const WEB_SEARCH_MAX_USES = 4;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 2 });

const pilotJsonPath = process.argv[2];
if (!pilotJsonPath) {
  console.error("usage: tsx scripts/pilot-combined-pass.ts <pilot-json-path>");
  process.exit(1);
}

const CombinedSchema = z.object({
  fineprint: AnalysisSchema,
  mispricing: z.object({
    true_p_yes: z.number().min(0).max(1).nullable(),
    confidence: z.enum(["low", "medium", "high"]),
    key_facts: z.array(z.string()).max(10).default([]),
    obvious_bet_side: z.enum(["YES", "NO", "NONE"]),
    reasoning: z.string().default(""),
    source_findings: z.string().default(""),
  }),
});
type CombinedJson = z.infer<typeof CombinedSchema>;

const COMBINED_SYSTEM_PROMPT = `You are analyzing a Polymarket prediction market from TWO INDEPENDENT perspectives in this single call. Each perspective asks a different question and requires separate reasoning. Do NOT let one perspective bleed into the other — run them in parallel and report both.

═══════════════════════════════════════════
PERSPECTIVE 1 — FINEPRINT GAP
═══════════════════════════════════════════
QUESTION: Do the resolution RULES diverge meaningfully from what the QUESTION TEXT vibes like, in a way casual bettors will miss?

You are NOT predicting outcomes. You are scoring whether the literal rules differ from the lay reading of the title in a way that creates expected-value mispricing.

A successful audit finds gaps like:
- A date-bound deadline that the lay reader assumes is later than the rules state
- A "named source" requirement that requires confirmation from a specific entity
- A threshold (e.g., "above $100") that a casual bettor reads as "around $100"
- A specific event requirement (e.g., "officially announced") vs. casual reading
- Definitional gaps (e.g., what counts as a "war" or "deal")

When divergence_score >= 5, structure reasoning as: (a) the textual gap, (b) the steelman case for the market price, (c) the refutation, (d) why refutation wins.

STEELMAN the market price using sibling markets and base rates before claiming a divergence. If a sibling/precedent/mechanism supports the price, score divergence LOW (0-4) and set edge_direction NONE — the textual gap is genuine but not actionable.

═══════════════════════════════════════════
PERSPECTIVE 2 — WORLD STATE MISPRICING
═══════════════════════════════════════════
QUESTION: Is this market PRICED FACTUALLY WRONG given the current state of the real world — irrespective of any fineprint subtlety?

This is NOT a rules-vs-vibe pass. Take the rules AT FACE VALUE — do not scrutinize for gaps; Perspective 1 already does that. Ask: "based on what an informed person searching the web TODAY would find, is this price clearly wrong?"

PROCESS:
1. Read title, rules, end date, named source. Be clear what YES literally requires.
2. Web search for the most recent authoritative information. Prefer primary sources (named resolver, government records, official scores), then major journalism (AP, Reuters, BBC). Avoid prediction-market aggregators.
3. Estimate true_p_yes — your honest forecast given the strongest evidence found. If multiple sources agree on near-certain outcome, approach 0 or 1.
4. Compare to market price. If |true_p_yes − yesPrice| >= 0.20 AND confidence >= medium → obvious_bet_side is the side you're long. Otherwise NONE.

CONFIDENCE:
- HIGH: a primary source has confirmed the resolution-relevant state (event happened, deadline passed, resolver published).
- MEDIUM: strong indirect convergent evidence; observable facts converging across reputable sources.
- LOW: speculation or mixed signals. NEVER set obvious_bet_side YES or NO at LOW — return NONE.

CALIBRATION:
- 25¢ market you think should be 35¢ is NOT obvious (10pp is normal noise).
- 25¢ market you think should be 75¢ IS obvious.
- 8¢ market on something that ALREADY HAPPENED per official source is the most actionable kind.

PITFALLS:
- Don't argue with the rules in Perspective 2 — that's Perspective 1's job.
- Don't confuse dislike of the price with evidence the price is wrong.
- Don't flag NEAR-50/50 markets just because they "feel obvious."
- News momentum on long-horizon events ("negotiations are progressing") is not evidence the deadline will be met.

═══════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════
Output a single raw JSON object — no markdown, no fences, no preamble. EXACTLY this shape:

{
  "fineprint": {
    "vibe_interpretation": "<one sentence>",
    "literal_interpretation": "<one sentence>",
    "divergence_type": "date_bound|threshold|ambiguous_source|specific_event|definition_gap|none|other",
    "divergence_score": <integer 0-10>,
    "edge_direction": "YES|NO|NONE",
    "rule_implied_probability": <0-1 or null>,
    "expected_yes_payout_cents": <0-100>,
    "expected_no_payout_cents": <0-100>,
    "reasoning": "<3-5 sentences>",
    "verification_steps": ["<concrete check>", "...", "<3-5 total>"]
  },
  "mispricing": {
    "true_p_yes": <0-1 or null>,
    "confidence": "low|medium|high",
    "key_facts": ["<short factual statement with inline citation>", "..."],
    "obvious_bet_side": "YES|NO|NONE",
    "reasoning": "<2-4 sentences explaining the gap or lack of gap>",
    "source_findings": "<2-4 sentence summary of what web searches revealed>"
  }
}

BOTH sections REQUIRED. Output JSON ONLY.`;

interface ComparisonRow {
  marketId: string;
  question: string;
  ok: boolean;
  error?: string;
  combinedFineprint?: { divergence_score: number; edge_direction: string; rule_implied_probability: number | null; divergence_type: string };
  combinedMispricing?: { true_p_yes: number | null; confidence: string; obvious_bet_side: string };
  baselineFineprint: { divergence_score: number; edge_direction: string; rule_implied_probability: number | null; divergence_type: string };
  baselineMispricing: { true_p_yes: number | null; confidence: string; obvious_bet_side: string };
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  webSearches: number;
  latencyMs: number;
}

async function callCombined(market: Market): Promise<{ analysis?: CombinedJson; usage: { in: number; out: number; cr: number; cw: number }; webSearches: number; latencyMs: number; error?: string }> {
  const t0 = Date.now();
  try {
    const res = await anthropic.messages.create({
      model: OPUS_MODEL,
      max_tokens: 4096,
      system: [{ type: "text", text: COMBINED_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: WEB_SEARCH_MAX_USES } as any],
      messages: [{ role: "user", content: buildUserMessage(market) }],
    });
    let webSearches = 0;
    for (const c of res.content) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyC = c as any;
      if (anyC.type === "server_tool_use" && anyC.name === "web_search") webSearches++;
    }
    const textBlocks = res.content.filter((c) => c.type === "text") as { type: "text"; text: string }[];
    const fullText = textBlocks.map((t) => t.text).join("\n");
    const usage = {
      in: res.usage.input_tokens ?? 0,
      out: res.usage.output_tokens ?? 0,
      cr: res.usage.cache_read_input_tokens ?? 0,
      cw: res.usage.cache_creation_input_tokens ?? 0,
    };
    let parsed: CombinedJson | undefined;
    let err: string | undefined;
    try {
      parsed = CombinedSchema.parse(tryParseJson(fullText));
    } catch (e) {
      err = `parse fail: ${(e as Error).message.slice(0, 150)}`;
    }
    return { analysis: parsed, usage, webSearches, latencyMs: Date.now() - t0, error: err };
  } catch (e) {
    const ex = e as { status?: number; message?: string };
    return {
      usage: { in: 0, out: 0, cr: 0, cw: 0 },
      webSearches: 0,
      latencyMs: Date.now() - t0,
      error: `${ex.status ?? "?"} ${(ex.message ?? "").slice(0, 150)}`,
    };
  }
}

async function main() {
  const pilot = JSON.parse(fs.readFileSync(pilotJsonPath, "utf-8")) as { results: Array<{ marketId: string; analysis?: { true_p_yes: number | null; confidence: string; obvious_bet_side: string } }> };
  const pilotByMarket = new Map(pilot.results.filter((r) => r.analysis).map((r) => [r.marketId, r.analysis!]));
  console.log(`[pilot-combined] loaded ${pilotByMarket.size} pilot mispricing baselines`);

  // Find markets that have BOTH a pilot mispricing AND a current Opus verifier
  const candidates = await prisma.market.findMany({
    where: { id: { in: [...pilotByMarket.keys()] } },
    include: {
      analyses: {
        where: { pass: "opus" },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  const eligible = candidates.filter((m) => m.analyses.length > 0 && m.analyses[0].rulesHash === m.rulesHash);
  console.log(`[pilot-combined] ${eligible.length} markets have current Opus verifier + pilot mispricing`);

  // Shuffle and take SAMPLE_SIZE
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }
  const sample = eligible.slice(0, SAMPLE_SIZE);
  console.log(`[pilot-combined] running combined Shape B on ${sample.length} markets at concurrency ${CONCURRENCY}...\n`);

  const results: ComparisonRow[] = [];
  let nextIdx = 0;
  let done = 0;
  const start = Date.now();

  async function worker(id: number) {
    while (true) {
      const idx = nextIdx++;
      if (idx >= sample.length) return;
      const market = sample[idx];
      const baselineOpus = market.analyses[0];
      const baselineMispricing = pilotByMarket.get(market.id)!;

      const r = await callCombined(market);
      const cost = computeCost(OPUS_MODEL, {
        inputTokens: r.usage.in,
        outputTokens: r.usage.out,
        cacheReadTokens: r.usage.cr,
        cacheCreationTokens: r.usage.cw,
      }) + r.webSearches * WEB_SEARCH_COST_PER_CALL;

      results.push({
        marketId: market.id,
        question: market.eventTitle && market.groupItemTitle ? `${market.eventTitle}: ${market.groupItemTitle}` : market.question,
        ok: !!r.analysis,
        error: r.error,
        combinedFineprint: r.analysis ? {
          divergence_score: r.analysis.fineprint.divergence_score,
          edge_direction: r.analysis.fineprint.edge_direction,
          rule_implied_probability: r.analysis.fineprint.rule_implied_probability,
          divergence_type: r.analysis.fineprint.divergence_type,
        } : undefined,
        combinedMispricing: r.analysis ? {
          true_p_yes: r.analysis.mispricing.true_p_yes,
          confidence: r.analysis.mispricing.confidence,
          obvious_bet_side: r.analysis.mispricing.obvious_bet_side,
        } : undefined,
        baselineFineprint: {
          divergence_score: baselineOpus.divergenceScore,
          edge_direction: baselineOpus.edgeDirection,
          rule_implied_probability: baselineOpus.ruleImpliedProbability,
          divergence_type: baselineOpus.divergenceType,
        },
        baselineMispricing: baselineMispricing,
        costUsd: cost,
        inputTokens: r.usage.in,
        outputTokens: r.usage.out,
        webSearches: r.webSearches,
        latencyMs: r.latencyMs,
      });

      done++;
      if (done % 5 === 0 || done === sample.length) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(0);
        const totalCost = results.reduce((s, x) => s + x.costUsd, 0);
        console.log(`[pilot-combined] worker ${id}: ${done}/${sample.length} done (${elapsed}s, $${totalCost.toFixed(3)} spent)`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));

  // ===== Analysis =====
  const ok = results.filter((r) => r.ok && r.combinedFineprint && r.combinedMispricing);
  console.log(`\n[pilot-combined] parsed: ${ok.length}/${results.length}\n`);

  // FINEPRINT comparison
  let fpEdgeAgree = 0, fpDivWithin1 = 0, fpDivWithin2 = 0, fpTypeMatch = 0, fpRulePAbsDiffTotal = 0, fpRulePN = 0;
  for (const r of ok) {
    const c = r.combinedFineprint!, b = r.baselineFineprint;
    if (c.edge_direction === b.edge_direction) fpEdgeAgree++;
    if (Math.abs(c.divergence_score - b.divergence_score) <= 1) fpDivWithin1++;
    if (Math.abs(c.divergence_score - b.divergence_score) <= 2) fpDivWithin2++;
    if (c.divergence_type === b.divergence_type) fpTypeMatch++;
    if (c.rule_implied_probability != null && b.rule_implied_probability != null) {
      fpRulePAbsDiffTotal += Math.abs(c.rule_implied_probability - b.rule_implied_probability);
      fpRulePN++;
    }
  }

  // MISPRICING comparison
  const confRank = { low: 0, medium: 1, high: 2 } as const;
  let mpSideAgree = 0, mpConfAgree = 0, mpConfWithin1 = 0, mpTrueAbsDiffTotal = 0, mpTrueN = 0;
  for (const r of ok) {
    const c = r.combinedMispricing!, b = r.baselineMispricing;
    if (c.obvious_bet_side === b.obvious_bet_side) mpSideAgree++;
    if (c.confidence === b.confidence) mpConfAgree++;
    if (Math.abs(confRank[c.confidence as keyof typeof confRank] - confRank[b.confidence as keyof typeof confRank]) <= 1) mpConfWithin1++;
    if (c.true_p_yes != null && b.true_p_yes != null) {
      mpTrueAbsDiffTotal += Math.abs(c.true_p_yes - b.true_p_yes);
      mpTrueN++;
    }
  }

  const totalCost = results.reduce((s, r) => s + r.costUsd, 0);
  const avgWs = results.reduce((s, r) => s + r.webSearches, 0) / Math.max(1, results.length);
  const avgIn = results.reduce((s, r) => s + r.inputTokens, 0) / Math.max(1, results.length);
  const avgOut = results.reduce((s, r) => s + r.outputTokens, 0) / Math.max(1, results.length);
  const avgLatency = results.reduce((s, r) => s + r.latencyMs, 0) / Math.max(1, results.length);

  console.log(`=== COMBINED SHAPE B ===`);
  console.log(`Total cost:                  $${totalCost.toFixed(3)} ($${(totalCost / results.length).toFixed(4)}/call)`);
  console.log(`Avg input / output tokens:   ${avgIn.toFixed(0)} / ${avgOut.toFixed(0)}`);
  console.log(`Avg web searches:            ${avgWs.toFixed(2)}`);
  console.log(`Avg latency:                 ${(avgLatency / 1000).toFixed(1)}s`);

  console.log(`\n=== FINEPRINT agreement (combined vs production Opus verifier) ===`);
  console.log(`  edge_direction match:      ${fpEdgeAgree}/${ok.length}  (${(fpEdgeAgree / ok.length * 100).toFixed(1)}%)`);
  console.log(`  divergence_score within 1: ${fpDivWithin1}/${ok.length}  (${(fpDivWithin1 / ok.length * 100).toFixed(1)}%)`);
  console.log(`  divergence_score within 2: ${fpDivWithin2}/${ok.length}  (${(fpDivWithin2 / ok.length * 100).toFixed(1)}%)`);
  console.log(`  divergence_type match:     ${fpTypeMatch}/${ok.length}  (${(fpTypeMatch / ok.length * 100).toFixed(1)}%)`);
  console.log(`  rule_p MAE:                ${fpRulePN > 0 ? (fpRulePAbsDiffTotal / fpRulePN).toFixed(3) : "n/a"} (n=${fpRulePN})`);

  console.log(`\n=== MISPRICING agreement (combined vs standalone obvious-bets pilot) ===`);
  console.log(`  obvious_bet_side match:    ${mpSideAgree}/${ok.length}  (${(mpSideAgree / ok.length * 100).toFixed(1)}%)`);
  console.log(`  confidence exact match:    ${mpConfAgree}/${ok.length}  (${(mpConfAgree / ok.length * 100).toFixed(1)}%)`);
  console.log(`  confidence within 1 level: ${mpConfWithin1}/${ok.length}  (${(mpConfWithin1 / ok.length * 100).toFixed(1)}%)`);
  console.log(`  true_p_yes MAE:            ${mpTrueN > 0 ? (mpTrueAbsDiffTotal / mpTrueN).toFixed(3) : "n/a"} (n=${mpTrueN})`);

  const outDir = path.join(process.cwd(), "eval-output");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(outDir, `pilot-combined-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ runAt: new Date().toISOString(), totalCostUsd: totalCost, results }, null, 2));
  console.log(`\nReport: ${outPath}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
