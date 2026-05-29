import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 0 });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

function err(e: unknown): string {
  const x = e as { status?: number; message?: string };
  return `${x.status ?? "?"} ${(x.message ?? String(e)).slice(0, 400)}`;
}

async function testSonnetWebSearchBatch() {
  const t = Date.now();
  try {
    const batch = await anthropic.messages.batches.create({
      requests: [
        {
          custom_id: "smoke-sonnet-ws",
          params: {
            model: "claude-sonnet-4-6",
            max_tokens: 1024,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 } as any],
            messages: [{ role: "user", content: "Use web_search to find the current weather in San Francisco. Reply with one short sentence." }],
          },
        },
      ],
    });
    return { ok: true, batchId: batch.id, status: batch.processing_status, ms: Date.now() - t };
  } catch (e) {
    return { ok: false, error: err(e), ms: Date.now() - t };
  }
}

async function testGptWebSearchResponses() {
  const t = Date.now();
  try {
    // OpenAI Responses API with web_search_preview tool
    const res = await openai.responses.create({
      model: "gpt-5.4",
      input: "Use web search to find the current weather in San Francisco. Reply with one short sentence.",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [{ type: "web_search_preview" } as any],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = res as any;
    return {
      ok: true,
      id: r.id,
      status: r.status,
      output_text: r.output_text?.slice(0, 200),
      tool_calls: Array.isArray(r.output) ? r.output.filter((x: { type: string }) => x.type === "web_search_call" || x.type === "tool_use").length : undefined,
      usage: r.usage,
      ms: Date.now() - t,
    };
  } catch (e) {
    return { ok: false, error: err(e), ms: Date.now() - t };
  }
}

async function testGptWebSearchFlex() {
  // Flex with tool use — does it work?
  const t = Date.now();
  try {
    const res = await openai.responses.create({
      model: "gpt-5.4",
      service_tier: "flex",
      input: "Use web search to find the current weather in San Francisco. Reply with one short sentence.",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [{ type: "web_search_preview" } as any],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = res as any;
    return {
      ok: true,
      id: r.id,
      status: r.status,
      service_tier: r.service_tier,
      output_text: r.output_text?.slice(0, 200),
      tool_calls: Array.isArray(r.output) ? r.output.filter((x: { type: string }) => x.type === "web_search_call" || x.type === "tool_use").length : undefined,
      ms: Date.now() - t,
    };
  } catch (e) {
    return { ok: false, error: err(e), ms: Date.now() - t };
  }
}

(async () => {
  console.log("[smoke] Sonnet 4.6 + web_search batch:");
  console.log(JSON.stringify(await testSonnetWebSearchBatch(), null, 2));
  console.log("\n[smoke] GPT-5.4 + web_search_preview (Responses, standard tier):");
  console.log(JSON.stringify(await testGptWebSearchResponses(), null, 2));
  console.log("\n[smoke] GPT-5.4 + web_search_preview (Responses, flex tier):");
  console.log(JSON.stringify(await testGptWebSearchFlex(), null, 2));
})();
