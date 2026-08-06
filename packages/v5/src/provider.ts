/**
 * Provider-neutral boundary: fake | deepseek_direct | openrouter.
 *
 * Design note:
 * - Original V5 design was OpenRouter-first.
 * - DeepSeek Direct is now the primary opt-in experimental real route for cost measurement.
 * - OpenRouter remains optional for DeepSeek and for the Luna escalation slot.
 * - Real network is disabled by default. No implicit provider fallback.
 */

import { digestSha256, jcs } from "./jcs.js";
import {
  createDeepSeekDirectAdapter,
  createDisabledTransport,
  createFakeAdapter,
  createOpenRouterAdapter,
  DEFAULT_EXTRACT_RESPONSE,
  DEFAULT_SYNTHESIS_RESPONSE,
} from "./provider-adapters.js";
import { calculateCostUsd } from "./provider-cost.js";
import {
  DEEPSEEK_DIRECT_FLASH_PRICE_SNAPSHOT,
  getProfile,
  isProfileAvailable,
  OPENROUTER_DEEPSEEK_PRICE_SNAPSHOT,
  PROVIDER_PROFILES,
} from "./provider-profiles.js";
import type {
  HttpTransport,
  PriceSnapshot,
  ProviderAdapter,
  ProviderCallResult,
  ProviderConsent,
  ProviderErrorCode,
  ProviderId,
  ProviderKillSwitch,
  ProviderPreflight,
  ProviderProfileId,
  ProviderRequest,
  ProviderRoute,
} from "./provider-types.js";
import type { ExtractResponse, SynthesisResponse } from "./reducer.js";

export type {
  ProviderConsent,
  ProviderId,
  ProviderKillSwitch,
  ProviderPreflight,
  ProviderProfileId,
  ProviderRoute,
} from "./provider-types.js";
export { PROVIDER_PROFILES, getProfile } from "./provider-profiles.js";
export {
  createScriptedTransport,
  createFakeAdapter,
  fakeChatCompletionJson,
  envReaderFromMap,
} from "./provider-adapters.js";

export type ProviderBudget = {
  max_extract_calls: number;
  max_synthesis_calls: number;
  max_escalation_calls: number;
  extract_used: number;
  synthesis_used: number;
  escalation_used: number;
  spend_usd: number;
  spend_cap_usd: number;
};

export type FakeProviderResponses = {
  extract?: ExtractResponse;
  synthesis?: SynthesisResponse;
};

export class ProviderBoundary {
  private readonly kill: ProviderKillSwitch;
  private readonly budget: ProviderBudget;
  private readonly adapters: Map<ProviderId, ProviderAdapter>;
  private readonly transport: HttpTransport;
  private readonly getEnv: (name: string) => string | undefined;
  private readonly priceByProfile: Map<ProviderProfileId, PriceSnapshot>;
  private readonly requirePrivacyDocumented: boolean;

