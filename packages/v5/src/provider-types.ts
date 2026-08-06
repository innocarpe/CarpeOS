/**
 * Provider-neutral types for V5 draft-only LLM routes.
 * Real network is disabled by default; credentials never leave env vars.
 */

import type { ExtractResponse, SynthesisResponse } from "./reducer.js";

export type ProviderId = "fake" | "deepseek_direct" | "openrouter";

export type ProviderProfileId =
  | "fake_extract_v1"
  | "deepseek_direct_extract_v1"
  | "openrouter_deepseek_extract_v1"
  | "openrouter_luna_escalation_v1";

export type ProviderSlot = "extract_default" | "escalation_or_synthesis" | "local_fake";

export type AuthEnvName = "DEEPSEEK_API_KEY" | "OPENROUTER_API_KEY" | null;

export type PrivacyPolicyStatus = "unknown" | "documented" | "unavailable";

/**
 * Privacy claims are never asserted without provider-specific evidence.
 * Default is none_asserted / unknown — fail closed for required checks.
 */
export type ProviderPrivacyDeclaration = {
  data_policy_status: PrivacyPolicyStatus;
  /** Never claim ZDR/no-retention/no-training without evidence. */
  retention_claim: "none_asserted" | "unavailable";
  training_claim: "none_asserted" | "unavailable";
  notes: string;
};

export type ProviderProfile = {
  profile_id: ProviderProfileId;
  provider_id: ProviderId;
  model_id: string;
  slot: ProviderSlot;
  /** null for fake */
  base_url: string | null;
  auth_env: AuthEnvName;
  /** OpenRouter must never fall back silently. */
  allow_fallbacks: false;
  /** Optional OpenRouter provider constraint list (empty = unset). */
  provider_constraints: string[];
  consent_scope: string;
  privacy: ProviderPrivacyDeclaration;
  budget: {
    max_calls: number;
    spend_cap_usd: number;
  };
  kill_switch_key: string;
  /** Real network off by default for every profile. */
  network_enabled_default: false;
  predeclared_escalation_only: boolean;
};

export type ProviderRoute = {
  profile_id: ProviderProfileId;
  provider_id: ProviderId;
  model_id: string;
  slot: ProviderSlot;
  predeclared?: true;
};

export type ProviderConsent = {
  consent_id: string;
  profile_id: ProviderProfileId;
  allow_network: boolean;
  allow_escalation: boolean;
  expires_at: string | null;
};

export type ProviderPreflight = {
  profile_id: ProviderProfileId;
  pack_digest: string;
  consent_id: string;
  route: ProviderRoute;
  trust_zone_id: string;
};

export type ProviderKillSwitch = {
  provider_disabled: boolean;
  escalation_disabled: boolean;
  /** Global real-network gate; default true (disabled). */
  network_disabled: boolean;
  deepseek_direct_disabled: boolean;
  openrouter_disabled: boolean;
  spend_cap_exceeded: boolean;
};

export type UsageMetadata = {
  input_tokens: number | null;
  output_tokens: number | null;
  cache_hit_tokens: number | null;
  cache_miss_tokens: number | null;
};

export type ProviderErrorCode =
  | "consent_denied"
  | "route_not_allowed"
  | "budget_exceeded"
  | "spend_cap_exceeded"
  | "kill_switch"
  | "preflight_mismatch"
  | "expired"
  | "network_disabled"
  | "profile_unavailable"
  | "missing_credentials"
  | "timeout"
  | "http_429"
  | "http_5xx"
  | "malformed_json"
  | "schema_invalid"
  | "usage_missing"
  | "cost_calculation_failed"
  | "implicit_fallback_forbidden"
  | "transport_failure"
  | "fake_only"
  | "ambiguous_dispatch";

export type ProviderCallOk<T> = {
  ok: true;
  response: T;
  route: ProviderRoute;
  network_used: boolean;
  usage: UsageMetadata;
  latency_ms: number;
  http_status: number | null;
  cost_usd: number | null;
  canonical_effect: "none";
};

export type ProviderCallErr = {
  ok: false;
  error: ProviderErrorCode;
  network_used: boolean;
  route: ProviderRoute | null;
  latency_ms: number;
  http_status: number | null;
  canonical_effect: "none";
  details_digest?: string;
};

export type ProviderCallResult<T> = ProviderCallOk<T> | ProviderCallErr;

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ProviderRequest = {
  messages: ChatMessage[];
  temperature: number;
  max_tokens: number;
  /** Body-free request fingerprint material (no raw pack bodies in logs). */
  pack_digest: string;
  purpose: "extract" | "synthesize" | "escalate";
};

export type RawProviderHttpResponse = {
  status: number;
  body_text: string;
  latency_ms: number;
};

/** Injectible HTTP so tests never open real sockets. */
export type HttpTransport = {
  postJson(input: {
    url: string;
    headers: Record<string, string>;
    body: unknown;
    timeout_ms: number;
  }): Promise<RawProviderHttpResponse>;
};

export type AdapterContext = {
  profile: ProviderProfile;
  /** Env reader — never logs values. */
  getEnv: (name: string) => string | undefined;
  transport: HttpTransport;
  now_ms: () => number;
  network_allowed: boolean;
};

export type ProviderAdapter = {
  provider_id: ProviderId;
  extract(ctx: AdapterContext, req: ProviderRequest): Promise<ProviderCallResult<ExtractResponse>>;
  synthesize(
    ctx: AdapterContext,
    req: ProviderRequest,
  ): Promise<ProviderCallResult<SynthesisResponse>>;
};

export type BodyFreeCostRecord = {
  schema: "carpeos.v5.cost-record/v1";
  provider_id: ProviderId;
  model_id: string;
  route: ProviderProfileId;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_hit_tokens: number | null;
  cache_miss_tokens: number | null;
  latency_ms: number;
  status: "ok" | "error";
  error_code: ProviderErrorCode | null;
  cost_usd: number | null;
  currency: "USD";
  canonical_effect: "none";
};

export type PriceSnapshot = {
  schema: "carpeos.v5.price-snapshot/v1";
  provider_id: ProviderId;
  model_id: string;
  currency: "USD";
  /** USD per 1M tokens */
  input_cache_hit_per_1m: number | null;
  input_cache_miss_per_1m: number;
  output_per_1m: number;
  source: string;
  timestamp: string;
  formula: string;
};
