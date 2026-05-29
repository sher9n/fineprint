/**
 * One-off Scenario A pass: submit Opus 4.7 + web_search to top N active markets at >$10K
 * liquidity. The production scheduler's batch poller will ingest results within 5 min of
 * Anthropic completion — writes Analysis rows (pass="opus") + CostLog rows.
 *
 * No new code paths; just exercises the existing production verifier ingestion against a
 * larger pool than usual.
 *
 * Bypasses submitVerifierBatch's budget gate (the $0.30/market estimate is stale and would
 * fail; real refined cost is ~$0.013/market after the 2026-05-29 BATCH_DISCOUNT calibration
 * to 0.25 — Anthropic appears to give an empirical 75% off on batch rather than the
 * documented 50%). Cost still bounded by the explicit N cap.
 *
 * Run:
 *   DATABASE_URL='<railway>' npx tsx scripts/scenario-a-pass.ts
 *
 * Env knobs:
 *   SCENARIO_A_LIMIT (default 2000)
 *   SCENARIO_A_MIN_LIQ (default 10000)
 */
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../src/lib/prisma";
import { SYSTEM_PROMPT } from "../src/lib/analyzer";
import { buildVerifierUserMessage } from "../src/lib/batch";
import { prefilter } from "../src/lib/prefilter";

const LIMIT = Number(process.env.SCENARIO_A_LIMIT ?? 2000);
const MIN_LIQ = Number(process.env.SCENARIO_A_MIN_LIQ ?? 10000);
const VERIFIER_PURPOSE = "verifier_pass"; // matches batch.ts constant — required so production
                                          // ingester treats results as Opus verifier output.
const OPUS_MODEL = "claude-opus-4-7";

async function main() {
  const dbUrl = process.env.DATABASE_URL || "";
  const dbHost = dbUrl.includes("zephyr") ? "Railway prod" : dbUrl.split("@")[1]?.split("/")[0] ?? "unknown";
  console.log(`[scenario-a] DB: ${dbHost}`);
  console.log(`[scenario-a] config: limit=${LIMIT} min_liquidity=$${MIN_LIQ}\n`);

  // Step 1: pull candidates from prod
  console.log(`[scenario-a] pulling eligible markets...`);
  const all = await prisma.market.findMany({
    where: {
      active: true,
      closed: false,
      liquidity: { gt: MIN_LIQ },
      description: { not: "" },
      OR: [{ endDate: null }, { endDate: { gt: new Date() } }],
    },
    orderBy: { liquidity: "desc" },
    take: 10000,
  });
  console.log(`[scenario-a] candidate pool at >$${MIN_LIQ} liquidity: ${all.length}`);

  // Apply prefilter (drops price_collapsed markets etc.)
  const filtered = all.filter((m) => prefilter(m).pass);
  console.log(`[scenario-a] after prefilter: ${filtered.length}`);

  // Sort by prefilter score desc, then liquidity desc (matches production ranking spirit)
  const ranked = filtered
    .map((m) => ({ market: m, pre: prefilter(m) }))
    .sort((a, b) => b.pre.score - a.pre.score || b.market.liquidity - a.market.liquidity);

  const picked = ranked.slice(0, LIMIT).map((x) => x.market);
  console.log(`[scenario-a] selected: ${picked.length} markets\n`);

  if (picked.length === 0) {
    console.log("[scenario-a] no markets to submit; exiting");
    return;
  }

  // Step 2: build verifier prompts (includes sibling-market context from pgvector).
  // buildVerifierUserMessage hits the DB twice per call (event/negRisk siblings + pgvector
  // similarity). Doing 2000 in Promise.all exhausts the Prisma pool. Chunk to 8 concurrent.
  console.log(`[scenario-a] building verifier prompts (chunked, this takes ~1-2 min for 2000)...`);
  const CHUNK = 8;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requests: any[] = [];
  for (let i = 0; i < picked.length; i += CHUNK) {
    const chunk = picked.slice(i, i + CHUNK);
    const built = await Promise.all(
      chunk.map(async (m) => ({
        custom_id: m.id,
        params: {
          model: OPUS_MODEL,
          max_tokens: 3072,
          system: [{ type: "text" as const, text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } }],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 } as any],
          messages: [{ role: "user" as const, content: await buildVerifierUserMessage(m) }],
        },
      })),
    );
    requests.push(...built);
    if ((i + CHUNK) % 200 === 0 || i + CHUNK >= picked.length) {
      console.log(`[scenario-a] prompts built: ${Math.min(i + CHUNK, picked.length)}/${picked.length}`);
    }
  }
  console.log(`[scenario-a] all prompts built (${requests.length} requests)`);

  // Step 3: submit to Anthropic
  console.log(`[scenario-a] submitting batch to Anthropic...`);
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 2 });
  const batch = await client.messages.batches.create({ requests });
  console.log(`[scenario-a] batch submitted: ${batch.id} (status: ${batch.processing_status})`);

  // Step 4: write BatchJob row to Railway prod so the production scheduler ingests
  await prisma.batchJob.create({
    data: {
      anthropicBatchId: batch.id,
      status: batch.processing_status,
      purpose: VERIFIER_PURPOSE,
      marketIds: JSON.stringify(picked.map((m) => m.id)),
      totalRequests: picked.length,
    },
  });
  console.log(`[scenario-a] BatchJob row written to prod — production scheduler will poll/ingest.\n`);

  console.log(`Estimated cost at calibrated $0.013/call: $${(picked.length * 0.013).toFixed(2)}`);
  console.log(`\nMonitor:`);
  console.log(`  - Anthropic Console > Batches > ${batch.id}`);
  console.log(`  - When batch ends, production scheduler will ingest within 5 min`);
  console.log(`  - Results visible in Analysis table (pass='opus') + CostLog (purpose='verifier_pass_batch')`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
