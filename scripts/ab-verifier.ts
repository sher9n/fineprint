import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { runOpusAnalysis } from "../src/lib/analyzer";

const N = Number(process.env.AB_N ?? 20);

function pad(s: string | number, n: number) {
  const v = String(s);
  return v.length >= n ? v : v + " ".repeat(n - v.length);
}

function fmtP(p: number | null | undefined) {
  return p == null ? "  ?  " : p.toFixed(2);
}

async function main() {
  console.log(`A/B verifier — Sonnet 4.6 (stored) vs ${process.env.VERIFIER_MODEL || "(unset)"} on ${N} markets\n`);

  const stored = await prisma.analysis.findMany({
    where: { pass: "opus" },
    orderBy: { createdAt: "desc" },
    take: N,
    include: { market: true },
  });

  console.log(`Loaded ${stored.length} markets with stored Sonnet verifier analysis.\n`);

  let totalCost = 0;
  let totalSearches = 0;
  const rows: Array<{
    id: string;
    title: string;
    yesPrice: number | null;
    sonnetDivS: number;
    opusDivS: number;
    sonnetType: string;
    opusType: string;
    sonnetEdge: string;
    opusEdge: string;
    sonnetP: number | null;
    opusP: number | null;
    sonnetYesPay: number | null;
    opusYesPay: number | null;
    sonnetNoPay: number | null;
    opusNoPay: number | null;
    cost: number;
    searches: number;
  }> = [];

  for (let i = 0; i < stored.length; i++) {
    const a = stored[i];
    const title = (a.market.eventTitle && a.market.groupItemTitle)
      ? `${a.market.eventTitle} — ${a.market.groupItemTitle}`
      : a.market.question;
    process.stdout.write(`[${String(i + 1).padStart(2)}/${stored.length}] ${title.slice(0, 60).padEnd(60)} `);
    try {
      const r = await runOpusAnalysis(a.market);
      if (!r) {
        console.log("(skipped — budget or parse)");
        continue;
      }
      totalCost += r.costUsd;
      totalSearches += r.webSearches;
      rows.push({
        id: a.marketId,
        title,
        yesPrice: a.market.yesPrice,
        sonnetDivS: a.divergenceScore,
        opusDivS: r.analysis.divergence_score,
        sonnetType: a.divergenceType,
        opusType: r.analysis.divergence_type,
        sonnetEdge: a.edgeDirection,
        opusEdge: r.analysis.edge_direction,
        sonnetP: a.ruleImpliedProbability,
        opusP: r.analysis.rule_implied_probability,
        sonnetYesPay: a.expectedYesPayoutCents,
        opusYesPay: r.analysis.expected_yes_payout_cents,
        sonnetNoPay: a.expectedNoPayoutCents,
        opusNoPay: r.analysis.expected_no_payout_cents,
        cost: r.costUsd,
        searches: r.webSearches,
      });
      console.log(`ok  $${r.costUsd.toFixed(3)}  (${r.webSearches} searches)`);
    } catch (e) {
      console.log(`ERR ${(e as Error).message}`);
    }
  }

  console.log(`\n\n==== SIDE-BY-SIDE (${rows.length} markets) ====\n`);
  for (const r of rows) {
    const dirFlip = r.sonnetEdge !== r.opusEdge;
    const divDelta = (r.opusDivS - r.sonnetDivS);
    const typeChg = r.sonnetType !== r.opusType;
    const pDelta = (r.opusP ?? 0) - (r.sonnetP ?? 0);

    const flag: string[] = [];
    if (dirFlip) flag.push("DIR_FLIP");
    if (Math.abs(divDelta) >= 2) flag.push("DIV±2");
    if (typeChg) flag.push("TYPE");
    if (Math.abs(pDelta) >= 0.10) flag.push("P±10pp");

    console.log(`\n${r.title.slice(0, 80)}`);
    console.log(`  mkt yes=${r.yesPrice != null ? (r.yesPrice * 100).toFixed(0) + "¢" : "?"}  ${flag.length ? "⚠ " + flag.join(", ") : ""}`);
    console.log(`                | ${pad("Sonnet 4.6", 18)} | ${pad("Opus 4.7", 18)} | Δ`);
    console.log(`  div_score     | ${pad(r.sonnetDivS, 18)} | ${pad(r.opusDivS, 18)} | ${divDelta > 0 ? "+" : ""}${divDelta}`);
    console.log(`  div_type      | ${pad(r.sonnetType, 18)} | ${pad(r.opusType, 18)} | ${typeChg ? "CHANGED" : ""}`);
    console.log(`  edge_dir      | ${pad(r.sonnetEdge, 18)} | ${pad(r.opusEdge, 18)} | ${dirFlip ? "FLIPPED" : ""}`);
    console.log(`  rule_p        | ${pad(fmtP(r.sonnetP), 18)} | ${pad(fmtP(r.opusP), 18)} | ${pDelta >= 0 ? "+" : ""}${pDelta.toFixed(2)}`);
    console.log(`  yes_payout¢   | ${pad(r.sonnetYesPay ?? "?", 18)} | ${pad(r.opusYesPay ?? "?", 18)} |`);
    console.log(`  no_payout¢    | ${pad(r.sonnetNoPay ?? "?", 18)} | ${pad(r.opusNoPay ?? "?", 18)} |`);
  }

  const flips = rows.filter((r) => r.sonnetEdge !== r.opusEdge).length;
  const divBig = rows.filter((r) => Math.abs(r.opusDivS - r.sonnetDivS) >= 2).length;
  const typeChg = rows.filter((r) => r.sonnetType !== r.opusType).length;
  const pBig = rows.filter((r) => Math.abs((r.opusP ?? 0) - (r.sonnetP ?? 0)) >= 0.10).length;
  const sonnetEquivCost = 0.142 * rows.length;

  console.log(`\n\n==== SUMMARY ====`);
  console.log(`Markets evaluated:        ${rows.length}`);
  console.log(`Edge direction flips:     ${flips}/${rows.length}  (${rows.length ? Math.round((flips / rows.length) * 100) : 0}%)`);
  console.log(`Big div_score moves (≥2): ${divBig}/${rows.length}  (${rows.length ? Math.round((divBig / rows.length) * 100) : 0}%)`);
  console.log(`Div_type changes:         ${typeChg}/${rows.length}  (${rows.length ? Math.round((typeChg / rows.length) * 100) : 0}%)`);
  console.log(`Big rule_p moves (≥0.10): ${pBig}/${rows.length}  (${rows.length ? Math.round((pBig / rows.length) * 100) : 0}%)`);
  console.log(`\nOpus cost (actual):       $${totalCost.toFixed(3)}  (avg $${(totalCost / Math.max(1, rows.length)).toFixed(3)}/market, ${totalSearches} web searches)`);
  console.log(`Sonnet equiv cost (est):  $${sonnetEquivCost.toFixed(3)}  (at $0.142/market)`);
  console.log(`Opus / Sonnet multiplier: ${(totalCost / Math.max(0.001, sonnetEquivCost)).toFixed(2)}×`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
