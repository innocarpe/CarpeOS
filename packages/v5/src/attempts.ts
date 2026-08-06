/**
 * Attempts, review, incident, rollback — local sidecar only.
 * No canonical materialization.
 */

import { digestSha256 } from "./jcs.js";

export type AttemptStatus =
  | "prepared"
  | "dispatched"
  | "succeeded"
  | "failed"
  | "timeout"
  | "ambiguous"
  | "reconciled";

export type AttemptRecord = {
  schema: "carpeos.attempt-record/v1";
  attempt_id: string;
  run_scope_key: string;
  run_ordinal: number;
  status: AttemptStatus;
  route_digest: string;
  dispatched_at: string | null;
  finished_at: string | null;
  result: unknown | null;
  reconciliation_receipt: string | null;
  canonical_effect: "none";
};

export type ReviewDecision =
  | { decision: "accept_draft"; reviewer_id: string; at: string }
  | { decision: "reject"; reviewer_id: string; at: string; reason_code: string }
  | { decision: "rollback"; reviewer_id: string; at: string; reason_code: string };

export type IncidentRecord = {
  schema: "carpeos.v5-incident/v1";
  incident_id: string;
  attempt_id: string | null;
  kind: "dispatch_timeout" | "provider_failure" | "ambiguous_result" | "kill_switch" | "budget";
  at: string;
  details_digest: string;
  canonical_effect: "none";
};

export type SidecarState = {
  attempts: Map<string, AttemptRecord>;
  reviews: ReviewDecision[];
  incidents: IncidentRecord[];
  dispatched_keys: Set<string>;
  kill_provider: boolean;
  kill_escalation: boolean;
  v5_enabled: boolean;
};

export function createSidecar(v5_enabled = false): SidecarState {
  return {
    attempts: new Map(),
    reviews: [],
    incidents: [],
    dispatched_keys: new Set(),
    kill_provider: false,
    kill_escalation: false,
    v5_enabled,
  };
}

export function prepareAttempt(
  state: SidecarState,
  input: {
    attempt_id: string;
    run_scope_key: string;
    run_ordinal: number;
    route_digest: string;
  },
): AttemptRecord {
  if (!state.v5_enabled) {
    throw new Error("V5 is opt-in and currently disabled");
  }
  const record: AttemptRecord = {
    schema: "carpeos.attempt-record/v1",
    attempt_id: input.attempt_id,
    run_scope_key: input.run_scope_key,
    run_ordinal: input.run_ordinal,
    status: "prepared",
    route_digest: input.route_digest,
    dispatched_at: null,
    finished_at: null,
    result: null,
    reconciliation_receipt: null,
    canonical_effect: "none",
  };
  state.attempts.set(record.attempt_id, record);
  return record;
}

/** One-dispatch rule: (run_scope_key, run_ordinal, route_digest) dispatches at most once. */
export function dispatchAttempt(
  state: SidecarState,
  attempt_id: string,
  at: string,
): AttemptRecord | IncidentRecord {
  if (state.kill_provider) {
    const incident: IncidentRecord = {
      schema: "carpeos.v5-incident/v1",
      incident_id: `inc_${attempt_id}_kill`,
      attempt_id,
      kind: "kill_switch",
      at,
      details_digest: digestSha256({ kind: "kill_switch", attempt_id }),
      canonical_effect: "none",
    };
    state.incidents.push(incident);
    return incident;
  }
  const attempt = state.attempts.get(attempt_id);
  if (!attempt) throw new Error(`unknown attempt: ${attempt_id}`);
  if (attempt.status !== "prepared") {
    throw new Error(`attempt not prepared: ${attempt.status}`);
  }
  const key = `${attempt.run_scope_key}|${attempt.run_ordinal}|${attempt.route_digest}`;
  if (state.dispatched_keys.has(key)) {
    const incident: IncidentRecord = {
      schema: "carpeos.v5-incident/v1",
      incident_id: `inc_${attempt_id}_dup`,
      attempt_id,
      kind: "ambiguous_result",
      at,
      details_digest: digestSha256({ kind: "duplicate_dispatch", key }),
      canonical_effect: "none",
    };
    state.incidents.push(incident);
    attempt.status = "ambiguous";
    return incident;
  }
  state.dispatched_keys.add(key);
  attempt.status = "dispatched";
  attempt.dispatched_at = at;
  return attempt;
}

export function finishAttempt(
  state: SidecarState,
  attempt_id: string,
  outcome: {
    status: "succeeded" | "failed" | "timeout" | "ambiguous";
    at: string;
    result?: unknown | null;
  },
): AttemptRecord {
  const attempt = state.attempts.get(attempt_id);
  if (!attempt) throw new Error(`unknown attempt: ${attempt_id}`);
  attempt.status = outcome.status;
  attempt.finished_at = outcome.at;
  attempt.result = outcome.result ?? null;
  if (
    outcome.status === "timeout" ||
    outcome.status === "failed" ||
    outcome.status === "ambiguous"
  ) {
    state.incidents.push({
      schema: "carpeos.v5-incident/v1",
      incident_id: `inc_${attempt_id}_${outcome.status}`,
      attempt_id,
      kind:
        outcome.status === "timeout"
          ? "dispatch_timeout"
          : outcome.status === "failed"
            ? "provider_failure"
            : "ambiguous_result",
      at: outcome.at,
      details_digest: digestSha256({
        kind: outcome.status,
        attempt_id,
      }),
      canonical_effect: "none",
    });
  }
  return attempt;
}

export function reconcileAttempt(
  state: SidecarState,
  attempt_id: string,
  at: string,
): AttemptRecord {
  const attempt = state.attempts.get(attempt_id);
  if (!attempt) throw new Error(`unknown attempt: ${attempt_id}`);
  attempt.reconciliation_receipt = digestSha256({
    schema: "carpeos.attempt-reconciliation/v1",
    attempt_id,
    status: attempt.status,
    at,
  });
  attempt.status = "reconciled";
  return attempt;
}

export function recordReview(state: SidecarState, decision: ReviewDecision): void {
  state.reviews.push(decision);
}

export function rollbackV5(state: SidecarState, reviewer_id: string, at: string): void {
  recordReview(state, {
    decision: "rollback",
    reviewer_id,
    at,
    reason_code: "operator_rollback",
  });
  state.v5_enabled = false;
  state.kill_provider = true;
}

/** V5-off fallback: no draft authority, no dispatches. */
export function isV5Off(state: SidecarState): boolean {
  return !state.v5_enabled;
}
