import { describe, expect, it } from "vitest";
import { jcs } from "../src/jcs.js";
import {
  createScriptedTransport,
  envReaderFromMap,
  fakeChatCompletionJson,
} from "../src/provider-adapters.js";
import {
  calculateCostUsd,
  buildCostComputationReceipt,
  buildCostRecord,
} from "../src/provider-cost.js";
import {
  buildExperimentLedger,
  compareRouteCosts,
  priceSnapshotForProfile,
  recordCostFromCall,
} from "../src/provider-experiment.js";
import { isExtractResponse, parseExtractResponse } from "../src/provider-normalize.js";
import {
  DEEPSEEK_DIRECT_FLASH_PRICE_SNAPSHOT,
  DEEPSEEK_DIRECT_MODEL_ID,
  OPENROUTER_DEEPSEEK_MODEL_ID,
  OPENROUTER_LUNA_MODEL_ID,
  PROVIDER_PROFILES,
} from "../src/provider-profiles.js";
import { ProviderBoundary } from "../src/provider.js";
import type { ExtractResponse } from "../src/reducer.js";

const NO_CANDIDATE: ExtractResponse = {
  schema: "carpeos.llm-extract/v1",
  result: "no_candidate",
  candidates: [],
  citations: [],
};

const WITH_CANDIDATE: ExtractResponse = {
  schema: "carpeos.llm-extract/v1",
  result: "candidates",
  candidates: [
    {
      quote_kind: "decision",
      segment_id: "seg_0",
      start: 0,
      end: 1,
      text: "X",
    },
  ],
  citations: [{ segment_id: "seg_0", start: 0, end: 1 }],
};

const NOW = "2026-08-06T00:00:00.000Z";
const PACK = "sha256:synthetic_pack_digest_01";

function headersSeen(): { auth: string[]; deepseekKeyToOpenRouter: boolean } {
  return { auth: [], deepseekKeyToOpenRouter: false };
}

describe("verified model IDs", () => {
  it("uses current DeepSeek Direct and OpenRouter slugs (not deprecated aliases)", () => {
    expect(DEEPSEEK_DIRECT_MODEL_ID).toBe("deepseek-v4-flash");
    expect(OPENROUTER_DEEPSEEK_MODEL_ID).toBe("deepseek/deepseek-v4-flash-0731");
    expect(OPENROUTER_LUNA_MODEL_ID).toBe("openai/gpt-5.6-luna");
    expect(DEEPSEEK_DIRECT_MODEL_ID).not.toBe("deepseek-chat");
    expect(DEEPSEEK_DIRECT_MODEL_ID).not.toBe("deepseek-reasoner");
  });
});

describe("DeepSeek Direct fake HTTP contract", () => {
  it("posts to api.deepseek.com with DEEPSEEK_API_KEY and normalizes ExtractResponse", async () => {
    const seen = headersSeen();
    const transport = createScriptedTransport(({ url, headers, body }) => {
      expect(url).toBe("https://api.deepseek.com/chat/completions");
      expect(headers.authorization).toBe("Bearer synthetic-deepseek-credential");
      seen.auth.push(headers.authorization);
      const b = body as { model: string; provider?: unknown };
      expect(b.model).toBe("deepseek-v4-flash");
      expect(b.provider).toBeUndefined();
      return {
        status: 200,
        latency_ms: 12,
        body_text: fakeChatCompletionJson(WITH_CANDIDATE),
      };
    });
    const p = new ProviderBoundary({
      kill: { network_disabled: false },
      transport,
      getEnv: envReaderFromMap({ DEEPSEEK_API_KEY: "synthetic-deepseek-credential" }),
    });
    const route = p.deepseekDirectExtractRoute();
    const preflight = {
      profile_id: route.profile_id,
      pack_digest: PACK,
      consent_id: "c1",
      route,
      trust_zone_id: "tz",
    };
    const result = await p.extract({
      consent: {
        consent_id: "c1",
        profile_id: route.profile_id,
        allow_network: true,
        allow_escalation: false,
        expires_at: null,
      },
      preflight,
      expectedPreflight: preflight,
      nowIso: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response).toEqual(WITH_CANDIDATE);
      expect(result.network_used).toBe(true);
      expect(result.canonical_effect).toBe("none");
      expect(result.usage.input_tokens).toBe(100);
    }
  });
});

