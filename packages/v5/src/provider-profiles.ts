/**
 * Separate ProviderProfile entries — independently declare model, route,
 * consent, privacy, budget, and kill switch. No ZDR/no-retention claims.
 *
 * Verified model IDs (2026-08-06):
 * - DeepSeek Direct: deepseek-v4-flash @ https://api.deepseek.com
 *   (legacy deepseek-chat / deepseek-reasoner discontinued; do not use)
 * - OpenRouter DeepSeek: deepseek/deepseek-v4-flash-0731
 * - OpenRouter Luna: openai/gpt-5.6-luna
 */

import type { ProviderProfile, ProviderProfileId, PriceSnapshot } from "./provider-types.js";

const NO_PRIVACY_CLAIM = {
  data_policy_status: "unknown" as const,
  retention_claim: "none_asserted" as const,
  training_claim: "none_asserted" as const,
  notes:
    "No ZDR, no-retention, or no-training claim is asserted. Remote bytes may exist after a call.",
};

/** Verified DeepSeek Direct extract model (not a deprecated alias). */
export const DEEPSEEK_DIRECT_MODEL_ID = "deepseek-v4-flash" as const;
export const DEEPSEEK_DIRECT_BASE_URL = "https://api.deepseek.com" as const;

/** Pinned OpenRouter DeepSeek slug (not an implicit "latest" redirect). */
export const OPENROUTER_DEEPSEEK_MODEL_ID = "deepseek/deepseek-v4-flash-0731" as const;
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1" as const;

/** Verified OpenRouter Luna escalation slug. */
export const OPENROUTER_LUNA_MODEL_ID = "openai/gpt-5.6-luna" as const;

export const PROVIDER_PROFILES: Record<ProviderProfileId, ProviderProfile> = {
  fake_extract_v1: {
    profile_id: "fake_extract_v1",
    provider_id: "fake",
    model_id: "fake-extract-v1",
    slot: "local_fake",
    base_url: null,
    auth_env: null,
    allow_fallbacks: false,
    provider_constraints: [],
    consent_scope: "extract",
    privacy: {
      data_policy_status: "documented",
      retention_claim: "none_asserted",
      training_claim: "none_asserted",
      notes: "Local fake — no network, no remote bytes.",
    },
    budget: { max_calls: 100, spend_cap_usd: 0 },
    kill_switch_key: "fake",
    network_enabled_default: false,
    predeclared_escalation_only: false,
  },
  deepseek_direct_extract_v1: {
    profile_id: "deepseek_direct_extract_v1",
    provider_id: "deepseek_direct",
    model_id: DEEPSEEK_DIRECT_MODEL_ID,
    slot: "extract_default",
    base_url: DEEPSEEK_DIRECT_BASE_URL,
    auth_env: "DEEPSEEK_API_KEY",
    allow_fallbacks: false,
    provider_constraints: [],
    consent_scope: "extract",
    privacy: { ...NO_PRIVACY_CLAIM },
    budget: { max_calls: 8, spend_cap_usd: 1.0 },
    kill_switch_key: "deepseek_direct",
    network_enabled_default: false,
    predeclared_escalation_only: false,
  },
  openrouter_deepseek_extract_v1: {
    profile_id: "openrouter_deepseek_extract_v1",
    provider_id: "openrouter",
    model_id: OPENROUTER_DEEPSEEK_MODEL_ID,
    slot: "extract_default",
    base_url: OPENROUTER_BASE_URL,
    auth_env: "OPENROUTER_API_KEY",
    allow_fallbacks: false,
    /** Constrain to DeepSeek provider only — no silent multi-provider routing. */
    provider_constraints: ["deepseek"],
    consent_scope: "extract",
    privacy: { ...NO_PRIVACY_CLAIM },
    budget: { max_calls: 8, spend_cap_usd: 1.0 },
    kill_switch_key: "openrouter",
    network_enabled_default: false,
    predeclared_escalation_only: false,
  },
  openrouter_luna_escalation_v1: {
    profile_id: "openrouter_luna_escalation_v1",
    provider_id: "openrouter",
    model_id: OPENROUTER_LUNA_MODEL_ID,
    slot: "escalation_or_synthesis",
    base_url: OPENROUTER_BASE_URL,
    auth_env: "OPENROUTER_API_KEY",
    allow_fallbacks: false,
    provider_constraints: ["openai"],
    consent_scope: "escalation",
    privacy: { ...NO_PRIVACY_CLAIM },
    budget: { max_calls: 1, spend_cap_usd: 1.0 },
    kill_switch_key: "openrouter_luna",
    network_enabled_default: false,
    predeclared_escalation_only: true,
  },
};

