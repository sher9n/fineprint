// Maps technical concepts to plain-English language for non-technical users.

export type ConfidenceLevel = "low" | "medium" | "high" | "very high";
export type AnalysisStage = "initial" | "confirmed";

export function confidenceLabel(divergenceScore: number): { label: string; level: ConfidenceLevel } {
  if (divergenceScore >= 8) return { label: "Very high", level: "very high" };
  if (divergenceScore >= 6) return { label: "High", level: "high" };
  if (divergenceScore >= 4) return { label: "Medium", level: "medium" };
  return { label: "Low", level: "low" };
}

export function stageLabel(pass: string): { label: string; stage: AnalysisStage; description: string } {
  if (pass === "opus") {
    return {
      label: "Confirmed with research",
      stage: "confirmed",
      description: "We re-checked this opportunity with web search to confirm the facts. Higher confidence.",
    };
  }
  return {
    label: "Initial analysis",
    stage: "initial",
    description: "Our first-pass read of the rules. Not yet confirmed against current real-world facts.",
  };
}

export function divergenceTypeLabel(type: string): { short: string; explainer: string } {
  switch (type) {
    case "date_bound":
      return { short: "Deadline mismatch", explainer: "The rules require the event to happen by a specific date, but most bettors are pricing it as if it could happen anytime." };
    case "threshold":
      return { short: "Specific threshold", explainer: "The rules require a precise number or threshold that the title's wording obscures." };
    case "ambiguous_source":
      return { short: "Source ambiguity", explainer: "The rules name a specific authority to resolve this, and that source may not behave as bettors assume." };
    case "specific_event":
      return { short: "Narrower event", explainer: "The title suggests a category, but the rules require one specific instance of that category." };
    case "definition_gap":
      return { short: "Wording gap", explainer: "A key term in the title is defined narrowly or technically in the rules in a way that changes the math." };
    case "other":
      return { short: "Other mismatch", explainer: "There's a meaningful gap between the rules and the casual reading, but it doesn't fit a standard pattern." };
    default:
      return { short: "No mismatch", explainer: "The rules match what most bettors would naturally assume." };
  }
}

export function describeBet({
  betSide,
  yesPrice,
  noPrice,
  expectedYesPayoutCents,
  expectedNoPayoutCents,
  ruleImpliedProbability,
}: {
  betSide: string;
  yesPrice: number | null;
  noPrice: number | null;
  expectedYesPayoutCents: number | null;
  expectedNoPayoutCents: number | null;
  ruleImpliedProbability: number | null;
}): { recommendation: string; entryCents: number | null; expectedCents: number | null; evPercent: number | null; netCents: number | null } {
  if (betSide !== "YES" && betSide !== "NO") {
    return { recommendation: "No clear bet right now", entryCents: null, expectedCents: null, evPercent: null, netCents: null };
  }
  let exp = betSide === "YES" ? expectedYesPayoutCents : expectedNoPayoutCents;
  if (exp == null && ruleImpliedProbability != null) {
    exp = (betSide === "YES" ? ruleImpliedProbability : 1 - ruleImpliedProbability) * 100;
  }
  const priceFraction = betSide === "YES" ? yesPrice : noPrice ?? (yesPrice != null ? 1 - yesPrice : null);
  if (priceFraction == null || exp == null) {
    return { recommendation: `Consider buying ${betSide}`, entryCents: null, expectedCents: null, evPercent: null, netCents: null };
  }
  const entry = priceFraction * 100;
  const ev = entry > 0 ? (exp - entry) / entry : 0;
  return {
    recommendation: `Buy ${betSide} at ${entry.toFixed(0)}¢ to win up to $1.00`,
    entryCents: entry,
    expectedCents: exp,
    netCents: exp - entry,
    evPercent: ev,
  };
}

/**
 * Resolve which side an analysis is implicitly recommending, agnostic of how the model
 * labeled `edge_direction`.
 *
 * Why this exists: the schema's `edge_direction` answers "which side does the LITERAL reading
 * favor over the VIBE reading?" — a divergence-direction, not a bet-direction. A confident
 * fact-finder that sees no rules-vs-vibe gap (divergence ~1) but estimates P(YES) = 1.0 against
 * a 49¢ price returns edge_direction = "NONE", which makes it look like it's saying "no bet" —
 * even though it's saying "buy YES, the market is just mispriced." The two ideas live in the
 * same field, and they shouldn't.
 *
 * Resolution order:
 *   1. If betSide is YES or NO (set by computeEdge from payouts vs price), trust it.
 *   2. Else if rule_implied_probability is set and far from the live YES price (>10pp gap),
 *      infer YES (when P > price) or NO (when P < price). This is the case computeEdge would
 *      have handled if divergenceScore had been >= 4, so we replicate the EV math here.
 *   3. Else fall back to the raw model edge_direction, mapped to YES/NO/NONE.
 *
 * Used wherever the UI asks "do Opus and GPT agree on the bet" — that question needs an
 * implied-bet-direction comparator, not a divergence-direction one.
 */
