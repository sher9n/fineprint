import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  _client = new Anthropic({ apiKey: key, maxRetries: 0 });
  return _client;
}

export const HAIKU_MODEL = "claude-haiku-4-5-20251001";
export const OPUS_MODEL = "claude-opus-4-7";
export const SONNET_MODEL = "claude-sonnet-4-6";
export const VERIFIER_MODEL = process.env.VERIFIER_MODEL || OPUS_MODEL;

export function resolveFirstPassModel(setting: string | undefined): string {
  if (setting === "sonnet") return SONNET_MODEL;
  return HAIKU_MODEL;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export function extractUsage(u: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }): UsageTotals {
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
  };
}

export async function withRetry<T>(fn: () => Promise<T>, opts: { attempts?: number; baseMs?: number; label?: string } = {}): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const base = opts.baseMs ?? 1500;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: unknown) {
      lastErr = e;
      const status = (e as { status?: number })?.status;
      const isRetryable = status === 429 || status === 529 || (status != null && status >= 500);
      if (!isRetryable || i === attempts - 1) throw e;
      const delay = base * Math.pow(2, i) + Math.random() * 500;
      console.warn(`[${opts.label ?? "anthropic"}] ${status} retry ${i + 1}/${attempts} in ${Math.round(delay)}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
