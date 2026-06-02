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
    const { submitDailyOpusPasses } = await import("@/lib/batch");
    const { ensureSettings } = await import("@/lib/bootstrap");
    const { embedPendingMarkets } = await import("@/lib/embeddings");
    const { prisma } = await import("@/lib/prisma");
    await ensureSettings();
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
      // Daily dual-batch pipeline (asymmetric cooldowns), see submitDailyOpusPasses:
      //   VERIFIER (opus, rule-divergence) re-scans on a LONG cooldown since rules are stable;
      //   OBVIOUS (world-state mispricing) re-scans on a SHORT cooldown since facts move. Each picks
      //   its own candidate set, so the expensive verifier isn't burned re-deriving stable verdicts
      //   and freed budget flows to never-scanned lower-liquidity markets. Separate ingestion
      //   (verifier -> pass='opus', obvious -> pass='obvious') feeds the Opportunities vs Mispricings tabs.
      const res = await submitDailyOpusPasses();
      if (res.verifierBatchId) console.log(`[scheduler] verifier (fineprint) batch ${res.verifierBatchId} submitted (${res.verifierCount} markets, cooldown ${res.verifierCooldownH}h)`);
      else console.log(`[scheduler] verifier: no markets due (cooldown ${res.verifierCooldownH}h)`);
      if (res.obviousBatchId) console.log(`[scheduler] obvious (mispricings) batch ${res.obviousBatchId} submitted (${res.obviousCount} markets, cooldown ${res.obviousCooldownH}h)`);
      else console.log(`[scheduler] obvious: no markets due (cooldown ${res.obviousCooldownH}h)`);
      res.errors.forEach((m) => console.error(`[scheduler] batch submit failed: ${m}`));
      await prisma.ingestRun.update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          // "partial" (not "success") when a sub-batch submit threw, so the failure is visible in
          // the DB / admin Runs page instead of being silently swallowed into a green run.
          status: res.errors.length > 0 ? "partial" : "success",
          errors: res.errors.length > 0 ? res.errors.join(" | ") : null,
          marketsAdded: ing.added,
          marketsUpdated: ing.updated,
          marketsAnalyzed: res.verifierCount + res.obviousCount,
          opusCalls: res.verifierCount + res.obviousCount,
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
    const { pollAndIngestBatches } = await import("@/lib/batch");
    const r = await pollAndIngestBatches();
    if (r.ingested > 0) console.log(`[scheduler] batch poll ingested ${r.ingested} analyses`);
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
