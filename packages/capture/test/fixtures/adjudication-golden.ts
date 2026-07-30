import {
  extractKnowledgeCandidateSpans,
  type KnowledgeCandidate,
  type KnowledgeDisposition,
  type KnowledgeEvidenceRef,
} from "../../src/adjudication.js";

export type GoldenAdjudicationClass = "must_promote" | "must_hold" | "must_reject";

export type GoldenAdjudicationFixture = {
  id: string;
  classification: GoldenAdjudicationClass;
  candidate: KnowledgeCandidate;
  expected_disposition: KnowledgeDisposition;
  expected_lifecycle_status: "active" | "draft";
  required_reason_codes: readonly string[];
  expected_statement_fragment?: string;
  forbidden_statement_fragments?: readonly string[];
};

const sourceEventId = "evt_golden_candidate_00000001";
const artifactId = "art_golden_candidate_00000001";
const evidenceRefs: readonly KnowledgeEvidenceRef[] = [
  { ref_type: "source_event", ref_id: sourceEventId },
  { ref_type: "artifact", ref_id: artifactId },
];

function candidate(input: {
  signal?: string;
  hook?: string;
  allow_statement_span?: boolean;
}): KnowledgeCandidate {
  const signal = input.signal;
  return {
    provider: "synthetic-agent",
    hook_event_name: input.hook ?? "SessionEnd",
    kind: "message",
    media_type: "application/json",
    subject_ref: "subject_golden_synthetic",
    artifact_id: artifactId,
    source_event_id: sourceEventId,
    ...(signal === undefined ? {} : { signal_text: signal }),
    spans:
      signal === undefined || input.allow_statement_span === false
        ? []
        : extractKnowledgeCandidateSpans(signal, evidenceRefs),
    evidence_refs: evidenceRefs,
  };
}

const credentialAssignment = ["pass", "word=syntheticgoldenvalue"].join("");
const decision = "Decision: adopt pnpm as the default installer for every synthetic workspace.";
const preference = "Preference: prefer deterministic offline checks before each synthetic release.";
const constraint = "Constraint: releases must pass public-boundary checks before publication.";
const procedure =
  "Procedure: run offline checks before every release and verify the synthetic package output.";

export const GOLDEN_ADJUDICATION_FIXTURES: readonly GoldenAdjudicationFixture[] = [
  {
    id: "decision-session-end",
    classification: "must_promote",
    candidate: candidate({ signal: decision }),
    expected_disposition: "promote",
    expected_lifecycle_status: "active",
    required_reason_codes: ["lifecycle_boundary_signal", "value_terms", "promote_threshold"],
    expected_statement_fragment: decision,
  },
  {
    id: "preference-stop",
    classification: "must_promote",
    candidate: candidate({ signal: preference, hook: "Stop" }),
    expected_disposition: "promote",
    expected_lifecycle_status: "active",
    required_reason_codes: ["lifecycle_boundary_signal", "value_terms", "promote_threshold"],
    expected_statement_fragment: preference,
  },
  {
    id: "constraint-pre-compact",
    classification: "must_promote",
    candidate: candidate({ signal: constraint, hook: "PreCompact" }),
    expected_disposition: "promote",
    expected_lifecycle_status: "active",
    required_reason_codes: ["lifecycle_boundary_signal", "value_terms", "promote_threshold"],
    expected_statement_fragment: constraint,
  },
  {
    id: "procedure-session-end",
    classification: "must_promote",
    candidate: candidate({ signal: procedure }),
    expected_disposition: "promote",
    expected_lifecycle_status: "active",
    required_reason_codes: ["lifecycle_boundary_signal", "value_terms", "promote_threshold"],
    expected_statement_fragment: procedure,
  },
  {
    id: "metadata-only-session-end",
    classification: "must_hold",
    candidate: candidate({}),
    expected_disposition: "hold",
    expected_lifecycle_status: "draft",
    required_reason_codes: ["no_safe_candidate_span", "metadata_only_weak", "hold_for_review"],
  },
  {
    id: "scoring-only-transcript-decision",
    classification: "must_hold",
    candidate: candidate({ signal: decision, allow_statement_span: false }),
    expected_disposition: "hold",
    expected_lifecycle_status: "draft",
    required_reason_codes: ["no_safe_candidate_span", "value_terms", "hold_for_review"],
    forbidden_statement_fragments: [decision],
  },
  {
    id: "procedure-like-chatter",
    classification: "must_hold",
    candidate: candidate({
      signal: "First run to lunch, then check the weather before heading back to the office.",
    }),
    expected_disposition: "hold",
    expected_lifecycle_status: "draft",
    required_reason_codes: ["no_safe_candidate_span", "hold_for_review"],
    forbidden_statement_fragments: ["lunch", "weather"],
  },
  {
    id: "user-prompt-preference",
    classification: "must_hold",
    candidate: candidate({ signal: preference, hook: "UserPromptSubmit" }),
    expected_disposition: "hold",
    expected_lifecycle_status: "draft",
    required_reason_codes: ["user_prompt_needs_review", "hold_for_review"],
    expected_statement_fragment: preference,
  },
  {
    id: "post-tool-use-decision",
    classification: "must_reject",
    candidate: candidate({ signal: decision, hook: "PostToolUse" }),
    expected_disposition: "reject",
    expected_lifecycle_status: "draft",
    required_reason_codes: ["post_tool_use_noise"],
  },
  {
    id: "pure-thanks-noise",
    classification: "must_reject",
    candidate: candidate({ signal: "thanks", hook: "Stop" }),
    expected_disposition: "reject",
    expected_lifecycle_status: "draft",
    required_reason_codes: ["noise_only_signal"],
  },
  {
    id: "credential-assignment",
    classification: "must_reject",
    candidate: candidate({ signal: `Decision: retain ${credentialAssignment} for later.` }),
    expected_disposition: "reject",
    expected_lifecycle_status: "draft",
    required_reason_codes: ["secret_like_material"],
    forbidden_statement_fragments: [credentialAssignment],
  },
  {
    id: "session-start-not-eligible",
    classification: "must_reject",
    candidate: candidate({ signal: decision, hook: "SessionStart" }),
    expected_disposition: "reject",
    expected_lifecycle_status: "draft",
    required_reason_codes: ["lifecycle_not_eligible"],
  },
];
