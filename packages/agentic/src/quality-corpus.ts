/**
 * Quality ultragoal corpus harness (Q2′ / DoD Q-S1–S3,S8,S13).
 * Exact expect: promote | no_promote | hold — not hold_or_promote.
 * Fake path by default; recorded-Flash JSON optional per case.
 */

import { readFileSync } from "node:fs";
import { type AgenticPipelineResult, runAgenticProposalPipeline } from "./pipeline.js";
import type { SqlDatabase } from "./sql.js";

export type QualityCase = {
  id: string;
  class: string;
  expect_gate: "promote" | "no_promote" | "hold";
  /** Optional expected primary kind when expect_gate=promote. */
  expect_kind?: "decision" | "constraint" | "preference" | "procedure" | "fact_candidate";
  must_not_promote?: boolean;
  signal_source?: string;
  pack_text: string;
  /** Optional recorded Flash triage JSON body (enables mode=flash without network). */
  flash_triage_json?: string;
  /** Optional recorded Flash extract JSON body. */
  flash_extract_json?: string;
};

export type QualityManifest = {
  schema: string;
  policy_version: string;
  model_id: string;
  description?: string;
  baseline?: string;
  cases: QualityCase[];
};

export type QualityCaseResult = {
  id: string;
  class: string;
  expect_gate: string;
  expect_kind: string | null;
  pass: boolean;
  observed: "promote" | "no_promote" | "hold" | "drop";
  observed_kind: string | null;
  pipeline: AgenticPipelineResult;
  notes: string[];
  signal_source: string;
  recorded_flash: boolean;
};

export type QualityReport = {
  schema: "carpeos.agentic.quality-report/v1";
  pass: boolean;
  baseline: string | null;
  case_count: number;
  pass_count: number;
  fail_count: number;
  results: QualityCaseResult[];
  counters: {
    gate_promote: number;
    gate_hold: number;
    gate_reject: number;
    admit_drop: number;
    must_not_promote_leaks: number;
  };
  /** Q-S13: counts of fixture signal_source labels. */
  signal_source_counts: Record<string, number>;
  /** Q-S3: per-kind promote recall among cases with expect_kind. */
  per_kind_recall: Record<string, { expected: number; observed_promote: number; recall: number }>;
  canonical_effect: "none";
  network_used: boolean;
};

export function loadQualityManifest(path: string): QualityManifest {
  const raw = JSON.parse(readFileSync(path, "utf8")) as QualityManifest;
  if (!Array.isArray(raw.cases)) throw new Error("quality manifest missing cases[]");
  return raw;
}

