/**
 * P5 draft Claim mapping (ADR 0017 D7 / D10).
 * Never creates AcceptanceDecision. accept remains human-only.
 */

import type { Claim } from "@carpeos/schema";
import type { AgenticKnowledgeKind } from "./types.js";

/** Kinds that may land as draft Claims in Product 6 P5. */
export const AGENTIC_DRAFT_CLAIM_KINDS = new Set<AgenticKnowledgeKind>([
  "fact_candidate",
  "decision",
]);

/**
 * Map agentic ontology kind → schema claim_type for draft Claims.
 * - fact_candidate → factual (Claim only; never auto-accepted)
 * - decision → decision (optional dual-write with Observation)
 * - others → null (Observation path only)
 */
export function agenticKindToClaimType(kind: AgenticKnowledgeKind): Claim["claim_type"] | null {
  if (kind === "fact_candidate") return "factual";
  if (kind === "decision") return "decision";
  return null;
}

export type AgenticMaterializeTargets = {
  /** Write draft/active Observation via proposeObservationDraft. */
  observation: boolean;
  /** Write lifecycle_status=draft Claim via proposeClaimDraft (never AcceptanceDecision). */
  draft_claim: boolean;
};

/**
 * Materialize targets by kind.
 * fact_candidate: Claim only (ADR D7).
 * decision: Observation + optional draft Claim.
 * other kinds: Observation only.
 */
export function materializeTargetsForKind(kind: AgenticKnowledgeKind): AgenticMaterializeTargets {
  if (kind === "fact_candidate") {
    return { observation: false, draft_claim: true };
  }
  if (kind === "decision") {
    return { observation: true, draft_claim: true };
  }
  return { observation: true, draft_claim: false };
}

export function agenticClaimIdempotencyKey(
  sourceEventId: string,
  policyVersion: string,
  proposalId: string,
): string {
  const raw = `agc_${policyVersion}_${sourceEventId}_${proposalId}`.replace(/[^A-Za-z0-9_-]/g, "_");
  const body = raw.slice(0, 120);
  return `idem_${body.length >= 16 ? body : body.padEnd(16, "0")}`;
}
