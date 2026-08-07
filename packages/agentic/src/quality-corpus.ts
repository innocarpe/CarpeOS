/**
 * Quality ultragoal corpus harness (Q2′).
 * Exact expect: promote | no_promote | hold — not hold_or_promote.
 * Fake path by default; recorded-Flash JSON optional later.
 */

import { readFileSync } from "node:fs";
import { type AgenticPipelineResult, runAgenticProposalPipeline } from "./pipeline.js";
import type { SqlDatabase } from "./sql.js";

export type QualityCase = {
  id: string;
  class: string;
  expect_gate: "promote" | "no_promote" | "hold";
  must_not_promote?: boolean;
  signal_source?: string;
  pack_text: string;
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
  pass: boolean;
  observed: "promote" | "no_promote" | "hold" | "drop";
  pipeline: AgenticPipelineResult;
  notes: string[];
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

  for (const c of manifest.cases) {
    // Lifecycle SessionEnd for all quality fixtures (including tool-noise-on-lifecycle).
    const hook =
      c.class === "tool_noise_session_end" && !c.pack_text.toLowerCase().includes("decision")
        ? "SessionEnd"
        : "SessionEnd";
    const pipeline = runAgenticProposalPipeline(db, {
      trust_zone_id,
      source_event_id: `evt_quality_${c.id}`,
      hook_event_name: hook,
      signal_text: c.pack_text,
      mode: "fake",
      allow_network: false,
      allow_auto_promote: true,
      agentic_enabled: true,
      ...(options?.now !== undefined ? { now: options.now } : {}),
    });
    network_used = network_used || pipeline.network_used;
    const notes: string[] = [];
    const observed = observeDisposition(pipeline);
    if (pipeline.admit_decision === "drop") counters.admit_drop += 1;
    for (const p of pipeline.proposals) {
      if (p.gate.decision === "promote") counters.gate_promote += 1;
      if (p.gate.decision === "hold") counters.gate_hold += 1;
      if (p.gate.decision === "reject") counters.gate_reject += 1;
    }
    const pass = judgeQualityCase(c, observed, pipeline, notes);
    if (c.must_not_promote === true && observed === "promote") {
      counters.must_not_promote_leaks += 1;
    }
    results.push({
      id: c.id,
      class: c.class,
      expect_gate: c.expect_gate,
      pass,
      observed,
      pipeline,
      notes,
    });
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

function judgeQualityCase(
  c: QualityCase,
  observed: "promote" | "no_promote" | "hold" | "drop",
  pipeline: AgenticPipelineResult,
  notes: string[],
): boolean {
  if (c.expect_gate === "promote") {
    const ok = observed === "promote";
    if (!ok) notes.push(`expected promote got ${observed} stage=${pipeline.stage}`);
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
