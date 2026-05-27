import { prisma } from "./prisma";
import { openai, DEEP_RESEARCH_MODEL } from "./openai";
import { AnalysisSchema, tryParseJson, type AnalysisJson } from "./analyzer";
import { logCost, remainingDeepResearchBudgetUsd } from "./budget";
import { computeEdge } from "./scoring";
import { runSynthesis } from "./synthesis";
import { llmCallsEnabled, LLMDisabledError } from "./llm-gate";
import type { Market, DeepResearchJob } from "@prisma/client";

const SUBMIT_THRESHOLD_USD = 1.5;

// Deliberately separate from the auditor SYSTEM_PROMPT in analyzer.ts. GPT runs as an independent
// fact-finder with NO knowledge of the market price, sibling markets, or any prediction-market
// data. Opus stays market-aware on the other pipeline branch; the synthesizer reconciles them.
const GPT_FACT_FINDER_SYSTEM_PROMPT = `You are an independent fact-finder. A separate analyst sees the prediction-market context (price, sibling markets, crowd consensus) and will be reconciled against your work by a third model. Your job is the opposite of theirs: assemble the real-world picture from primary, authoritative sources, with no reference to or knowledge of how anyone is betting on this question.

YOUR INPUTS
- A question (and possibly an event / outcome label)
- The verbatim resolution rules
- Web search access

YOUR OUTPUT
- A factual research summary, then a JSON object matching the schema below.

WHAT YOU DO NOT KNOW
- The current market price. Do not speculate about it.
- What other related markets are pricing. Do not search for them.
- What "the crowd" thinks. The crowd is not a source.

SOURCE POLICY

PREFERRED (weight heavily):
- The named resolution source in the rules itself (e.g. NOAA, NBER, FOMC, Registraduría, Box Office Mojo, the IRS, the SEC) via its own website, press releases, datasets, or published reports.
- Government, regulatory, and judicial bodies (electoral commissions, courts, treaty texts, central banks).
- Primary reporting from AP, Reuters, AFP, Bloomberg, FT, WSJ, BBC, NYT, NPR, Guardian, major national wire services.
- Peer-reviewed papers and institutional reports (IMF, World Bank, IEA, IPCC).
- Direct company filings (SEC EDGAR, exchange disclosures, investor-relations primary docs).

ACCEPTABLE (lighter weight):
- Established trade press (TechCrunch, Variety, Politico, Defense News).
- Wikipedia, only for cross-referencing dates and named entities, never as a primary source.

FORBIDDEN (do not weight, do not cite, do not visit if avoidable):
- Polymarket, Kalshi, PredictIt, Manifold, Metaculus, Smarkets, Betfair, Insight Prediction.
- Sportsbook lines: DraftKings, FanDuel, BetMGM, Caesars, Bet365.
- Odds aggregators: Oddschecker, OddsPortal, oddsmakers.
- Twitter / X threads that cite market or sportsbook odds.
- Reddit, 4chan, Discord, or Telegram threads about betting on this question.

If web search returns one of these, do not extract odds or implied probabilities. If the same page cites a primary fact ("according to the official commission..."), follow the link to the primary source and cite that instead.

LANGUAGE BAN
Never use the phrases: "market price", "the odds", "what bettors think", "the crowd", "sibling markets", "implied probability from the market", "priced in", "trading at". You do not know any of this. Reason only about the underlying event and the rules.

READING THE RULES

1. THREE-WAY OUTCOMES. Many questions have a third resolution beyond YES / NO:
   - "50-50 fallback": "If neither X nor Y happens by [date], the market resolves 50-50." Both YES and NO shares pay 50 cents.
   - "Other / Void / N/A" fallback: "If [condition] is not met by [date], resolves to Other (or void)." Both YES and NO pay 0 cents.

   For binary markets:
     expected_yes_payout_cents = P(YES) * 100
     expected_no_payout_cents  = (1 - P(YES)) * 100

   For 50-50 fallback (P(YES) outright = y, P(fallback) = f):
     expected_yes_payout_cents = y * 100 + f * 50
     expected_no_payout_cents  = (1 - y - f) * 100 + f * 50

   For Other / Void fallback (paying 0):
     expected_yes_payout_cents = y * 100
     expected_no_payout_cents  = (1 - y - f) * 100
     (these do not sum to 100; fallback probability eats the difference)

   ALWAYS identify whether a fallback exists and reflect it in the expected payouts.

2. RULES DEADLINE. If the rules state a deadline, that is the deadline. If the rules do not state a deadline, say so explicitly in reasoning and do NOT substitute a date you saw elsewhere. Some platforms close their orderbook before the rules-stated deadline; that orderbook close is not the rules deadline.

3. NAMED SOURCE. If the rules name a specific source (NBER, Coinbase BTC-USD spot, the Registraduría, NOAA's end-of-season report), check:
   - Does the source exist and report on the schedule you would expect?
   - Has it already reported relevant data?
   - Does it have a track record of delays or unusual interpretations?

4. COMPOUND AND CONDITIONS. "Resolves YES if (a) AND (b) AND (c)" multiplies probabilities. Identify every gating condition.

5. ELIGIBILITY / PRECONDITIONS. If a person, entity, or event must satisfy a precondition (constitutional eligibility, certification, legal standing), verify the precondition first.

6. EXCLUSION / CARVE-OUT CLAUSES. Rules frequently include explicit "does not qualify" / "will not count" / "is insufficient" language. Phrasings to watch for: "agreements that are explicitly temporary will not qualify", "announcements alone do not suffice", "framework MOUs do not count", "informal arrangements are insufficient", "X will not qualify unless Y", "the following will NOT be considered". These exclusions are often MORE decisive than the YES criteria — they tell you exactly what would NOT win YES, often by naming a specific kind of event that closely resembles the underlying activity. When the rules name an excluded category by example (e.g. "a temporary extension of the April 7 ceasefire will not qualify") and the underlying activity matches that example, the answer is NO with high confidence, regardless of how active or visible the activity is.

MAP FACTS TO RULE CATEGORIES (ALWAYS, before estimating probability)

After gathering facts, do not jump to a probability. First, classify each major fact:
- Does this fact directly satisfy the YES criteria as written? (YES evidence)
- Does this fact match an EXCLUDED / carve-out category? (NO evidence, NOT "progress toward YES")
- Is it neutral (doesn't bear on resolution)?

A common failure: treating high-activity NEGOTIATION as progress toward YES, when the rules explicitly carve out the type of agreement currently being negotiated. If the rules require a PERMANENT deal and what is being signed is explicitly a TEMPORARY extension or framework MOU, the negotiation activity is NOT YES evidence. It is direct NO evidence (it tells you what the parties are actually doing, and the rules say that activity does not qualify). Active talks alone do not move rule_implied_probability up.

Worked example: A market resolves YES on a "permanent peace deal" by a deadline. Rules state that temporary ceasefire extensions and 60-day roadmap MOUs do not qualify. News reports a 60-day roadmap MOU is about to be signed. Wrong reading: "talks are advanced, P(YES) = 0.7". Right reading: "the agreement being signed is explicitly excluded by the rules; P(YES) requires a separate, qualifying permanent deal also signing by the deadline, which there is no evidence of; P(YES) = 0.05-0.10."

INTERPRETATION FIELDS

- vibe_interpretation: one sentence on what a casual reader of the question (someone who did not read the rules) would assume the question is asking.
- literal_interpretation: one sentence on what the rules literally require, in plain English.

These are linguistic, not market-related.

DIVERGENCE TYPES (pick one)
- date_bound: rules require event by a specific date the casual title obscures.
- threshold: rules specify a precise numeric threshold the casual reading rounds.
- ambiguous_source: rules name a source that may not report on time or may interpret differently.
- specific_event: title implies a category, rules require one specific instance.
- definition_gap: a key term has a narrow technical definition in the rules.
- none: rules match the casual reading.
- other: gap exists but does not fit the above.

SCORING (divergence_score 0 to 10)
- 0 to 2: rules match the casual reading.
- 3 to 4: minor wording difference; careful readers would catch it.
- 5 to 6: real divergence visible to careful readers.
- 7 to 8: clear gap; the rules say something noticeably different.
- 9 to 10: dramatic gap; the rules guarantee or strongly tilt a particular outcome.

edge_direction: which side does the LITERAL reading favor over the VIBE reading? YES, NO, or NONE. The literal reading typically narrows P(YES) because rules add constraints, so most edges are NO. YES edges exist when rules are looser than the title suggests or the event has already partly occurred under the literal rules.

rule_implied_probability: your honest factual estimate of P(YES under literal rules), 0 to 1, based on current world state. null only if truly inestimable.

CALIBRATION EXAMPLES

EXAMPLE 1 (date_bound + Other fallback):
Question: "Will Candidate X win the first round?"
Rules: "If final results from the Electoral Commission are not certified by Dec 31, the market resolves to Other."
You should research: when the election occurs, the Commission's typical certification timeline, whether disputes are common in this country.
Audit: vibe = "did X get the most votes"; literal = "did X win AND was certification published by Dec 31"; edge NO; score 6 to 7.

EXAMPLE 2 (specific_event):
Question: "Will Trump pardon anyone in his second term?"
Rules: "Resolves YES if Donald Trump issues a presidential pardon to Person Y between Jan 20, 2025 and end of term."
You should research: whether Trump has issued pardons in the relevant window, what is publicly known about his plans for Person Y, prior history.
Audit: vibe = any pardon; literal = pardon to one specific person. Massive gap. Score 9 to 10.

EXAMPLE 3 (definition_gap):
Question: "Will the US enter a recession in 2026?"
Rules: "Resolves YES if NBER officially declares a US recession with start date in 2026, as published in NBER's business cycle dating report."
You should research: NBER's historical lag between recession start and official declaration (typically 6 to 18 months), current state of leading indicators, whether NBER has declared anything yet.
Audit: NBER declarations lag. A 2026 recession may not be declared until 2027 or 2028. Edge NO. Score 7 to 8.

EXAMPLE 4 (none, clarification not divergence):
Question: "Will Bitcoin hit 200k this year?"
Rules: "Resolves YES if Bitcoin price (per Coinbase BTC-USD spot) exceeds 200000 dollars at any point between Jan 1 and Dec 31."
Audit: the rule clarifies "hit" = any intraday touch on a named exchange; matches the casual reading. Score 0 to 1. (If the rule said "200000 close, not intraday wick" while the title said "hit", that would be a definition_gap worth 6 to 7.)

OUTPUT FORMAT

A short factual summary, then the literal separator on its own line, then the JSON.

source_findings: 3 to 6 sentences describing what your research turned up, naming the specific sources you weighted most heavily. Cite by name (NBER, AP, the Commission) and include inline links to the primary documents when available. Do not mention any prediction-market, betting-site, or odds aggregator.

Then the literal separator "---JSON---" on its own line.

Then the JSON object, no markdown fence, exactly these keys:

{
  "vibe_interpretation": "<one sentence>",
  "literal_interpretation": "<one sentence>",
  "divergence_type": "date_bound | threshold | ambiguous_source | specific_event | definition_gap | none | other",
  "divergence_score": <integer 0 to 10>,
  "edge_direction": "YES | NO | NONE",
  "rule_implied_probability": <0 to 1, or null>,
  "expected_yes_payout_cents": <0 to 100>,
  "expected_no_payout_cents": <0 to 100>,
  "reasoning": "<3 to 5 sentences: what the gap is, what factual evidence supports your probability estimate, what would change your mind>",
  "verification_steps": ["<concrete check>", "<another>", "<3 to 5 total>"]
}

REMINDERS
- You are auditing rules against world facts. You do not know what anyone is betting.
- Score conservatively. False positives waste user attention more than false negatives.
- For "none" divergence, vibe and literal can be near-identical, score 0 to 2, edge_direction NONE, verification_steps may be empty.
- A score of 7 means you would personally stake money on the gap based on what you found.`;

