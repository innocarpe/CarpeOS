/** Pure OKF export mapping types. */

export type OkfLifecycleStatus = "draft" | "stable" | "deprecated";

export type OkfActor = string;

export type OkfGenerated = {
  by: OkfActor;
  at: string;
};

export type OkfVerifiedEntry = {
  by: OkfActor;
  at: string;
};

export type OkfSourceEntry = {
  id: string;
  resource: string;
  title?: string;
  author?: string;
};

/** Closed producer type strings for CarpeOS OKF export (ADR 0014). */
export type OkfProducerType =
  | "Accepted Decision"
  | "Observation"
  | "Draft Observation"
  | "Evidence Summary"
  | "Supersession"
  | "Erasure";

export type OkfFrontmatter = {
  type: OkfProducerType;
  title: string;
  description?: string;
  tags?: string[];
  status?: OkfLifecycleStatus;
  generated?: OkfGenerated;
  verified?: OkfVerifiedEntry[];
  sources?: OkfSourceEntry[];
  carpeos_projection: true;
  canonical_effect: "none";
  carpeos_event_id: string;
  carpeos_event_type: string;
  carpeos_trust_zone_id: string;
  carpeos_claim_id?: string;
  carpeos_observation_id?: string;
  carpeos_artifact_id?: string;
  carpeos_decision_id?: string;
  carpeos_supersession_id?: string;
};

export type OkfConceptFile = {
  /** Bundle-relative path using `/` separators, e.g. `decisions/claim_alpha.md`. */
  path: string;
  frontmatter: OkfFrontmatter;
  body: string;
};

export type OkfOmissionReason =
  | "wrong_trust_zone"
  | "erased"
  | "rejected"
  | "held_excluded"
  | "draft_claim_excluded"
  | "acceptance_missing"
  | "acceptance_not_accepted"
  | "not_exportable_type"
  | "orphan_evidence"
  | "supersession_target_missing";

export type OkfOmission = {
  event_id: string;
  event_type: string;
  reason: OkfOmissionReason;
};

export type OkfMapConfig = {
  visibleTrustZoneIds: readonly string[];
  /** When false (default), held/draft observations and draft claims are omitted. */
  includeHeld?: boolean;
  /**
   * When true (default), export Evidence Summary concepts that are referenced
   * by an exported concept. Unreferenced evidence is omitted as orphan_evidence.
   */
  includeReferencedEvidence?: boolean;
  /** Actor for `generated.by`, default `carpeos/okf-export/v1`. */
  generatedBy?: string;
  /** ISO-8601 timestamp for `generated.at` (tests should pin this). */
  generatedAt: string;
  /** Optional export-run note for log.md body. */
  exportNote?: string;
};

export type OkfMapInputEvent = {
  event_id: string;
  event_type: string;
  trust_zone_id: string;
  event: import("@carpeos/schema").CanonicalEvent;
};

export type OkfMapInputErasure = {
  erasure_id: string;
  trust_zone_id: string;
  erasure: import("@carpeos/schema").ErasureLedgerRecord;
};

export type OkfMapInput = {
  events: readonly OkfMapInputEvent[];
  erasures?: readonly OkfMapInputErasure[];
};

export type OkfMapResult = {
  /** Concept documents only (not index/log). Sorted by path. */
  concepts: OkfConceptFile[];
  /** Root index.md content (OKF reserved). */
  indexMarkdown: string;
  /** Root log.md content (OKF reserved). */
  logMarkdown: string;
  omissions: OkfOmission[];
  okfVersion: "0.2";
  projectionVersion: "okf-export/v1";
};
