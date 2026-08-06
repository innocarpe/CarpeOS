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

/** Prompt/schema identity for stage digests (Flash multi-workflow, not multi-model). */
export const AGENTIC_PROMPT_VERSIONS = {
  admit: "agentic.admit/v1",
  pack: "agentic.pack/v1",
  triage: "agentic.triage/v1",
  extract: "agentic.extract/v1",
  verify: "agentic.verify/v1",
  structure: "agentic.structure/v1",
  gate: "agentic.gate/v1",
  materialize: "agentic.materialize/v1",
  project: "agentic.project/v1",
} as const satisfies Record<AgenticStageId, string>;

export type AgenticJob = {
  schema: "carpeos.agentic.job/v1";
  job_id: string;
  trust_zone_id: string;
  source_event_id: string;
  stage: AgenticStageId;
  state: AgenticJobState;
  policy_version: typeof AGENTIC_POLICY_VERSION;
  model_id: typeof AGENTIC_FLASH_MODEL_ID | "fake";
  /** Identity digest: pack + prompt + model + policy (+ prior stage output). */
  input_digest: string;
  output_digest: string | null;
  attempt: number;
  max_attempts: number;
  available_at: string;
  leased_at: string | null;
  lease_id: string | null;
  lease_expires_at: string | null;
  finished_at: string | null;
  error_code: string | null;
  last_error: string | null;
  /** Sidecar proposals only until materialize bridge (P2). */
  canonical_effect: "none" | "observation" | "draft_claim";
  created_at: string;
  updated_at: string;
};

export type AgenticJobEnqueueSpec = {
  trust_zone_id: string;
  source_event_id: string;
  stage: AgenticStageId;
  model_id?: typeof AGENTIC_FLASH_MODEL_ID | "fake";
  /** Prior pack digest when known (E2+). */
  pack_digest?: string | null;
  /** Prior stage output digest for chained stages. */
  prev_output_digest?: string | null;
  prompt_version?: string;
  schema_version?: string;
  canonical_effect?: AgenticJob["canonical_effect"];
  max_attempts?: number;
  available_at?: string;
  now?: Date;
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