// Market-blind user message: strips current price, platform "trading ends" date, and the
// resolution-source metadata field. GPT extracts deadlines and named sources directly from the
// rules text. The event/outcome labels are kept because they ARE what users see — the rules
// alone don't always disambiguate which outcome of a multi-leg event this market resolves on.
function buildGptUserMessage(market: Market): string {
  const label =
    market.eventTitle && market.groupItemTitle
      ? `EVENT: ${market.eventTitle}\nOUTCOME (the specific option this resolves on): ${market.groupItemTitle}`
      : `QUESTION: ${market.question}`;

  const internalQuestion =
    market.eventTitle && market.groupItemTitle && market.question
      ? `\nNOTE: an internal question field reads "${market.question}". This may be stale template text. Use the EVENT and OUTCOME labels above and the rules below as the authoritative description of what is being asked.`
      : "";

  return `${label}${internalQuestion}

FULL RESOLUTION RULES (verbatim — THIS is the authoritative source for deadlines, named sources, and conditions; extract any deadline yourself from this text):
"""
${market.description}
"""

Return your factual research summary, then the literal separator "---JSON---", then the JSON object.`;
}

type ResponseStatus = "queued" | "in_progress" | "completed" | "failed" | "cancelled" | "incomplete";

interface ResponseEnvelope {
  id: string;
  status: ResponseStatus | string;
  output_text?: string;
  output?: Array<{ type: string; content?: Array<{ type: string; text?: string }>; text?: string }>;
  error?: { message?: string; code?: string } | null;
  usage?: { input_tokens?: number; output_tokens?: number };
  model?: string;
}

