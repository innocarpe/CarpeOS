/**
 * Normalize OpenAI-compatible chat completions into strict Extract/Synthesis schemas.
 */

import type { ExtractResponse, SynthesisResponse } from "./reducer.js";
import type { UsageMetadata } from "./provider-types.js";

export type ParseResult<T> =
  | { ok: true; value: T; usage: UsageMetadata }
  | { ok: false; error: "malformed_json" | "schema_invalid"; usage: UsageMetadata };

function emptyUsage(): UsageMetadata {
  return {
    input_tokens: null,
    output_tokens: null,
    cache_hit_tokens: null,
    cache_miss_tokens: null,
  };
}

export function parseUsage(raw: unknown): UsageMetadata {
  if (!raw || typeof raw !== "object") return emptyUsage();
  const u = raw as Record<string, unknown>;
  const prompt = typeof u.prompt_tokens === "number" ? u.prompt_tokens : null;
  const completion = typeof u.completion_tokens === "number" ? u.completion_tokens : null;
  // DeepSeek may expose cache fields under prompt_cache_hit_tokens / prompt_cache_miss_tokens
  const hit =
    typeof u.prompt_cache_hit_tokens === "number"
      ? u.prompt_cache_hit_tokens
      : typeof u.cache_hit_tokens === "number"
        ? u.cache_hit_tokens
        : null;
  const miss =
    typeof u.prompt_cache_miss_tokens === "number"
      ? u.prompt_cache_miss_tokens
      : typeof u.cache_miss_tokens === "number"
        ? u.cache_miss_tokens
        : null;
  return {
    input_tokens: prompt,
    output_tokens: completion,
    cache_hit_tokens: hit,
    cache_miss_tokens: miss,
  };
}

function extractContentText(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  const choices = (parsed as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const msg = (choices[0] as { message?: { content?: unknown } })?.message;
  if (!msg || typeof msg.content !== "string") return null;
  return msg.content;
}

export function parseExtractResponse(bodyText: string): ParseResult<ExtractResponse> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return { ok: false, error: "malformed_json", usage: emptyUsage() };
  }
  const usage = parseUsage((parsed as { usage?: unknown })?.usage);
  const content = extractContentText(parsed);
  if (content === null) {
    return { ok: false, error: "schema_invalid", usage };
  }
  let inner: unknown;
  try {
    inner = JSON.parse(content);
  } catch {
    return { ok: false, error: "schema_invalid", usage };
  }
  if (!isExtractResponse(inner)) {
    return { ok: false, error: "schema_invalid", usage };
  }
  return { ok: true, value: inner, usage };
}

export function parseSynthesisResponse(bodyText: string): ParseResult<SynthesisResponse> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return { ok: false, error: "malformed_json", usage: emptyUsage() };
  }
  const usage = parseUsage((parsed as { usage?: unknown })?.usage);
  const content = extractContentText(parsed);
  if (content === null) {
    return { ok: false, error: "schema_invalid", usage };
  }
  let inner: unknown;
  try {
    inner = JSON.parse(content);
  } catch {
    return { ok: false, error: "schema_invalid", usage };
  }
  if (!isSynthesisResponse(inner)) {
    return { ok: false, error: "schema_invalid", usage };
  }
  return { ok: true, value: inner, usage };
}

export function isExtractResponse(value: unknown): value is ExtractResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.schema !== "carpeos.llm-extract/v1") return false;
  if (v.result !== "candidates" && v.result !== "no_candidate") return false;
  if (!Array.isArray(v.candidates) || !Array.isArray(v.citations)) return false;
  if (v.result === "no_candidate") {
    return v.candidates.length === 0 && v.citations.length === 0;
  }
  return true;
}

export function isSynthesisResponse(value: unknown): value is SynthesisResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.schema !== "carpeos.llm-synthesize/v1") return false;
  if (v.result !== "draft" && v.result !== "no_candidate") return false;
  if (!Array.isArray(v.citations)) return false;
  if (v.result === "no_candidate") {
    return v.draft_text === null && v.citations.length === 0;
  }
  return typeof v.draft_text === "string";
}

/** Build OpenAI-compatible chat completion JSON body (for fake HTTP contracts). */
export function buildChatCompletionBody(input: {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature: number;
  max_tokens: number;
  /** OpenRouter only */
  provider?: { order?: string[]; allow_fallbacks: false };
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    temperature: input.temperature,
    max_tokens: input.max_tokens,
  };
  if (input.provider) {
    body.provider = input.provider;
  }
  return body;
}