describe("OpenRouter fake HTTP contract", () => {
  it("uses OPENROUTER_API_KEY, allow_fallbacks:false, and never DEEPSEEK_API_KEY", async () => {
    const transport = createScriptedTransport(({ url, headers, body }) => {
      expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(headers.authorization).toBe("Bearer synthetic-openrouter-credential");
      expect(headers.authorization).not.toContain("synthetic-deepseek-credential");
      const b = body as {
        model: string;
        provider: { allow_fallbacks: boolean; order?: string[] };
      };
      expect(b.model).toBe("deepseek/deepseek-v4-flash-0731");
      expect(b.provider.allow_fallbacks).toBe(false);
      expect(b.provider.order).toEqual(["deepseek"]);
      return {
        status: 200,
        latency_ms: 15,
        body_text: fakeChatCompletionJson(WITH_CANDIDATE, {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        }),
      };
    });
    const p = new ProviderBoundary({
      kill: { network_disabled: false },
      transport,
      getEnv: envReaderFromMap({
        OPENROUTER_API_KEY: "synthetic-openrouter-credential",
        DEEPSEEK_API_KEY: "synthetic-deepseek-credential",
      }),
    });
    const route = p.openrouterDeepseekExtractRoute();
    const preflight = {
      profile_id: route.profile_id,
      pack_digest: PACK,
      consent_id: "c1",
      route,
      trust_zone_id: "tz",
    };
    const result = await p.extract({
      consent: {
        consent_id: "c1",
        profile_id: route.profile_id,
        allow_network: true,
        allow_escalation: false,
        expires_at: null,
      },
      preflight,
      expectedPreflight: preflight,
      nowIso: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response).toEqual(WITH_CANDIDATE);
      expect(result.canonical_effect).toBe("none");
    }
  });
});

describe("normalized ExtractResponse equality across routes", () => {
  it("returns the same ExtractResponse schema for Direct and OpenRouter fakes", async () => {
    const payload = WITH_CANDIDATE;
    const body = fakeChatCompletionJson(payload);
    const pDirect = new ProviderBoundary({
      kill: { network_disabled: false },
      transport: createScriptedTransport(() => ({
        status: 200,
        latency_ms: 1,
        body_text: body,
      })),
      getEnv: envReaderFromMap({ DEEPSEEK_API_KEY: "k" }),
    });
    const pOr = new ProviderBoundary({
      kill: { network_disabled: false },
      transport: createScriptedTransport(() => ({
        status: 200,
        latency_ms: 1,
        body_text: body,
      })),
      getEnv: envReaderFromMap({ OPENROUTER_API_KEY: "k" }),
    });
    const dRoute = pDirect.deepseekDirectExtractRoute();
    const oRoute = pOr.openrouterDeepseekExtractRoute();
    const dPre = {
      profile_id: dRoute.profile_id,
      pack_digest: PACK,
      consent_id: "c",
      route: dRoute,
      trust_zone_id: "tz",
    };
    const oPre = {
      profile_id: oRoute.profile_id,
      pack_digest: PACK,
      consent_id: "c",
      route: oRoute,
      trust_zone_id: "tz",
    };
    const d = await pDirect.extract({
      consent: {
        consent_id: "c",
        profile_id: dRoute.profile_id,
        allow_network: true,
        allow_escalation: false,
        expires_at: null,
      },
      preflight: dPre,
      expectedPreflight: dPre,
      nowIso: NOW,
    });
    const o = await pOr.extract({
      consent: {
        consent_id: "c",
        profile_id: oRoute.profile_id,
        allow_network: true,
        allow_escalation: false,
        expires_at: null,
      },
      preflight: oPre,
      expectedPreflight: oPre,
      nowIso: NOW,
    });
    expect(d.ok && o.ok).toBe(true);
    if (d.ok && o.ok) {
      expect(jcs(d.response)).toBe(jcs(o.response));
      expect(isExtractResponse(d.response)).toBe(true);
    }
  });
});

