import { NextResponse } from "next/server";
import { runIngest } from "@/lib/ingest";
import { runAnalysisPass } from "@/lib/analyzer";
import { ensureSettings } from "@/lib/bootstrap";
import { prisma } from "@/lib/prisma";
import { pickMarketsForBatch, submitHaikuBatch } from "@/lib/batch";
import { requireAdmin } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

export async function POST() {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: gate.status });
  await ensureSettings();
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const useBatch = settings?.batchModeEnabled === true;
  const run = await prisma.ingestRun.create({ data: { kind: "daily", status: "running" } });
  try {
    const ingestRes = await runIngest();
    if (useBatch) {
      const markets = await pickMarketsForBatch(2000);
      let batchId: string | null = null;
      if (markets.length > 0) batchId = await submitHaikuBatch(markets);
      await prisma.ingestRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date(), status: "success", marketsAdded: ingestRes.added, marketsUpdated: ingestRes.updated },
      });
      return NextResponse.json({ ok: true, mode: "batch", ingest: ingestRes, batchSubmitted: markets.length, batchId });
    }
    const analyzeRes = await runAnalysisPass({ maxMarkets: 2000 });
    await prisma.ingestRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status: "success",
        marketsAdded: ingestRes.added,
        marketsUpdated: ingestRes.updated,
        marketsAnalyzed: analyzeRes.haikuRun,
        haikuCalls: analyzeRes.haikuRun,
        opusCalls: analyzeRes.verifierSubmitted,
      },
    });
    return NextResponse.json({ ok: true, mode: "sync", ingest: ingestRes, analyze: analyzeRes });
  } catch (err) {
    await prisma.ingestRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), status: "error", errors: String(err) },
    });
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
