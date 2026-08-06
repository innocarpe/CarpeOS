/**
 * P3 precision suite for narrow auto-promote (ADR 0017 D6).
 * Offline fake only. Require precision ≥ threshold and zero must_not_promote leaks.
 */

import { type GoldenManifest, type GoldenReport, loadGoldenManifest } from "./golden.js";
import { runAgenticProposalPipeline } from "./pipeline.js";
import type { SqlDatabase } from "./sql.js";

export const AGENTIC_AUTO_PROMOTE_PRECISION_MIN = 0.9;

export type PrecisionSuiteReport = {
  schema: "carpeos.agentic.precision-suite/v1";
  pass: boolean;
  precision: number;
  precision_min: number;
  promote_count: number;
  true_promote_count: number;
  false_promote_count: number;
  must_not_promote_leaks: number;
  case_count: number;
  reason_codes: string[];
  golden_with_auto: GoldenReport;
};

/**
 * Run golden corpus with allow_auto_promote and score promote precision.
 *
 * - true promote: case expect_gate is hold_or_promote and at least one promote
 * - false promote: promote on noise/injection/ambiguous (must not)
 * precision = true / (true + false); require ≥ 0.90 and false === 0 for pass
 *   (strict zero-leak on must_not, plus overall precision gate).
 */
export function evaluateAutoPromotePrecisionSuite(
  db: SqlDatabase,
  manifest: GoldenManifest,
  options?: {
    trust_zone_id?: string;
    now?: Date;
    precision_min?: number;
  },
): PrecisionSuiteReport {
  const precision_min = options?.precision_min ?? AGENTIC_AUTO_PROMOTE_PRECISION_MIN;
  const trust_zone_id = options?.trust_zone_id ?? "tz_precision_synthetic";
  let true_promote_count = 0;
  let false_promote_count = 0;
  let promote_count = 0;
  let must_not_promote_leaks = 0;
  const reason_codes: string[] = [];

  // Reuse golden report structure with auto-promote on.
  const results = [];
  let network_used = false;
  let pass_count = 0;

  for (const c of manifest.cases) {
    const pipeline = runAgenticProposalPipeline(db, {
      trust_zone_id,
      source_event_id: `evt_precision_${c.id}`,
      hook_event_name: c.class === "noise" ? "PostToolUse" : "SessionEnd",
      signal_text: c.pack_text,
      ...(c.hint_kind !== undefined ? { hint_kind: c.hint_kind } : {}),
      ...(options?.now !== undefined ? { now: options.now } : {}),
      agentic_enabled: true,
      mode: "fake",
      allow_network: false,
      allow_auto_promote: true,
    });
    network_used = network_used || pipeline.network_used;
    const decisions = pipeline.proposals.map((p) => p.gate.decision);
    const promoted = decisions.includes("promote");
    if (promoted) {
      promote_count += 1;
      if (c.expect_gate === "hold_or_promote") {
        true_promote_count += 1;
      } else {
        false_promote_count += 1;
        if (c.class === "noise" || c.class === "injection" || c.expect_gate === "reject") {
          must_not_promote_leaks += 1;
        }
      }
    }

    // Pass case-level golden expectations still hold under auto-promote:
    // noise/injection must not promote; decision may promote; ambiguous must not promote.
    let ok = true;
    const notes: string[] = [];
    if (c.expect_gate === "reject" || c.class === "noise" || c.class === "injection") {
      if (promoted) {
        ok = false;
        notes.push("must_not_promote_leak");
      }
    } else if (c.expect_gate === "hold_or_reject" || c.class === "ambiguous") {
      if (promoted) {
        ok = false;
        notes.push("ambiguous_must_not_auto_promote");
      }
    } else if (c.expect_gate === "hold_or_promote") {
      const active = pipeline.proposals.some(
        (p) => p.gate.decision === "hold" || p.gate.decision === "promote",
      );
      if (!active) {
        ok = false;
        notes.push("expected_active_meaning");
      }
    }
    if (ok) pass_count += 1;
    results.push({
      id: c.id,
      class: c.class,
      expect_gate: c.expect_gate,
      pass: ok,
      pipeline,
      notes,
    });
  }

  const denom = true_promote_count + false_promote_count;
  const precision = denom === 0 ? 1 : true_promote_count / denom;
  const golden_with_auto: GoldenReport = {
    schema: "carpeos.agentic.golden-report/v1",
    pass: pass_count === results.length,
    case_count: results.length,
    pass_count,
    fail_count: results.length - pass_count,
    results,
    canonical_effect: "none",
    network_used,
  };

  if (must_not_promote_leaks > 0) {
    reason_codes.push("must_not_promote_leak");
  }
  if (precision < precision_min) {
    reason_codes.push("precision_below_threshold");
  }
  if (!golden_with_auto.pass) {
    reason_codes.push("golden_auto_cases_failed");
  }

  const pass =
    must_not_promote_leaks === 0 &&
    precision + 1e-12 >= precision_min &&
    golden_with_auto.pass &&
    network_used === false;

  return {
    schema: "carpeos.agentic.precision-suite/v1",
    pass,
    precision,
    precision_min,
    promote_count,
    true_promote_count,
    false_promote_count,
    must_not_promote_leaks,
    case_count: manifest.cases.length,
    reason_codes,
    golden_with_auto,
  };
}

/** Convenience: load path then evaluate. */
export function evaluateAutoPromotePrecisionFromPath(
  db: SqlDatabase,
  manifestPath: string,
  options?: Parameters<typeof evaluateAutoPromotePrecisionSuite>[2],
): PrecisionSuiteReport {
  return evaluateAutoPromotePrecisionSuite(db, loadGoldenManifest(manifestPath), options);
}
