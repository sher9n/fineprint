import "dotenv/config";
import { anthropic, OPUS_MODEL, extractUsage } from "../src/lib/anthropic";
import { computeCost, WEB_SEARCH_COST_PER_CALL } from "../src/lib/budget";

/**
 * Standalone smoke test for the Opus 4.8 upgrade. Exercises the two things the app relies on:
 *   Part A: a synchronous Messages call on OPUS_MODEL with the web_search server tool.
 *   Part B: a 1-request Message Batch on OPUS_MODEL with web_search, polled to completion.
 *
 * Uses the OPUS_MODEL constant (not a hardcoded id) so it verifies whatever the app is set to,
 * and the exact same web_search_20250305 tool config the analyzer/batch submitters use. It calls
 * the SDK directly, so it does NOT consult the LLM_DISABLED gate (the app/scheduler stay gated).
 * Cost is ~$0.20 total.
 *
 * Usage:
 *   npx tsx scripts/test-opus48.ts            # run both parts
 *   npx tsx scripts/test-opus48.ts --check <batchId>   # just read an existing batch's results
 */

const webSearchTool = { type: "web_search_20250305", name: "web_search", max_uses: 3 } as never;

function countWebSearches(content: unknown[]): number {
  let n = 0;
  for (const c of content) {
    const anyC = c as { type?: string; name?: string };
    if (anyC.type === "server_tool_use" && anyC.name === "web_search") n++;
  }
  return n;
}

function finalText(content: unknown[]): string {
  const parts: string[] = [];
  for (const c of content) {
    const anyC = c as { type?: string; text?: string };
    if (anyC.type === "text" && anyC.text) parts.push(anyC.text);
  }
  return parts.join("\n").trim();
}

async function testSync(): Promise<boolean> {
  console.log("\n=== Part A: synchronous Opus call + web search ===");
  const client = anthropic();
  const res = await client.messages.create({
    model: OPUS_MODEL,
    max_tokens: 1024,
    tools: [webSearchTool],
    messages: [
      {
        role: "user" as const,
        content:
          "Use web search to find one notable news headline from the last few days. Reply in one short sentence and include the source URL.",
      },
    ],
  });

  const usage = extractUsage(res.usage);
  const searches = countWebSearches(res.content as unknown[]);
  const text = finalText(res.content as unknown[]);
  const cost = computeCost(res.model, usage) + searches * WEB_SEARCH_COST_PER_CALL;
  console.log("  model returned:", res.model);
  console.log("  stop_reason:   ", res.stop_reason);
  console.log("  web searches:  ", searches);
  console.log("  usage:         ", JSON.stringify(usage));
  console.log("  est cost USD:  ", cost.toFixed(5));
  console.log("  answer:        ", text.slice(0, 400) || "(no text block)");

  const ok = res.model.includes("opus-4-8") && searches >= 1 && text.length > 0;
  console.log(ok ? "  PART A: PASS" : "  PART A: FAIL");
  return ok;
}

async function readBatchResults(batchId: string): Promise<boolean> {
  const client = anthropic();
  const stream = await client.messages.batches.results(batchId);
  let pass = false;
  for await (const entry of stream) {
    if (entry.result.type !== "succeeded") {
      console.log(`  ${entry.custom_id}: ${entry.result.type}`);
      continue;
    }
    const message = entry.result.message;
    const usage = extractUsage(message.usage);
    const searches = countWebSearches(message.content as unknown[]);
    const text = finalText(message.content as unknown[]);
    // Batch tokens are 50% off; web searches are billed at the standard per-search rate.
    const cost = computeCost(message.model, usage) * 0.5 + searches * WEB_SEARCH_COST_PER_CALL;
    console.log("  model returned:", message.model);
    console.log("  web searches:  ", searches);
    console.log("  usage:         ", JSON.stringify(usage));
    console.log("  est cost USD:  ", cost.toFixed(5), "(batch 50% token discount)");
    console.log("  answer:        ", text.slice(0, 400) || "(no text block)");
    pass = message.model.includes("opus-4-8") && searches >= 1 && text.length > 0;
  }
  console.log(pass ? "  PART B: PASS" : "  PART B: FAIL");
  return pass;
}

async function testBatch(): Promise<boolean | null> {
  console.log("\n=== Part B: Message Batch (1 request) + web search ===");
  const client = anthropic();
  const customId = "opus48-batch-test";
  const requests = [
    {
      custom_id: customId,
      params: {
        model: OPUS_MODEL,
        max_tokens: 1024,
        tools: [webSearchTool],
        messages: [
          {
            role: "user" as const,
            content:
              "Use web search to find the current US federal funds target rate range and cite the source. One short sentence.",
          },
        ],
      },
    },
  ];

  const batch = await client.messages.batches.create({ requests });
  console.log("  submitted batch:", batch.id, "status:", batch.processing_status);

  let elapsed = 0;
  const TIMEOUT_S = 13 * 60;
  const POLL_S = 15;
  let status: string = batch.processing_status;
  while (status !== "ended") {
    if (elapsed > TIMEOUT_S) {
      console.log(
        `  PART B: PENDING after ${Math.round(elapsed / 60)}min. Batch ${batch.id} still '${status}'.`,
      );
      console.log(`  Re-check later with: npx tsx scripts/test-opus48.ts --check ${batch.id}`);
      return null;
    }
    await new Promise((r) => setTimeout(r, POLL_S * 1000));
    elapsed += POLL_S;
    const b = await client.messages.batches.retrieve(batch.id);
    status = b.processing_status;
    const c = b.request_counts as { processing?: number; succeeded?: number; errored?: number };
    console.log(`  poll +${elapsed}s: ${status} (processing:${c.processing} succeeded:${c.succeeded} errored:${c.errored})`);
  }
  return readBatchResults(batch.id);
}

async function main() {
  console.log("OPUS_MODEL =", OPUS_MODEL);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY not set; cannot run.");
    process.exit(1);
  }

  const checkIdx = process.argv.indexOf("--check");
  if (checkIdx !== -1 && process.argv[checkIdx + 1]) {
    await readBatchResults(process.argv[checkIdx + 1]);
    return;
  }

  const a = await testSync();
  const b = await testBatch();

  console.log("\n=== SUMMARY ===");
  console.log("  Part A (sync + web search): ", a ? "PASS" : "FAIL");
  console.log("  Part B (batch + web search):", b === null ? "PENDING" : b ? "PASS" : "FAIL");
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    console.error("ERROR:", (e as { message?: string })?.message ?? e);
    process.exit(1);
  });
