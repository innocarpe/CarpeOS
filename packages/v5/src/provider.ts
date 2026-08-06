/**
 * OpenRouter-first provider boundary with no-network fakes.
 * Real network remains disabled until offline gates pass.
 */

import { digestSha256, jcs } from "./jcs.js";
import type { ExtractResponse, SynthesisResponse } from "./reducer.js";

export type ProviderRoute =
  | {
      slot: "extract_default";
      provider: "openrouter";
      model: "deepseek/deepseek-flash";
    }
  | {
      slot: "escalation_or_synthesis";
      provider: "openrouter";
      model: "openai/gpt-5.6-luna";
      predeclared: true;
    }
  | {
      slot: "local_fake";
      provider: "fake";
      model: "fake-extract-v1" | "fake-synthesis-v1";
    };

export type ProviderConsent = {
  consent_id: string;
  profile_id: string;
  allow_network: boolean;
  allow_escalation: boolean;
  expires_at: string | null;
};

export type ProviderBudget = {
  max_extract_calls: number;
  max_synthesis_calls: number;
  max_escalation_calls: number;
  extract_used: number;
  synthesis_used: number;
  escalation_used: number;
};

export type ProviderPreflight = {
  profile_id: string;
  pack_digest: string;
  consent_id: string;
  route: ProviderRoute;
  trust_zone_id: string;
};

export type ProviderKillSwitch = {
  provider_disabled: boolean;
  escalation_disabled: boolean;
  network_disabled: boolean;
};

export type ProviderCallResult<T> =
  | { ok: true; response: T; route: ProviderRoute; network_used: false }
  | {
      ok: false;
      error:
        | "consent_denied"
        | "route_not_allowed"
        | "budget_exceeded"
        | "kill_switch"
        | "preflight_mismatch"
        | "expired"
        | "network_disabled"
        | "fake_only";
      network_used: false;
    };

export type FakeProviderResponses = {
  extract?: ExtractResponse;
  synthesis?: SynthesisResponse;
};

const DEFAULT_EXTRACT: ExtractResponse = {
  schema: "carpeos.llm-extract/v1",
  result: "no_candidate",
  candidates: [],
  citations: [],
};

const DEFAULT_SYNTHESIS: SynthesisResponse = {
  schema: "carpeos.llm-synthesize/v1",
  result: "no_candidate",
  draft_text: null,
  citations: [],
};

export class ProviderBoundary {
  private readonly kill: ProviderKillSwitch;
  private readonly fakes: FakeProviderResponses;
  private budget: ProviderBudget;

  constructor(input?: {
    kill?: Partial<ProviderKillSwitch>;
    fakes?: FakeProviderResponses;
    budget?: Partial<ProviderBudget>;
  }) {
    this.kill = {
      provider_disabled: input?.kill?.provider_disabled ?? false,
      escalation_disabled: input?.kill?.escalation_disabled ?? false,
      // Real network stays disabled by default
      network_disabled: input?.kill?.network_disabled ?? true,
    };
    this.fakes = input?.fakes ?? {};
    this.budget = {
      max_extract_calls: input?.budget?.max_extract_calls ?? 8,
      max_synthesis_calls: input?.budget?.max_synthesis_calls ?? 2,
      max_escalation_calls: input?.budget?.max_escalation_calls ?? 1,
      extract_used: input?.budget?.extract_used ?? 0,
      synthesis_used: input?.budget?.synthesis_used ?? 0,
      escalation_used: input?.budget?.escalation_used ?? 0,
    };
  }

  defaultExtractRoute(): ProviderRoute {
    return {
      slot: "extract_default",
      provider: "openrouter",
      model: "deepseek/deepseek-flash",
    };
  }

  rareEscalationRoute(): ProviderRoute {
    return {
      slot: "escalation_or_synthesis",
      provider: "openrouter",
      model: "openai/gpt-5.6-luna",
      predeclared: true,
    };
  }

  fakeExtractRoute(): ProviderRoute {
    return { slot: "local_fake", provider: "fake", model: "fake-extract-v1" };
  }

  checkAdmission(input: {
    consent: ProviderConsent;
    preflight: ProviderPreflight;
    expectedPreflight: ProviderPreflight;
    nowIso: string;
  }):
    | "consent_denied"
    | "route_not_allowed"
    | "budget_exceeded"
    | "kill_switch"
    | "preflight_mismatch"
    | "expired"
    | "network_disabled"
    | "fake_only"
    | null {
    if (this.kill.provider_disabled) return "kill_switch";
    if (jcs(input.preflight) !== jcs(input.expectedPreflight)) return "preflight_mismatch";
    if (!input.consent.allow_network && input.preflight.route.provider !== "fake") {
      return "consent_denied";
    }
    if (input.consent.expires_at && input.consent.expires_at < input.nowIso) {
      return "expired";
    }
    if (
      input.preflight.route.slot === "escalation_or_synthesis" &&
      (!input.consent.allow_escalation || this.kill.escalation_disabled)
    ) {
      return "route_not_allowed";
    }
    if (input.preflight.route.provider !== "fake" && this.kill.network_disabled) {
      return "network_disabled";
    }
    return null;
  }

  extract(input: {
    consent: ProviderConsent;
    preflight: ProviderPreflight;
    expectedPreflight: ProviderPreflight;
    nowIso: string;
  }): ProviderCallResult<ExtractResponse> {
    const err = this.checkAdmission(input);
    if (err) return { ok: false, error: err, network_used: false };
    if (input.preflight.route.provider !== "fake") {
      return { ok: false, error: "fake_only", network_used: false };
    }
    if (this.budget.extract_used >= this.budget.max_extract_calls) {
      return { ok: false, error: "budget_exceeded", network_used: false };
    }
    this.budget.extract_used += 1;
    return {
      ok: true,
      response: this.fakes.extract ?? DEFAULT_EXTRACT,
      route: input.preflight.route,
      network_used: false,
    };
  }

  synthesize(input: {
    consent: ProviderConsent;
    preflight: ProviderPreflight;
    expectedPreflight: ProviderPreflight;
    nowIso: string;
  }): ProviderCallResult<SynthesisResponse> {
    const err = this.checkAdmission(input);
    if (err) return { ok: false, error: err, network_used: false };
    if (input.preflight.route.provider !== "fake") {
      return { ok: false, error: "fake_only", network_used: false };
    }
    if (this.budget.synthesis_used >= this.budget.max_synthesis_calls) {
      return { ok: false, error: "budget_exceeded", network_used: false };
    }
    this.budget.synthesis_used += 1;
    return {
      ok: true,
      response: this.fakes.synthesis ?? DEFAULT_SYNTHESIS,
      route: input.preflight.route,
      network_used: false,
    };
  }

  budgetSnapshot(): ProviderBudget {
    return { ...this.budget };
  }

  routeDigest(route: ProviderRoute): string {
    return digestSha256({ schema: "carpeos.provider-route/v1", route });
  }
}