export function getProfile(id: ProviderProfileId): ProviderProfile {
  return PROVIDER_PROFILES[id];
}

/**
 * Price snapshot for DeepSeek Direct flash from official docs.
 * Source verified 2026-08-06: https://api-docs.deepseek.com/quick_start/pricing/
 */
export const DEEPSEEK_DIRECT_FLASH_PRICE_SNAPSHOT: PriceSnapshot = {
  schema: "carpeos.v5.price-snapshot/v1",
  provider_id: "deepseek_direct",
  model_id: DEEPSEEK_DIRECT_MODEL_ID,
  currency: "USD",
  input_cache_hit_per_1m: 0.0028,
  input_cache_miss_per_1m: 0.14,
  output_per_1m: 0.28,
  source: "https://api-docs.deepseek.com/quick_start/pricing/",
  timestamp: "2026-08-06T00:00:00.000Z",
  formula:
    "cost_usd = (cache_hit_tokens/1e6)*input_cache_hit_per_1m + (cache_miss_tokens/1e6)*input_cache_miss_per_1m + (output_tokens/1e6)*output_per_1m; if cache splits null, treat all input as cache_miss",
};

/**
 * OpenRouter DeepSeek price snapshot — body-free catalog reference.
 * Must be re-verified before live cost comparison; not a retention claim.
 */
export const OPENROUTER_DEEPSEEK_PRICE_SNAPSHOT: PriceSnapshot = {
  schema: "carpeos.v5.price-snapshot/v1",
  provider_id: "openrouter",
  model_id: OPENROUTER_DEEPSEEK_MODEL_ID,
  currency: "USD",
  input_cache_hit_per_1m: null,
  input_cache_miss_per_1m: 0.09,
  output_per_1m: 0.18,
  source: "https://openrouter.ai/deepseek/deepseek-v4-flash-0731",
  timestamp: "2026-08-06T00:00:00.000Z",
  formula:
    "cost_usd = (input_tokens/1e6)*input_cache_miss_per_1m + (output_tokens/1e6)*output_per_1m (OpenRouter catalog; cache splits unused when null)",
};

export function isProfileAvailable(
  profile: ProviderProfile,
  input: {
    kill: {
      provider_disabled: boolean;
      deepseek_direct_disabled: boolean;
      openrouter_disabled: boolean;
      escalation_disabled: boolean;
    };
    require_privacy_documented?: boolean;
  },
): { available: boolean; reason: string | null } {
  if (input.kill.provider_disabled) {
    return { available: false, reason: "kill_switch" };
  }
  if (profile.provider_id === "deepseek_direct" && input.kill.deepseek_direct_disabled) {
    return { available: false, reason: "deepseek_direct_disabled" };
  }
  if (profile.provider_id === "openrouter" && input.kill.openrouter_disabled) {
    return { available: false, reason: "openrouter_disabled" };
  }
  if (profile.predeclared_escalation_only && input.kill.escalation_disabled) {
    return { available: false, reason: "escalation_disabled" };
  }
  if (
    input.require_privacy_documented &&
    profile.privacy.data_policy_status !== "documented" &&
    profile.provider_id !== "fake"
  ) {
    return { available: false, reason: "privacy_policy_unavailable" };
  }
  return { available: true, reason: null };
}