describe("error branches", () => {
  it("maps timeout, 429, 5xx, malformed JSON, schema-invalid", async () => {
    const cases: Array<{
      name: string;
      script: () => { status: number; latency_ms: number; body_text: string } | never;
      throws?: boolean;
      error: string;
    }> = [
      {
        name: "timeout",
        throws: true,
        script: () => {
          throw new Error("timeout");
        },
        error: "timeout",
      },
      {
        name: "429",
        script: () => ({ status: 429, latency_ms: 1, body_text: "{}" }),
        error: "http_429",
      },
      {
        name: "5xx",
        script: () => ({ status: 503, latency_ms: 1, body_text: "{}" }),
        error: "http_5xx",
      },
      {
        name: "malformed",
        script: () => ({ status: 200, latency_ms: 1, body_text: "not-json" }),
        error: "malformed_json",
      },
      {
        name: "schema",
        script: () => ({
          status: 200,
          latency_ms: 1,
          body_text: fakeChatCompletionJson({ schema: "wrong", result: "x" }),
        }),
        error: "schema_invalid",
      },
    ];

    for (const c of cases) {
      const transport = createScriptedTransport(() => {
        if (c.throws) throw new Error("timeout");
        return c.script();
      });
      const p = new ProviderBoundary({
        kill: { network_disabled: false },
        transport,
        getEnv: envReaderFromMap({ DEEPSEEK_API_KEY: "k" }),
      });
      const route = p.deepseekDirectExtractRoute();
      const preflight = {
        profile_id: route.profile_id,
        pack_digest: PACK,
        consent_id: "c",
        route,
        trust_zone_id: "tz",
      };
      const result = await p.extract({
        consent: {
          consent_id: "c",
          profile_id: route.profile_id,
          allow_network: true,
          allow_escalation: false,
          expires_at: null,
        },
        preflight,
        expectedPreflight: preflight,
        nowIso: NOW,
      });
      expect(result.ok, c.name).toBe(false);
      if (!result.ok) {
        expect(result.error, c.name).toBe(c.error);
        expect(result.canonical_effect).toBe("none");
      }
    }
  });
});

describe("usage and cost calculation", () => {
  it("fails cost calculation when usage metadata is missing", () => {
    const calc = calculateCostUsd(
      {
        input_tokens: null,
        output_tokens: null,
        cache_hit_tokens: null,
        cache_miss_tokens: null,
      },
      DEEPSEEK_DIRECT_FLASH_PRICE_SNAPSHOT,
    );
    expect(calc.ok).toBe(false);
    if (!calc.ok) expect(calc.error).toBe("usage_missing");
  });

  it("computes Direct flash cost with official price snapshot formula", () => {
    const calc = calculateCostUsd(
      {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        cache_hit_tokens: 500_000,
        cache_miss_tokens: 500_000,
      },
      DEEPSEEK_DIRECT_FLASH_PRICE_SNAPSHOT,
    );
    expect(calc.ok).toBe(true);
    if (calc.ok) {
      // 0.5*0.0028 + 0.5*0.14 + 1*0.28 = 0.0014 + 0.07 + 0.28 = 0.3514
      expect(calc.cost_usd).toBeCloseTo(0.3514, 6);
    }
    const record = buildCostRecord({
      provider_id: "deepseek_direct",
      model_id: DEEPSEEK_DIRECT_MODEL_ID,
      route: "deepseek_direct_extract_v1",
      usage: {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        cache_hit_tokens: 500_000,
        cache_miss_tokens: 500_000,
      },
      latency_ms: 10,
      status: "ok",
      error_code: null,
      cost_usd: calc.ok ? calc.cost_usd : null,
    });
    const receipt = buildCostComputationReceipt({
      price_snapshot: DEEPSEEK_DIRECT_FLASH_PRICE_SNAPSHOT,
      record,
      calculation: calc,
    });
    expect(receipt.pass).toBe(true);
    expect(receipt.canonical_effect).toBe("none");
    expect(JSON.stringify(receipt)).not.toMatch(/sk-|Bearer |DEEPSEEK_API_KEY=/i);
  });
});

