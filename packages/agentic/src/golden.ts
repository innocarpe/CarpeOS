/**
 * Offline golden-12 (or expanded) evaluation for Product 6 vertical slice.
 * Network-off; fake stages only. Synthetic public fixtures only.
 */

import { readFileSync } from "node:fs";
import { type AgenticPipelineResult, runAgenticProposalPipeline } from "./pipeline.js";
import type { SqlDatabase } from "./sql.js";
import type { AgenticKnowledgeKind } from "./types.js";

export type GoldenCase = {
  id: string;
  class: string;
  expect_gate: string;
  must_not_active_without_cite?: boolean;
  pack_text: string;
  hint_kind?: AgenticKnowledgeKind;
};

export type GoldenManifest = {
  schema: string;
  policy_version: string;
  model_id: string;
  description?: string;
  cases: GoldenCase[];
};

export type GoldenCaseResult = {
  id: string;
  class: string;
  expect_gate: string;
  pass: boolean;
  pipeline: AgenticPipelineResult;
  notes: string[];
};

export type GoldenReport = {
  schema: "carpeos.agentic.golden-report/v1";
  pass: boolean;
  case_count: number;
  pass_count: number;
  fail_count: number;
  results: GoldenCaseResult[];
  canonical_effect: "none";
  network_used: boolean;
};

export function loadGoldenManifest(path: string): GoldenManifest {
  const raw = JSON.parse(readFileSync(path, "utf8")) as GoldenManifest;
  if (!Array.isArray(raw.cases)) {
    throw new Error("golden manifest missing cases[]");
  }
  return raw;
}

/**
 * Run each golden case through the proposal pipeline (offline fake).
 * Decisions:
 * - decision class expect hold_or_promote → need ≥1 hold|promote proposal with cites
 * - noise/injection expect reject → no hold/promote proposals
 * - ambiguous expect hold_or_reject → not promote
 */
export function evaluateGoldenManifest(
  db: SqlDatabase,
  manifest: GoldenManifest,
  options?: { trust_zone_id?: string; now?: Date; agentic_enabled?: boolean },
): GoldenReport {
  const trust_zone_id = options?.trust_zone_id ?? "tz_golden_synthetic";
  const results: GoldenCaseResult[] = [];
  let network_used = false;

  for (const c of manifest.cases) {
    const pipeline = runAgenticProposalPipeline(db, {
      trust_zone_id,
      source_event_id: `evt_golden_${c.id}`,
      hook_event_name: c.class === "noise" ? "PostToolUse" : "SessionEnd",
      signal_text: c.pack_text,
      ...(c.hint_kind !== undefined ? { hint_kind: c.hint_kind } : {}),
      ...(options?.now !== undefined ? { now: options.now } : {}),
      agentic_enabled: options?.agentic_enabled !== false,
      mode: "fake",
      allow_network: false,
      allow_auto_promote: false,
    });
    network_used = network_used || pipeline.network_used;
    const notes: string[] = [];
    const pass = judgeCase(c, pipeline, notes);
    results.push({
      id: c.id,
      class: c.class,
      expect_gate: c.expect_gate,
      pass,
      pipeline,
      notes,
    });
  }

  const pass_count = results.filter((r) => r.pass).length;
  return {
    schema: "carpeos.agentic.golden-report/v1",
    pass: pass_count === results.length,
    case_count: results.length,
    pass_count,
    fail_count: results.length - pass_count,
    results,
    canonical_effect: "none",
    network_used,
  };
}

function judgeCase(c: GoldenCase, pipeline: AgenticPipelineResult, notes: string[]): boolean {
  const gates = pipeline.proposals.map((p) => p.gate.decision);
  const hasActiveMeaning = pipeline.proposals.some(
    (p) => p.gate.decision === "hold" || p.gate.decision === "promote",
  );
  const allCited = pipeline.proposals.every((p) => p.cite_ok && p.candidate.citations.length > 0);

  if (c.expect_gate === "hold_or_promote") {
    if (!hasActiveMeaning) {
      notes.push("expected hold_or_promote proposal, got none");
      return false;
    }
    if (!allCited) {
      notes.push("proposal missing cite integrity");
      return false;
    }
    if (c.must_not_active_without_cite && !allCited) {
      notes.push("must_not_active_without_cite violated");
      return false;
    }
    return true;
  }

  if (c.expect_gate === "reject") {
    if (hasActiveMeaning) {
      notes.push(`expected reject/no-meaning, got ${gates.join(",")}`);
      return false;
    }
    return true;
  }

  if (c.expect_gate === "hold_or_reject") {
    if (gates.includes("promote")) {
      notes.push("ambiguous case must not auto-promote");
      return false;
    }
    return true;
  }

  notes.push(`unknown expect_gate ${c.expect_gate}`);
  return false;
}
