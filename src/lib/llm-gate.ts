/**
 * Kill-switch for outbound LLM calls. Used to avoid double-spending when the app runs in two
 * environments at once (local + Railway): the local instance reads the same data but should not
 * burn tokens.
 *
 * Toggle via the `LLM_DISABLED` env var. Default is enabled (calls go through). Set to "true",
 * "1", or "yes" (case-insensitive) to disable. Affects:
 *   - All analyzer functions (first-pass Haiku/Sonnet, Opus verifier, synthesis)
 *   - All batch submitters (Anthropic batches, OpenAI Responses background)
 *   - The daily scheduler and batch poller (they short-circuit early)
 * Does NOT affect free read-only polls (Anthropic batch status, OpenAI response retrieve).
 */
export function llmCallsEnabled(): boolean {
  const v = (process.env.LLM_DISABLED ?? "").trim().toLowerCase();
  return !(v === "true" || v === "1" || v === "yes");
}

export class LLMDisabledError extends Error {
  constructor() {
    super(
      "LLM calls are disabled in this environment (LLM_DISABLED=true). " +
        "To re-enable: unset LLM_DISABLED (or set it to 'false') in .env and restart the server."
    );
    this.name = "LLMDisabledError";
  }
}
