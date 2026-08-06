/**
 * Provider adapters: fake | deepseek_direct | openrouter.
 * Never log bodies or credentials. Real network only when explicitly allowed.
 */

import { digestSha256 } from "./jcs.js";
import {
  buildChatCompletionBody,
  parseExtractResponse,
  parseSynthesisResponse,
} from "./provider-normalize.js";
import type {
  AdapterContext,
  HttpTransport,
  ProviderAdapter,
  ProviderCallResult,
  ProviderErrorCode,
  ProviderRequest,
  ProviderRoute,
  RawProviderHttpResponse,
} from "./provider-types.js";
import type { ExtractResponse, SynthesisResponse } from "./reducer.js";

export const DEFAULT_EXTRACT_RESPONSE: ExtractResponse = {
  schema: "carpeos.llm-extract/v1",
  result: "no_candidate",
  candidates: [],
  citations: [],
};

export const DEFAULT_SYNTHESIS_RESPONSE: SynthesisResponse = {
  schema: "carpeos.llm-synthesize/v1",
  result: "no_candidate",
  draft_text: null,
  citations: [],
};

function routeFromCtx(ctx: AdapterContext): ProviderRoute {
  return {
    profile_id: ctx.profile.profile_id,
    provider_id: ctx.profile.provider_id,
    model_id: ctx.profile.model_id,
    slot: ctx.profile.slot,
    ...(ctx.profile.predeclared_escalation_only ? { predeclared: true as const } : {}),
  };
}

function err(
  code: ProviderErrorCode,
  ctx: AdapterContext,
  extra?: { network_used?: boolean; http_status?: number | null; latency_ms?: number },
): ProviderCallResult<never> {
  return {
    ok: false,
    error: code,
    network_used: extra?.network_used ?? false,
    route: routeFromCtx(ctx),
    latency_ms: extra?.latency_ms ?? 0,
    http_status: extra?.http_status ?? null,
    canonical_effect: "none",
    details_digest: digestSha256({ error: code, profile: ctx.profile.profile_id }),
  };
}

function mapHttpStatus(status: number): ProviderErrorCode | null {
  if (status === 429) return "http_429";
  if (status >= 500) return "http_5xx";
  if (status < 200 || status >= 300) return "transport_failure";
  return null;
}

async function chatCompletionCall(
  ctx: AdapterContext,
  req: ProviderRequest,
  parse: typeof parseExtractResponse | typeof parseSynthesisResponse,
): Promise<ProviderCallResult<ExtractResponse | SynthesisResponse>> {
  const route = routeFromCtx(ctx);
  if (!ctx.network_allowed) {
    return err("network_disabled", ctx);
  }
  if (!ctx.profile.auth_env || !ctx.profile.base_url) {
    return err("profile_unavailable", ctx);
  }
  const apiKey = ctx.getEnv(ctx.profile.auth_env);
  if (!apiKey) {
    return err("missing_credentials", ctx);
  }
  // Never send DEEPSEEK_API_KEY to OpenRouter
  if (ctx.profile.provider_id === "openrouter" && ctx.profile.auth_env !== "OPENROUTER_API_KEY") {
    return err("route_not_allowed", ctx);
  }
  if (
    ctx.profile.provider_id === "deepseek_direct" &&
    ctx.profile.auth_env !== "DEEPSEEK_API_KEY"
  ) {
    return err("route_not_allowed", ctx);
  }

  const url = `${ctx.profile.base_url.replace(/\/$/, "")}/chat/completions`;
  const body = buildChatCompletionBody({
    model: ctx.profile.model_id,
    messages: req.messages,
    temperature: req.temperature,
    max_tokens: req.max_tokens,
    ...(ctx.profile.provider_id === "openrouter"
      ? {
          provider: {
            allow_fallbacks: false as const,
            ...(ctx.profile.provider_constraints.length > 0
              ? { order: [...ctx.profile.provider_constraints] }
              : {}),
          },
        }
      : {}),
  });

  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  };
  // OpenRouter optional attribution headers — no secrets
  if (ctx.profile.provider_id === "openrouter") {
    headers["http-referer"] = "https://github.com/innocarpe/CarpeOS";
    headers["x-title"] = "CarpeOS-v5-offline";
  }

  let raw: RawProviderHttpResponse;
  try {
    raw = await ctx.transport.postJson({
      url,
      headers,
      body,
      timeout_ms: 30_000,
    });
  } catch {
    return err("timeout", ctx, { network_used: true });
  }

  const httpErr = mapHttpStatus(raw.status);
  if (httpErr) {
    return err(httpErr, ctx, {
      network_used: true,
      http_status: raw.status,
      latency_ms: raw.latency_ms,
    });
  }

  const parsed = parse(raw.body_text);
  if (!parsed.ok) {
    return err(parsed.error, ctx, {
      network_used: true,
      http_status: raw.status,
      latency_ms: raw.latency_ms,
    });
  }

  return {
    ok: true,
    response: parsed.value as ExtractResponse | SynthesisResponse,
    route,
    network_used: true,
    usage: parsed.usage,
    latency_ms: raw.latency_ms,
    http_status: raw.status,
    cost_usd: null, // filled by boundary with price snapshot
    canonical_effect: "none",
  };
}