export function impliedBetSide(
  a: {
    betSide?: string | null;
    edgeDirection?: string | null;
    ruleImpliedProbability?: number | null;
  },
  yesPrice: number | null
): "YES" | "NO" | "NONE" {
  if (a.betSide === "YES" || a.betSide === "NO") return a.betSide;
  if (a.ruleImpliedProbability != null && yesPrice != null) {
    const gap = a.ruleImpliedProbability - yesPrice;
    if (gap > 0.1) return "YES";
    if (gap < -0.1) return "NO";
  }
  if (a.edgeDirection === "YES" || a.edgeDirection === "NO") return a.edgeDirection;
  return "NONE";
}

/**
 * Detect markets that have a tie-breaker / fallback rule. Two structures appear in practice:
 *   - "Resolves to Other" or no-payout fallback: sum(E_yes, E_no) < 1
 *   - "Resolves 50-50" fallback (the common one): sum(E_yes, E_no) stays at 1, but the model's
 *     literal rule_p disagrees with E_yes because some of the YES-payout probability mass comes
 *     from the fallback (E_yes = rule_p + 0.5 * p_fb).
 * The 50-50 case is invisible to a pure sum check, so we also compare E_yes against rule_p.
 */
export function hasThreeWayStructure(
  expectedYesPayoutCents: number | null,
  expectedNoPayoutCents: number | null,
  ruleImpliedProbability?: number | null
): boolean {
  if (expectedYesPayoutCents == null || expectedNoPayoutCents == null) return false;
  if (expectedYesPayoutCents + expectedNoPayoutCents < 95) return true;
  if (ruleImpliedProbability != null) {
    const eYes = expectedYesPayoutCents / 100;
    if (Math.abs(eYes - ruleImpliedProbability) > 0.05) return true;
  }
  return false;
}

/**
 * Solve for the three outcome probabilities of a market with a 50-50 fallback rule.
 *
 * Setup (50-50 fallback):
 *   p_yes + p_no + p_fb = 1
 *   E_yes = p_yes + 0.5 * p_fb
 *   E_no  = p_no  + 0.5 * p_fb
 * Two equations, three unknowns — under-determined. We close the system by accepting the model's
 * `rule_implied_probability` as p_yes (its estimate of the probability YES wins outright per the
 * literal rules). Then:
 *   p_fb = 2 * (E_yes - p_yes)
 *   p_no = 1 - p_yes - p_fb
 *
 * Returns null if any of the inputs is missing, the structure isn't actually three-way, or the
 * solved probabilities don't make sense (negatives or significantly off-1 sum). The caller should
 * gracefully omit the breakdown in those cases.
 */
export function solveThreeWay(
  ruleP: number | null,
  expectedYesCents: number | null,
  expectedNoCents: number | null
): { pYes: number; pNo: number; pFallback: number } | null {
  if (ruleP == null || expectedYesCents == null || expectedNoCents == null) return null;
  const eYes = expectedYesCents / 100;
  // Binary detection: if E_yes ≈ rule_p, p_fallback collapses to 0 and we'd just be displaying
  // p_yes / p_no as the binary outcomes. Skip the three-way breakdown entirely.
  if (Math.abs(eYes - ruleP) < 0.02) return null;
  const pYes = ruleP;
  const pFallback = 2 * (eYes - pYes);
  const pNo = 1 - pYes - pFallback;
  if (pFallback < -0.02 || pNo < -0.02 || pYes < 0) return null; // tiny tolerance for rounding
  // Clamp tiny negatives from rounding back to 0
  const clampedFb = Math.max(0, pFallback);
  const clampedNo = Math.max(0, pNo);
  if (Math.abs(pYes + clampedNo + clampedFb - 1) > 0.05) return null;
  return { pYes, pNo: clampedNo, pFallback: clampedFb };
}

export function fmtBetSize(sizeUsd: number, betSide: string, priceCents: number) {
  const sharesValue = sizeUsd / (priceCents / 100);
  const maxReturn = sharesValue;
  return { sharesValue, maxReturn, maxLoss: sizeUsd, betSide };
}

export function opportunityScoreLabel(edgeScore: number): { label: string; emoji: string; color: "green" | "amber" | "accent" | "muted" } {
  if (edgeScore >= 70) return { label: "Strong opportunity", emoji: "🔥", color: "green" };
  if (edgeScore >= 50) return { label: "Solid opportunity", emoji: "✨", color: "green" };
  if (edgeScore >= 30) return { label: "Worth a look", emoji: "👀", color: "amber" };
  if (edgeScore > 0) return { label: "Marginal", emoji: "💭", color: "accent" };
  return { label: "No edge", emoji: "", color: "muted" };
}