  constructor(input?: {
    kill?: Partial<ProviderKillSwitch>;
    fakes?: FakeProviderResponses;
    budget?: Partial<ProviderBudget>;
    transport?: HttpTransport;
    getEnv?: (name: string) => string | undefined;
    requirePrivacyDocumented?: boolean;
  }) {
    this.kill = {
      provider_disabled: input?.kill?.provider_disabled ?? false,
      escalation_disabled: input?.kill?.escalation_disabled ?? false,
      network_disabled: input?.kill?.network_disabled ?? true,
      deepseek_direct_disabled: input?.kill?.deepseek_direct_disabled ?? false,
      openrouter_disabled: input?.kill?.openrouter_disabled ?? false,
      spend_cap_exceeded: input?.kill?.spend_cap_exceeded ?? false,
    };
    this.budget = {
      max_extract_calls: input?.budget?.max_extract_calls ?? 8,
      max_synthesis_calls: input?.budget?.max_synthesis_calls ?? 2,
      max_escalation_calls: input?.budget?.max_escalation_calls ?? 1,
      extract_used: input?.budget?.extract_used ?? 0,
      synthesis_used: input?.budget?.synthesis_used ?? 0,
      escalation_used: input?.budget?.escalation_used ?? 0,
      spend_usd: input?.budget?.spend_usd ?? 0,
      spend_cap_usd: input?.budget?.spend_cap_usd ?? 1.0,
    };
    this.transport = input?.transport ?? createDisabledTransport();
    this.getEnv = input?.getEnv ?? ((name) => process.env[name]);
    this.requirePrivacyDocumented = input?.requirePrivacyDocumented ?? false;
    this.adapters = new Map([
      ["fake", createFakeAdapter(input?.fakes)],
      ["deepseek_direct", createDeepSeekDirectAdapter()],
      ["openrouter", createOpenRouterAdapter()],
    ]);
    this.priceByProfile = new Map([
      ["deepseek_direct_extract_v1", DEEPSEEK_DIRECT_FLASH_PRICE_SNAPSHOT],
      ["openrouter_deepseek_extract_v1", OPENROUTER_DEEPSEEK_PRICE_SNAPSHOT],
    ]);
  }

  /** Primary experimental extract route: DeepSeek Direct. */
  deepseekDirectExtractRoute(): ProviderRoute {
    const p = getProfile("deepseek_direct_extract_v1");
    return {
      profile_id: p.profile_id,
      provider_id: p.provider_id,
      model_id: p.model_id,
      slot: p.slot,
    };
  }

  /** Optional OpenRouter DeepSeek extract route (different billing/auth than Direct). */
  openrouterDeepseekExtractRoute(): ProviderRoute {
    const p = getProfile("openrouter_deepseek_extract_v1");
    return {
      profile_id: p.profile_id,
      provider_id: p.provider_id,
      model_id: p.model_id,
      slot: p.slot,
    };
  }

  /** Predeclared rare Luna escalation via OpenRouter only. */
  lunaEscalationRoute(): ProviderRoute {
    const p = getProfile("openrouter_luna_escalation_v1");
    return {
      profile_id: p.profile_id,
      provider_id: p.provider_id,
      model_id: p.model_id,
      slot: p.slot,
      predeclared: true,
    };
  }

  fakeExtractRoute(): ProviderRoute {
    const p = getProfile("fake_extract_v1");
    return {
      profile_id: p.profile_id,
      provider_id: p.provider_id,
      model_id: p.model_id,
      slot: p.slot,
    };
  }

  /** Product default extract route: DeepSeek Direct (OpenRouter is optional, not required). */
  defaultExtractRoute(): ProviderRoute {
    return this.deepseekDirectExtractRoute();
  }

  /** @deprecated Use lunaEscalationRoute */
  rareEscalationRoute(): ProviderRoute {
    return this.lunaEscalationRoute();
  }

  checkAdmission(input: {
    consent: ProviderConsent;
    preflight: ProviderPreflight;
    expectedPreflight: ProviderPreflight;
    nowIso: string;
  }): ProviderErrorCode | null {
    if (this.kill.provider_disabled) return "kill_switch";
    if (this.kill.spend_cap_exceeded || this.budget.spend_usd >= this.budget.spend_cap_usd) {
      return "spend_cap_exceeded";
    }
    if (jcs(input.preflight) !== jcs(input.expectedPreflight)) return "preflight_mismatch";
    if (input.consent.profile_id !== input.preflight.profile_id) return "consent_denied";
    if (!input.consent.allow_network && input.preflight.route.provider_id !== "fake") {
      return "consent_denied";
    }
    if (input.consent.expires_at && input.consent.expires_at < input.nowIso) {
      return "expired";
    }
    const profile = getProfile(input.preflight.profile_id);
    const avail = isProfileAvailable(profile, {
      kill: this.kill,
      require_privacy_documented: this.requirePrivacyDocumented,
    });
    if (!avail.available) {
      if (avail.reason === "privacy_policy_unavailable") return "profile_unavailable";
      if (avail.reason === "escalation_disabled") return "route_not_allowed";
      return "kill_switch";
    }
    if (
      input.preflight.route.slot === "escalation_or_synthesis" &&
      (!input.consent.allow_escalation || this.kill.escalation_disabled)
    ) {
      return "route_not_allowed";
    }
    if (input.preflight.route.provider_id !== "fake" && this.kill.network_disabled) {
      return "network_disabled";
    }
    return null;
  }

