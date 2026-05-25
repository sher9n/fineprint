import { clamp } from "./utils";

export interface ScoreInputs {
  divergenceScore: number;
  edgeDirection: "YES" | "NO" | "NONE";
  yesPrice: number | null;
  noPrice: number | null;
  liquidity: number;
  endDate: Date | null;
  ruleImpliedProbability: number | null;
  expectedYesPayoutCents: number | null;
  expectedNoPayoutCents: number | null;
  pass: "haiku" | "opus";
}

export interface ScoreResult {
  edgeScore: number;
  betSide: "YES" | "NO" | "NONE";
  priceGap: number | null;
  directionAgreement: boolean;
  yesEvPerDollar: number | null;
  noEvPerDollar: number | null;
}

export function computeEdge(i: ScoreInputs): ScoreResult {
  const empty: ScoreResult = { edgeScore: 0, betSide: "NONE", priceGap: null, directionAgreement: true, yesEvPerDollar: null, noEvPerDollar: null };

  if (i.divergenceScore < 4) return empty;

  let yesPayout: number | null = i.expectedYesPayoutCents;
  let noPayout: number | null = i.expectedNoPayoutCents;

  if (yesPayout == null && i.ruleImpliedProbability != null) {
    yesPayout = clamp(i.ruleImpliedProbability, 0, 1) * 100;
    noPayout = (1 - clamp(i.ruleImpliedProbability, 0, 1)) * 100;
  }

  if (yesPayout == null || noPayout == null || i.yesPrice == null) {
    if (i.edgeDirection === "NONE") return empty;
    const divergence = i.divergenceScore / 10;
    const liquidityScore = clamp(Math.log10(Math.max(1, i.liquidity)) / 5, 0, 1);
    const timeScore = timeFactor(i.endDate);
    const passWeight = i.pass === "opus" ? 1.0 : 0.85;
    const raw = 0.15 * 0.5 + divergence * 0.3 + liquidityScore * 0.1 + timeScore * 0.1;
    return {
      edgeScore: clamp(raw * passWeight * 0.7 * 100, 0, 100),
      betSide: i.edgeDirection,
      priceGap: null,
      directionAgreement: true,
      yesEvPerDollar: null,
      noEvPerDollar: null,
    };
  }

  const yesPrice = i.yesPrice * 100;
  const noPrice = (i.noPrice != null ? i.noPrice : 1 - i.yesPrice) * 100;

  const yesNetCents = yesPayout - yesPrice;
  const noNetCents = noPayout - noPrice;
  const yesEvPerDollar = yesPrice > 0 ? yesNetCents / yesPrice : 0;
  const noEvPerDollar = noPrice > 0 ? noNetCents / noPrice : 0;

  let betSide: "YES" | "NO" | "NONE";
  let priceGap: number;
  if (yesNetCents <= 0 && noNetCents <= 0) {
    return { ...empty, priceGap: 0, betSide: "NONE", yesEvPerDollar, noEvPerDollar };
  } else if (yesNetCents >= noNetCents) {
    betSide = "YES";
    priceGap = yesNetCents / 100;
  } else {
    betSide = "NO";
    priceGap = noNetCents / 100;
  }

  if (priceGap < 0.02) return { ...empty, priceGap, betSide, yesEvPerDollar, noEvPerDollar };

  const directionAgreement = i.edgeDirection === "NONE" ? false : i.edgeDirection === betSide;

  const divergence = i.divergenceScore / 10;
  const liquidityScore = clamp(Math.log10(Math.max(1, i.liquidity)) / 5, 0, 1);
  const timeScore = timeFactor(i.endDate);
  const passWeight = i.pass === "opus" ? 1.0 : 0.85;
  const directionMult = directionAgreement ? 1.0 : 0.6;

  const raw = priceGap * 0.5 + divergence * 0.3 + liquidityScore * 0.1 + timeScore * 0.1;
  const edgeScore = clamp(raw * passWeight * directionMult * 100, 0, 100);

  return { edgeScore, betSide, priceGap, directionAgreement, yesEvPerDollar, noEvPerDollar };
}

function timeFactor(endDate: Date | null): number {
  if (!endDate) return 0.5;
  const days = (endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (days < 1) return 0;
  if (days <= 30) return 1;
  if (days <= 90) return 0.8;
  if (days <= 180) return 0.5;
  return 0.3;
}

export function computeEdgeScore(i: ScoreInputs): number {
  return computeEdge(i).edgeScore;
}
