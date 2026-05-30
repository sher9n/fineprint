/**
 * LOCAL DEV SEED. Creates a small, varied set of markets + analyses so every UI state has
 * something to render, plus a dev user with bookmarks/votes/bets. Idempotent (deterministic
 * ids, upserts). Never run against production. No LLM calls.
 *
 *   npx tsx scripts/seed-dev.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const DAY = 86_400_000;
const now = Date.now();
const future = (d: number) => new Date(now + d * DAY);
const ago = (mins: number) => new Date(now - mins * 60_000);

type A = {
  pass: string;
  model: string;
  divergenceType: string;
  divergenceScore: number;
  edgeDirection: string;
  betSide: string;
  edgeScore: number;
  ruleImpliedProbability?: number | null;
  expectedYesPayoutCents?: number | null;
  expectedNoPayoutCents?: number | null;
  yesPriceAtAnalysis?: number | null;
  noPriceAtAnalysis?: number | null;
  vibe: string;
  literal: string;
  reasoning: string;
  sourceFindings?: string | null;
  steps?: string[];
  ageMins: number;
};

type M = {
  id: string;
  question: string;
  description: string;
  resolutionSource?: string;
  endDays: number;
  liquidity: number;
  volume: number;
  yesPrice: number;
  noPrice: number;
  eventTitle?: string | null;
  groupItemTitle?: string | null;
  analyses: A[];
};

const MARKETS: M[] = [
  {
    id: "seed-fed-march",
    question: "Will the Federal Reserve cut interest rates at its March meeting?",
    description:
      "This market resolves YES if the Federal Reserve announces a reduction in the federal funds target rate at the FOMC meeting scheduled in March. A pause, a hold, or a cut announced at any other meeting does not count. The resolution source is the official FOMC statement.",
    resolutionSource: "Federal Reserve FOMC statement",
    endDays: 20,
    liquidity: 120000,
    volume: 940000,
    yesPrice: 0.42,
    noPrice: 0.58,
    analyses: [
      {
        pass: "opus", model: "claude-opus-4-7", divergenceType: "date_bound", divergenceScore: 8,
        edgeDirection: "YES", betSide: "YES", edgeScore: 70, ruleImpliedProbability: 0.86,
        expectedYesPayoutCents: 86, expectedNoPayoutCents: 14, yesPriceAtAnalysis: 0.42, noPriceAtAnalysis: 0.58,
        vibe: "People read this as a general bet on whether the Fed is in a rate-cutting mood this spring.",
        literal: "The rules only count a cut announced at the single March meeting. Recent guidance and the dot plot point clearly to a March move.",
        reasoning: "The headline reads like a vague 'will they cut soon' question, but the rules pin it to one specific meeting. Forward guidance and futures both point to a cut at exactly that meeting, so the literal reading is more favourable to YES than the 42 cent price implies.",
        sourceFindings: "Fed funds futures imply roughly an 85% chance of a cut at the March meeting ([cmegroup.com](https://www.cmegroup.com)). Two regional Fed presidents signalled support for a March move in recent remarks.",
        steps: ["Confirm the March FOMC date has not moved.", "Check fed funds futures the morning of the meeting.", "Verify the resolution source is the official statement, not press-conference commentary."],
        ageMins: 90,
      },
      {
        pass: "gpt_deep", model: "o3-deep-research", divergenceType: "date_bound", divergenceScore: 7,
        edgeDirection: "YES", betSide: "YES", edgeScore: 66, ruleImpliedProbability: 0.9,
        expectedYesPayoutCents: 90, expectedNoPayoutCents: 10, yesPriceAtAnalysis: 0.42, noPriceAtAnalysis: 0.58,
        vibe: "A general read on Fed easing.",
        literal: "Independent of the market, base rates and current guidance put the probability of a March cut around 90%.",
        reasoning: "Looking only at primary sources and ignoring the market price, the weight of official guidance points strongly to a cut at the March meeting.",
        sourceFindings: "Recent FOMC minutes describe the committee as 'prepared to begin reducing policy restraint' ([federalreserve.gov](https://www.federalreserve.gov)). Inflation has printed below forecast for two consecutive months.",
        steps: ["Re-read the latest FOMC minutes.", "Confirm the most recent CPI print."],
        ageMins: 60,
      },
      {
        pass: "synthesis", model: "claude-opus-4-7", divergenceType: "date_bound", divergenceScore: 8,
        edgeDirection: "YES", betSide: "YES", edgeScore: 72, ruleImpliedProbability: 0.88,
        expectedYesPayoutCents: 88, expectedNoPayoutCents: 12, yesPriceAtAnalysis: 0.42, noPriceAtAnalysis: 0.58,
        vibe: "Most bettors treat this as a loose question about Fed easing this spring.",
        literal: "The rules require a cut at one specific meeting, and both the market-aware and independent reviews agree a cut there is very likely.",
        reasoning: "Both reviews land on the same side. The market is pricing 42 cents for an outcome that the rules, the guidance, and the data all put closer to 88 cents. The gap is the opportunity.",
        sourceFindings: "Both the market-aware review and the independent fact-finder concluded a March cut is highly likely, for the same underlying reasons (guidance plus soft inflation). No material disagreement.",
        steps: ["Place the bet before the meeting, not after.", "Size it for the chance the Fed surprises with a hold."],
        ageMins: 30,
      },
    ],
  },
  {
    id: "seed-nyc-mayor",
    question: "Will Jordan Avery be the next Mayor of New York City?",
    description:
      "Resolves YES only if Jordan Avery is certified as the winner of the general election by the New York City Board of Elections. A primary win, a poll lead, or a conceded race that is not yet certified does not resolve this market.",
    resolutionSource: "NYC Board of Elections certification",
    endDays: 25,
    liquidity: 64000,
    volume: 410000,
    yesPrice: 0.62,
    noPrice: 0.38,
    analyses: [
      {
        pass: "haiku", model: "claude-haiku-4-5", divergenceType: "specific_event", divergenceScore: 6,
        edgeDirection: "NO", betSide: "NONE", edgeScore: 12, ruleImpliedProbability: 0.4,
        vibe: "", literal: "",
        reasoning: "First pass flags a possible gap between the primary lead and the certification requirement.",
        ageMins: 240,
      },
      {
        pass: "opus", model: "claude-opus-4-7", divergenceType: "specific_event", divergenceScore: 7,
        edgeDirection: "NO", betSide: "NO", edgeScore: 65, ruleImpliedProbability: 0.18,
        expectedYesPayoutCents: 18, expectedNoPayoutCents: 90, yesPriceAtAnalysis: 0.62, noPriceAtAnalysis: 0.38,
        vibe: "The price treats the current polling front-runner as the likely mayor.",
        literal: "The rules need certification of the general-election win, which is months away and historically far from guaranteed for an early front-runner.",
        reasoning: "The 62 cent price is really pricing 'leads the polls now', but the market only pays out on a certified general-election win. Early front-runners in this race have a poor conversion rate, so NO at 38 cents is the value side.",
        sourceFindings: "The candidate leads the primary polls but has not won the nomination. Two comparable early front-runners in the last decade failed to win the general election ([nytimes.com](https://www.nytimes.com)).",
        steps: ["Confirm the candidate has actually secured the nomination.", "Check whether certification happens before this market's end date."],
        ageMins: 120,
      },
    ],
  },
  {
    id: "seed-ceasefire-june",
    question: "Gaza ceasefire by June 30?",
    description:
      "Resolves YES if a formal, signed ceasefire agreement is in effect on or before June 30. A temporary humanitarian pause, an unsigned framework, or a 60-day memorandum of understanding does not qualify. If no qualifying agreement is in effect by the deadline, the market resolves 50-50 per the event's tie-breaker rule.",
    resolutionSource: "Official joint statement of the parties",
    endDays: 35,
    liquidity: 88000,
    volume: 520000,
    yesPrice: 0.5,
    noPrice: 0.5,
    eventTitle: "Gaza ceasefire by date",
    groupItemTitle: "June 30",
    analyses: [
      {
        pass: "opus", model: "claude-opus-4-7", divergenceType: "date_bound", divergenceScore: 6,
        edgeDirection: "YES", betSide: "YES", edgeScore: 40, ruleImpliedProbability: 0.5,
        expectedYesPayoutCents: 65, expectedNoPayoutCents: 30, yesPriceAtAnalysis: 0.5, noPriceAtAnalysis: 0.5,
        vibe: "People see a coin-flip on peace by summer.",
        literal: "There is a 50-50 fallback rule: if neither side wins outright by the deadline, the market splits. That changes the payout maths in YES's favour.",
        reasoning: "Because the tie-breaker pays 50 cents even when there is no outright resolution, a YES share at 50 cents is worth more than the naive coin-flip suggests once you fold the fallback probability in.",
        sourceFindings: "Negotiations are active but the rules exclude the kind of temporary pause currently being discussed. The fallback clause is the key structural feature.",
        steps: ["Read the tie-breaker clause in full.", "Confirm a temporary pause would not count as a signed agreement."],
        ageMins: 150,
      },
    ],
  },
  {
    id: "seed-recount",
    question: "Will the statewide recount change the certified winner?",
    description:
      "Resolves YES if the official recount results in a different certified winner than the initial count. The margin currently stands at roughly 0.3 percent. Resolution follows the Secretary of State's final certification.",
    resolutionSource: "Secretary of State certification",
    endDays: 15,
    liquidity: 42000,
    volume: 300000,
    yesPrice: 0.3,
    noPrice: 0.7,
    analyses: [
      {
        pass: "opus", model: "claude-opus-4-7", divergenceType: "threshold", divergenceScore: 6,
        edgeDirection: "YES", betSide: "YES", edgeScore: 45, ruleImpliedProbability: 0.55,
        expectedYesPayoutCents: 60, expectedNoPayoutCents: 40, yesPriceAtAnalysis: 0.3, noPriceAtAnalysis: 0.7,
        vibe: "Recounts almost never flip results, so the crowd is heavily on NO.",
        literal: "The margin here is unusually thin and there are tens of thousands of provisional ballots still being adjudicated, which historically favours movement.",
        reasoning: "Market-aware view: this particular recount has enough outstanding ballots and a thin enough margin that a flip is more plausible than the base rate suggests.",
        sourceFindings: "Roughly 30,000 provisional ballots remain to be counted against a 4,000-vote margin ([apnews.com](https://www.apnews.com)).",
        steps: ["Track the provisional-ballot adjudication count.", "Confirm the certification deadline."],
        ageMins: 200,
      },
      {
        pass: "gpt_deep", model: "o3-deep-research", divergenceType: "threshold", divergenceScore: 4,
        edgeDirection: "NO", betSide: "NO", edgeScore: 30, ruleImpliedProbability: 0.2,
        expectedYesPayoutCents: 20, expectedNoPayoutCents: 80, yesPriceAtAnalysis: 0.3, noPriceAtAnalysis: 0.7,
        vibe: "A recount drama.",
        literal: "Independent of the market, the historical base rate for a recount overturning a result at this margin is well under 10 percent.",
        reasoning: "Across hundreds of statewide recounts, only a tiny fraction at margins this size changed the outcome. The provisional ballots tend to break proportionally, not decisively.",
        sourceFindings: "A study of statewide recounts found the average margin shift was about 0.02 percent, far short of what a flip here would require ([fairvote.org](https://www.fairvote.org)).",
        steps: ["Compare this margin to the historical shift distribution."],
        ageMins: 100,
      },
      {
        pass: "synthesis", model: "claude-opus-4-7", divergenceType: "threshold", divergenceScore: 6,
        edgeDirection: "YES", betSide: "YES", edgeScore: 33, ruleImpliedProbability: 0.42,
        expectedYesPayoutCents: 52, expectedNoPayoutCents: 48, yesPriceAtAnalysis: 0.3, noPriceAtAnalysis: 0.7,
        vibe: "The crowd sees a near-certain NO; the two reviews see it differently from each other.",
        literal: "One review weights the unusual local conditions, the other weights the historical base rate. They disagree on the side.",
        reasoning: "This is a genuine disagreement. The market-aware review sees enough outstanding ballots to justify YES at 30 cents; the independent fact-finder leans NO on base rates. Treat the edge as uncertain and read both columns below before acting.",
        sourceFindings: "FACTUAL vs STRUCTURAL: the disagreement is mostly about how much weight to give this race's unusual provisional-ballot volume versus the strong historical base rate against flips. We did not resolve it; we flag it.",
        steps: ["Read both independent verdicts before betting.", "Consider waiting for the next ballot-count update."],
        ageMins: 40,
      },
    ],
  },
  {
    id: "seed-starship",
    question: "Will Starship reach orbit on its next test flight?",
    description:
      "Resolves YES if the next integrated Starship test flight completes at least one full orbit of the Earth as confirmed by the operator and independent tracking. A suborbital trajectory, even a successful one, does not count.",
    resolutionSource: "Operator confirmation plus independent tracking",
    endDays: 45,
    liquidity: 51000,
    volume: 280000,
    yesPrice: 0.55,
    noPrice: 0.45,
    analyses: [
      {
        pass: "opus", model: "claude-opus-4-7", divergenceType: "definition_gap", divergenceScore: 7,
        edgeDirection: "NONE", betSide: "NONE", edgeScore: 22, ruleImpliedProbability: 0.54,
        expectedYesPayoutCents: null, expectedNoPayoutCents: null, yesPriceAtAnalysis: 0.55, noPriceAtAnalysis: 0.45,
        vibe: "People read 'reach orbit' loosely, counting any successful high-altitude flight.",
        literal: "The rules require a full orbit, which is a stricter bar than the suborbital hops the program has flown so far. Even so, the price already reflects this fairly well.",
        reasoning: "There is a real wording gap here worth understanding, but once you account for it the 55 cent price looks about right. No clear edge on either side; worth watching rather than betting.",
        sourceFindings: "The operator's stated flight plan targets a near-orbital trajectory, leaving genuine ambiguity about whether a full orbit will be attempted ([spacenews.com](https://www.spacenews.com)).",
        steps: ["Read the published flight plan for the word 'orbit'.", "Watch for a scrubbed or delayed launch."],
        ageMins: 180,
      },
    ],
  },
  {
    id: "seed-btc-evap",
    question: "Will Bitcoin close above $150,000 this year?",
    description:
      "Resolves YES if the daily closing price of Bitcoin is at or above $150,000 on any day before year end, per the named index. Intraday spikes that do not hold to the close do not count.",
    resolutionSource: "Reference rate daily close",
    endDays: 60,
    liquidity: 200000,
    volume: 1500000,
    yesPrice: 0.85,
    noPrice: 0.15,
    analyses: [
      {
        pass: "opus", model: "claude-opus-4-7", divergenceType: "threshold", divergenceScore: 6,
        edgeDirection: "YES", betSide: "YES", edgeScore: 18, ruleImpliedProbability: 0.7,
        expectedYesPayoutCents: 70, expectedNoPayoutCents: 30, yesPriceAtAnalysis: 0.55, noPriceAtAnalysis: 0.45,
        vibe: "A momentum bet on Bitcoin making a new high.",
        literal: "The rules need a daily close at or above the level, not just an intraday touch. When we analysed this it looked like value at 55 cents.",
        reasoning: "When the analysis ran, YES at 55 cents was attractive against a 70 cent fair value. Since then the price has run up, so the edge may no longer be there at the current price.",
        sourceFindings: "Spot has rallied sharply since the analysis window.",
        steps: ["Check the live price before betting; the edge is price-sensitive."],
        ageMins: 600,
      },
    ],
  },
  {
    id: "seed-newsgap-elections",
    question: "Will Country X hold national elections before August?",
    description:
      "Resolves YES if national elections are held before August 1, per official electoral commission announcements. A scheduled-but-postponed election does not count unless voting actually occurs before the deadline.",
    resolutionSource: "National electoral commission",
    endDays: 30,
    liquidity: 73000,
    volume: 360000,
    yesPrice: 0.4,
    noPrice: 0.6,
    analyses: [
      {
        pass: "obvious", model: "claude-sonnet-4-6", divergenceType: "world_state", divergenceScore: 8,
        edgeDirection: "YES", betSide: "YES", edgeScore: 64, ruleImpliedProbability: 0.92,
        expectedYesPayoutCents: 92, expectedNoPayoutCents: 8, yesPriceAtAnalysis: 0.4, noPriceAtAnalysis: 0.6,
        vibe: "The price looks like a genuine coin-flip on whether elections happen in time.",
        literal: "The election date has already been formally gazetted for July, and candidate registration has closed. The real-world steps are well underway.",
        reasoning: "This is not a rules subtlety; it is the news outrunning the price. The official date is set, registration is done, and ballots are being printed. At 40 cents YES the market simply has not caught up.",
        sourceFindings: "The electoral commission gazetted a July polling date and closed candidate registration last week ([reuters.com](https://www.reuters.com)). Ballot printing contracts have been awarded.",
        steps: ["Confirm the gazetted date falls before the deadline.", "Check for any court challenge that could postpone voting."],
        ageMins: 75,
      },
    ],
  },
  {
    id: "seed-newsgap-product",
    question: "Will Company Y ship its flagship product this quarter?",
    description:
      "Resolves YES if Company Y makes its flagship product generally available to customers before the end of the current quarter. A limited beta, a pre-order, or a paper launch does not count as shipping.",
    resolutionSource: "Company official availability announcement",
    endDays: 22,
    liquidity: 59000,
    volume: 240000,
    yesPrice: 0.66,
    noPrice: 0.34,
    analyses: [
      {
        pass: "obvious", model: "claude-sonnet-4-6", divergenceType: "world_state", divergenceScore: 7,
        edgeDirection: "NO", betSide: "NO", edgeScore: 55, ruleImpliedProbability: 0.25,
        expectedYesPayoutCents: 25, expectedNoPayoutCents: 90, yesPriceAtAnalysis: 0.66, noPriceAtAnalysis: 0.34,
        vibe: "Optimism around the launch event has pushed YES to two-thirds.",
        literal: "Shipping means general availability, not the beta that was actually announced. Suppliers are reporting component delays that push GA past the quarter.",
        reasoning: "The launch event generated hype, but the rules require general availability and the supply chain is signalling a slip. NO at 34 cents has real value here.",
        sourceFindings: "Two component suppliers disclosed delays on their earnings calls, and the company's own page lists the product as 'beta' rather than available ([bloomberg.com](https://www.bloomberg.com)).",
        steps: ["Check the product page for 'generally available' wording.", "Watch for a shipping-date announcement before quarter end."],
        ageMins: 95,
      },
    ],
  },
];

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production.");
  // Hard guard: never write demo data into the live Railway database, even when local .env is
  // pointed at it for read testing.
  const dbUrl = process.env.DATABASE_URL || "";
  if (/rlwy\.net|railway\.internal|\.railway\.app|proxy\.rlwy/i.test(dbUrl)) {
    throw new Error("Refusing to seed: DATABASE_URL points at a Railway database. Seed only against local Postgres.");
  }

  // Dev user (matches the dev-login bypass email) so account pages have content.
  const user = await p.user.upsert({
    where: { email: "sherancorera@gmail.com" },
    update: { isAdmin: true },
    create: { id: "seed-dev-user", email: "sherancorera@gmail.com", name: "Dev", isAdmin: true, emailVerified: new Date() },
  });

  for (const m of MARKETS) {
    const rulesHash = `rules-${m.id}`;
    await p.market.upsert({
      where: { id: m.id },
      update: {
        question: m.question, description: m.description, resolutionSource: m.resolutionSource ?? null,
        endDate: future(m.endDays), liquidity: m.liquidity, volume: m.volume, yesPrice: m.yesPrice, noPrice: m.noPrice,
        active: true, closed: false, eventTitle: m.eventTitle ?? null, groupItemTitle: m.groupItemTitle ?? null,
        rulesHash, lastIngestedAt: new Date(),
      },
      create: {
        id: m.id, conditionId: `cond-${m.id}`, slug: m.id, question: m.question, description: m.description,
        resolutionSource: m.resolutionSource ?? null, endDate: future(m.endDays), startDate: future(-30),
        liquidity: m.liquidity, volume: m.volume, outcomes: '["Yes","No"]',
        outcomePrices: JSON.stringify([m.yesPrice, m.noPrice]), yesPrice: m.yesPrice, noPrice: m.noPrice,
        active: true, closed: false, eventTitle: m.eventTitle ?? null, eventSlug: m.eventTitle ? `${m.id}-event` : null,
        groupItemTitle: m.groupItemTitle ?? null, rulesHash,
      },
    });

    for (const a of m.analyses) {
      const id = `${m.id}-${a.pass}`;
      const data = {
        marketId: m.id, rulesHash, pass: a.pass, model: a.model,
        vibeInterpretation: a.vibe, literalInterpretation: a.literal,
        divergenceType: a.divergenceType, divergenceScore: a.divergenceScore, edgeDirection: a.edgeDirection,
        ruleImpliedProbability: a.ruleImpliedProbability ?? null,
        expectedYesPayoutCents: a.expectedYesPayoutCents ?? null, expectedNoPayoutCents: a.expectedNoPayoutCents ?? null,
        verificationSteps: a.steps ? JSON.stringify(a.steps) : null,
        reasoning: a.reasoning, sourceFindings: a.sourceFindings ?? null,
        yesPriceAtAnalysis: a.yesPriceAtAnalysis ?? null, noPriceAtAnalysis: a.noPriceAtAnalysis ?? null,
        liquidityAtAnalysis: m.liquidity, edgeScore: a.edgeScore, betSide: a.betSide,
        priceGap: a.ruleImpliedProbability != null ? a.ruleImpliedProbability - m.yesPrice : null,
        directionAgreement: true, costUsd: a.pass === "gpt_deep" ? 1.4 : a.pass === "opus" || a.pass === "synthesis" ? 0.4 : 0.005,
        createdAt: ago(a.ageMins),
      };
      await p.analysis.upsert({ where: { id }, update: data, create: { id, ...data } });
    }
  }

  // Bookmarks
  for (const mid of ["seed-fed-march", "seed-ceasefire-june"]) {
    await p.bookmark.upsert({
      where: { userId_marketId: { userId: user.id, marketId: mid } },
      update: {}, create: { userId: user.id, marketId: mid },
    });
  }

  // Votes (one up, one down)
  const voteData = [
    { marketId: "seed-fed-march", analysisId: "seed-fed-march-synthesis", direction: 1 },
    { marketId: "seed-nyc-mayor", analysisId: "seed-nyc-mayor-opus", direction: -1 },
  ];
  for (const v of voteData) {
    await p.vote.upsert({
      where: { userId_marketId: { userId: user.id, marketId: v.marketId } },
      update: { direction: v.direction, analysisId: v.analysisId },
      create: { userId: user.id, marketId: v.marketId, analysisId: v.analysisId, direction: v.direction },
    });
  }

  // Bets (open, won, lost) for the My bets page
  const bets = [
    { id: "seed-bet-1", marketId: "seed-fed-march", side: "YES", priceAtBet: 0.42, sizeUsd: 50, status: "open", pnlUsd: null, rationale: "Rules pin it to the March meeting and guidance points to a cut." },
    { id: "seed-bet-2", marketId: "seed-nyc-mayor", side: "NO", priceAtBet: 0.38, sizeUsd: 25, status: "won", pnlUsd: 40.8, rationale: "Front-runner never got certified." },
    { id: "seed-bet-3", marketId: "seed-newsgap-elections", side: "YES", priceAtBet: 0.4, sizeUsd: 30, status: "lost", pnlUsd: -30, rationale: "Court challenge postponed the vote." },
  ];
  for (const b of bets) {
    await p.bet.upsert({
      where: { id: b.id },
      update: { side: b.side, priceAtBet: b.priceAtBet, sizeUsd: b.sizeUsd, status: b.status, pnlUsd: b.pnlUsd, rationale: b.rationale },
      create: { id: b.id, userId: user.id, marketId: b.marketId, analysisId: `${b.marketId}-opus`, side: b.side, priceAtBet: b.priceAtBet, sizeUsd: b.sizeUsd, status: b.status, pnlUsd: b.pnlUsd, rationale: b.rationale, resolvedAt: b.status === "open" ? null : new Date() },
    });
  }

  const counts = { markets: await p.market.count(), analyses: await p.analysis.count(), bookmarks: await p.bookmark.count(), votes: await p.vote.count(), bets: await p.bet.count() };
  console.log("Seeded:", JSON.stringify(counts));
  await p.$disconnect();
}

main().catch(async (e) => { console.error(e); await p.$disconnect(); process.exit(1); });
