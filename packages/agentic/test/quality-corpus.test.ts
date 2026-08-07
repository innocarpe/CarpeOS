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

describe("Q2′ quality corpus (baseline #1)", () => {
  it("runs exact-expect corpus under fake promote defaults", () => {
    const db = new DatabaseSync(":memory:");
    const manifest = loadQualityManifest(manifestPath);
    const report = evaluateQualityManifest(db, manifest, { now });
    // Characterization: print failures for baseline tracking.
    const fails = report.results.filter((r) => !r.pass);
    if (fails.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        "quality baseline fails",
        fails.map((f) => ({ id: f.id, observed: f.observed, notes: f.notes })),
      );
    }
    expect(report.case_count).toBeGreaterThanOrEqual(10);
    expect(report.counters.must_not_promote_leaks).toBe(0);
    // Strong gate for must_not_promote cases always.
    for (const r of report.results.filter((x) => x.expect_gate === "no_promote")) {
      expect(r.observed).not.toBe("promote");
      expect(r.pass).toBe(true);
    }
    // Promote class: require majority green on baseline #1 (recall floor partial).
    const promoteCases = report.results.filter((r) => r.expect_gate === "promote");
    const promotePass = promoteCases.filter((r) => r.pass).length;
    expect(promotePass / promoteCases.length).toBeGreaterThanOrEqual(0.5);
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
