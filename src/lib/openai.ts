import OpenAI from "openai";

let _client: OpenAI | null = null;

export function openai(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  _client = new OpenAI({ apiKey });
  return _client;
}

export const DEEP_RESEARCH_MODEL = process.env.OPENAI_DEEP_RESEARCH_MODEL || "gpt-5-deep-research";
