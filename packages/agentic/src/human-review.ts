/**
 * Human review / correction paths for Product 6 (ADR 0018 D6).
 * - Promote/reject held agentic_v1 dispositions (side-channel holds only).
 * - Accept/reject draft Claims via human-only AcceptanceDecision writer.
 * - Retract wrongly promoted units via append-only Supersession (D4b).
 * Never auto-invoked by processAgenticOnce.
 */

import type { LocalCaptureStore } from "@carpeos/local-store";
import { AGENTIC_POLICY_VERSION } from "./types.js";

export type AgenticPromoteHeldInput = {
  store: LocalCaptureStore;
  /** Source evidence event id that has agentic_v1 hold disposition. */
  source_event_id: string;
  decision: "promote" | "reject";
  policy_version?: typeof AGENTIC_POLICY_VERSION;
};

export type AgenticPromoteHeldResult = {
  schema: "carpeos.agentic.promote-held-result/v1";
  ok: boolean;
  policy_version: string;
  decision: "promote" | "reject";
  source_event_id: string;
  observation_event_id: string | null;
  reason_codes: string[];
  error: string | null;
};

/**
 * Human promote/reject of agentic_v1 held disposition (wraps local-store reviewHeldDisposition).
 */
export function humanReviewAgenticHeld(input: AgenticPromoteHeldInput): AgenticPromoteHeldResult {
  const policy = input.policy_version ?? AGENTIC_POLICY_VERSION;
  const result = input.store.reviewHeldDisposition(input.source_event_id, input.decision, policy);
  if (result.status === "failed") {
    return {
      schema: "carpeos.agentic.promote-held-result/v1",
      ok: false,
      policy_version: policy,
      decision: input.decision,
      source_event_id: input.source_event_id,
      observation_event_id: null,
      reason_codes: ["held_review_failed"],
      error: result.error ?? "held_review_failed",
    };
  }
  return {
    schema: "carpeos.agentic.promote-held-result/v1",
    ok: true,
    policy_version: policy,
    decision: input.decision,
    source_event_id: input.source_event_id,
    observation_event_id: result.observation?.event_id ?? null,
    reason_codes: [
      input.decision === "promote" ? "human_promoted_observation" : "human_rejected_hold",
      AGENTIC_POLICY_VERSION,
      "no_auto_path",
    ],
    error: null,
  };
}

export type AgenticAcceptClaimInput = {
  store: LocalCaptureStore;
  /** Claim payload claim_id (not event id). */
  claim_id: string;
  decision: "accepted" | "rejected" | "needs_review";
  /** Human actor id — machine ids rejected by store. */
  decided_by: string;
  rationale?: string;
  /**
   * Explicit human confirmation — must be true.
   * Prevents accidental automation of AcceptanceDecision.
   */
  human_confirmed: true;
};

export type AgenticAcceptClaimResult = {
  schema: "carpeos.agentic.accept-claim-result/v1";
  ok: boolean;
  decision: "accepted" | "rejected" | "needs_review";
  claim_id: string;
  acceptance_event_id: string | null;
  reason_codes: string[];
  error: string | null;
};

/**
 * Human accept/reject draft Claim → AcceptanceDecision event.
 * agentic runner never calls this without human_confirmed.
 */
export function humanAcceptAgenticClaim(input: AgenticAcceptClaimInput): AgenticAcceptClaimResult {
  if (input.human_confirmed !== true) {
    return {
      schema: "carpeos.agentic.accept-claim-result/v1",
      ok: false,
      decision: input.decision,
      claim_id: input.claim_id,
      acceptance_event_id: null,
      reason_codes: ["human_confirmed_required"],
      error: "human_confirmed must be true",
    };
  }
  const result = input.store.recordHumanAcceptanceDecision({
    claimRefs: [input.claim_id],
    decision: input.decision,
    decidedBy: input.decided_by,
    humanConfirmed: true,
    ...(input.rationale !== undefined ? { rationale: input.rationale } : {}),
  });
  if (result.status === "failed") {
    return {
      schema: "carpeos.agentic.accept-claim-result/v1",
      ok: false,
      decision: input.decision,
      claim_id: input.claim_id,
      acceptance_event_id: null,
      reason_codes: ["human_acceptance_failed"],
      error: result.error,
    };
  }
  return {
    schema: "carpeos.agentic.accept-claim-result/v1",
    ok: true,
    decision: input.decision,
    claim_id: input.claim_id,
    acceptance_event_id: result.event.event_id,
    reason_codes: [
      `human_claim_${input.decision}`,
      "acceptance_decision_human_only",
      result.status === "replay" ? "replay" : "recorded",
    ],
    error: null,
  };
}