export function timeAgo(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const ms = Date.now() - new Date(d).getTime();
  if (ms < 0) return "just now";
  const m = ms / 60000;
  if (m < 1) return "just now";
  if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h ago`;
  const days = h / 24;
  if (days < 30) return `${Math.floor(days)}d ago`;
  const months = days / 30;
  if (months < 12) return `${Math.floor(months)}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

// Polymarket's `endDate` is the trading cutoff (when the orderbook closes), NOT the rules
// deadline. For grouped markets the gap is often weeks: e.g., the "June 30" outcome in a
// peace-deal series has endDate=May 31 because that's when the prior sibling's deadline hits.
// Labeling that as "resolves in 4d" misleads bettors into thinking they have 4 days of upside
// when in fact they have 4 days of trading and a month of frozen position.
export function humanizeTimeRemaining(endDate: Date | string | null | undefined): string {
  if (!endDate) return "no trading deadline";
  const d = typeof endDate === "string" ? new Date(endDate) : endDate;
  const ms = d.getTime() - Date.now();
  if (ms < 0) {
    const ago = Math.abs(ms);
    if (ago < 86400000) return `trading closed ${Math.round(ago / 3600000)}h ago`;
    return `trading closed ${Math.round(ago / 86400000)}d ago`;
  }
  const hours = ms / 3600000;
  if (hours < 1) return `trading ends in ${Math.round(ms / 60000)}m`;
  if (hours < 48) return `trading ends in ${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 60) return `trading ends in ${Math.round(days)}d`;
  return `trading ends in ${Math.round(days / 30)}mo`;
}

const MONTH_DAY_PATTERN = /^(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{1,2})(?:,\s*(\d{4}))?$/i;

/**
 * Parse a groupItemTitle like "June 30", "December 31, 2026", or "Jun 30" into a concrete date.
 * Returns null if the string isn't date-shaped (candidate names, money thresholds, etc).
 *
 * For dates without an explicit year, we derive the year from `referenceDate` (typically the
 * market's endDate). If the parsed date would be in the past relative to the reference, we roll
 * forward a year — handles Polymarket events that cross calendar boundaries (a "January 5"
 * outcome in a series running through Dec is January next year).
 */
function parseGroupItemTitleDate(
  groupItemTitle: string | null | undefined,
  referenceDate: Date | null
): Date | null {
  if (!groupItemTitle) return null;
  const m = groupItemTitle.trim().match(MONTH_DAY_PATTERN);
  if (!m) return null;
  const [, monthRaw, dayRaw, yearRaw] = m;
  const refYear = referenceDate ? referenceDate.getUTCFullYear() : new Date().getUTCFullYear();
  const year = yearRaw ? parseInt(yearRaw, 10) : refYear;
  // Date.parse handles "June 30 2026" reliably across V8. Force midnight UTC so the resulting
  // date matches how Polymarket renders these labels.
  const parsed = new Date(Date.UTC(year, monthIndex(monthRaw), parseInt(dayRaw, 10)));
  if (isNaN(parsed.getTime())) return null;
  // If we guessed the year and the parsed date is before the reference (or before now if no
  // reference), bump to next year.
  if (!yearRaw) {
    const cutoff = referenceDate ? referenceDate.getTime() : Date.now();
    if (parsed.getTime() < cutoff) parsed.setUTCFullYear(year + 1);
  }
  return parsed;
}

const MONTH_INDEX: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

function monthIndex(monthName: string): number {
  return MONTH_INDEX[monthName.toLowerCase()] ?? 0;
}

function formatResolutionDate(d: Date, includeYear: boolean): string {
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const month = months[d.getUTCMonth()];
  const day = d.getUTCDate();
  return includeYear ? `${month} ${day}, ${d.getUTCFullYear()}` : `${month} ${day}`;
}

/**
 * The display string for a market's time situation, factoring in both:
 *  - the trading-cutoff endDate from Polymarket, and
 *  - the rules-defined resolution date when we can infer it from groupItemTitle.
 *
 * For grouped markets with a date-shaped groupItemTitle (the common case for time-series
 * outcomes like "by June 30"), this shows "resolves by June 30" rather than the misleading
 * "trading ends in 4d" — bettors care when they get paid, not when the orderbook freezes.
 *
 * When trading has already closed but the rules resolution is still in the future, returns
 * "trading closed, resolves by June 30" so users understand the position is frozen but not yet
 * decided. Non-grouped markets or non-date groupItemTitles fall through to humanizeTimeRemaining.
 */
export function resolutionTimeline(
  endDate: Date | string | null | undefined,
  groupItemTitle: string | null | undefined
): string {
  const endDateObj = endDate ? (typeof endDate === "string" ? new Date(endDate) : endDate) : null;
  const resolveDate = parseGroupItemTitleDate(groupItemTitle, endDateObj);
  if (!resolveDate) return humanizeTimeRemaining(endDate);

  const now = Date.now();
  const ms = resolveDate.getTime() - now;
  // Show year only if it differs from the current calendar year or is more than ~9 months out.
  const currentYear = new Date().getUTCFullYear();
  const includeYear = resolveDate.getUTCFullYear() !== currentYear || ms > 9 * 30 * 86400000;
  const dateStr = formatResolutionDate(resolveDate, includeYear);

  if (ms < 0) return `resolved ${dateStr}`;

  const tradingClosed = endDateObj != null && endDateObj.getTime() < now;
  if (tradingClosed) return `trading closed, resolves by ${dateStr}`;
  return `resolves by ${dateStr}`;
}
