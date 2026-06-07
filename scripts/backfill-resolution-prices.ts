/**
 * Phase 0.5: pre-resolution price backfill + favorite-longshot study (at scale).
 *
 * For an unbiased random sample of resolved binary markets, recover the YES price
 * at a fixed horizon BEFORE endDate (so the price is not yet converged and is
 * comparable across markets, and matches a short-hold "buy N hours before
 * resolution" trade). Then tabulate realized YES rate by price band: the
 * population-wide favorite-longshot curve, free of the selection bias in the
 * Phase 1 sample (which only covered markets we chose to analyze).
 *
 * Chain per market: prod (id, resolved outcome, endDate) -> Gamma /markets?id&closed=true
 * (clobTokenIds) -> CLOB /prices-history -> price at endDate - ANCHOR_HOURS.
 *
 * Resumable: appends one JSON line per processed market; re-running skips done ids.
 * Read-only on prod, no LLM. Writes only the local JSONL.
 *
 *   DATABASE_URL="<public proxy>" SAMPLE=6000 ANCHOR_HOURS=24 CONCURRENCY=6 \
 *     npx tsx scripts/backfill-resolution-prices.ts
 *   # SAMPLE=0 processes ALL eligible closed markets.
 */
import { PrismaClient } from "@prisma/client";
import { appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const GAMMA = process.env.POLYMARKET_GAMMA_URL || "https://gamma-api.polymarket.com";
const CLOB = process.env.POLYMARKET_CLOB_URL || "https://clob.polymarket.com";
const OUT = process.env.OUT || "/tmp/fp-resprices.jsonl";
const SAMPLE = parseInt(process.env.SAMPLE || "6000", 10); // 0 = all
const ANCHOR_HOURS = parseInt(process.env.ANCHOR_HOURS || "24", 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || "6", 10);
const MIN_GAP_HOURS = parseInt(process.env.MIN_GAP_HOURS || "6", 10); // ref price must be >= this far before end

const prisma = new PrismaClient();

type Rec = { id: string; resolvedYes: boolean; refPrice: number | null; gapHours: number | null; nPts: number; spanDays: number; err?: string };

const toArr = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") { try { const p = JSON.parse(v); return Array.isArray(p) ? p.map(String) : []; } catch { return []; } }
  return [];
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (x: number) => (100 * x).toFixed(1) + "%";

async function withRetry<T>(fn: () => Promise<T>, label: string, tries = 4): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const transient = /ECONNRESET|ETIMEDOUT|fetch failed|EAI_AGAIN|ENETUNREACH| 5\d\d| 429/.test(msg);
      if (!transient || i === tries - 1) { return null; }
      await sleep(500 * 2 ** i + Math.floor(Math.random() * 250));
    }
  }
  return null;
}

async function gammaTokens(id: string): Promise<{ yesToken: string; endDate: number | null } | null> {
  const fetchOne = async (qs: string) => {
    const res = await fetch(`${GAMMA}/markets?id=${encodeURIComponent(id)}${qs}&limit=1`, { headers: { accept: "application/json" } });
    if (res.status === 429 || res.status >= 500) throw new Error(`gamma ${res.status}`);
    if (!res.ok) return [] as Record<string, unknown>[];
    const a = (await res.json()) as Record<string, unknown>[];
    return Array.isArray(a) ? a : [];
  };
  let data = await fetchOne("");
  if (data.length === 0) data = await fetchOne("&closed=true");
  const m = data[0];
  if (!m) return null;
  const outcomes = toArr(m.outcomes);
  const tokens = toArr(m.clobTokenIds);
  const yesIdx = outcomes.findIndex((o) => o.toLowerCase() === "yes");
  if (yesIdx < 0 || !tokens[yesIdx]) return null;
  const end = m.endDate ? Math.floor(new Date(String(m.endDate)).getTime() / 1000) : null;
  return { yesToken: tokens[yesIdx], endDate: end };
}

async function clobHistory(tokenId: string): Promise<{ t: number; p: number }[]> {
  const res = await fetch(`${CLOB}/prices-history?market=${encodeURIComponent(tokenId)}&interval=max&fidelity=1440`, { headers: { accept: "application/json" } });
  if (res.status === 429 || res.status >= 500) throw new Error(`clob ${res.status}`);
  if (!res.ok) return [];
  const j = (await res.json()) as { history?: { t: number; p: number }[] };
  return j.history ?? [];
}

