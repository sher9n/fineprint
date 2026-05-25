export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (g.__fineprint_scheduler) return;
  g.__fineprint_scheduler = true;
  const { scheduleDaily } = await import("@/lib/scheduler");
  scheduleDaily();
}