  private async dispatch<T extends ExtractResponse | SynthesisResponse>(input: {
    consent: ProviderConsent;
    preflight: ProviderPreflight;
    expectedPreflight: ProviderPreflight;
    nowIso: string;
    request: ProviderRequest;
    kind: "extract" | "synthesize";
  }): Promise<ProviderCallResult<T>> {
    const admission = this.checkAdmission(input);
    if (admission) {
      return {
        ok: false,
        error: admission,
        network_used: false,
        route: input.preflight.route,
        latency_ms: 0,
        http_status: null,
        canonical_effect: "none",
      };
    }

    const profile = getProfile(input.preflight.profile_id);
    if (profile.provider_id !== input.preflight.route.provider_id) {
      return {
        ok: false,
        error: "route_not_allowed",
        network_used: false,
        route: input.preflight.route,
        latency_ms: 0,
        http_status: null,
        canonical_effect: "none",
      };
    }

    // Budget counters by slot
    if (input.kind === "extract") {
      if (this.budget.extract_used >= this.budget.max_extract_calls) {
        return {
          ok: false,
          error: "budget_exceeded",
          network_used: false,
          route: input.preflight.route,
          latency_ms: 0,
          http_status: null,
          canonical_effect: "none",
        };
      }
    } else if (input.preflight.route.slot === "escalation_or_synthesis") {
      if (this.budget.escalation_used >= this.budget.max_escalation_calls) {
        return {
          ok: false,
          error: "budget_exceeded",
          network_used: false,
          route: input.preflight.route,
          latency_ms: 0,
          http_status: null,
          canonical_effect: "none",
        };
      }
    } else if (this.budget.synthesis_used >= this.budget.max_synthesis_calls) {
      return {
        ok: false,
        error: "budget_exceeded",
        network_used: false,
        route: input.preflight.route,
        latency_ms: 0,
        http_status: null,
        canonical_effect: "none",
      };
    }

    const adapter = this.adapters.get(profile.provider_id);
    if (!adapter) {
      return {
        ok: false,
        error: "profile_unavailable",
        network_used: false,
        route: input.preflight.route,
        latency_ms: 0,
        http_status: null,
        canonical_effect: "none",
      };
    }

    const network_allowed =
      profile.provider_id === "fake" ||
      (!this.kill.network_disabled && input.consent.allow_network);

    const ctx = {
      profile,
      getEnv: this.getEnv,
      transport: this.transport,
      now_ms: () => Date.now(),
      network_allowed,
    };

    const result =
      input.kind === "extract"
        ? await adapter.extract(ctx, input.request)
        : await adapter.synthesize(ctx, input.request);

    if (!result.ok) {
      return result as ProviderCallResult<T>;
    }

    // Attach cost when price snapshot exists and usage present
    let cost_usd = result.cost_usd;
    const price = this.priceByProfile.get(profile.profile_id);
    if (price && profile.provider_id !== "fake") {
      const calc = calculateCostUsd(result.usage, price);
      if (!calc.ok) {
        // Missing usage is a soft fail for cost only when response ok — still return response
        // but mark cost null; experiment receipt captures cost_calculation_failed separately
        cost_usd = null;
        if (calc.error === "usage_missing") {
          // Keep ok response; cost experiment tests missing usage explicitly
        }
      } else {
        cost_usd = calc.cost_usd;
        this.budget.spend_usd += calc.cost_usd;
        if (this.budget.spend_usd >= this.budget.spend_cap_usd) {
          this.kill.spend_cap_exceeded = true;
        }
      }
    }

    if (input.kind === "extract") this.budget.extract_used += 1;
    else if (input.preflight.route.slot === "escalation_or_synthesis")
      this.budget.escalation_used += 1;
    else this.budget.synthesis_used += 1;

    return {
      ...result,
      cost_usd,
      canonical_effect: "none",
    } as ProviderCallResult<T>;
  }

