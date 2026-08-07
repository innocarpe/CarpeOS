import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateQualityManifest, loadQualityManifest } from "../src/quality-corpus.js";
import { statementGroundedInCitations } from "../src/verify.js";

const now = new Date("2026-08-07T12:00:00Z");
const manifestPath = resolve(
  process.cwd(),
  "../../fixtures/agentic/v1/quality-ultragoal/manifest.json",
);

describe("quality corpus DoD (baseline #2)", () => {
  it("Q-S1/S2: full exact-expect green under fake + recorded-Flash inject", () => {
    const db = new DatabaseSync(":memory:");
    const manifest = loadQualityManifest(manifestPath);
    const report = evaluateQualityManifest(db, manifest, { now });
    const fails = report.results.filter((r) => !r.pass);
    if (fails.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        "quality DoD fails",
        fails.map((f) => ({
          id: f.id,
          observed: f.observed,
          kind: f.observed_kind,
          notes: f.notes,
        })),
      );
    }
    expect(report.case_count).toBeGreaterThanOrEqual(40);
    expect(report.counters.must_not_promote_leaks).toBe(0);
    expect(report.pass).toBe(true);
    expect(report.pass_count).toBe(report.case_count);
    // Recorded-Flash inject cases present (no live HTTP in this harness).
    expect(report.results.some((r) => r.recorded_flash)).toBe(true);
    expect(report.results.filter((r) => r.recorded_flash).every((r) => r.pass)).toBe(true);
    db.close();
  });

  it("Q-S2: every must_not_promote case never promotes", () => {
    const db = new DatabaseSync(":memory:");
    const report = evaluateQualityManifest(db, loadQualityManifest(manifestPath), { now });
    for (const r of report.results.filter((x) => x.expect_gate === "no_promote")) {
      expect(r.observed).not.toBe("promote");
      expect(r.pass).toBe(true);
    }
    db.close();
  });

  it("Q-S3: per-kind recall ≥80% with ≥10 fixtures for decision/constraint/preference", () => {
    const db = new DatabaseSync(":memory:");
    const report = evaluateQualityManifest(db, loadQualityManifest(manifestPath), { now });
    for (const kind of ["decision", "constraint", "preference"] as const) {
      const stats = report.per_kind_recall[kind];
      expect(stats, `missing kind stats for ${kind}`).toBeDefined();
      expect(stats!.expected).toBeGreaterThanOrEqual(10);
      expect(stats!.recall).toBeGreaterThanOrEqual(0.8);
    }
    db.close();
  });

  it("Q-S13: signal_source_counts include inline and alternate shapes", () => {
    const db = new DatabaseSync(":memory:");
    const report = evaluateQualityManifest(db, loadQualityManifest(manifestPath), { now });
    expect(report.signal_source_counts.inline).toBeGreaterThan(0);
    expect(Object.keys(report.signal_source_counts).length).toBeGreaterThanOrEqual(2);
    db.close();
  });

  it("Q-S9 style: promoted statements exclude metadata boilerplate", () => {
    const db = new DatabaseSync(":memory:");
    const report = evaluateQualityManifest(db, loadQualityManifest(manifestPath), { now });
    const meta = /hook event is SessionEnd|session id is|The agent type is|agentic\.evidence/i;
    for (const r of report.results.filter((x) => x.observed === "promote")) {
      for (const p of r.pipeline.proposals.filter((x) => x.gate.decision === "promote")) {
        expect(meta.test(p.candidate.statement)).toBe(false);
      }
    }
    db.close();
  });
});

describe("Q4′ CJK grounding", () => {
  it("grounds Korean statement against Korean quote (NFC)", () => {
    const quote = "PR을 열기 전에 반드시 make preflight를 요구한다";
    const statement = "PR을 열기 전에 반드시 make preflight를 요구한다";
    const r = statementGroundedInCitations(statement, [
      {
        evidence_event_id: "e",
        segment_id: "seg",
        start: 0,
        end: quote.length,
        quote,
      },
    ]);
    expect(r.ok).toBe(true);
  });

  it("grounds NFD-normalized Korean against NFC quote", () => {
    const quote = "결정: 반드시 사전 검사를 요구한다".normalize("NFC");
    const statement = "결정: 반드시 사전 검사를 요구한다".normalize("NFD");
    const r = statementGroundedInCitations(statement, [
      {
        evidence_event_id: "e",
        segment_id: "seg",
        start: 0,
        end: quote.length,
        quote,
      },
    ]);
    expect(r.ok).toBe(true);
  });
});
