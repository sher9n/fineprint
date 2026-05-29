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
    const { submitVerifierBatch, pickMarketsForOpusFirstPass } = await import("@/lib/batch");
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
      // Scenario A: Opus 4.7 + web_search + sibling context on every eligible market. Single
      // batch per day, no separate first-pass / escalation. Calibrated 2026-05-29: ~$27/day
      // at 2000 markets, ~10x more candidate flags than Sonnet→escalation triage at similar
      // total spend. See conversation 2026-05-29 for cost analysis.
      const markets = await pickMarketsForOpusFirstPass(2000);
      let batchId: string | null = null;
      if (markets.length > 0) {
        batchId = await submitVerifierBatch(markets);
        console.log(`[scheduler] Opus+ws batch ${batchId} submitted (${markets.length} markets)`);
      } else {
        console.log(`[scheduler] no markets to analyze; skipping batch submission`);
      }
      await prisma.ingestRun.update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          status: "success",
          marketsAdded: ing.added,
          marketsUpdated: ing.updated,
          marketsAnalyzed: markets.length,
          opusCalls: markets.length,
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

  // Catch up if today's scheduled run was missed (e.g., dev server restarted after 5am IST).
  setTimeout(() => catchUpDailyRunIfMissed(hour), 5000);
}
