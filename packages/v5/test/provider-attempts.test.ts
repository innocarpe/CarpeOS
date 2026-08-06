import { describe, expect, it } from "vitest";
import {
  createSidecar,
  dispatchAttempt,
  finishAttempt,
  isV5Off,
  prepareAttempt,
  reconcileAttempt,
  rollbackV5,
} from "../src/attempts.js";
import {
  buildEvidencePack,
  buildProfileBinding,
  serializeEvidencePackView,
} from "../src/evidence-pack.js";
import { ProviderBoundary } from "../src/provider.js";
import type { RedactOk } from "../src/redaction.js";

describe("provider boundary (fake-only)", () => {
  it("exposes DeepSeek Direct primary and optional OpenRouter/Luna routes", () => {
    const p = new ProviderBoundary();
    expect(p.deepseekDirectExtractRoute()).toMatchObject({
      provider_id: "deepseek_direct",
      model_id: "deepseek-v4-flash",
      profile_id: "deepseek_direct_extract_v1",
    });
    expect(p.openrouterDeepseekExtractRoute()).toMatchObject({
      provider_id: "openrouter",
      model_id: "deepseek/deepseek-v4-flash-0731",
    });
    expect(p.lunaEscalationRoute()).toMatchObject({
      provider_id: "openrouter",
      model_id: "openai/gpt-5.6-luna",
      predeclared: true,
    });
  });

  it("blocks real network and serves fakes only by default", async () => {
    const p = new ProviderBoundary({
      fakes: {
        extract: {
          schema: "carpeos.llm-extract/v1",
          result: "no_candidate",
          candidates: [],
          citations: [],
        },
      },
    });
    const route = p.deepseekDirectExtractRoute();
    const consent = {
      consent_id: "c1",
      profile_id: route.profile_id,
      allow_network: true,
      allow_escalation: false,
      expires_at: null,
    };
    const preflight = {
      profile_id: route.profile_id,
      pack_digest: "sha256:00",
      consent_id: "c1",
      route,
      trust_zone_id: "tz",
    };
    const blocked = await p.extract({
      consent,
      preflight,
      expectedPreflight: preflight,
      nowIso: "2026-08-06T00:00:00.000Z",
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toBe("network_disabled");
    expect(blocked.canonical_effect).toBe("none");

    const fakeRoute = p.fakeExtractRoute();
    const fakePre = {
      profile_id: fakeRoute.profile_id,
      pack_digest: "sha256:00",
      consent_id: "c1",
      route: fakeRoute,
      trust_zone_id: "tz",
    };
    const ok = await p.extract({
      consent: {
        consent_id: "c1",
        profile_id: fakeRoute.profile_id,
        allow_network: false,
        allow_escalation: false,
        expires_at: null,
      },
      preflight: fakePre,
      expectedPreflight: fakePre,
      nowIso: "2026-08-06T00:00:00.000Z",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.network_used).toBe(false);
      expect(ok.canonical_effect).toBe("none");
    }
  });
});

describe("attempts / review / rollback sidecar", () => {
  it("enforces opt-in, one-dispatch, and V5-off rollback", () => {
    const off = createSidecar(false);
    expect(isV5Off(off)).toBe(true);
    expect(() =>
      prepareAttempt(off, {
        attempt_id: "a1",
        run_scope_key: "scope_x",
        run_ordinal: 0,
        route_digest: "sha256:r",
      }),
    ).toThrow(/opt-in/);

    const state = createSidecar(true);
    prepareAttempt(state, {
      attempt_id: "a1",
      run_scope_key: "scope_x",
      run_ordinal: 0,
      route_digest: "sha256:r",
    });
    const d1 = dispatchAttempt(state, "a1", "2026-08-06T00:00:00.000Z");
    expect("status" in d1 && d1.status === "dispatched").toBe(true);
    finishAttempt(state, "a1", {
      status: "succeeded",
      at: "2026-08-06T00:00:01.000Z",
      result: null,
    });
    reconcileAttempt(state, "a1", "2026-08-06T00:00:02.000Z");
    rollbackV5(state, "reviewer-1", "2026-08-06T00:01:00.000Z");
    expect(isV5Off(state)).toBe(true);
  });
});

describe("evidence pack", () => {
  it("builds pack view with canonical_effect none", () => {
    const redaction: RedactOk = {
      ok: true,
      pack: { field_count: 1, scalar_count: 1, utf8_bytes: 1 },
      records: [
        {
          field: "document.title",
          kind: "document",
          normalized: "X",
          ordinal: 0,
          record_index: 0,
          segments: [
            {
              id: "seg_0",
              start: 0,
              end: 1,
              scalar_count: 1,
              bytes_b64: "WA==",
            },
          ],
        },
      ],
    };
    const profile = buildProfileBinding({
      profile_id: "redact_default_v1",
      profile_digest_binding: "binding",
      limits: { field_count: 8 },
    });
    const pack = buildEvidencePack({
      pack_id: "pack-1",
      profile,
      consent: {
        consent_id: "consent-1",
        profile_id: "redact_default_v1",
        granted_at: "2026-08-06T00:00:00.000Z",
        expires_at: null,
        scopes: ["extract"],
      },
      redaction,
    });
    expect(pack.canonical_effect).toBe("none");
    const view = serializeEvidencePackView(pack);
    expect(view.field_count).toBe(1);
    expect(view.canonical_effect).toBe("none");
  });
});
