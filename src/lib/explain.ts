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

export function humanizeTimeRemaining(endDate: Date | string | null | undefined): string {
  if (!endDate) return "no deadline";
  const d = typeof endDate === "string" ? new Date(endDate) : endDate;
  const ms = d.getTime() - Date.now();
  if (ms < 0) {
    const ago = Math.abs(ms);
    if (ago < 86400000) return `closed ${Math.round(ago / 3600000)}h ago`;
    return `closed ${Math.round(ago / 86400000)}d ago`;
  }
  const hours = ms / 3600000;
  if (hours < 1) return `resolves in ${Math.round(ms / 60000)}m`;
  if (hours < 48) return `resolves in ${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 60) return `resolves in ${Math.round(days)}d`;
  return `resolves in ${Math.round(days / 30)}mo`;
}
