import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXTRACTION_EXCLUDED_HOOK_EVENTS,
  DEFAULT_EXTRACTION_HOOK_EVENTS,
  DEFAULT_MEANINGFUL_UNIT_POLICY,
  MEANINGFUL_UNIT_POLICY_VERSION,
  OBSERVATION_VS_CLAIM_MVP,
  assertSafeMeaningfulUnitText,
  containsSecretLikeMaterial,
  defaultMeaningfulUnitPolicySnapshot,
  isHookEligibleForExtraction,
  normalizeCaptureHookEventName,
  recommendExtractionTarget,
  resolveMeaningfulUnitPolicy,
} from "../src/meaningful-unit-policy.js";

describe("meaningful-unit-policy", () => {
  it("exports stable policy version and default snapshot", () => {
    expect(MEANINGFUL_UNIT_POLICY_VERSION).toBe("v1");
    expect(DEFAULT_MEANINGFUL_UNIT_POLICY.post_tool_use).toBe("off");
    expect(DEFAULT_MEANINGFUL_UNIT_POLICY.allow_auto_claim).toBe(false);
    expect(defaultMeaningfulUnitPolicySnapshot()).toBe(
      JSON.stringify({
        policy_version: "v1",
        enabled_hook_events: ["Stop", "SessionEnd", "PreCompact", "UserPromptSubmit"],
        post_tool_use: "off",
        allow_auto_claim: false,
        auto_claim_min_confidence: 0.85,
      }),
    );
  });

  it("lists default extraction allow/deny sets without PostToolUse", () => {
    expect(DEFAULT_EXTRACTION_HOOK_EVENTS).toEqual([
      "Stop",
      "SessionEnd",
      "PreCompact",
      "UserPromptSubmit",
    ]);
    expect(DEFAULT_EXTRACTION_EXCLUDED_HOOK_EVENTS).toContain("PostToolUse");
    expect(DEFAULT_EXTRACTION_EXCLUDED_HOOK_EVENTS).toContain("SessionStart");
  });

  it("marks Stop/SessionEnd/PreCompact/UserPromptSubmit eligible by default", () => {
    for (const event of DEFAULT_EXTRACTION_HOOK_EVENTS) {
      expect(isHookEligibleForExtraction(event)).toBe(true);
      expect(recommendExtractionTarget({ hook_event_name: event })).toBe("observation");
    }
  });

  it("keeps PostToolUse off by default and on when opted in", () => {
    expect(isHookEligibleForExtraction("PostToolUse")).toBe(false);
    expect(recommendExtractionTarget({ hook_event_name: "PostToolUse" })).toBe("none");

    expect(isHookEligibleForExtraction("PostToolUse", { post_tool_use: "on" })).toBe(true);
    expect(
      recommendExtractionTarget({ hook_event_name: "PostToolUse" }, { post_tool_use: "on" }),
    ).toBe("observation");
  });

  it("keeps SessionStart off by default", () => {
    expect(isHookEligibleForExtraction("SessionStart")).toBe(false);
    expect(recommendExtractionTarget({ hook_event_name: "SessionStart" })).toBe("none");
  });

  it("recommends claim_draft only when allow_auto_claim and confidence gate pass", () => {
    expect(
      recommendExtractionTarget(
        { hook_event_name: "SessionEnd", confidence: 0.99 },
        { allow_auto_claim: false },
      ),
    ).toBe("observation");

    expect(
      recommendExtractionTarget(
        { hook_event_name: "SessionEnd", confidence: 0.5 },
        { allow_auto_claim: true },
      ),
    ).toBe("observation");

    expect(
      recommendExtractionTarget(
        { hook_event_name: "SessionEnd", confidence: 0.9 },
        { allow_auto_claim: true },
      ),
    ).toBe("claim_draft");
  });

  it("rejects secret-like material in unit text", () => {
    expect(containsSecretLikeMaterial("plain summary of the session")).toBe(false);
    expect(containsSecretLikeMaterial("includes raw_payload in body")).toBe(true);
    expect(containsSecretLikeMaterial("token sk-abcdefghijklmnop")).toBe(true);
    expect(containsSecretLikeMaterial("Authorization: Bearer abcdefghijklmnop")).toBe(true);
    expect(containsSecretLikeMaterial("api_key=supersecretvalue")).toBe(true);
    const credentialAssignment = ["pass", "word=syntheticsecretvalue"].join("");
    const clientCredential = ["client", "_secret: syntheticsecretvalue"].join("");
    expect(containsSecretLikeMaterial(credentialAssignment)).toBe(true);
    expect(containsSecretLikeMaterial(clientCredential)).toBe(true);

    expect(assertSafeMeaningfulUnitText("  User chose pnpm over npm.  ")).toBe(
      "User chose pnpm over npm.",
    );
    expect(() => assertSafeMeaningfulUnitText("")).toThrow(/non-empty/);
    expect(() => assertSafeMeaningfulUnitText("leak transcript_secret here")).toThrow(
      /secret-like/,
    );
  });

  it("documents Observation vs Claim MVP rules", () => {
    expect(OBSERVATION_VS_CLAIM_MVP.observation.required_links).toMatch(/evidence_artifact/);
    expect(OBSERVATION_VS_CLAIM_MVP.claim_draft.lifecycle).toMatch(/draft/);
    expect(OBSERVATION_VS_CLAIM_MVP.never_from_extractor).toContain("AcceptanceDecision");
  });

  it("resolveMeaningfulUnitPolicy merges overrides immutably relative to defaults", () => {
    const resolved = resolveMeaningfulUnitPolicy({
      post_tool_use: "on",
      enabled_hook_events: ["Stop"],
    });
    expect(resolved.post_tool_use).toBe("on");
    expect(resolved.enabled_hook_events).toEqual(["Stop"]);
    expect(resolved.allow_auto_claim).toBe(false);
    expect(DEFAULT_MEANINGFUL_UNIT_POLICY.post_tool_use).toBe("off");
  });
});

describe("normalizeCaptureHookEventName", () => {
  it("maps grok snake_case hooks to product lifecycle names", () => {
    expect(normalizeCaptureHookEventName("user_prompt_submit")).toBe("UserPromptSubmit");
    expect(normalizeCaptureHookEventName("session_end")).toBe("SessionEnd");
    expect(normalizeCaptureHookEventName("stop")).toBe("Stop");
    expect(normalizeCaptureHookEventName("SessionEnd")).toBe("SessionEnd");
  });
});
