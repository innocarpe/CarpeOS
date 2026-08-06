/**
 * Product 6 Agentic Layer contracts (ADR 0017).
 * Scaffold types for ultragoal implementation — no side effects.
 */

/** Frozen real model id for Product 6 (cost policy). */
export const AGENTIC_FLASH_MODEL_ID = "deepseek-v4-flash" as const;

/** Promotion / disposition policy identity for this plane. */
export const AGENTIC_POLICY_VERSION = "agentic_v1" as const;

/** Ontology kinds v1 (ADR 0017 D7). */
export type AgenticKnowledgeKind =
  | "decision"
  | "constraint"
  | "preference"
  | "procedure"
  | "fact_candidate"
  | "open_question";

export type AgenticJobState = "pending" | "leased" | "succeeded" | "blocked" | "dead";

export type AgenticStageId =
  | "admit"
  | "pack"
  | "triage"
  | "extract"
  | "verify"
  | "structure"
  | "gate"
  | "materialize"
  | "project";

export type AgenticJob = {
  schema: "carpeos.agentic.job/v1";
  job_id: string;
  trust_zone_id: string;
  source_event_id: string;
  stage: AgenticStageId;
  state: AgenticJobState;
  policy_version: typeof AGENTIC_POLICY_VERSION;
  model_id: typeof AGENTIC_FLASH_MODEL_ID | "fake";
  input_digest: string;
  output_digest: string | null;
  attempt: number;
  available_at: string;
  leased_at: string | null;
  finished_at: string | null;
  error_code: string | null;
  canonical_effect: "none" | "observation" | "draft_claim";
};

export type AgenticTriageDecision = "keep" | "drop" | "need_context";

export type AgenticCitation = {
  evidence_event_id: string;
  segment_id: string | null;
  start: number;
  end: number;
  quote: string;
};

export type AgenticExtractCandidate = {
  kind: AgenticKnowledgeKind;
  statement: string;
  citations: AgenticCitation[];
  confidence: number;
};

export type AgenticGateDecision = "promote" | "hold" | "reject";

export type AgenticGateResult = {
  schema: "carpeos.agentic.gate-result/v1";
  policy_version: typeof AGENTIC_POLICY_VERSION;
  decision: AgenticGateDecision;
  reason_codes: string[];
  /** Model confidence is never sole authority. */
  features: {
    cite_ok: boolean;
    secret_ok: boolean;
    kind_allowlisted: boolean;
    model_confidence: number | null;
  };
};

/** Edge proposals only — materialize via provenance + graph rebuild. */
export type AgenticEdgeKind = "derived_from" | "supports" | "contradicts" | "about";

export type AgenticEdgeProposal = {
  kind: AgenticEdgeKind;
  from_ref: string;
  to_ref: string;
  note: string | null;
};
