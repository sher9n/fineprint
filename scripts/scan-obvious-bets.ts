/**
 * Pilot scan: find OBVIOUS mispricings where current world state contradicts the market
 * price, irrespective of any fineprint subtlety. Different from the existing structural-
 * divergence pipeline. Uses Opus 4.7 + web_search.
 *
 * Run (against Railway prod DB, since local doesn't have one):
 *   DATABASE_URL='<railway-public-url>' DIRECT_URL='<same>' \
 *     npx tsx scripts/scan-obvious-bets.ts [sample-size]
 *
 * Reads markets from DB, runs each through Opus+web_search, writes results to
 * eval-output/obvious-bets-pilot-<timestamp>.json. Does NOT touch the DB.
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import { prisma } from "../src/lib/prisma";
import { tryParseJson } from "../src/lib/analyzer";
import { computeCost, WEB_SEARCH_COST_PER_CALL } from "../src/lib/budget";
import type { Market } from "@prisma/client";

const OPUS_MODEL = "claude-opus-4-7";
const SAMPLE_SIZE = parseInt(process.argv[2] || "100", 10);
const CONCURRENCY = Number(process.env.SCAN_CONCURRENCY ?? 5);
const MIN_LIQUIDITY = 10_000;
const MIN_DAYS = 7;
const MAX_DAYS = 60;
const WEB_SEARCH_MAX_USES = 4;

const PRICE_BANDS = [
  { name: "low_10_30", min: 0.1, max: 0.3 },
  { name: "mid_30_70", min: 0.3, max: 0.7 },
  { name: "high_70_90", min: 0.7, max: 0.9 },
] as const;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 2 });

const ObviousBetSchema = z.object({
  true_p_yes: z.number().min(0).max(1).nullable(),
  confidence: z.enum(["low", "medium", "high"]),
  key_facts: z.array(z.string()).max(10).default([]),
  obvious_bet_side: z.enum(["YES", "NO", "NONE"]),
  reasoning: z.string().default(""),
  source_findings: z.string().default(""),
});
type ObviousBetJson = z.infer<typeof ObviousBetSchema>;

const SYSTEM_PROMPT = `You are scanning Polymarket prediction markets for OBVIOUS MISPRICINGS — situations where the current state of the world makes the market price look factually wrong, irrespective of any fineprint subtlety.

This is NOT a fineprint / rules-vs-vibe divergence pass. A separate system handles that. Your job is different: read the title and rules AT FACE VALUE — take them as given — and then ask "based on what an informed person searching the web TODAY would find about the underlying real-world events, is this market price clearly wrong?"

PROCESS (run in this order, every time):

STEP 1 — UNDERSTAND THE MARKET
Read the title, rules, end date, and named source. Be clear in your head: what does YES literally require? What does NO mean? When does it resolve? Who decides? Do NOT scrutinize the rules for hidden gaps — the other system does that.

STEP 2 — WEB SEARCH FOR CURRENT WORLD STATE (use 2-4 searches)
Find the most recent, authoritative information about the underlying events. Prefer:
- Primary sources (named resolver, government records, regulatory filings)
- Major journalism (AP, Reuters, BBC, FT)
- Official scores / standings / results pages for sports
- Project / company official channels for product launches
- Recent dated coverage (within the last 30 days, ideally the last week)
Avoid relying on prediction-market aggregators, betting sites, or speculation pieces — those echo the price you're trying to evaluate.

STEP 3 — ESTIMATE TRUE P(YES)
Your honest forecast of the probability the market resolves YES, taking the rules at face value. Anchor on the strongest evidence you found in step 2. If multiple sources agree on a near-certain outcome, your estimate should approach 0 or 1.

STEP 4 — COMPARE TO THE MARKET PRICE
The user message will state CURRENT MARKET PRICE: YES X%. Compute the gap.
- If |true_p_yes − market_yes_price| ≥ 0.20 AND confidence ≥ medium → obvious_bet_side is the side you're long (YES if your true_p exceeds price; NO if it falls below).
- Otherwise → obvious_bet_side = NONE.

CONFIDENCE LEVELS (be honest, calibration matters):
- HIGH: a primary source has already confirmed the resolution-relevant state. Examples: the event has already happened and is publicly reported; the deadline has passed without the trigger; the named resolver has already published a result; a regulatory body has already issued its decision.
- MEDIUM: strong indirect evidence; multiple independent reputable sources converge; the answer follows from observable facts (e.g., elections decided by overwhelming margins where formal certification hasn't yet posted; sports brackets where the qualifying team is mathematically determined).
- LOW: speculation, partial information, inference from base rates without primary evidence, the future-looking event hasn't happened and signals are mixed. NEVER set obvious_bet_side to YES or NO at LOW confidence — return NONE instead.

CALIBRATION REMINDERS:
- A 25¢ market that you think should be 35¢ is NOT obvious (10pp gap is normal market noise and your own forecast has error bars too).
- A 25¢ market that you think should be 75¢ IS obvious — there is something the market is not pricing in.
- A 8¢ market on something that ALREADY HAPPENED per official source is the most actionable kind — flag it confidently.
- A 90¢ market on something the named source has now contradicted (e.g., official statement says the threshold won't be hit) is also obvious — flag NO.

PITFALLS TO AVOID:
- Don't argue with the rules. If the rules say "by Dec 31" and the event happened on Jan 2, your true_p is low — the rules govern.
- Don't confuse your dislike of the price with evidence the price is wrong. The market has 100s of bettors who have seen the same news.
- Don't flag markets just because they're near 50/50 on something that "should be obvious to you" — without evidence, your gut is not signal.
- Don't be fooled by news momentum on long-horizon events. "Negotiations are progressing" is not evidence the deal will be signed by the deadline.
- Don't double-count: if YOUR true_p_yes is only 0.05 above the market price but you "feel strongly," that's not a 20pp gap and not obvious.
- If multiple credible sources contradict each other, lower your confidence rather than picking a side.

OUTPUT FORMAT: a single raw JSON object with EXACTLY these keys (no markdown, no fences, no preamble):
{
  "true_p_yes": <number between 0 and 1, or null if you truly cannot estimate>,
  "confidence": "low" | "medium" | "high",
  "key_facts": [<2-5 short factual statements that drove your estimate, each with an inline citation in parentheses like "(per AP News, 2026-05-14)" or "(per official ICAO bulletin)">],
  "obvious_bet_side": "YES" | "NO" | "NONE",
  "reasoning": "<2-4 sentences explaining the gap between true_p_yes and market_yes_price, or why there isn't a gap>",
  "source_findings": "<2-4 sentence summary of what your web searches revealed about the current real-world state>"
}

ALL keys REQUIRED. Output JSON only.`;

function buildUserMessage(market: Market): string {
  const endDateStr = market.endDate ? market.endDate.toISOString() : "unspecified";
  const yes = market.yesPrice != null ? `${(market.yesPrice * 100).toFixed(1)}%` : "unknown";
  const no = market.noPrice != null ? `${(market.noPrice * 100).toFixed(1)}%` : "unknown";
  const src = market.resolutionSource || "(not specified in metadata; see description)";

  let userFacingLabel: string;
  if (market.eventTitle && market.groupItemTitle) {
    userFacingLabel = `EVENT (what users see on Polymarket): ${market.eventTitle}\nOUTCOME (the specific option this market resolves on): ${market.groupItemTitle}`;
  } else {
    userFacingLabel = `MARKET TITLE: ${market.question}`;
  }

  return `${userFacingLabel}

MARKET TRADING ENDS: ${endDateStr}
CURRENT MARKET PRICE: YES ${yes} / NO ${no}
NAMED RESOLUTION SOURCE: ${src}

FULL RESOLUTION RULES:
"""
${market.description}
"""

Use web_search to verify the current state of the world. Then return the JSON only.`;
}

interface ScanResult {
  marketId: string;
  question: string;
  eventTitle: string | null;
  groupItemTitle: string | null;
  yesPrice: number | null;
  liquidity: number;
  endDate: Date | null;
  band: string;
  ok: boolean;
  error?: string;
  analysis?: ObviousBetJson;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  webSearches: number;
  latencyMs: number;
}

async function callOpusWithWebSearch(market: Market, band: string): Promise<ScanResult> {
  const t0 = Date.now();
  const base = {
    marketId: market.id,
    question: market.question,
    eventTitle: market.eventTitle,
    groupItemTitle: market.groupItemTitle,
    yesPrice: market.yesPrice,
    liquidity: market.liquidity,
    endDate: market.endDate,
    band,
  };
  try {
    const res = await anthropic.messages.create({
      model: OPUS_MODEL,
      max_tokens: 2048,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
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
      inputTokens: res.usage.input_tokens ?? 0,
      outputTokens: res.usage.output_tokens ?? 0,
      cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: res.usage.cache_creation_input_tokens ?? 0,
    };
    const cost = computeCost(OPUS_MODEL, usage) + webSearches * WEB_SEARCH_COST_PER_CALL;

    let parsed: ObviousBetJson | undefined;
    let parseError: string | undefined;
    try {
      parsed = ObviousBetSchema.parse(tryParseJson(fullText));
    } catch (e) {
      parseError = `parse fail: ${(e as Error).message.slice(0, 100)} | text head: ${fullText.slice(0, 200)}`;
    }

    return {
      ...base,
      ok: !!parsed,
      error: parseError,
      analysis: parsed,
      costUsd: cost,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      webSearches,
      latencyMs: Date.now() - t0,
    };
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return {
      ...base,
      ok: false,
      error: `${err.status ?? "?"} ${(err.message ?? "unknown").slice(0, 200)}`,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      webSearches: 0,
      latencyMs: Date.now() - t0,
    };
  }
}

async function pickStratifiedSample(target: number): Promise<Array<{ market: Market; band: string }>> {
  const now = Date.now();
  const minEnd = new Date(now + MIN_DAYS * 86400_000);
  const maxEnd = new Date(now + MAX_DAYS * 86400_000);

  // Get counts per band so we can balance
  const perBand = await Promise.all(
    PRICE_BANDS.map(async (b) => {
      const count = await prisma.market.count({
        where: {
          active: true,
          closed: false,
          liquidity: { gte: MIN_LIQUIDITY },
          endDate: { gt: minEnd, lt: maxEnd },
          yesPrice: { gte: b.min, lte: b.max },
        },
      });
      return { band: b, count };
    })
  );
  console.log(`[sample] band availability:`, perBand.map((p) => `${p.band.name}=${p.count}`).join(" "));

  // Balanced stratification: aim for target/3 per band, but cap at availability and redistribute
  // any deficit to bands that have headroom. This makes per-band comparisons interpretable rather
  // than dominating low-price markets just because they're more numerous in the pool.
  const allocations = perBand.map((p) => ({ band: p.band, take: 0, avail: p.count }));
  let remaining = target;
  const evenShare = Math.floor(target / allocations.length);
  for (const a of allocations) a.take = Math.min(a.avail, evenShare);
  remaining = target - allocations.reduce((s, a) => s + a.take, 0);
  // Redistribute leftover (from bands that hit their cap) one at a time to the currently
  // smallest-take band that still has headroom. Produces an even distribution: e.g. with
  // caps (124, 66, 20) and target 100 this yields (40, 40, 20) rather than (47, 33, 20).
  while (remaining > 0) {
    const eligible = allocations.filter((a) => a.take < a.avail);
    if (eligible.length === 0) break;
    eligible.sort((a, b) => a.take - b.take);
    eligible[0].take++;
    remaining--;
  }
  console.log(`[sample] allocations:`, allocations.map((a) => `${a.band.name}=${a.take}`).join(" "));

  const out: Array<{ market: Market; band: string }> = [];
  for (const a of allocations) {
    if (a.take === 0) continue;
    // Random ordering via offset within liquidity-sorted top-N. To keep it simple, use raw
    // query with TABLESAMPLE alternative: fetch a window and shuffle.
    const pool = await prisma.market.findMany({
      where: {
        active: true,
        closed: false,
        liquidity: { gte: MIN_LIQUIDITY },
        endDate: { gt: minEnd, lt: maxEnd },
        yesPrice: { gte: a.band.min, lte: a.band.max },
      },
      orderBy: { liquidity: "desc" },
      take: Math.max(a.take * 3, 50), // wider pool to shuffle from
    });
    // Shuffle and take
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const picks = pool.slice(0, a.take);
    for (const m of picks) out.push({ market: m, band: a.band.name });
  }
  return out;
}

/**
 * Hard-validate sampled markets against live Gamma before we burn LLM tokens on them. Our DB
 * can be hours-to-days stale (reconcileStaleMarkets misses cases — first surfaced 2026-05-29
 * when the Sinner French Open market was flagged at 73.5¢ NO but had actually resolved). Skip
 * any market that is no longer accepting orders, or whose live ask price is effectively gone.
 *
 * Also refreshes yesPrice/noPrice from the live midpoint so the prompt sees current data, not
 * the DB snapshot. ~150ms per market × concurrency=10 → ~1.5s overhead for 100 markets.
 */
