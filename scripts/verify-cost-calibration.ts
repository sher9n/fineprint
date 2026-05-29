/**
 * Sanity-check: make one in-line Sonnet messages.create with a cached system prompt, then
 * compute predicted cost using the corrected formula. Print the breakdown so we can compare
 * against what Anthropic Console eventually bills for this exact request id.
 *
 * Skips llm-gate.ts (talks to the SDK directly), so LLM_DISABLED state doesn't matter.
 *
 * Run:
 *   npx tsx scripts/verify-cost-calibration.ts
 */
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "../src/lib/analyzer";
import { computeCost } from "../src/lib/budget";

const SONNET_MODEL = "claude-sonnet-4-6";

(async () => {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 0 });

  const userMsg = `Test calibration call.

MARKET TITLE: Will Test Outcome occur by 2026-12-31?

MARKET TRADING ENDS: 2026-12-31

CURRENT MARKET PRICE: YES 50.0% / NO 50.0%
NAMED RESOLUTION SOURCE: (not specified)

FULL RESOLUTION RULES:
"""
This market resolves YES if the test outcome occurs by 2026-12-31. Otherwise NO.
"""

Return JSON only with the schema.`;

  console.log(`[verify] Making one Sonnet call with cached system prompt...`);
  const res = await client.messages.create({
    model: SONNET_MODEL,
    max_tokens: 512,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userMsg }],
  });

  console.log(`\nrequest id: ${res.id}`);
  console.log(`model returned: ${res.model}`);
  console.log(`\nusage from Anthropic:`);
  console.log(JSON.stringify(res.usage, null, 2));

  const usage = {
    inputTokens: res.usage.input_tokens ?? 0,
    outputTokens: res.usage.output_tokens ?? 0,
    cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: res.usage.cache_creation_input_tokens ?? 0,
  };

  console.log(`\n=== COST BREAKDOWN ===`);

  // OLD formula (with cache_creation billed per request)
  const oldCost =
    (usage.inputTokens * 3.0) / 1e6 +
    (usage.outputTokens * 15.0) / 1e6 +
    (usage.cacheReadTokens * 0.3) / 1e6 +
    (usage.cacheCreationTokens * 3.75) / 1e6;
  console.log(`OLD formula (in-line, no batch discount):  $${oldCost.toFixed(6)}`);

  // NEW formula (cache_creation excluded)
  const newCost = computeCost(SONNET_MODEL, usage);
  console.log(`NEW formula (in-line, no batch discount):  $${newCost.toFixed(6)}`);
  console.log(`Δ (cache_creation dropped):                 $${(oldCost - newCost).toFixed(6)}`);

  console.log(`\n=== TO VERIFY ===`);
  console.log(`Look up request ${res.id} in Anthropic Console > Logs.`);
  console.log(`Compare 'Total cost' there with the NEW figure above.`);
  console.log(`If NEW matches → formula correct. If still over → cache_read may also need adjustment.`);
})();
