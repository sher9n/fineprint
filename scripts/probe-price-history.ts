/**
 * Phase 0.5 feasibility probe (not the backfill itself).
 *
 * Verifies we can recover a PRE-resolution YES price for a closed market we only
 * ever saw resolved. Chain: Gamma /markets?id=<id> -> clobTokenIds -> CLOB
 * /prices-history for the YES token -> pick a reference price well before close.
 *
 * Also reports endDate coverage on closed markets (anchoring concern), if
 * DATABASE_URL is set.
 *
 * Read-only, no writes, no LLM. Run:
 *   DATABASE_URL="<public proxy>" npx tsx scripts/probe-price-history.ts
 */
const GAMMA = process.env.POLYMARKET_GAMMA_URL || "https://gamma-api.polymarket.com";
const CLOB = process.env.POLYMARKET_CLOB_URL || "https://clob.polymarket.com";

// (id, what it resolved to) from prod
const SAMPLES: { id: string; resolved: "YES" | "NO"; note: string }[] = [
  { id: "502462", resolved: "YES", note: "ETH above $3,400 on June 21" },
  { id: "533177", resolved: "YES", note: "Chelsea dies in White Lotus S3" },
  { id: "502521", resolved: "NO", note: "Will Austria win" },
  { id: "501328", resolved: "NO", note: "Yale next to cancel commencement" },
];

function toArr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function gammaMarket(id: string): Promise<Record<string, unknown> | null> {
  // Listing endpoint defaults to open-only; resolved markets need &closed=true (see
  // fetchMarketById in src/lib/polymarket.ts).
  const fetchOne = async (extraQS: string) => {
    const res = await fetch(`${GAMMA}/markets?id=${encodeURIComponent(id)}${extraQS}&limit=1`, { headers: { accept: "application/json" } });
    if (!res.ok) {
      console.log(`   gamma ${id}${extraQS} -> HTTP ${res.status}`);
      return [] as Record<string, unknown>[];
    }
    const arr = (await res.json()) as Record<string, unknown>[];
    return Array.isArray(arr) ? arr : [];
  };
  let data = await fetchOne("");
  if (data.length === 0) data = await fetchOne("&closed=true");
  return data.length ? data[0] : null;
}

async function clobHistory(tokenId: string): Promise<{ t: number; p: number }[]> {
  // interval=max + daily fidelity returns the full life of the market.
  const res = await fetch(`${CLOB}/prices-history?market=${encodeURIComponent(tokenId)}&interval=max&fidelity=1440`);
  if (!res.ok) {
    console.log(`   clob history -> HTTP ${res.status}`);
    return [];
  }
  const j = (await res.json()) as { history?: { t: number; p: number }[] };
  return j.history ?? [];
}

async function main() {
  if (process.env.DATABASE_URL) {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const [closed, closedWithEnd, closedWithStart] = await Promise.all([
      prisma.market.count({ where: { closed: true } }),
      prisma.market.count({ where: { closed: true, endDate: { not: null } } }),
      prisma.market.count({ where: { closed: true, startDate: { not: null } } }),
    ]);
    console.log(`endDate coverage on closed markets:  ${closedWithEnd.toLocaleString()} / ${closed.toLocaleString()} (${((100 * closedWithEnd) / closed).toFixed(1)}%)`);
    console.log(`startDate coverage on closed markets:${closedWithStart.toLocaleString()} / ${closed.toLocaleString()} (${((100 * closedWithStart) / closed).toFixed(1)}%)`);
    await prisma.$disconnect();
  }

  for (const s of SAMPLES) {
    console.log(`\n[${s.id}] ${s.note}  (resolved ${s.resolved})`);
    const m = await gammaMarket(s.id);
    if (!m) continue;
    const outcomes = toArr(m.outcomes);
    const tokens = toArr(m.clobTokenIds);
    const yesIdx = outcomes.findIndex((o) => o.toLowerCase() === "yes");
    console.log(`   gamma: outcomes=${JSON.stringify(outcomes)} clobTokenIds=${tokens.length ? "present(" + tokens.length + ")" : "MISSING"} endDate=${m.endDate ?? "null"} startDate=${m.startDate ?? "null"} closed=${m.closed} outcomePrices=${JSON.stringify(m.outcomePrices)}`);
    if (yesIdx < 0 || !tokens[yesIdx]) {
      console.log(`   -> cannot map YES token`);
      continue;
    }
    const hist = await clobHistory(tokens[yesIdx]);
    if (!hist.length) {
      console.log(`   -> no price history returned`);
      continue;
    }
    const first = hist[0];
    const last = hist[hist.length - 1];
    const mid = hist[Math.floor(hist.length / 2)];
    const prices = hist.map((h) => h.p).sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];
    // price ~7 days before the last sample (anchored to series end, robust to null endDate)
    const cutoff = last.t - 7 * 86400;
    const before7 = [...hist].reverse().find((h) => h.t <= cutoff) ?? first;
    const days = (last.t - first.t) / 86400;
    console.log(`   history: ${hist.length} pts spanning ${days.toFixed(0)}d  | first=${first.p.toFixed(3)} mid=${mid.p.toFixed(3)} median=${median.toFixed(3)} T-7d=${before7.p.toFixed(3)} last=${last.p.toFixed(3)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