const GAMMA_URL = process.env.POLYMARKET_GAMMA_URL || "https://gamma-api.polymarket.com";

async function filterLiveActiveMarkets(items: Array<{ market: Market; band: string }>): Promise<Array<{ market: Market; band: string }>> {
  console.log(`[gamma-precheck] validating ${items.length} markets against live Gamma...`);
  const CONC = 10;
  const out: Array<{ market: Market; band: string }> = [];
  let nextIdx = 0;
  let dropped = 0;

  async function worker() {
    while (true) {
      const idx = nextIdx++;
      if (idx >= items.length) return;
      const { market, band } = items[idx];
      try {
        const res = await fetch(`${GAMMA_URL}/markets/${encodeURIComponent(market.id)}`, {
          headers: { accept: "application/json" },
        });
        if (!res.ok) {
          dropped++;
          continue;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = (await res.json()) as any;
        if (raw?.closed === true || raw?.acceptingOrders === false || raw?.active === false) {
          dropped++;
          continue;
        }
        // Refresh the in-memory market's prices to live midpoint so the prompt sees current data.
        const prices = (() => {
          try {
            const a = typeof raw.outcomePrices === "string" ? JSON.parse(raw.outcomePrices) : raw.outcomePrices;
            return Array.isArray(a) ? a.map((p: string | number) => parseFloat(String(p))) : null;
          } catch {
            return null;
          }
        })();
        const outcomes = (() => {
          try {
            const a = typeof raw.outcomes === "string" ? JSON.parse(raw.outcomes) : raw.outcomes;
            return Array.isArray(a) ? a.map((o: string) => String(o)) : null;
          } catch {
            return null;
          }
        })();
        if (prices && outcomes) {
          const yesIdx = outcomes.findIndex((o: string) => o.toLowerCase() === "yes");
          const noIdx = outcomes.findIndex((o: string) => o.toLowerCase() === "no");
          if (yesIdx >= 0 && prices[yesIdx] != null) market.yesPrice = prices[yesIdx];
          if (noIdx >= 0 && prices[noIdx] != null) market.noPrice = prices[noIdx];
        }
        out.push({ market, band });
      } catch {
        dropped++;
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, () => worker()));
  console.log(`[gamma-precheck] kept ${out.length}/${items.length}, dropped ${dropped} (closed / not-accepting-orders / fetch-fail)`);
  return out;
}

async function runConcurrent(items: Array<{ market: Market; band: string }>): Promise<ScanResult[]> {
  console.log(`[scan] running ${items.length} markets with concurrency=${CONCURRENCY}...`);
  const results: ScanResult[] = [];
  let nextIdx = 0;
  let done = 0;
  const start = Date.now();

  async function worker(id: number) {
    while (true) {
      const idx = nextIdx++;
      if (idx >= items.length) return;
      const { market, band } = items[idx];
      const r = await callOpusWithWebSearch(market, band);
      results.push(r);
      done++;
      if (done % 5 === 0 || done === items.length) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(0);
        const totalCost = results.reduce((s, x) => s + x.costUsd, 0);
        console.log(`[scan] worker ${id}: ${done}/${items.length} done (${elapsed}s, $${totalCost.toFixed(2)} spent)`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));
  console.log(`[scan] all done in ${((Date.now() - start) / 1000).toFixed(0)}s`);
  return results;
}

function summarize(results: ScanResult[]) {
  const ok = results.filter((r) => r.ok && r.analysis);
  const failed = results.filter((r) => !r.ok);
  const totalCost = results.reduce((s, r) => s + r.costUsd, 0);
  const totalWebSearches = results.reduce((s, r) => s + r.webSearches, 0);

  // Score each ok result by delta vs market price, weighted by confidence
  const scored = ok
    .map((r) => {
      const a = r.analysis!;
      const tp = a.true_p_yes;
      const mp = r.yesPrice;
      if (tp == null || mp == null) return { r, delta: 0, side: "NONE" as const };
      const delta = tp - mp;
      const side: "YES" | "NO" | "NONE" =
        a.obvious_bet_side === "NONE" ? "NONE" : a.obvious_bet_side;
      return { r, delta, absDelta: Math.abs(delta), side };
    })
    .filter((x) => x.side !== "NONE" && (x.absDelta ?? 0) >= 0.2)
    .filter((x) => x.r.analysis!.confidence !== "low");

  scored.sort((a, b) => (b.absDelta ?? 0) - (a.absDelta ?? 0));

  const byBand: Record<string, { total: number; flagged: number }> = {};
  for (const r of results) {
    const b = r.band;
    if (!byBand[b]) byBand[b] = { total: 0, flagged: 0 };
    byBand[b].total++;
    const a = r.analysis;
    if (a && a.obvious_bet_side !== "NONE" && a.confidence !== "low") byBand[b].flagged++;
  }
  const byConf: Record<string, number> = { low: 0, medium: 0, high: 0 };
  for (const r of ok) byConf[r.analysis!.confidence]++;

  console.log(`\n=== SUMMARY ===`);
  console.log(`Parsed:           ${ok.length}/${results.length}`);
  console.log(`Failed:           ${failed.length}`);
  console.log(`Total cost:       $${totalCost.toFixed(2)}  (avg $${(totalCost / Math.max(1, results.length)).toFixed(3)}/market)`);
  console.log(`Avg web searches: ${(totalWebSearches / Math.max(1, ok.length)).toFixed(1)}`);
  console.log(`Confidence:       low=${byConf.low}  medium=${byConf.medium}  high=${byConf.high}`);
  console.log(`Per band:`);
  for (const [band, v] of Object.entries(byBand)) console.log(`  ${band}: ${v.flagged}/${v.total} flagged`);
  console.log(`\nFlagged opportunities (>= 20pp gap, confidence>=medium): ${scored.length}`);
  console.log(`\nTOP 10:`);
  for (const s of scored.slice(0, 10)) {
    const a = s.r.analysis!;
    const label = s.r.eventTitle && s.r.groupItemTitle ? `${s.r.eventTitle} — ${s.r.groupItemTitle}` : s.r.question;
    const mp = s.r.yesPrice != null ? `${(s.r.yesPrice * 100).toFixed(0)}¢` : "?";
    const tp = a.true_p_yes != null ? `${(a.true_p_yes * 100).toFixed(0)}¢` : "?";
    console.log(`  [${s.side} @ ${mp}, true ${tp}, conf=${a.confidence}] ${label.slice(0, 100)}`);
    console.log(`     ${a.reasoning.slice(0, 200)}`);
  }
}

async function main() {
  console.log(`[scan] sample size: ${SAMPLE_SIZE}, liquidity>=${MIN_LIQUIDITY}, end in ${MIN_DAYS}-${MAX_DAYS}d`);
  const sample = await pickStratifiedSample(SAMPLE_SIZE);
  console.log(`[scan] sampled ${sample.length} markets across ${PRICE_BANDS.length} bands`);

  const live = await filterLiveActiveMarkets(sample);
  if (live.length < sample.length * 0.5) {
    console.warn(`[scan] WARNING: more than half the sample was filtered out by live precheck — DB may be badly stale, consider running reconcile`);
  }
  const results = await runConcurrent(live);
  summarize(results);

  const outDir = path.join(process.cwd(), "eval-output");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(outDir, `obvious-bets-pilot-${stamp}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        config: {
          model: OPUS_MODEL,
          sampleSize: SAMPLE_SIZE,
          concurrency: CONCURRENCY,
          minLiquidity: MIN_LIQUIDITY,
          minDays: MIN_DAYS,
          maxDays: MAX_DAYS,
          webSearchMaxUses: WEB_SEARCH_MAX_USES,
          priceBands: PRICE_BANDS,
        },
        totalCostUsd: results.reduce((s, r) => s + r.costUsd, 0),
        results,
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
