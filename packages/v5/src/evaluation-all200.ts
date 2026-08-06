/**
 * V5-M7 frozen all-200 evaluation ledger (synthetic, offline).
 * All attempted cases remain in denominators. Deterministic from seed.
 */

import {
  applyCircuitBreaker,
  buildFrozenLedger,
  evaluateGates,
  type EvalCase,
  type EvalGates,
  type EvalLedger,
  v5OffFallback,
} from "./evaluation.js";

export const ALL200_SEED = "v5-m7-all-200-20260806";
export const ALL200_CASE_COUNT = 200;

/** Fixed M7 gate thresholds for the frozen ledger. */
export const ALL200_THRESHOLDS = {
  min_quality_rate: 0.7,
  min_reviewer_rate: 0.85,
  min_baseline_rate: 0.85,
  max_novel_rate: 0.15,
  max_p95_latency_ms: 5_000,
  max_total_cost_units: 50_000,
  max_identity_drift_rate: 0.05,
} as const;

/**
 * Deterministic pseudo-random in [0,1) from seed + index (no Math.random).
 */
function unit(seed: string, i: number): number {
  let h = 2166136261;
  const s = `${seed}|${i}`;
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

/**
 * Build the frozen 200-case synthetic evaluation ledger.
 * Distribution is fixed by ALL200_SEED so re-runs are identical.
 */
export function buildAll200FrozenLedger(seed: string = ALL200_SEED): EvalLedger {
  const cases: EvalCase[] = [];
  for (let i = 0; i < ALL200_CASE_COUNT; i++) {
    const u = unit(seed, i);
    const attempted = true; // all 200 remain in denominators
    // ~10% non-eligible (must not claim quality_pass)
    const eligible = u >= 0.1;
    // Of eligible: ~85% quality pass overall ⇒ among eligible, higher rate
    const quality_pass = eligible && unit(seed, i + 1000) < 0.9;
    const reviewer_pass = unit(seed, i + 2000) < 0.92;
    const baseline_pass = unit(seed, i + 3000) < 0.9;
    const novel = unit(seed, i + 4000) < 0.08;
    const identity_stable = unit(seed, i + 5000) < 0.97;
    const latency_ms = Math.floor(50 + unit(seed, i + 6000) * 800);
    const cost_units = Math.floor(1 + unit(seed, i + 7000) * 40);

    cases.push({
      case_id: `eval_${String(i).padStart(3, "0")}`,
      attempted,
      eligible,
      quality_pass,
      reviewer_pass,
      baseline_pass,
      novel,
      latency_ms,
      cost_units,
      identity_stable,
    });
  }
  return buildFrozenLedger(cases);
}

export type All200EvaluationReceipt = {
  schema: "carpeos.v5.m7-all200-receipt/v1";
  seed: string;
  case_count: number;
  policy: "all-200";
  gates: EvalGates;
  thresholds: typeof ALL200_THRESHOLDS;
  kill_switch: ReturnType<typeof applyCircuitBreaker>;
  v5_off: ReturnType<typeof v5OffFallback>;
  pass: boolean;
  canonical_effect: "none";
};

/**
 * Run M7 all-200 offline evaluation and produce a body-free receipt.
 */
export function runAll200Evaluation(seed: string = ALL200_SEED): All200EvaluationReceipt {
  const ledger = buildAll200FrozenLedger(seed);
  const gates = evaluateGates(ledger, { ...ALL200_THRESHOLDS });
  const kill_switch = applyCircuitBreaker(
    {
      provider_disabled: false,
      telemetry_disabled: false,
      budget_exceeded: false,
      v5_enabled: true,
    },
    gates.pass ? {} : { force_v5_off: true, provider_fault: true },
  );
  const v5_off = v5OffFallback(kill_switch);
  return {
    schema: "carpeos.v5.m7-all200-receipt/v1",
    seed,
    case_count: ledger.cases.length,
    policy: "all-200",
    gates,
    thresholds: ALL200_THRESHOLDS,
    kill_switch,
    v5_off,
    pass: gates.pass && ledger.cases.length === ALL200_CASE_COUNT,
    canonical_effect: "none",
  };
}