function extractText(env: ResponseEnvelope): string {
  if (typeof env.output_text === "string" && env.output_text.length > 0) return env.output_text;
  if (Array.isArray(env.output)) {
    const parts: string[] = [];
    for (const item of env.output) {
      if (typeof item.text === "string") parts.push(item.text);
      if (Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c && c.type === "output_text" && typeof c.text === "string") parts.push(c.text);
          else if (c && c.type === "text" && typeof c.text === "string") parts.push(c.text);
        }
      }
    }
    if (parts.length > 0) return parts.join("\n");
  }
  return "";
}

/**
 * Submit a deep-research job for a market via the OpenAI Responses API in background mode.
 *
 * Why not Batch API: the user's OpenAI project doesn't have batch endpoint access to
 * o3-deep-research (verified 2026-05-24 via 403 model_not_found rejection). Responses API in
 * background mode does work, just at full price (no 50% discount). Anthropic batching for the
 * first-pass and Opus verifier is unaffected.
 *
 * Refuses if the market already has a completed gpt_deep Analysis for the current rulesHash
 * (unless opts.force is set, for admin re-runs after a prompt change), or if there's an
 * in-flight job for it (always — never double-submit).
 */
export async function submitDeepResearch(market: Market, opts: { force?: boolean } = {}): Promise<DeepResearchJob> {
  if (!llmCallsEnabled()) throw new LLMDisabledError();
  if (!opts.force) {
    const existingAnalysis = await prisma.analysis.findFirst({
      where: { marketId: market.id, pass: "gpt_deep", rulesHash: market.rulesHash },
      select: { id: true },
    });
    if (existingAnalysis) {
      throw new Error("This market already has a completed deep-research analysis for the current rules.");
    }
  }

  const existingInflight = await prisma.deepResearchJob.findFirst({
    where: {
      marketId: market.id,
      status: { in: ["queued", "in_progress"] },
      rulesHashAtSubmit: market.rulesHash,
    },
    orderBy: { submittedAt: "desc" },
  });
  if (existingInflight) return existingInflight;

  const remaining = await remainingDeepResearchBudgetUsd();
  if (remaining < SUBMIT_THRESHOLD_USD) {
    throw new Error(`Daily deep-research budget too low ($${remaining.toFixed(2)} remaining). Need at least $${SUBMIT_THRESHOLD_USD.toFixed(2)} to submit.`);
  }

  const input = `${GPT_FACT_FINDER_SYSTEM_PROMPT}\n\n${buildGptUserMessage(market)}`;
  const client = openai();

  // OpenAI Responses API in background mode. The response id comes back immediately; we poll for completion.
  const res = await client.responses.create({
    model: DEEP_RESEARCH_MODEL,
    input,
    background: true,
    tools: [{ type: "web_search_preview" }],
  });

  if (!res?.id) throw new Error("OpenAI Responses API returned no id");

  return prisma.deepResearchJob.create({
    data: {
      marketId: market.id,
      openaiResponseId: res.id,
      model: DEEP_RESEARCH_MODEL,
      status: typeof res.status === "string" ? res.status : "queued",
      rulesHashAtSubmit: market.rulesHash,
    },
  });
}

