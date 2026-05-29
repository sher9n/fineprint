/**
 * Verify Opus 4.7 token rates. Makes one inline Opus call with cached system prompt + a tiny
 * user message. Captures both the message id (msg_...) and the Anthropic request id (req_...).
 * The Console Logs page uses the req_ id.
 *
 * Run:
 *   npx tsx scripts/verify-opus-cost.ts
 */
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "../src/lib/analyzer";
import { computeCost } from "../src/lib/budget";

const OPUS_MODEL = "claude-opus-4-7";

(async () => {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 0 });

  const userMsg = `Calibration call for cost verification.

MARKET TITLE: Test market.
CURRENT MARKET PRICE: YES 50.0% / NO 50.0%
FULL RESOLUTION RULES: """ Test. """

Return JSON only:
{
  "vibe_interpretation": "test",
  "literal_interpretation": "test",
  "divergence_type": "none",
  "divergence_score": 0,
  "edge_direction": "NONE",
  "rule_implied_probability": 0.5,
  "expected_yes_payout_cents": 50,
  "expected_no_payout_cents": 50,
  "reasoning": "test",
  "verification_steps": []
}`;

  console.log(`[verify-opus] making one inline Opus call (capturing req_ id from response headers)...`);
  const startedAt = new Date();

  const { data: res, response } = await client.messages
    .create({
      model: OPUS_MODEL,
      max_tokens: 512,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userMsg }],
    })
    .withResponse();

  // Anthropic includes the request id in response headers.
  // Different header casings appear in different SDK versions; check both.
  const reqId =
    response.headers.get("anthropic-request-id") ||
    response.headers.get("request-id") ||
    response.headers.get("x-request-id") ||
    "(not found in headers)";

  console.log(`\nmessage id:   ${res.id}`);
  console.log(`request id:   ${reqId}`);
  console.log(`model:        ${res.model}`);
  console.log(`call time:    ${startedAt.toISOString()}  (UTC)`);
  console.log(`\nraw usage:`);
  console.log(JSON.stringify(res.usage, null, 2));

  const usage = {
    inputTokens: res.usage.input_tokens ?? 0,
    outputTokens: res.usage.output_tokens ?? 0,
    cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: res.usage.cache_creation_input_tokens ?? 0,
  };
  const cost = computeCost(OPUS_MODEL, usage);

  console.log(`\nPredicted cost (corrected formula, no batch discount): $${cost.toFixed(6)}`);
  console.log(`\nBreakdown:`);
  console.log(`  input ${usage.inputTokens} × $5/M               = $${(usage.inputTokens * 5 / 1e6).toFixed(6)}`);
  console.log(`  output ${usage.outputTokens} × $25/M              = $${(usage.outputTokens * 25 / 1e6).toFixed(6)}`);
  console.log(`  cache_read ${usage.cacheReadTokens} × $0.50/M         = $${(usage.cacheReadTokens * 0.5 / 1e6).toFixed(6)}`);
  if (usage.cacheReadTokens === 0 && usage.cacheCreationTokens > 0) {
    console.log(`  cache_creation ${usage.cacheCreationTokens} × $6.25/M = $${(usage.cacheCreationTokens * 6.25 / 1e6).toFixed(6)}`);
  }
  console.log(`\nLOOKUP: search the request id above in Anthropic Console > Logs.`);
})();
