import { NextResponse } from "next/server";
import { PROJECT_FROZEN, llmCallsEnabled } from "@/lib/llm-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Deploy verification endpoint. Hit this after pushing to confirm the new commit is actually live.
 * Reads the commit SHA from common CI/host env vars; falls back to "unknown" if none are set.
 */
export async function GET() {
  const commitSha =
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GIT_COMMIT_SHA ||
    process.env.COMMIT_SHA ||
    "unknown";
  const buildTime = process.env.BUILD_TIME || "unknown";
  return NextResponse.json({
    ok: true,
    commit: commitSha,
    commit_short: commitSha === "unknown" ? "unknown" : commitSha.slice(0, 7),
    buildTime,
    node: process.version,
    runtime: process.env.NEXT_RUNTIME || "nodejs",
    // Deprecation freeze state: frozen=true means every LLM pass is hard-disabled in code
    // (see PROJECT_FROZEN in src/lib/llm-gate.ts). llmEnabled is the effective gate result.
    frozen: PROJECT_FROZEN,
    llmEnabled: llmCallsEnabled(),
    time: new Date().toISOString(),
  });
}
