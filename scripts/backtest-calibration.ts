/**
 * Phase 1: Calibration backtest.
 *
 * Joins every Analysis to its market, keeps the ones whose market has since
 * resolved to a clean binary outcome, and asks the only question that matters
 * before trusting any pick: does the model's `ruleImpliedProbability` carry
 * information the market price did not already have?
 *
 * Ground truth: for a resolved market, Market.yesPrice is the final
 * outcomePrices[yesIdx], i.e. ~1 if YES won or ~0 if NO won (see
 * src/lib/polymarket.ts). Closed markets with a mid price are treated as
 * ambiguous (voided / UMA-pending / non-binary) and excluded.
 *
 * Metrics:
 *   - Brier score + log-loss of model P(YES) vs market price vs realized outcome
 *   - betSide hit-rate and naive P&L per share at the entry price
 *   - head-to-head on >=20pp model-vs-market disagreements (who was closer)
 *   - favorite-longshot table (realized YES rate by entry-price band)
 *
 * Read-only. No LLM calls, no writes. Run against prod with the public proxy URL:
 *   DATABASE_URL="<public proxy url>" npx tsx scripts/backtest-calibration.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Row = {
  pass: string;
  pModel: number | null; // ruleImpliedProbability (P(YES) under literal rules)
  entryYes: number | null; // yesPriceAtAnalysis (market price when we judged it)
  entryNo: number | null; // noPriceAtAnalysis, or 1 - entryYes
  betSide: string;
  divergenceScore: number;
  marketId: string;
  resolvedYes: boolean;
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const clip = (p: number, lo = 1e-3, hi = 1 - 1e-3) => Math.min(hi, Math.max(lo, p));
const pct = (x: number) => (100 * x).toFixed(1) + "%";
const se = (p: number, n: number) => (n > 0 ? Math.sqrt((p * (1 - p)) / n) : NaN);

function report(label: string, subset: Row[]) {
  const usable = subset.filter((r) => r.pModel != null && r.entryYes != null);
  const n = usable.length;
  console.log(`\n## ${label}  (n=${n})`);
  if (n < 5) {
    console.log("   insufficient sample (n<5)");
    return;
  }
  const y = (r: Row) => (r.resolvedYes ? 1 : 0);
  const baseYes = mean(usable.map(y));
  const brierModel = mean(usable.map((r) => (clip(r.pModel!) - y(r)) ** 2));
  const brierMkt = mean(usable.map((r) => (clip(r.entryYes!) - y(r)) ** 2));
  const llModel = mean(usable.map((r) => -(y(r) * Math.log(clip(r.pModel!)) + (1 - y(r)) * Math.log(1 - clip(r.pModel!)))));
  const llMkt = mean(usable.map((r) => -(y(r) * Math.log(clip(r.entryYes!)) + (1 - y(r)) * Math.log(1 - clip(r.entryYes!)))));
  console.log(`   base rate YES: ${pct(baseYes)}`);
  console.log(`   Brier    model=${brierModel.toFixed(4)}  market=${brierMkt.toFixed(4)}  -> ${brierModel < brierMkt ? "MODEL" : "MARKET"} better by ${Math.abs(brierModel - brierMkt).toFixed(4)}`);
  console.log(`   LogLoss  model=${llModel.toFixed(4)}  market=${llMkt.toFixed(4)}  -> ${llModel < llMkt ? "MODEL" : "MARKET"} better`);

  const directional = usable.filter((r) => r.betSide === "YES" || r.betSide === "NO");
  if (directional.length) {
    const sideStat = (side: "YES" | "NO") => {
      const b = directional.filter((r) => r.betSide === side);
      let wins = 0;
      let pnl = 0;
      for (const r of b) {
        const win = side === "YES" ? r.resolvedYes : !r.resolvedYes;
        if (win) wins++;
        pnl += (win ? 1 : 0) - (side === "YES" ? r.entryYes! : r.entryNo!);
      }
      return { n: b.length, wins, pnl };
    };
    const yes = sideStat("YES");
    const no = sideStat("NO");
    const wins = yes.wins + no.wins;
    const pnl = yes.pnl + no.pnl;
    const hr = wins / directional.length;
    console.log(`   betSide bets: ${directional.length}  hit-rate=${pct(hr)} (se ${pct(se(hr, directional.length))})  avg P&L/share=$${(pnl / directional.length).toFixed(3)}  total=$${pnl.toFixed(2)}`);
    if (yes.n) console.log(`      YES bets: ${yes.n}  hit=${pct(yes.wins / yes.n)}  P&L/share=$${(yes.pnl / yes.n).toFixed(3)}`);
    if (no.n) console.log(`      NO  bets: ${no.n}  hit=${pct(no.wins / no.n)}  P&L/share=$${(no.pnl / no.n).toFixed(3)}  [vs ${pct(1 - mean(usable.map((r) => (r.resolvedYes ? 1 : 0))))} = blind-NO base rate]`);
  }

  const dis = usable.filter((r) => Math.abs(r.pModel! - r.entryYes!) >= 0.2);
  if (dis.length) {
    const modelCloser = dis.filter((r) => Math.abs(r.pModel! - y(r)) < Math.abs(r.entryYes! - y(r))).length;
    const f = modelCloser / dis.length;
    console.log(`   >=20pp disagreements: ${dis.length}  model-closer-to-outcome=${pct(f)} (se ${pct(se(f, dis.length))})  [<50% => big edges are model errors]`);
  }
}

function longshot(rows: Row[]) {
  const usable = rows.filter((r) => r.entryYes != null);
  const bands: [number, number][] = [
    [0, 0.05], [0.05, 0.15], [0.15, 0.35], [0.35, 0.65], [0.65, 0.85], [0.85, 0.95], [0.95, 1.0001],
  ];
  console.log(`\n## Favorite-longshot: realized YES rate by entry price band  (YES side, n=${usable.length})`);
  console.log(`   band        |   n  | avg price | realized YES`);
  for (const [lo, hi] of bands) {
    const b = usable.filter((r) => r.entryYes! >= lo && r.entryYes! < hi);
    if (!b.length) continue;
    console.log(`   ${lo.toFixed(2)}-${hi.toFixed(2)} | ${String(b.length).padStart(4)} | ${pct(mean(b.map((r) => r.entryYes!))).padStart(8)} | ${pct(mean(b.map((r) => (r.resolvedYes ? 1 : 0))))}`);
  }
}

async function main() {
  const [mktTotal, mktClosed, anaTotal] = await Promise.all([
    prisma.market.count(),
    prisma.market.count({ where: { closed: true } }),
    prisma.analysis.count(),
  ]);

  const raw = await prisma.analysis.findMany({
    where: { market: { closed: true } },
    select: {
      pass: true,
      ruleImpliedProbability: true,
      yesPriceAtAnalysis: true,
      noPriceAtAnalysis: true,
      betSide: true,
      divergenceScore: true,
      market: { select: { id: true, yesPrice: true } },
    },
  });

  const rows: Row[] = [];
  let ambiguous = 0;
  for (const a of raw) {
    const yp = a.market.yesPrice;
    if (yp == null) {
      ambiguous++;
      continue;
    }
    let resolvedYes: boolean;
    if (yp >= 0.98) resolvedYes = true;
    else if (yp <= 0.02) resolvedYes = false;
    else {
      ambiguous++; // closed but not cleanly resolved to YES/NO
      continue;
    }
    rows.push({
      pass: a.pass,
      pModel: a.ruleImpliedProbability,
      entryYes: a.yesPriceAtAnalysis,
      entryNo: a.noPriceAtAnalysis ?? (a.yesPriceAtAnalysis != null ? 1 - a.yesPriceAtAnalysis : null),
      betSide: a.betSide,
      divergenceScore: a.divergenceScore,
      marketId: a.market.id,
      resolvedYes,
    });
  }

  console.log("=".repeat(70));
  console.log("CALIBRATION BACKTEST");
  console.log("=".repeat(70));
  console.log(`markets total:            ${mktTotal.toLocaleString()}`);
  console.log(`markets closed:           ${mktClosed.toLocaleString()}`);
  console.log(`analyses total:           ${anaTotal.toLocaleString()}`);
  console.log(`analyses on closed mkts:  ${raw.length.toLocaleString()}`);
  console.log(`  -> cleanly resolved:    ${rows.length.toLocaleString()}`);
  console.log(`  -> ambiguous (skipped): ${ambiguous.toLocaleString()} (void / pending / non-binary / stale price)`);
  console.log(`resolved YES share:       ${rows.length ? pct(mean(rows.map((r) => (r.resolvedYes ? 1 : 0)))) : "n/a"}`);

  // De-duplicate to the latest analysis per (market,pass)? For a first read we report
  // all analyses (each was a real prediction); correlated re-scans of the same market
  // are a known caveat noted in the writeup.
  report("ALL passes", rows);
  const passes = Array.from(new Set(rows.map((r) => r.pass))).sort();
  for (const p of passes) report(`pass=${p}`, rows.filter((r) => r.pass === p));

  longshot(rows);

  console.log("\nNote: P&L is per 1 share bought at the last price at analysis time; it ignores");
  console.log("bid/ask spread and slippage, so realized P&L on thin books would be lower.\n");

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