export function evaluateQualityManifest(
  db: SqlDatabase,
  manifest: QualityManifest,
  options?: { trust_zone_id?: string; now?: Date },
): QualityReport {
  const trust_zone_id = options?.trust_zone_id ?? "tz_quality_synthetic";
  const results: QualityCaseResult[] = [];
  let network_used = false;
  const counters = {
    gate_promote: 0,
    gate_hold: 0,
    gate_reject: 0,
    admit_drop: 0,
    must_not_promote_leaks: 0,
  };
  const signal_source_counts: Record<string, number> = {};

  for (const c of manifest.cases) {
    const signal_source = (c.signal_source ?? "inline").trim() || "inline";
    signal_source_counts[signal_source] = (signal_source_counts[signal_source] ?? 0) + 1;

    const recorded =
      (c.flash_triage_json !== undefined && c.flash_triage_json.trim().length > 0) ||
      (c.flash_extract_json !== undefined && c.flash_extract_json.trim().length > 0);
    const useFlash = recorded;

    const pipeline = runAgenticProposalPipeline(db, {
      trust_zone_id,
      source_event_id: `evt_quality_${c.id}`,
      hook_event_name: "SessionEnd",
      signal_text: c.pack_text,
      mode: useFlash ? "flash" : "fake",
      allow_network: useFlash,
      allow_auto_promote: true,
      agentic_enabled: true,
      ...(useFlash && c.flash_triage_json !== undefined
        ? { flash_triage_text: c.flash_triage_json }
        : {}),
      ...(useFlash && c.flash_extract_json !== undefined
        ? { flash_extract_text: c.flash_extract_json }
        : {}),
      ...(options?.now !== undefined ? { now: options.now } : {}),
    });
    // Recorded-Flash injects response text without HTTP — network_used should stay false.
    network_used = network_used || pipeline.network_used;
    const notes: string[] = [];
    const observed = observeDisposition(pipeline);
    const observed_kind = primaryPromoteKind(pipeline);
    if (pipeline.admit_decision === "drop") counters.admit_drop += 1;
    for (const p of pipeline.proposals) {
      if (p.gate.decision === "promote") counters.gate_promote += 1;
      if (p.gate.decision === "hold") counters.gate_hold += 1;
      if (p.gate.decision === "reject") counters.gate_reject += 1;
    }
    const pass = judgeQualityCase(c, observed, observed_kind, pipeline, notes);
    if (c.must_not_promote === true && observed === "promote") {
      counters.must_not_promote_leaks += 1;
    }
    results.push({
      id: c.id,
      class: c.class,
      expect_gate: c.expect_gate,
      expect_kind: c.expect_kind ?? null,
      pass,
      observed,
      observed_kind,
      pipeline,
      notes,
      signal_source,
      recorded_flash: recorded,
    });
  }

  const cleanKind: Record<string, { expected: number; observed_promote: number }> = {};
  for (const r of results) {
    if (r.expect_kind === null) continue;
    const k = r.expect_kind;
    const slot = cleanKind[k] ?? { expected: 0, observed_promote: 0 };
    slot.expected += 1;
    if (r.observed === "promote" && r.observed_kind === k) {
      slot.observed_promote += 1;
    }
    cleanKind[k] = slot;
  }
  const per_kind_recall: QualityReport["per_kind_recall"] = {};
  for (const [k, s] of Object.entries(cleanKind)) {
    per_kind_recall[k] = {
      expected: s.expected,
      observed_promote: s.observed_promote,
      recall: s.expected === 0 ? 0 : s.observed_promote / s.expected,
    };
  }

  const pass_count = results.filter((r) => r.pass).length;
  return {
    schema: "carpeos.agentic.quality-report/v1",
    pass: pass_count === results.length && counters.must_not_promote_leaks === 0,
    baseline: manifest.baseline ?? null,
    case_count: results.length,
    pass_count,
    fail_count: results.length - pass_count,
    results,
    counters,
    signal_source_counts,
    per_kind_recall,
    canonical_effect: "none",
    network_used,
  };
}

function observeDisposition(
  pipeline: AgenticPipelineResult,
): "promote" | "no_promote" | "hold" | "drop" {
  if (pipeline.admit_decision === "drop") return "drop";
  if (pipeline.proposals.some((p) => p.gate.decision === "promote")) return "promote";
  if (pipeline.proposals.some((p) => p.gate.decision === "hold")) return "hold";
  return "no_promote";
}

function primaryPromoteKind(pipeline: AgenticPipelineResult): string | null {
  const promoted = pipeline.proposals.find((p) => p.gate.decision === "promote");
  return promoted?.candidate.kind ?? null;
}

function judgeQualityCase(
  c: QualityCase,
  observed: "promote" | "no_promote" | "hold" | "drop",
  observed_kind: string | null,
  pipeline: AgenticPipelineResult,
  notes: string[],
): boolean {
  if (c.expect_gate === "promote") {
    const ok = observed === "promote";
    if (!ok) notes.push(`expected promote got ${observed} stage=${pipeline.stage}`);
    if (
      ok &&
      c.expect_kind !== undefined &&
      observed_kind !== null &&
      observed_kind !== c.expect_kind
    ) {
      // Kind mismatch is a soft fail for mixed packs (decision+constraint line).
      // Still pass gate if promote, but note for recall metrics.
      notes.push(`kind_mismatch expected=${c.expect_kind} got=${observed_kind}`);
    }
    return ok;
  }
  if (c.expect_gate === "hold") {
    const ok = observed === "hold";
    if (!ok) notes.push(`expected hold got ${observed}`);
    return ok;
  }
  const ok = observed !== "promote";
  if (!ok) notes.push("must_not_promote leaked a promote");
  return ok;
}
