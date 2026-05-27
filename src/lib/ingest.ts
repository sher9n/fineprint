import crypto from "node:crypto";
import { prisma } from "./prisma";
import { fetchAllOpenMarkets, fetchMarketById, normalize, type NormalizedMarket } from "./polymarket";

function hashRules(text: string) {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export interface IngestResult {
  runId: string;
  fetched: number;
  added: number;
  updated: number;
  skipped: number;
  rulesChanged: number;
  reconciledChecked: number;
  reconciledClosed: number;
  reconciledUpdated: number;
  reconciledErrors: number;
  durationMs: number;
}

export async function upsertMarket(m: NormalizedMarket): Promise<{ created: boolean; rulesChanged: boolean; closedFlipped: boolean }> {
  const newHash = hashRules(m.description);
  const existing = await prisma.market.findUnique({ where: { id: m.id } });
  const data = {
    conditionId: m.conditionId,
    slug: m.slug,
    question: m.question,
    description: m.description,
    resolutionSource: m.resolutionSource,
    endDate: m.endDate,
    startDate: m.startDate,
    liquidity: m.liquidity,
    volume: m.volume,
    outcomes: JSON.stringify(m.outcomes),
    outcomePrices: JSON.stringify(m.outcomePrices),
    yesPrice: m.yesPrice,
    noPrice: m.noPrice,
    active: m.active,
    closed: m.closed,
    imageUrl: m.imageUrl,
    eventTitle: m.eventTitle,
    eventSlug: m.eventSlug,
    groupItemTitle: m.groupItemTitle,
    negRiskMarketId: m.negRiskMarketId,
    rulesHash: newHash,
    lastIngestedAt: new Date(),
  };
  if (existing) {
    await prisma.market.update({ where: { id: m.id }, data });
    return {
      created: false,
      rulesChanged: existing.rulesHash !== newHash,
      closedFlipped: !existing.closed && m.closed,
    };
  }
  await prisma.market.create({ data: { id: m.id, ...data } });
  return { created: true, rulesChanged: false, closedFlipped: m.closed };
}

/**
 * Re-checks DB markets that we believe are active+open but didn't appear in the latest ingest sweep.
 * Polymarket drops closed markets from the active-filtered pages, so without this we'd never notice
 * a transition to closed and stale records would linger forever.
 */
export async function reconcileStaleMarkets(opts: {
  seenIds: Set<string>;
  cutoff: Date;
  concurrency?: number;
}): Promise<{ checked: number; closedFlipped: number; updated: number; errors: number }> {
  const concurrency = Math.max(1, Math.min(16, opts.concurrency ?? 8));
  const stale = await prisma.market.findMany({
    where: {
      active: true,
      closed: false,
      lastIngestedAt: { lt: opts.cutoff },
    },
    select: { id: true },
  });
  const targets = stale.filter((s) => !opts.seenIds.has(s.id)).map((s) => s.id);

  let checked = 0;
  let closedFlipped = 0;
  let updated = 0;
  let errors = 0;

  for (let i = 0; i < targets.length; i += concurrency) {
    const chunk = targets.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async (id) => {
        checked++;
        try {
          const raw = await fetchMarketById(id);
          if (!raw) return;
          const n = normalize(raw);
          if (!n || !n.description || n.description.length < 30) return;
          const r = await upsertMarket(n);
          updated++;
          if (r.closedFlipped) closedFlipped++;
        } catch (err) {
          errors++;
          console.error(`[reconcile] ${id} failed:`, String(err).slice(0, 200));
        }
      })
    );
  }

  return { checked, closedFlipped, updated, errors };
}

export async function runIngest(): Promise<IngestResult> {
  const startedAt = Date.now();
  const runStart = new Date();
  const run = await prisma.ingestRun.create({ data: { kind: "ingest", status: "running" } });

  try {
    const raw = await fetchAllOpenMarkets({ pageSize: 200, maxPages: 50 });
    const normalized = raw.map(normalize).filter(Boolean) as NormalizedMarket[];

    let added = 0;
    let updated = 0;
    let skipped = 0;
    let rulesChanged = 0;
    const seenIds = new Set<string>();

    for (const m of normalized) {
      if (!m.description || m.description.length < 30) {
        skipped++;
        continue;
      }
      seenIds.add(m.id);
      const r = await upsertMarket(m);
      if (r.created) added++;
      else updated++;
      if (r.rulesChanged) rulesChanged++;
    }

    const rec = await reconcileStaleMarkets({ seenIds, cutoff: runStart });

    await prisma.ingestRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status: "success",
        marketsAdded: added,
        marketsUpdated: updated + rec.updated,
      },
    });

    return {
      runId: run.id,
      fetched: normalized.length,
      added,
      updated,
      skipped,
      rulesChanged,
      reconciledChecked: rec.checked,
      reconciledClosed: rec.closedFlipped,
      reconciledUpdated: rec.updated,
      reconciledErrors: rec.errors,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    await prisma.ingestRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), status: "error", errors: String(err) },
    });
    throw err;
  }
}
