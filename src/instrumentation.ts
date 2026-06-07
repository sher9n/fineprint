export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  // Off-by-default kill switch (mirrors LLM_DISABLED). Lets a second instance, or a local
  // dev server pointed at the prod DB for read-only inspection, run without the scheduler's
  // ingest / batch-poll / price-refresh write paths firing. Production leaves this unset.
  if (process.env.SCHEDULER_DISABLED === "true") {
    console.log("[instrumentation] SCHEDULER_DISABLED=true — scheduler not started");
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (g.__fineprint_scheduler) return;
  g.__fineprint_scheduler = true;
  const { scheduleDaily } = await import("@/lib/scheduler");
  scheduleDaily();
}
