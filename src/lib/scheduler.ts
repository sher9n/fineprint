import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { IST_TZ } from "./time";
import { llmCallsEnabled } from "./llm-gate";

function nextRunMs(hourIst: number): number {
  const todayIstDate = formatInTimeZone(new Date(), IST_TZ, "yyyy-MM-dd");
  let target = fromZonedTime(`${todayIstDate}T${String(hourIst).padStart(2, "0")}:00:00`, IST_TZ);
  if (target.getTime() <= Date.now()) {
    const tomorrowIstDate = formatInTimeZone(new Date(Date.now() + 24 * 60 * 60 * 1000), IST_TZ, "yyyy-MM-dd");
    target = fromZonedTime(`${tomorrowIstDate}T${String(hourIst).padStart(2, "0")}:00:00`, IST_TZ);
  }
  return target.getTime() - Date.now();
}

let dailyRunning = false;
let pollRunning = false;
let deepResearchPollRunning = false;
let refreshRunning = false;

async function fireDailyRun() {
  if (!llmCallsEnabled()) {
    console.log("[scheduler] daily run skipped: LLM_DISABLED is set");
    return;
  }
  if (dailyRunning) {
    console.log("[scheduler] daily run skipped: previous run still in progress");
    return;
  }
  dailyRunning = true;
  try {
    const { runIngest } = await import("@/lib/ingest");
    const { submitVerifierBatch, submitObviousBatch, pickMarketsForPass } = await import("@/lib/batch");
    const { ensureSettings } = await import("@/lib/bootstrap");
    const { embedPendingMarkets } = await import("@/lib/embeddings");
    const { prisma } = await import("@/lib/prisma");
    await ensureSettings();
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const cap = settings?.dailyMarketCap ?? 3200;
    const verifierCooldownH = settings?.verifierCooldownHours ?? 144;
    const obviousCooldownH = settings?.obviousCooldownHours ?? 48;
    const run = await prisma.ingestRun.create({ data: { kind: "scheduled", status: "running" } });
    try {
      const ing = await runIngest();
      // Embed any newly-ingested markets (and re-embed any that were nulled). This is free
      // (local model, no API), so we run it every day to keep the sibling-search index
      // fresh. Caps at 20K per run to bound wall time.
      try {
        const eRes = await embedPendingMarkets({ limit: 20000 });
        if (eRes.embedded > 0) console.log(`[scheduler] embedded ${eRes.embedded} markets (${eRes.errors} errors, ${eRes.remaining} still pending)`);
      } catch (e) {
        console.error(`[scheduler] embedPendingMarkets failed:`, String(e).slice(0, 200));
      }
      // Daily dual-batch pipeline (asymmetric cooldowns):
      //   1. VERIFIER (fineprint) — Opus 4.8 + ws + sibling context, asks "do the rules diverge
      //      from the lay reading in a way casual bettors miss?" Rules are stable, so it re-scans
      //      on a LONG cooldown (verifierCooldownHours, ~6d); a rulesHash change forces re-scan.
      //   2. OBVIOUS (mispricings) — Opus 4.8 + ws, no sibling context, asks "does world state
      //      already determine the outcome in a way the price doesn't reflect?" World-state moves,
      //      so it re-scans on a SHORT cooldown (obviousCooldownHours, ~2d).
      // Each pass picks its own candidate set (keyed on its own latest analysis), so the expensive
      // verifier isn't burned re-deriving stable verdicts. Freed budget flows to never-scanned
      // lower-liquidity markets. Separate ingestion (verifier → pass='opus', obvious → pass='obvious')
      // so the UI can surface them as Opportunities vs Mispricings tabs. Recalibrated 2026-06-02.
      const verifierMarkets = await pickMarketsForPass({ pass: "opus", maxAgeHours: verifierCooldownH, limit: cap });
      const obviousMarkets = await pickMarketsForPass({ pass: "obvious", maxAgeHours: obviousCooldownH, limit: cap });
      let verifierBatchId: string | null = null;
      let obviousBatchId: string | null = null;
      const submitErrors: string[] = [];
      if (verifierMarkets.length > 0) {
        try {
          verifierBatchId = await submitVerifierBatch(verifierMarkets);
          console.log(`[scheduler] verifier (fineprint) batch ${verifierBatchId} submitted (${verifierMarkets.length} markets, cooldown ${verifierCooldownH}h)`);
        } catch (e) {
          const msg = String(e instanceof Error ? e.message : e).slice(0, 300);
          submitErrors.push(`verifier: ${msg}`);
          console.error(`[scheduler] verifier batch submit failed:`, msg);
        }
      } else {
        console.log(`[scheduler] verifier: no markets due (cooldown ${verifierCooldownH}h)`);
      }
      if (obviousMarkets.length > 0) {
        try {
          obviousBatchId = await submitObviousBatch(obviousMarkets);
          console.log(`[scheduler] obvious (mispricings) batch ${obviousBatchId} submitted (${obviousMarkets.length} markets, cooldown ${obviousCooldownH}h)`);
        } catch (e) {
          const msg = String(e instanceof Error ? e.message : e).slice(0, 300);
          submitErrors.push(`obvious: ${msg}`);
          console.error(`[scheduler] obvious batch submit failed:`, msg);
        }
      } else {
        console.log(`[scheduler] obvious: no markets due (cooldown ${obviousCooldownH}h)`);
      }
      await prisma.ingestRun.update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          // "partial" (not "success") when a sub-batch submit threw, so the failure is visible in
          // the DB / admin Runs page instead of being silently swallowed into a green run.
          status: submitErrors.length > 0 ? "partial" : "success",
          errors: submitErrors.length > 0 ? submitErrors.join(" | ") : null,
          marketsAdded: ing.added,
          marketsUpdated: ing.updated,
          marketsAnalyzed: verifierMarkets.length + obviousMarkets.length,
          opusCalls: verifierMarkets.length + obviousMarkets.length,
        },
      });
      console.log("[scheduler] daily run done");
    } catch (e) {
      await prisma.ingestRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date(), status: "error", errors: String(e) },
      });
      console.error("[scheduler] daily run failed", e);
    }
  } catch (e) {
    console.error("[scheduler] init failed", e);
  } finally {
    dailyRunning = false;
  }
}

