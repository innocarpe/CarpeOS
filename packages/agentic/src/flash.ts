/**
 * Live DeepSeek V4 Flash I/O for agentic stages (Product 6).
 * Network only when explicitly allowed. No OpenRouter/Luna escalation.
 */

import { AGENTIC_FLASH_PROMPTS } from "./stages.js";
import { AGENTIC_FLASH_MODEL_ID } from "./types.js";

export type FlashStage = "triage" | "extract";

export type FlashCallResult =
  | {
      ok: true;
      text: string;
      network_used: true;
      model_id: typeof AGENTIC_FLASH_MODEL_ID;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    }
  | {
      ok: false;
      error: string;
      network_used: boolean;
      model_id: typeof AGENTIC_FLASH_MODEL_ID;
    };

export type FlashSpendState = {
  spend_usd: number;
  spend_cap_usd: number;
  calls: number;
  max_calls: number;
};

const DEEPSEEK_BASE = "https://api.deepseek.com";
/** Conservative default price snapshot (USD / 1M tokens) — operator can lower spend_cap. */
const DEFAULT_INPUT_PER_M = 0.14;
const DEFAULT_OUTPUT_PER_M = 0.28;

export function createFlashSpendState(input?: {
  spend_cap_usd?: number;
  max_calls?: number;
}): FlashSpendState {
  return {
    spend_usd: 0,
    spend_cap_usd: input?.spend_cap_usd ?? 5.0,
    calls: 0,
    max_calls: input?.max_calls ?? 64,
  };
}

/**
 * Call deepseek-v4-flash for triage or extract JSON.
 * Requires DEEPSEEK_API_KEY (env or explicit). Never logs the key.
 */
export async function callAgenticFlash(input: {
  stage: FlashStage;
  pack_text: string;
  allow_network: boolean;
  api_key?: string | null;
  spend?: FlashSpendState;
  fetch_impl?: typeof fetch;
  base_url?: string;
}): Promise<FlashCallResult> {
  const model_id = AGENTIC_FLASH_MODEL_ID;
  if (input.allow_network !== true) {
    return { ok: false, error: "network_disabled", network_used: false, model_id };
  }
  const key = (input.api_key ?? process.env.DEEPSEEK_API_KEY ?? "").trim();
  if (key.length === 0) {
    return { ok: false, error: "missing_credentials", network_used: false, model_id };
  }
  const spend = input.spend ?? createFlashSpendState();
  if (spend.calls >= spend.max_calls || spend.spend_usd >= spend.spend_cap_usd) {
    return { ok: false, error: "spend_cap_exceeded", network_used: false, model_id };
  }

  const prompt = AGENTIC_FLASH_PROMPTS[input.stage];
  const userContent =
    input.stage === "triage"
      ? `Pack:\n${input.pack_text.slice(0, 12_000)}\n\nReply JSON only.`
      : `Pack:\n${input.pack_text.slice(0, 12_000)}\n\nExtract cited candidates. quote MUST be exact substring. Reply JSON only.`;

  // deepseek-v4-flash may spend tokens on reasoning_content; budget enough for JSON body.
  const body = {
    model: model_id,
    temperature: 0,
    max_tokens: input.stage === "triage" ? 1024 : 2048,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: userContent },
    ],
  };

  const fetchFn = input.fetch_impl ?? globalThis.fetch;
  if (typeof fetchFn !== "function") {
    return { ok: false, error: "fetch_unavailable", network_used: false, model_id };
  }

  const url = `${(input.base_url ?? DEEPSEEK_BASE).replace(/\/$/, "")}/chat/completions`;
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: "transport_failure", network_used: true, model_id };
  }

  if (!res.ok) {
    return {
      ok: false,
      error: res.status === 429 ? "http_429" : res.status >= 500 ? "http_5xx" : "http_error",
      network_used: true,
      model_id,
    };
  }

  const raw = (await res.json()) as {
    choices?: Array<{
      message?: { content?: string | null; reasoning_content?: string | null };
      finish_reason?: string;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = extractFlashMessageText(raw.choices?.[0]?.message);
  if (text.length === 0) {
    return { ok: false, error: "empty_model_response", network_used: true, model_id };
  }

  const prompt_tokens = raw.usage?.prompt_tokens ?? 0;
  const completion_tokens = raw.usage?.completion_tokens ?? 0;
  const cost =
    (prompt_tokens / 1_000_000) * DEFAULT_INPUT_PER_M +
    (completion_tokens / 1_000_000) * DEFAULT_OUTPUT_PER_M;
  spend.calls += 1;
  spend.spend_usd += cost;

  return {
    ok: true,
    text,
    network_used: true,
    model_id,
    usage: { prompt_tokens, completion_tokens },
  };
}

/**
 * deepseek-v4-flash often returns JSON in `content`, but sometimes spends the
 * token budget on `reasoning_content` with empty `content`. Prefer content;
 * fall back to trailing JSON in reasoning, then full reasoning text.
 */
export function extractFlashMessageText(message?: {
  content?: string | null;
  reasoning_content?: string | null;
}): string {
  const content = (message?.content ?? "").trim();
  if (content.length > 0) return content;
  const reasoning = (message?.reasoning_content ?? "").trim();
  if (reasoning.length === 0) return "";
  // Last JSON object in reasoning (models often conclude with the payload).
  const objects = reasoning.match(/\{[\s\S]*?\}(?=\s*$|\s*[^,{}\s])/g);
  if (objects !== null && objects.length > 0) {
    const last = objects[objects.length - 1]!.trim();
    if (last.startsWith("{") && last.endsWith("}")) return last;
  }
  const greedy = reasoning.match(/\{[\s\S]*\}\s*$/);
  if (greedy !== null) return greedy[0]!.trim();
  return reasoning;
}

// Re-export model constant for callers that import flash only.
export { AGENTIC_FLASH_MODEL_ID };
