import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { runAgenticProposalPipeline } from "../src/pipeline.js";
import {
  AGENTIC_REPORT_REDACTED_PLACEHOLDER,
  redactAgenticPipelineResultForReport,
  redactAgenticRunnerReport,
  reportJsonLeaksPrivateText,
} from "../src/report.js";
import type { AgenticRunnerReport } from "../src/runner.js";

const now = new Date("2026-08-07T12:00:00Z");
const PRIVATE =
  "Decision: we will require make preflight before opening any pull request. UNIQUE_TOKEN_q15_xyz";

describe("Q1.5′ report redaction (QD7 / Q-S12)", () => {
  it("strips statements, quotes, and pack views by default", () => {
    const db = new DatabaseSync(":memory:");
    const pipeline = runAgenticProposalPipeline(db, {
      trust_zone_id: "tz_report",
      source_event_id: "evt_report_01",
      hook_event_name: "SessionEnd",
      signal_text: PRIVATE,
      hint_kind: "decision",
      now,
    });
    expect(pipeline.ok).toBe(true);
    expect(pipeline.proposals.length).toBeGreaterThan(0);
    expect(pipeline.extract_view_text).toContain("UNIQUE_TOKEN_q15_xyz");

    const redacted = redactAgenticPipelineResultForReport(pipeline);
    expect(redacted.extract_view_text).toBe(AGENTIC_REPORT_REDACTED_PLACEHOLDER);
    expect(redacted.triage_view_text).toBe(AGENTIC_REPORT_REDACTED_PLACEHOLDER);
    for (const p of redacted.proposals) {
      expect(p.candidate.statement).toBe(AGENTIC_REPORT_REDACTED_PLACEHOLDER);
      for (const c of p.candidate.citations) {
        expect(c.quote).toBe(AGENTIC_REPORT_REDACTED_PLACEHOLDER);
      }
    }

    const json = JSON.stringify(redacted);
    expect(reportJsonLeaksPrivateText(json, ["UNIQUE_TOKEN_q15_xyz", "make preflight"])).toEqual(
      [],
    );
    // Kind / gate metadata still visible for operators.
    expect(redacted.proposals.some((p) => p.candidate.kind === "decision")).toBe(true);
    db.close();
  });

  it("verbose keeps private text", () => {
    const db = new DatabaseSync(":memory:");
    const pipeline = runAgenticProposalPipeline(db, {
      trust_zone_id: "tz_report",
      source_event_id: "evt_report_02",
      hook_event_name: "SessionEnd",
      signal_text: PRIVATE,
      hint_kind: "decision",
      now,
    });
    const full = redactAgenticPipelineResultForReport(pipeline, { verbose: true });
    expect(full.extract_view_text).toContain("UNIQUE_TOKEN_q15_xyz");
    expect(full.proposals.length).toBeGreaterThan(0);
    // Verbose must not replace statements with the redaction token.
    expect(full.proposals[0]?.candidate.statement).not.toBe(AGENTIC_REPORT_REDACTED_PLACEHOLDER);
    expect(full.proposals[0]?.candidate.statement).toBe(pipeline.proposals[0]?.candidate.statement);
    db.close();
  });

  it("runner report redaction sets redacted flag and strips pipelines", () => {
    const db = new DatabaseSync(":memory:");
    const pipeline = runAgenticProposalPipeline(db, {
      trust_zone_id: "tz_report",
      source_event_id: "evt_report_03",
      hook_event_name: "SessionEnd",
      signal_text: PRIVATE,
      hint_kind: "decision",
      now,
    });
    const report: AgenticRunnerReport = {
      schema: "carpeos.agentic.runner-report/v1",
      ok: true,
      agentic_enabled: true,
      feed_seen: 1,
      feed_done: 1,
      feed_skipped: 0,
      front_drop: 0,
      front_drop_by_reason: {},
      pipelines: [pipeline],
      materializations: 0,
      draft_claims: 0,
      structure_edge_count: pipeline.structure_edge_count,
      project_invoked: false,
      network_used: false,
      flash_calls: 0,
      reason_codes: [],
    };
    const out = redactAgenticRunnerReport(report);
    expect(out.redacted).toBe(true);
    expect(out.feed_seen).toBe(1);
    const json = JSON.stringify(out);
    expect(json).not.toContain("UNIQUE_TOKEN_q15_xyz");
    expect(out.pipelines[0]?.proposals[0]?.candidate.statement).toBe(
      AGENTIC_REPORT_REDACTED_PLACEHOLDER,
    );

    const verbose = redactAgenticRunnerReport(report, { verbose: true });
    expect(verbose.redacted).toBe(false);
    expect(JSON.stringify(verbose)).toContain("UNIQUE_TOKEN_q15_xyz");
    db.close();
  });
});