async function processOne(row: { id: string; resolvedYes: boolean; endDate: Date | null }): Promise<Rec> {
  const base: Rec = { id: row.id, resolvedYes: row.resolvedYes, refPrice: null, gapHours: null, nPts: 0, spanDays: 0 };
  const tok = await withRetry(() => gammaTokens(row.id), `gamma ${row.id}`);
  if (!tok) return { ...base, err: "no-token" };
  const hist = await withRetry(() => clobHistory(tok.yesToken), `clob ${row.id}`);
  if (!hist || hist.length === 0) return { ...base, err: "no-history" };
  const first = hist[0], last = hist[hist.length - 1];
  base.nPts = hist.length;
  base.spanDays = (last.t - first.t) / 86400;
  // Anchor to prod endDate (guaranteed present by the eligibility query), else last sample.
  const endTs = row.endDate ? Math.floor(row.endDate.getTime() / 1000) : last.t;
  const anchor = endTs - ANCHOR_HOURS * 3600;
  const pt = [...hist].reverse().find((h) => h.t <= anchor) ?? null;
  if (pt) { base.refPrice = pt.p; base.gapHours = (endTs - pt.t) / 3600; }
  return base;
}

function loadDone(): Set<string> {
  if (!existsSync(OUT)) return new Set();
  const ids = new Set<string>();
  for (const line of readFileSync(OUT, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { ids.add((JSON.parse(line) as Rec).id); } catch {}
  }
  return ids;
}

function printCurve() {
  if (!existsSync(OUT)) return;
  const recs: Rec[] = [];
  for (const line of readFileSync(OUT, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { recs.push(JSON.parse(line) as Rec); } catch {}
  }
  const usable = recs.filter((r) => r.refPrice != null && r.gapHours != null && r.gapHours >= MIN_GAP_HOURS);
  const bands: [number, number][] = [[0, 0.03], [0.03, 0.07], [0.07, 0.15], [0.15, 0.30], [0.30, 0.50], [0.50, 0.70], [0.70, 0.85], [0.85, 0.93], [0.93, 0.97], [0.97, 1.0001]];
  console.log(`\n=== Favorite-longshot curve (price at endDate - ${ANCHOR_HOURS}h, gap>=${MIN_GAP_HOURS}h) ===`);
  console.log(`processed=${recs.length}  usable=${usable.length}  (no-token=${recs.filter((r) => r.err === "no-token").length} no-history=${recs.filter((r) => r.err === "no-history").length})`);
  console.log(`   price band  |   n  | avg price | realized YES | edge (realized-price)`);
  for (const [lo, hi] of bands) {
    const b = usable.filter((r) => r.refPrice! >= lo && r.refPrice! < hi);
    if (!b.length) continue;
    const avgP = mean(b.map((r) => r.refPrice!));
    const realized = mean(b.map((r) => (r.resolvedYes ? 1 : 0)));
    const edge = realized - avgP;
    console.log(`   ${lo.toFixed(2)}-${hi.toFixed(2)}  | ${String(b.length).padStart(4)} | ${pct(avgP).padStart(8)} | ${pct(realized).padStart(11)} | ${(edge >= 0 ? "+" : "") + (100 * edge).toFixed(1)}pp`);
  }
}

async function main() {
  if (process.argv.includes("--curve-only")) { printCurve(); await prisma.$disconnect(); return; }
  mkdirSync(dirname(OUT), { recursive: true });
  const done = loadDone();

  // Eligible: closed, cleanly resolved (yesPrice ~0/1), endDate present.
  const all = await prisma.market.findMany({
    where: { closed: true, endDate: { not: null }, OR: [{ yesPrice: { gte: 0.98 } }, { yesPrice: { lte: 0.02 } }] },
    select: { id: true, yesPrice: true, endDate: true },
  });
  // Unbiased shuffle, then sample.
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  const targets = (SAMPLE > 0 ? all.slice(0, SAMPLE) : all)
    .filter((m) => !done.has(m.id))
    .map((m) => ({ id: m.id, resolvedYes: (m.yesPrice ?? 0) >= 0.98, endDate: m.endDate }));

  console.log(`eligible=${all.length.toLocaleString()}  sample=${SAMPLE || "all"}  already-done=${done.size}  to-fetch=${targets.length}  -> ${OUT}`);

  let i = 0, completed = 0;
  async function worker() {
    while (i < targets.length) {
      const row = targets[i++];
      const rec = await processOne(row);
      appendFileSync(OUT, JSON.stringify(rec) + "\n");
      completed++;
      if (completed % 250 === 0) { console.log(`  ${completed}/${targets.length} done...`); }
      await sleep(40); // gentle pacing
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  printCurve();
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
