/**
 * E1 Rule admit — adj_v3 sibling feed (ADR 0017 D5).
 * Drops PostToolUse-class noise before any Flash spend.
 * No LLM, no network, no canonical writes.
 *
 * DF1: delegates to @carpeos/capture `evaluateDeterministicFront` (SSOT).
 */

import {
  evaluateDeterministicFront,
  frontDecisionToAdmit,
  residualProseLines,
} from "@carpeos/capture";

export type AgenticAdmitInput = {
  source_event_id: string;
  trust_zone_id: string;
  hook_event_name: string;
  /** Candidate text / transcript snippet (synthetic or redacted). */
  signal_text: string;
};

export type AgenticAdmitResult = {
  schema: "carpeos.agentic.admit-result/v1";
  decision: "admit" | "drop";
  reason_codes: string[];
  normalized_hook: string;
  source_event_id: string;
  trust_zone_id: string;
  /** Sidecar only until materialize. */
  canonical_effect: "none";
  /**
   * Line-scoped residual signal after dropping noise/secret lines (Q2.5′ / DF1).
   * When decision=admit, callers should prefer this over raw signal when non-empty.
   */
  residual_signal_text?: string;
};

/**
 * Cheap deterministic admit gate. Prefer SessionEnd / Stop / PreCompact.
 * Never admits PostToolUse flood into Flash stages.
 */
export function ruleAdmitEvidence(input: AgenticAdmitInput): AgenticAdmitResult {
  const front = evaluateDeterministicFront({
    hook_event_name: input.hook_event_name,
    signal_text: input.signal_text,
    require_lifecycle_hook: true,
  });

  const base = {
    schema: "carpeos.agentic.admit-result/v1" as const,
    source_event_id: input.source_event_id,
    trust_zone_id: input.trust_zone_id,
    normalized_hook: front.normalized_hook,
    canonical_effect: "none" as const,
    reason_codes: front.reason_codes,
    decision: frontDecisionToAdmit(front.decision),
  };

  if (front.decision === "pass" && front.residual_signal_text) {
    return { ...base, residual_signal_text: front.residual_signal_text };
  }
  return base;
}

/** Re-export for tests / callers that imported residualProseLines from admit. */
export { residualProseLines };
