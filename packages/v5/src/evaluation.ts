/**
 * V5-M7 evaluation ledger and rollback gates (offline).
 * All attempted cases remain in denominators.
 */

export type EvalCase = {
  case_id: string;
  attempted: boolean;
  eligible: boolean;
  quality_pass: boolean;
  reviewer_pass: boolean;
  baseline_pass: boolean;
  novel: boolean;
  latency_ms: number;
  cost_units: number;
  identity_stable: boolean;
};

export type EvalLedger = {
  schema: "carpeos.v5.eval-ledger/v1";
  frozen: true;
  policy: "all-200";
  cases: EvalCase[];
};

export type EvalGates = {
  quality_rate: number;
  noneligible_zero: boolean;
  reviewer_rate: number;
  baseline_rate: number;
  novel_rate: number;
  p95_latency_ms: number;
  total_cost_units: number;
  identity_drift_rate: number;
  denominator: number;
  pass: boolean;
  blockers: string[];
};

export type CircuitBreaker = {
  provider_disabled: boolean;
  telemetry_disabled: boolean;
  budget_exceeded: boolean;
  v5_enabled: boolean;
};

export function buildFrozenLedger(cases: EvalCase[]): EvalLedger {
  return {
    schema: "carpeos.v5.eval-ledger/v1",
    frozen: true,
    policy: "all-200",
    cases: cases.map((c) => ({ ...c })),
  };
}

export function evaluateGates(
  ledger: EvalLedger,
  thresholds: {
    min_quality_rate: number;
    min_reviewer_rate: number;
    min_baseline_rate: number;
    max_novel_rate: number;
    max_p95_latency_ms: number;
    max_total_cost_units: number;
    max_identity_drift_rate: number;
  },
): EvalGates {
  // All attempted cases remain in denominators
  const attempted = ledger.cases.filter((c) => c.attempted);
  const denominator = attempted.length;
  const blockers: string[] = [];
  if (denominator === 0) {
    return {
      quality_rate: 0,
      noneligible_zero: true,
      reviewer_rate: 0,
      baseline_rate: 0,
      novel_rate: 0,
      p95_latency_ms: 0,
      total_cost_units: 0,
      identity_drift_rate: 0,
      denominator: 0,
      pass: false,
      blockers: ["no attempted cases"],
    };
  }

  const eligibleAttempted = attempted.filter((c) => c.eligible);
  const noneligible = attempted.filter((c) => !c.eligible);
  // noneligible-zero gate: non-eligible attempted cases must not contribute quality credit
  const noneligible_zero = noneligible.every((c) => !c.quality_pass);

  const quality_rate = attempted.filter((c) => c.quality_pass).length / denominator;
  const reviewer_rate = attempted.filter((c) => c.reviewer_pass).length / denominator;
  const baseline_rate = attempted.filter((c) => c.baseline_pass).length / denominator;
  const novel_rate = attempted.filter((c) => c.novel).length / denominator;
  const identity_drift_rate =
    attempted.filter((c) => !c.identity_stable).length / denominator;
  const total_cost_units = attempted.reduce((n, c) => n + c.cost_units, 0);

  const latencies = attempted.map((c) => c.latency_ms).sort((a, b) => a - b);
  const p95_latency_ms = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))]!;

  if (!noneligible_zero) blockers.push("noneligible cases claimed quality_pass");
  if (quality_rate < thresholds.min_quality_rate) blockers.push("quality_rate below threshold");
  if (reviewer_rate < thresholds.min_reviewer_rate) blockers.push("reviewer_rate below threshold");
  if (baseline_rate < thresholds.min_baseline_rate) blockers.push("baseline_rate below threshold");
  if (novel_rate > thresholds.max_novel_rate) blockers.push("novel_rate above threshold");
  if (p95_latency_ms > thresholds.max_p95_latency_ms) blockers.push("p95 latency above threshold");
  if (total_cost_units > thresholds.max_total_cost_units) blockers.push("cost above threshold");
  if (identity_drift_rate > thresholds.max_identity_drift_rate) {
    blockers.push("identity drift above threshold");
  }

  // eligibleAttempted used for documentation only — denominators stay attempted
  void eligibleAttempted;

  return {
    quality_rate,
    noneligible_zero,
    reviewer_rate,
    baseline_rate,
    novel_rate,
    p95_latency_ms,
    total_cost_units,
    identity_drift_rate,
    denominator,
    pass: blockers.length === 0,
    blockers,
  };
}

export function applyCircuitBreaker(
  breaker: CircuitBreaker,
  input: {
    budget_exceeded?: boolean;
    provider_fault?: boolean;
    telemetry_fault?: boolean;
    force_v5_off?: boolean;
  },
): CircuitBreaker {
  const next = { ...breaker };
  if (input.budget_exceeded) {
    next.budget_exceeded = true;
    next.provider_disabled = true;
  }
  if (input.provider_fault) next.provider_disabled = true;
  if (input.telemetry_fault) next.telemetry_disabled = true;
  if (input.force_v5_off) next.v5_enabled = false;
  return next;
}

export function v5OffFallback(breaker: CircuitBreaker): {
  v5_enabled: false;
  draft_authority: false;
  capture_unblocked: true;
} {
  void breaker;
  return {
    v5_enabled: false,
    draft_authority: false,
    capture_unblocked: true,
  };
}