async function fireBatchPoll() {
  if (!llmCallsEnabled()) return; // silent: this runs every 5 min, would spam logs
  if (pollRunning) {
    console.log("[scheduler] batch poll skipped: previous poll still in progress");
    return;
  }
  pollRunning = true;
  try {
    const { pollAndIngestBatches, submitVerifierBatch, pickMarketsForVerifierBatch } = await import("@/lib/batch");
    const { prisma } = await import("@/lib/prisma");
    const r = await pollAndIngestBatches();
    if (r.ingested > 0) console.log(`[scheduler] batch poll ingested ${r.ingested} analyses`);

    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (settings?.batchModeEnabled) {
      const markets = await pickMarketsForVerifierBatch(50);
      if (markets.length > 0) {
        try {
          const batchId = await submitVerifierBatch(markets);
          console.log(`[scheduler] submitted verifier batch ${batchId} with ${markets.length} markets`);
        } catch (e) {
          console.error(`[scheduler] verifier batch submit failed:`, String(e).slice(0, 200));
        }
      }
    }
  } catch (e) {
    console.error("[scheduler] batch poll failed", e);
  } finally {
    pollRunning = false;
  }
}

async function fireDeepResearchPoll() {
  if (!llmCallsEnabled()) return; // silent: every 60s, would spam logs
  if (deepResearchPollRunning) return;
  deepResearchPollRunning = true;
  try {
    const { prisma } = await import("@/lib/prisma");
    const inflight = await prisma.deepResearchJob.count({
      where: { status: { in: ["queued", "in_progress"] } },
    });
    if (inflight === 0) return; // nothing to poll, save the import + API call
    const { pollDeepResearchJobs } = await import("@/lib/deep-research");
    const r = await pollDeepResearchJobs({ limit: 20 });
    if (r.completed > 0 || r.failed > 0) {
      console.log(`[scheduler] deep-research poll: polled=${r.polled} completed=${r.completed} failed=${r.failed} running=${r.stillRunning}`);
    }
  } catch (e) {
    console.error("[scheduler] deep-research poll failed", e);
  } finally {
    deepResearchPollRunning = false;
  }
}

async function fireMarketRefresh() {
  if (refreshRunning) return;
  refreshRunning = true;
  try {
    const { refreshSurfacedMarketPrices } = await import("@/lib/refresh");
    const r = await refreshSurfacedMarketPrices();
    if (r.updated > 0 || r.nowClosed > 0 || r.errors > 0) {
      console.log(`[scheduler] price refresh: checked ${r.checked}, updated ${r.updated}, now-closed ${r.nowClosed}, errors ${r.errors}`);
    }
  } catch (e) {
    console.error("[scheduler] price refresh failed", e);
  } finally {
    refreshRunning = false;
  }
}

async function catchUpDailyRunIfMissed(hourIst: number) {
  try {
    const { prisma } = await import("@/lib/prisma");
    const todayIst = formatInTimeZone(new Date(), IST_TZ, "yyyy-MM-dd");
    const todayCutoff = fromZonedTime(`${todayIst}T${String(hourIst).padStart(2, "0")}:00:00`, IST_TZ);
    if (Date.now() < todayCutoff.getTime()) return; // not yet 5am IST today

    const lastScheduled = await prisma.ingestRun.findFirst({
      where: { kind: "scheduled" },
      orderBy: { startedAt: "desc" },
    });
    if (lastScheduled && lastScheduled.startedAt.getTime() >= todayCutoff.getTime()) return; // already ran today

    console.log(`[scheduler] catching up: today's ${hourIst}:00 IST daily run was missed, firing now`);
    await fireDailyRun();
  } catch (e) {
    console.error("[scheduler] catch-up check failed", e);
  }
}

export function scheduleDaily() {
  const hour = parseInt(process.env.DAILY_RUN_HOUR_IST ?? "5", 10);
  const ms = nextRunMs(hour);
  console.log(`[scheduler] next daily run in ${(ms / 1000 / 60).toFixed(0)} min (target ${hour}:00 IST)`);
  setTimeout(async () => {
    await fireDailyRun();
    setInterval(fireDailyRun, 24 * 60 * 60 * 1000);
  }, ms);

  setInterval(fireBatchPoll, 5 * 60 * 1000);
  setTimeout(fireBatchPoll, 30 * 1000);

  // Poll OpenAI for in-flight deep-research jobs every 60s.
  setInterval(fireDeepResearchPoll, 60 * 1000);
  setTimeout(fireDeepResearchPoll, 10 * 1000);

  // Every 30 min: refresh live price + open/closed status for surfaced markets so cards don't show
  // stale prices or already-resolved markets between the daily 05:00 ingest. Edge-ordered coverage
  // (see refresh.ts) so thin-but-surfaced markets aren't stranded. Free (Gamma + DB only).
  setInterval(fireMarketRefresh, 30 * 60 * 1000);
  setTimeout(fireMarketRefresh, 90 * 1000);

  // Catch up if today's scheduled run was missed (e.g., dev server restarted after 5am IST).
  setTimeout(() => catchUpDailyRunIfMissed(hour), 5000);
}
