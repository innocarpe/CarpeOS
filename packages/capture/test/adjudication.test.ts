import { describe, expect, it } from "vitest";
import {
  adjudicateKnowledgeCandidate,
  ADJUDICATION_POLICY_VERSION,
  buildCandidateStatement,
  extractKnowledgeCandidateSpans,
} from "../src/adjudication.js";

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

  it("promotes durable decision language on SessionEnd with an explicit safe span", () => {
    const signal = "We decided to always use pnpm and never commit credentials in this monorepo.";
    const refs = [{ ref_type: "source_event" as const, ref_id: "evt_candidate_00000000" }];
    const result = adjudicateKnowledgeCandidate({
      provider: "claude",
      hook_event_name: "SessionEnd",
      kind: "message",
      media_type: "application/json",
      subject_ref: "subject_demo",
      signal_text: signal,
      spans: extractKnowledgeCandidateSpans(signal, refs),
      evidence_refs: refs,
    });
    expect(result.disposition).toBe("promote");
    expect(result.lifecycle_status).toBe("active");
    expect(result.policy_version).toBe(ADJUDICATION_POLICY_VERSION);
    expect(result.statement).toContain(
      "We decided to always use pnpm and never commit credentials in this monorepo.",
    );
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
    expect(result.disposition).toBe("hold");
    expect(result.reason_codes).toContain("user_prompt_needs_review");
  });

  it("rejects pure noise signals", () => {
    const result = adjudicateKnowledgeCandidate({
      provider: "grok",
      hook_event_name: "Stop",
      signal_text: "ok",
    });
    expect(result.disposition).toBe("reject");
  });

  it("extracts bounded decision, preference, and constraint spans with evidence refs", () => {
    const refs = [
      { ref_type: "source_event" as const, ref_id: "evt_candidate_00000001" },
      { ref_type: "artifact" as const, ref_id: "art_candidate_00000001" },
    ];
    const spans = extractKnowledgeCandidateSpans(
      "Decision: adopt pnpm for workspace installs. We prefer concise command output. Releases must pass offline checks.",
      refs,
    );

    expect(spans.map((span) => span.kind)).toEqual(["decision", "preference", "constraint"]);
    expect(spans[0]?.evidence_refs).toEqual(refs);
    expect(spans.every((span) => span.text.length <= 240)).toBe(true);
    expect(
      extractKnowledgeCandidateSpans("Decision: keep v2.0.0 blocked pending explicit approval.")[0]
        ?.text,
    ).toBe("Decision: keep v2.0.0 blocked pending explicit approval.");
  });

  it("does not create candidate spans for empty text, chatter, secrets, or dumps", () => {
    expect(extractKnowledgeCandidateSpans(undefined)).toEqual([]);
    expect(extractKnowledgeCandidateSpans("thanks")).toEqual([]);
    expect(
      extractKnowledgeCandidateSpans("Decision: store api_key=syntheticsecretvalue123 for later."),
    ).toEqual([]);
    expect(
      extractKnowledgeCandidateSpans('Decision: inspect {"transcript":"raw session dump"}.'),
    ).toEqual([]);
  });

  it("includes only a sanitized durable fragment in the Observation statement", () => {
    const signal =
      "Thanks for the help. We prefer deterministic offline checks before every release. Unlabelled session chatter stays protected.";
    const refs = [
      { ref_type: "source_event" as const, ref_id: "evt_candidate_00000002" },
      { ref_type: "artifact" as const, ref_id: "art_candidate_00000002" },
    ];
    const statement = buildCandidateStatement({
      provider: "synthetic-agent",
      hook_event_name: "SessionEnd",
      source_event_id: "evt_candidate_00000002",
      artifact_id: "art_candidate_00000002",
      signal_text: signal,
      spans: extractKnowledgeCandidateSpans(signal, refs),
      evidence_refs: refs,
    });

    expect(statement).toContain("Knowledge fragment (preference)");
    expect(statement).toContain("We prefer deterministic offline checks before every release.");
    expect(statement).not.toContain("Thanks for the help");
    expect(statement).not.toContain("Unlabelled session chatter");
  });

  it("keeps scoring-only signal text out of statements without explicit spans", () => {
    const statement = buildCandidateStatement({
      provider: "synthetic-agent",
      hook_event_name: "SessionEnd",
      signal_text:
        "We prefer this raw transcript sentence, but it was not approved as a candidate span.",
    });

    expect(statement).not.toContain("raw transcript sentence");
    expect(statement).not.toContain("Knowledge fragment");
  });

  it("rejects hostile or mismatched explicit candidate spans", () => {
    const result = adjudicateKnowledgeCandidate({
      provider: "synthetic-agent",
      hook_event_name: "SessionEnd",
      signal_text: "Decision: retain a safe synthetic default.",
      spans: [
        {
          start: 0,
          end: 40,
          kind: "decision",
          text: 'Decision: copy {"transcript":"raw dump"}.',
          evidence_refs: [],
        },
      ],
    });

    expect(result.disposition).toBe("reject");
    expect(result.reason_codes).toEqual(["unsafe_or_empty_statement"]);
    expect(result.statement).toBe("");
  });

  it("labels explicit procedure text without copying structured trace payloads", () => {
    const spans = extractKnowledgeCandidateSpans(
      "Procedure: first run offline checks, then verify the synthetic release artifact.",
    );
    expect(spans).toMatchObject([
      {
        kind: "procedure",
        text: "Procedure: first run offline checks, then verify the synthetic release artifact.",
      },
    ]);
  });
});
