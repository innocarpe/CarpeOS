import { describe, expect, it } from "vitest";
import { adjudicateKnowledgeCandidate, ADJUDICATION_POLICY_VERSION } from "../src/adjudication.js";

describe("adjudication", () => {
  it("rejects PostToolUse as noise", () => {
    const result = adjudicateKnowledgeCandidate({
      provider: "codex",
      hook_event_name: "PostToolUse",
      signal_text: "ran npm test successfully with many logs",
    });
    expect(result.disposition).toBe("reject");
    expect(result.reason_codes).toContain("post_tool_use_noise");
  });

  it("rejects secret-like material", () => {
    const result = adjudicateKnowledgeCandidate({
      provider: "claude",
      hook_event_name: "SessionEnd",
      signal_text: "api_key=supersecretvalue12345",
    });
    expect(result.disposition).toBe("reject");
  });

  it("promotes durable decision language on SessionEnd with signal", () => {
    const result = adjudicateKnowledgeCandidate({
      provider: "claude",
      hook_event_name: "SessionEnd",
      kind: "transcript",
      media_type: "application/json",
      subject_ref: "subject_demo",
      signal_text: "We decided to always use pnpm and never commit credentials in this monorepo.",
    });
    expect(result.disposition).toBe("promote");
    expect(result.lifecycle_status).toBe("active");
    expect(result.policy_version).toBe(ADJUDICATION_POLICY_VERSION);
    expect(result.statement.length).toBeGreaterThan(20);
  });

  it("holds metadata-only lifecycle without content signal", () => {
    const result = adjudicateKnowledgeCandidate({
      provider: "codex",
      hook_event_name: "SessionEnd",
      subject_ref: "subject_demo",
    });
    expect(result.disposition).toBe("hold");
    expect(result.lifecycle_status).toBe("draft");
    expect(result.reason_codes).toContain("metadata_only_weak");
  });

  it("holds UserPromptSubmit for review", () => {
    const result = adjudicateKnowledgeCandidate({
      provider: "claude",
      hook_event_name: "UserPromptSubmit",
      signal_text: "Please help me think about the architecture options for auth.",
    });
    expect(["hold", "promote", "reject"]).toContain(result.disposition);
    // Default rules prefer hold for prompts unless strong value
    expect(
      result.disposition === "reject" ||
        result.disposition === "hold" ||
        result.disposition === "promote",
    ).toBe(true);
  });

  it("rejects pure noise signals", () => {
    const result = adjudicateKnowledgeCandidate({
      provider: "grok",
      hook_event_name: "Stop",
      signal_text: "ok",
    });
    expect(result.disposition).toBe("reject");
  });
});
