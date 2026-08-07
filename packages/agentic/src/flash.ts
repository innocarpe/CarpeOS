/**
 * Live DeepSeek V4 Flash I/O for agentic stages (Product 6).
 * Network only when explicitly allowed. No OpenRouter/Luna escalation.
 *
 * Quality ultragoal Q1′ (QD0): callers MUST pass a prepared effective view
 * (triage_view_text / extract_view_text), never raw capture signal. The
 * serialized HTTP user message embeds that view without further slicing.
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
      /** Declared view text that was serialized into the request body. */
      declared_view_text: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    }
  | {
      ok: false;
      error: string;
      network_used: boolean;
      model_id: typeof AGENTIC_FLASH_MODEL_ID;
      declared_view_text?: string;
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
 * Build the user-message content Flash receives. View is used as-is (already
 * bounded by pack.deriveAgenticEffectiveViews) — no second slice.
 */
export function buildAgenticFlashUserContent(input: {
  stage: FlashStage;
  view_text: string;
}): string {
  if (input.stage === "triage") {
    return `Pack:\n${input.view_text}\n\nReply JSON only.`;
  }
  return `Pack:\n${input.view_text}\n\nExtract cited candidates. quote MUST be exact substring. Reply JSON only.`;
}

/**
 * Full chat-completions request body (minus credentials). Used by call path
 * and regression tests that assert the serialized body equals the declared view.
 */
export function buildAgenticFlashRequestBody(input: {
  stage: FlashStage;
  view_text: string;
  model_id?: typeof AGENTIC_FLASH_MODEL_ID;
}): {
  model: typeof AGENTIC_FLASH_MODEL_ID;
  temperature: number;
  max_tokens: number;
  messages: Array<{ role: "system" | "user"; content: string }>;
  user_content: string;
  declared_view_text: string;
} {
  const model_id = input.model_id ?? AGENTIC_FLASH_MODEL_ID;
  const prompt = AGENTIC_FLASH_PROMPTS[input.stage];
  const user_content = buildAgenticFlashUserContent({
    stage: input.stage,
    view_text: input.view_text,
  });
  return {
    model: model_id,
    temperature: 0,
    max_tokens: input.stage === "triage" ? 1024 : 2048,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: user_content },
    ],
    user_content,
    declared_view_text: input.view_text,
  };
}

/**
 * Assert QD0 same-view bind: serialized user content contains the declared view
 * exactly once as the Pack body (no double-slice / no raw signal substitution).
 */
export function assertFlashUserContentMatchesView(input: {
  user_content: string;
  view_text: string;
}): { ok: true } | { ok: false; error: string } {
  const expectedPrefix = `Pack:\n${input.view_text}\n\n`;
  if (!input.user_content.startsWith(expectedPrefix)) {
    return { ok: false, error: "user_content_view_mismatch" };
  }
  if (!input.user_content.includes(input.view_text)) {
    return { ok: false, error: "declared_view_absent" };
  }
  return { ok: true };
}

/**
 * Call deepseek-v4-flash for triage or extract JSON.
 * Requires DEEPSEEK_API_KEY (env or explicit). Never logs the key.
 *
 * Pass `view_text` (prepared effective view). `pack_text` is accepted only as a
 * deprecated alias for the same field during transition — do not pass raw signal.
 */
export async function callAgenticFlash(input: {
  stage: FlashStage;
  /** Prepared effective view (triage_view_text or extract_view_text). */
  view_text?: string;
  /**
   * @deprecated Use view_text. Kept for call-site migration; treated as view_text.
   */
  pack_text?: string;
  allow_network: boolean;
  api_key?: string | null;
  spend?: FlashSpendState;
  fetch_impl?: typeof fetch;
  base_url?: string;
}): Promise<FlashCallResult> {
  const model_id = AGENTIC_FLASH_MODEL_ID;
  const view_text = (input.view_text ?? input.pack_text ?? "").trim();
  if (view_text.length === 0) {
    return { ok: false, error: "empty_view_text", network_used: false, model_id };
  }
  if (input.allow_network !== true) {
    return {
      ok: false,
      error: "network_disabled",
      network_used: false,
      model_id,
      declared_view_text: view_text,
    };
  }
  const key = (input.api_key ?? process.env.DEEPSEEK_API_KEY ?? "").trim();
  if (key.length === 0) {
    return {
      ok: false,
      error: "missing_credentials",
      network_used: false,
      model_id,
      declared_view_text: view_text,
    };
  }
  const spend = input.spend ?? createFlashSpendState();
  if (spend.calls >= spend.max_calls || spend.spend_usd >= spend.spend_cap_usd) {
    return {
      ok: false,
      error: "spend_cap_exceeded",
      network_used: false,
      model_id,
      declared_view_text: view_text,
    };
  }

  const built = buildAgenticFlashRequestBody({ stage: input.stage, view_text });
  const bind = assertFlashUserContentMatchesView({
    user_content: built.user_content,
    view_text,
  });
  if (!bind.ok) {
    return {
      ok: false,
      error: bind.error,
      network_used: false,
      model_id,
      declared_view_text: view_text,
    };
  }

  // deepseek-v4-flash may spend tokens on reasoning_content; budget enough for JSON body.
  const body = {
    model: built.model,
    temperature: built.temperature,
    max_tokens: built.max_tokens,
    messages: built.messages,
  };

  const fetchFn = input.fetch_impl ?? globalThis.fetch;
  if (typeof fetchFn !== "function") {
    return {
      ok: false,
      error: "fetch_unavailable",
      network_used: false,
      model_id,
      declared_view_text: view_text,
    };
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
    return {
      ok: false,
      error: "transport_failure",
      network_used: true,
      model_id,
      declared_view_text: view_text,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      error: res.status === 429 ? "http_429" : res.status >= 500 ? "http_5xx" : "http_error",
      network_used: true,
      model_id,
      declared_view_text: view_text,
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
    return {
      ok: false,
      error: "empty_model_response",
      network_used: true,
      model_id,
      declared_view_text: view_text,
    };
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
    declared_view_text: view_text,
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