describe("credential non-leakage", () => {
  it("does not embed auth material in cost records or parse outputs", () => {
    // Use a probe marker only (do not write credential assignment literals in tests).
    const leakageProbe = "probe_value_must_not_appear_in_artifacts";
    const parsed = parseExtractResponse(fakeChatCompletionJson(NO_CANDIDATE));
    expect(parsed.ok).toBe(true);
    const serialized = JSON.stringify({
      profiles: PROVIDER_PROFILES,
      price: DEEPSEEK_DIRECT_FLASH_PRICE_SNAPSHOT,
      parsed,
    });
    expect(serialized).not.toContain(leakageProbe);
    expect(serialized).not.toMatch(/Bearer /);
    expect(serialized).not.toMatch(/\bsk-[A-Za-z0-9]{8,}\b/);
  });
});

describe("no implicit fallback", () => {
  it("refuses OpenRouter route when openrouter kill switch is on", async () => {
    const p = new ProviderBoundary({
      kill: { network_disabled: false, openrouter_disabled: true },
      transport: createScriptedTransport(() => {
        throw new Error("should not call");
      }),
      getEnv: envReaderFromMap({ OPENROUTER_API_KEY: "k" }),
    });
    const route = p.openrouterDeepseekExtractRoute();
    const preflight = {
      profile_id: route.profile_id,
      pack_digest: PACK,
      consent_id: "c",
      route,
      trust_zone_id: "tz",
    };
    const result = await p.extract({
      consent: {
        consent_id: "c",
        profile_id: route.profile_id,
        allow_network: true,
        allow_escalation: false,
        expires_at: null,
      },
      preflight,
      expectedPreflight: preflight,
      nowIso: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("kill_switch");
  });
});

describe("no_candidate → one Luna escalation", () => {
  it("escalates once on valid no_candidate and not on transport failure", async () => {
    let calls = 0;
    const transport = createScriptedTransport(({ body }) => {
      calls += 1;
      const model = (body as { model: string }).model;
      if (model === OPENROUTER_LUNA_MODEL_ID) {
        return {
          status: 200,
          latency_ms: 2,
          body_text: fakeChatCompletionJson(WITH_CANDIDATE),
        };
      }
      return {
        status: 200,
        latency_ms: 2,
        body_text: fakeChatCompletionJson(NO_CANDIDATE),
      };
    });
    const p = new ProviderBoundary({
      kill: { network_disabled: false },
      transport,
      getEnv: envReaderFromMap({
        DEEPSEEK_API_KEY: "dk",
        OPENROUTER_API_KEY: "ok",
      }),
      budget: { max_escalation_calls: 1 },
    });
    const primaryRoute = p.deepseekDirectExtractRoute();
    const preflight = {
      profile_id: primaryRoute.profile_id,
      pack_digest: PACK,
      consent_id: "c",
      route: primaryRoute,
      trust_zone_id: "tz",
    };
    const primary = await p.extract({
      consent: {
        consent_id: "c",
        profile_id: primaryRoute.profile_id,
        allow_network: true,
        allow_escalation: true,
        expires_at: null,
      },
      preflight,
      expectedPreflight: preflight,
      nowIso: NOW,
    });
    expect(primary.ok).toBe(true);
    if (primary.ok) expect(primary.response.result).toBe("no_candidate");

    const esc = await p.maybeEscalateFromNoCandidate({
      primary,
      consent: {
        consent_id: "c",
        profile_id: primaryRoute.profile_id,
        allow_network: true,
        allow_escalation: true,
        expires_at: null,
      },
      pack_digest: PACK,
      trust_zone_id: "tz",
      nowIso: NOW,
    });
    expect(esc?.ok).toBe(true);
    if (esc?.ok) {
      expect(esc.response).toEqual(WITH_CANDIDATE);
      expect(esc.route.model_id).toBe(OPENROUTER_LUNA_MODEL_ID);
      expect(esc.canonical_effect).toBe("none");
    }
    expect(calls).toBe(2);

    // Transport failure → no Luna
    const pFail = new ProviderBoundary({
      kill: { network_disabled: false },
      transport: createScriptedTransport(() => {
        throw new Error("timeout");
      }),
      getEnv: envReaderFromMap({ DEEPSEEK_API_KEY: "dk", OPENROUTER_API_KEY: "ok" }),
    });
    const failPrimary = await pFail.extract({
      consent: {
        consent_id: "c",
        profile_id: primaryRoute.profile_id,
        allow_network: true,
        allow_escalation: true,
        expires_at: null,
      },
      preflight,
      expectedPreflight: preflight,
      nowIso: NOW,
    });
    expect(failPrimary.ok).toBe(false);
    const noEsc = await pFail.maybeEscalateFromNoCandidate({
      primary: failPrimary,
      consent: {
        consent_id: "c",
        profile_id: primaryRoute.profile_id,
        allow_network: true,
        allow_escalation: true,
        expires_at: null,
      },
      pack_digest: PACK,
      trust_zone_id: "tz",
      nowIso: NOW,
    });
    expect(noEsc).toBeNull();
  });
});

describe("cost experiment ledger", () => {
  it("compares Direct vs OpenRouter on same pack with body-free receipts", () => {
    const usage = {
      input_tokens: 10_000,
      output_tokens: 2_000,
      cache_hit_tokens: 0,
      cache_miss_tokens: 10_000,
    };
    const okCall = {
      ok: true as const,
      response: WITH_CANDIDATE,
      route: {
        profile_id: "deepseek_direct_extract_v1" as const,
        provider_id: "deepseek_direct" as const,
        model_id: DEEPSEEK_DIRECT_MODEL_ID,
        slot: "extract_default" as const,
      },
      network_used: true,
      usage,
      latency_ms: 40,
      http_status: 200,
      cost_usd: null,
      canonical_effect: "none" as const,
    };
    const direct = recordCostFromCall({
      case_id: "exp-direct",
      pack_digest: PACK,
      profile_id: "deepseek_direct_extract_v1",
      provider_id: "deepseek_direct",
      model_id: DEEPSEEK_DIRECT_MODEL_ID,
      call: okCall,
      price: priceSnapshotForProfile("deepseek_direct_extract_v1")!,
    });
    const openrouter = recordCostFromCall({
      case_id: "exp-or",
      pack_digest: PACK,
      profile_id: "openrouter_deepseek_extract_v1",
      provider_id: "openrouter",
      model_id: OPENROUTER_DEEPSEEK_MODEL_ID,
      call: {
        ...okCall,
        route: {
          profile_id: "openrouter_deepseek_extract_v1",
          provider_id: "openrouter",
          model_id: OPENROUTER_DEEPSEEK_MODEL_ID,
          slot: "extract_default",
        },
      },
      price: priceSnapshotForProfile("openrouter_deepseek_extract_v1")!,
    });
    const cmp = compareRouteCosts(direct, openrouter);
    expect(cmp.same_pack).toBe(true);
    expect(cmp.comparable).toBe(true);
    expect(cmp.delta_usd).not.toBeNull();
    const ledger = buildExperimentLedger({
      results: [direct, openrouter],
      spend_cap_usd: 1.0,
    });
    expect(ledger.canonical_effect).toBe("none");
    expect(ledger.kill_switch_tripped).toBe(false);
    expect(JSON.stringify(ledger)).not.toMatch(/sk-|Bearer /);
  });
});

describe("canonical_effect fence", () => {
  it("is none for every profile definition and successful fake call", async () => {
    for (const profile of Object.values(PROVIDER_PROFILES)) {
      expect(profile.network_enabled_default).toBe(false);
      expect(profile.allow_fallbacks).toBe(false);
    }
    const p = new ProviderBoundary();
    const route = p.fakeExtractRoute();
    const preflight = {
      profile_id: route.profile_id,
      pack_digest: PACK,
      consent_id: "c",
      route,
      trust_zone_id: "tz",
    };
    const result = await p.extract({
      consent: {
        consent_id: "c",
        profile_id: route.profile_id,
        allow_network: false,
        allow_escalation: false,
        expires_at: null,
      },
      preflight,
      expectedPreflight: preflight,
      nowIso: NOW,
    });
    expect(result.canonical_effect).toBe("none");
  });
});