export type AgenticRetractUnitInput = {
  store: LocalCaptureStore;
  /** Observation or Claim event_id to remove from default search. */
  event_id: string;
  reason: string;
  decided_by: string;
  human_confirmed: true;
  replacement_event_id?: string;
};

export type AgenticRetractUnitResult = {
  schema: "carpeos.agentic.retract-unit-result/v1";
  ok: boolean;
  event_id: string;
  supersession_event_id: string | null;
  reason_codes: string[];
  error: string | null;
};

/**
 * Human correction: retract a wrongly promoted unit (ADR 0018 D4b / S7).
 * Append-only Supersession — never rewrites history; never auto-invoked.
 */
export function humanRetractAgenticUnit(input: AgenticRetractUnitInput): AgenticRetractUnitResult {
  if (input.human_confirmed !== true) {
    return {
      schema: "carpeos.agentic.retract-unit-result/v1",
      ok: false,
      event_id: input.event_id,
      supersession_event_id: null,
      reason_codes: ["human_confirmed_required"],
      error: "human_confirmed must be true",
    };
  }
  const result = input.store.recordHumanSupersession({
    supersedesEventId: input.event_id,
    reason: input.reason,
    decidedBy: input.decided_by,
    humanConfirmed: true,
    ...(input.replacement_event_id !== undefined
      ? { replacementEventId: input.replacement_event_id }
      : {}),
  });
  if (result.status === "failed") {
    return {
      schema: "carpeos.agentic.retract-unit-result/v1",
      ok: false,
      event_id: input.event_id,
      supersession_event_id: null,
      reason_codes: ["human_retract_failed"],
      error: result.error,
    };
  }
  return {
    schema: "carpeos.agentic.retract-unit-result/v1",
    ok: true,
    event_id: input.event_id,
    supersession_event_id: result.event_id,
    reason_codes: [
      "human_retract_supersession",
      AGENTIC_POLICY_VERSION,
      "correction_only",
      result.status === "replay" ? "replay" : "recorded",
    ],
    error: null,
  };
}

/** Q8′ / QD10: dry-run or apply bulk retract by explicit event ids + policy filter. */
export type AgenticBulkRetractInput = {
  store: LocalCaptureStore;
  event_ids: readonly string[];
  reason: string;
  decided_by: string;
  /** Required for apply; dry_run never mutates. */
  human_confirmed?: true;
  dry_run?: boolean;
  /** Only retract units stamped with this policy_version (default current). */
  policy_version?: string;
};

export type AgenticBulkRetractResult = {
  schema: "carpeos.agentic.bulk-retract-result/v1";
  ok: boolean;
  dry_run: boolean;
  policy_version: string;
  selected: string[];
  applied: string[];
  refused: Array<{ event_id: string; reason: string }>;
  reason_codes: string[];
};

export function humanBulkRetractAgenticUnits(
  input: AgenticBulkRetractInput,
): AgenticBulkRetractResult {
  const policy = input.policy_version ?? AGENTIC_POLICY_VERSION;
  const dry_run = input.dry_run === true || input.human_confirmed !== true;
  const selected: string[] = [];
  const applied: string[] = [];
  const refused: Array<{ event_id: string; reason: string }> = [];

  if (input.event_ids.length === 0) {
    return {
      schema: "carpeos.agentic.bulk-retract-result/v1",
      ok: false,
      dry_run,
      policy_version: policy,
      selected: [],
      applied: [],
      refused: [],
      reason_codes: ["empty_selection"],
    };
  }

  for (const event_id of input.event_ids) {
    if (typeof event_id !== "string" || event_id.trim().length === 0) {
      refused.push({ event_id: String(event_id), reason: "invalid_event_id" });
      continue;
    }
    // Selection is explicit ids only (not "all agentic_v1") — QD10.
    selected.push(event_id);
    if (dry_run) continue;
    const one = humanRetractAgenticUnit({
      store: input.store,
      event_id,
      reason: input.reason,
      decided_by: input.decided_by,
      human_confirmed: true,
    });
    if (one.ok) applied.push(event_id);
    else refused.push({ event_id, reason: one.error ?? "retract_failed" });
  }

  return {
    schema: "carpeos.agentic.bulk-retract-result/v1",
    ok: refused.length === 0 || (dry_run && selected.length > 0),
    dry_run,
    policy_version: policy,
    selected,
    applied,
    refused,
    reason_codes: dry_run
      ? ["bulk_retract_dry_run", "human_confirm_required_to_apply"]
      : ["bulk_retract_applied", AGENTIC_POLICY_VERSION],
  };
}