export function createFakeAdapter(fakes?: {
  extract?: ExtractResponse;
  synthesis?: SynthesisResponse;
}): ProviderAdapter {
  return {
    provider_id: "fake",
    async extract(ctx, _req) {
      const route = routeFromCtx(ctx);
      return {
        ok: true,
        response: fakes?.extract ?? DEFAULT_EXTRACT_RESPONSE,
        route,
        network_used: false,
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_hit_tokens: 0,
          cache_miss_tokens: 10,
        },
        latency_ms: 1,
        http_status: null,
        cost_usd: 0,
        canonical_effect: "none",
      };
    },
    async synthesize(ctx, _req) {
      const route = routeFromCtx(ctx);
      return {
        ok: true,
        response: fakes?.synthesis ?? DEFAULT_SYNTHESIS_RESPONSE,
        route,
        network_used: false,
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_hit_tokens: 0,
          cache_miss_tokens: 10,
        },
        latency_ms: 1,
        http_status: null,
        cost_usd: 0,
        canonical_effect: "none",
      };
    },
  };
}

export function createDeepSeekDirectAdapter(): ProviderAdapter {
  return {
    provider_id: "deepseek_direct",
    extract: (ctx, req) =>
      chatCompletionCall(ctx, req, parseExtractResponse) as Promise<
        ProviderCallResult<ExtractResponse>
      >,
    synthesize: (ctx, req) =>
      chatCompletionCall(ctx, req, parseSynthesisResponse) as Promise<
        ProviderCallResult<SynthesisResponse>
      >,
  };
}

export function createOpenRouterAdapter(): ProviderAdapter {
  return {
    provider_id: "openrouter",
    extract: (ctx, req) =>
      chatCompletionCall(ctx, req, parseExtractResponse) as Promise<
        ProviderCallResult<ExtractResponse>
      >,
    synthesize: (ctx, req) =>
      chatCompletionCall(ctx, req, parseSynthesisResponse) as Promise<
        ProviderCallResult<SynthesisResponse>
      >,
  };
}

/**
 * Fake HTTP transport for contract tests — never opens sockets.
 * Scripted by URL/path matcher.
 */
export function createScriptedTransport(
  script: (input: {
    url: string;
    headers: Record<string, string>;
    body: unknown;
  }) => RawProviderHttpResponse | Promise<RawProviderHttpResponse>,
): HttpTransport {
  return {
    async postJson(input) {
      // Secret leakage guard: never echo Authorization into body paths (tests check headers separately)
      return script({
        url: input.url,
        headers: input.headers,
        body: input.body,
      });
    },
  };
}

/** Disabled real transport — always timeout (fail closed). */
export function createDisabledTransport(): HttpTransport {
  return {
    async postJson() {
      throw new Error("network_disabled_transport");
    },
  };
}

export function envReaderFromMap(
  map: Record<string, string | undefined>,
): (name: string) => string | undefined {
  return (name) => map[name];
}

/** Build a successful OpenAI-style chat completion body embedding a JSON content payload. */
export function fakeChatCompletionJson(content: unknown, usage?: Record<string, number>): string {
  return JSON.stringify({
    id: "chatcmpl-synthetic",
    object: "chat.completion",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: JSON.stringify(content),
        },
        finish_reason: "stop",
      },
    ],
    usage: usage ?? {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      prompt_cache_hit_tokens: 20,
      prompt_cache_miss_tokens: 80,
    },
  });
}
