import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 0 });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

type Result = { ok: boolean; meta?: Record<string, unknown>; error?: string; ms: number };

function err(e: unknown): string {
  const x = e as { status?: number; message?: string };
  return `${x.status ?? "?"} ${(x.message ?? String(e)).slice(0, 300)}`;
}

async function testSonnetBatchSubmit(): Promise<Result> {
  const t = Date.now();
  try {
    const batch = await anthropic.messages.batches.create({
      requests: [
        {
          custom_id: "smoke-1",
          params: {
            model: "claude-sonnet-4-6",
            max_tokens: 20,
            messages: [{ role: "user", content: "Reply with exactly: pong" }],
          },
        },
      ],
    });
    return { ok: true, meta: { batchId: batch.id, status: batch.processing_status }, ms: Date.now() - t };
  } catch (e) {
    return { ok: false, error: err(e), ms: Date.now() - t };
  }
}

async function testGpt54Flex(): Promise<Result> {
  const t = Date.now();
  try {
    const res = await openai.chat.completions.create({
      model: "gpt-5.4",
      service_tier: "flex",
      max_completion_tokens: 30,
      messages: [{ role: "user", content: "Reply with exactly: pong" }],
    });
    const text = res.choices[0]?.message?.content ?? "";
    return {
      ok: true,
      meta: {
        modelReturned: res.model,
        serviceTierReturned: (res as unknown as { service_tier?: string }).service_tier,
        text: text.slice(0, 60),
        usage: res.usage,
      },
      ms: Date.now() - t,
    };
  } catch (e) {
    return { ok: false, error: err(e), ms: Date.now() - t };
  }
}

(async () => {
  console.log("[smoke] Anthropic Sonnet 4.6 batch submit:");
  console.log(JSON.stringify(await testSonnetBatchSubmit(), null, 2));
  console.log("\n[smoke] OpenAI gpt-5.4 + service_tier=flex:");
  console.log(JSON.stringify(await testGpt54Flex(), null, 2));
})();