  extract(input: {
    consent: ProviderConsent;
    preflight: ProviderPreflight;
    expectedPreflight: ProviderPreflight;
    nowIso: string;
    request?: ProviderRequest;
  }): Promise<ProviderCallResult<ExtractResponse>> {
    const request: ProviderRequest = input.request ?? {
      messages: [{ role: "user", content: "extract" }],
      temperature: 0,
      max_tokens: 512,
      pack_digest: input.preflight.pack_digest,
      purpose: "extract",
    };
    return this.dispatch({
      consent: input.consent,
      preflight: input.preflight,
      expectedPreflight: input.expectedPreflight,
      nowIso: input.nowIso,
      request,
      kind: "extract",
    });
  }

  synthesize(input: {
    consent: ProviderConsent;
    preflight: ProviderPreflight;
    expectedPreflight: ProviderPreflight;
    nowIso: string;
    request?: ProviderRequest;
  }): Promise<ProviderCallResult<SynthesisResponse>> {
    const request: ProviderRequest = input.request ?? {
      messages: [{ role: "user", content: "synthesize" }],
      temperature: 0,
      max_tokens: 512,
      pack_digest: input.preflight.pack_digest,
      purpose: "synthesize",
    };
    return this.dispatch({
      consent: input.consent,
      preflight: input.preflight,
      expectedPreflight: input.expectedPreflight,
      nowIso: input.nowIso,
      request,
      kind: "synthesize",
    });
  }

  /**
   * Escalation policy:
   * - Only after a valid primary no_candidate result.
   * - One predeclared Luna call max.
   * - Transport/timeout/malformed failures fail closed — never blind Luna retry.
   */
  async maybeEscalateFromNoCandidate(input: {
    primary: ProviderCallResult<ExtractResponse>;
    consent: ProviderConsent;
    pack_digest: string;
    trust_zone_id: string;
    nowIso: string;
    request?: ProviderRequest;
  }): Promise<ProviderCallResult<ExtractResponse> | null> {
    if (!input.primary.ok) {
      // Transport / schema / timeout → fail closed, no Luna
      return null;
    }
    if (input.primary.response.result !== "no_candidate") {
      return null;
    }
    if (!input.consent.allow_escalation) {
      return null;
    }
    const route = this.lunaEscalationRoute();
    const preflight: ProviderPreflight = {
      profile_id: route.profile_id,
      pack_digest: input.pack_digest,
      consent_id: input.consent.consent_id,
      route,
      trust_zone_id: input.trust_zone_id,
    };
    // Escalation consent must bind luna profile when escalating
    const escalationConsent: ProviderConsent = {
      ...input.consent,
      profile_id: route.profile_id,
    };
    return this.extract({
      consent: escalationConsent,
      preflight,
      expectedPreflight: preflight,
      nowIso: input.nowIso,
      request: input.request ?? {
        messages: [{ role: "user", content: "escalate" }],
        temperature: 0,
        max_tokens: 512,
        pack_digest: input.pack_digest,
        purpose: "escalate",
      },
    });
  }

  budgetSnapshot(): ProviderBudget {
    return { ...this.budget };
  }

  killSnapshot(): ProviderKillSwitch {
    return { ...this.kill };
  }

  routeDigest(route: ProviderRoute): string {
    return digestSha256({ schema: "carpeos.provider-route/v1", route });
  }
}

// Re-export defaults used by older tests
export { DEFAULT_EXTRACT_RESPONSE, DEFAULT_SYNTHESIS_RESPONSE };