/**
 * Poll all in-flight deep-research jobs. On completion, parse, write an Analysis row with
 * pass='gpt_deep', then kick off the synthesis pass.
 */
export async function pollDeepResearchJobs(opts: { limit?: number } = {}): Promise<{
  polled: number;
  completed: number;
  failed: number;
  stillRunning: number;
}> {
  const inflight = await prisma.deepResearchJob.findMany({
    where: { status: { in: ["queued", "in_progress"] } },
    orderBy: { submittedAt: "asc" },
    take: opts.limit ?? 50,
  });

  let polled = 0;
  let completed = 0;
  let failed = 0;
  let stillRunning = 0;
  const client = openai();

  for (const job of inflight) {
    polled++;
    try {
      const env = (await client.responses.retrieve(job.openaiResponseId)) as unknown as ResponseEnvelope;
      const status = env.status;
      await prisma.deepResearchJob.update({
        where: { id: job.id },
        data: { lastPolledAt: new Date(), status },
      });

      if (status === "queued" || status === "in_progress") {
        stillRunning++;
        continue;
      }

      if (status === "failed" || status === "cancelled" || status === "incomplete") {
        failed++;
        await prisma.deepResearchJob.update({
          where: { id: job.id },
          data: {
            status,
            errorMessage: env.error?.message ?? `status=${status}`,
            completedAt: new Date(),
          },
        });
        continue;
      }

      if (status === "completed") {
        const text = extractText(env);
        const inputTokens = env.usage?.input_tokens ?? 0;
        const outputTokens = env.usage?.output_tokens ?? 0;

        const market = await prisma.market.findUnique({ where: { id: job.marketId } });
        if (!market) {
          await prisma.deepResearchJob.update({
            where: { id: job.id },
            data: { status: "failed", errorMessage: "market deleted before completion", completedAt: new Date() },
          });
          failed++;
          continue;
        }

        // Idempotency: if a previous poll cycle already logged cost (e.g. parsing failed last time
        // and we're retrying after a parser fix), reuse the recorded amount instead of double-billing.
        const cost = job.costUsd > 0
          ? job.costUsd
          : await logCost({
              model: env.model ?? job.model,
              purpose: "gpt_deep_research",
              inputTokens,
              outputTokens,
            });

        // Parse: source_findings then JSON
        const parts = text.split(/---\s*JSON\s*---/i);
        let sourceFindings: string;
        let jsonText: string;
        if (parts.length >= 2) {
          sourceFindings = parts[0].trim();
          jsonText = parts.slice(1).join("\n").trim();
        } else {
          const jsonStart = text.lastIndexOf("{");
          sourceFindings = jsonStart > 0 ? text.slice(0, jsonStart).trim() : "";
          jsonText = jsonStart >= 0 ? text.slice(jsonStart) : text;
        }

        let parsed: AnalysisJson;
        try {
          parsed = AnalysisSchema.parse(tryParseJson(jsonText));
        } catch (err) {
          await prisma.deepResearchJob.update({
            where: { id: job.id },
            data: {
              status: "failed",
              errorMessage: `parse error: ${String(err).slice(0, 300)}`,
              completedAt: new Date(),
              costUsd: cost,
              inputTokens,
              outputTokens,
            },
          });
          failed++;
          continue;
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

        await prisma.analysis.create({
          data: {
            marketId: market.id,
            rulesHash: market.rulesHash,
            pass: "gpt_deep",
            model: env.model ?? job.model,
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
            inputTokens,
            outputTokens,
          },
        });

        await prisma.deepResearchJob.update({
          where: { id: job.id },
          data: {
            status: "completed",
            completedAt: new Date(),
            costUsd: cost,
            inputTokens,
            outputTokens,
          },
        });
        completed++;

        // Kick off synthesis. Best-effort; if it fails it doesn't roll back the gpt_deep row.
        try {
          await runSynthesis(market);
        } catch (err) {
          console.error(`[deep-research] synthesis after job ${job.id} failed:`, String(err).slice(0, 300));
        }
      }
    } catch (err) {
      console.error(`[deep-research] poll error for job ${job.id}:`, String(err).slice(0, 300));
      // Don't mark failed on transient poll errors; just record the error message and try again next cycle.
      await prisma.deepResearchJob.update({
        where: { id: job.id },
        data: { lastPolledAt: new Date(), errorMessage: String(err).slice(0, 500) },
      });
    }
  }

  return { polled, completed, failed, stillRunning };
}
