import type { Market } from "@prisma/client";

export interface PrefilterResult {
  pass: boolean;
  reasons: string[];
  score: number;
}

const DATE_BOUND_PATTERNS = [
  /\bby\s+(?:the\s+)?(?:end\s+of\s+)?(?:[A-Z][a-z]+\s+\d{1,2}|\d{4}|january|february|march|april|may|june|july|august|september|october|november|december|q[1-4])/i,
  /\bbefore\s+(?:the\s+end\s+of\s+)?(?:[A-Z][a-z]+|\d{4}|q[1-4])/i,
  /\bon\s+or\s+before\b/i,
];

const THRESHOLD_PATTERNS = [
  /\b(?:above|below|over|under|at\s+least|more\s+than|less\s+than|exceed|reach|hit)\s+\d/i,
  /\b\d+(?:\.\d+)?\s*%\b/,
  /\$\s*\d/,
];

const NAMED_SOURCE_PATTERNS = [
  /according\s+to/i,
  /as\s+reported\s+by/i,
  /as\s+(?:determined|confirmed|announced)\s+by/i,
  /per\s+(?:the\s+)?(?:official|press)/i,
];

const AMBIGUITY_PATTERNS = [
  /\bofficially\b/i,
  /\bcredible\s+source\b/i,
  /\bconsensus\b/i,
  /\bsignificant\b/i,
];

export function prefilter(market: Pick<Market, "question" | "description" | "endDate" | "liquidity" | "yesPrice" | "noPrice">): PrefilterResult {
  const reasons: string[] = [];
  let score = 0;

  // Reject markets whose price has effectively collapsed. The "edge" against such a price is
  // illusory (it just reflects that the answer is already obvious) and burns LLM budget.
  if (
    (market.yesPrice != null && (market.yesPrice >= 0.99 || market.yesPrice <= 0.01)) ||
    (market.noPrice != null && (market.noPrice >= 0.99 || market.noPrice <= 0.01))
  ) {
    return { pass: false, score: -10, reasons: ["price_collapsed"] };
  }

  const text = `${market.question}\n${market.description}`;

  for (const p of DATE_BOUND_PATTERNS) {
    if (p.test(text)) {
      reasons.push("date_bound_phrasing");
      score += 3;
      break;
    }
  }

  for (const p of THRESHOLD_PATTERNS) {
    if (p.test(text)) {
      reasons.push("numeric_threshold");
      score += 2;
      break;
    }
  }

  for (const p of NAMED_SOURCE_PATTERNS) {
    if (p.test(market.description)) {
      reasons.push("named_resolution_source");
      score += 2;
      break;
    }
  }

  for (const p of AMBIGUITY_PATTERNS) {
    if (p.test(market.description)) {
      reasons.push("ambiguous_terms");
      score += 1;
      break;
    }
  }

  if (market.endDate) {
    const days = (market.endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (days < 1) {
      score -= 5;
      reasons.push("near_resolution");
    } else if (days <= 90) {
      score += 2;
      reasons.push("within_window");
    } else if (days > 365) {
      score -= 1;
    }
  }

  if (market.liquidity < 500) score -= 2;
  else if (market.liquidity >= 5000) score += 1;

  if (market.yesPrice != null) {
    if (market.yesPrice >= 0.8 || market.yesPrice <= 0.2) {
      score += 1;
      reasons.push("extreme_pricing");
    }
  }

  return { pass: score >= 3, score, reasons };
}
