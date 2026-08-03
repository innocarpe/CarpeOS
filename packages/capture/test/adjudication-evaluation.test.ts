import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ADJUDICATION_POLICY_VERSION } from "../src/adjudication.js";
import {
  adjudicationQualityExitCode,
  digestAdjudicationQualityCorpus,
  evaluateAdjudicationQuality,
} from "../src/adjudication-evaluation.js";

async function corpus(): Promise<Record<string, unknown>> {
  const text = await readFile(
    new URL("./fixtures/adjudication-quality-v1.json", import.meta.url),
    "utf8",
  );
  const parsed = JSON.parse(text) as Record<string, unknown>;
  parsed.policy_version = ADJUDICATION_POLICY_VERSION;
  return parsed;
}
function fixtureRecords(
  input: Record<string, unknown>,
  minimumLength = 1,
): Record<string, unknown>[] {
  const fixtures = input.fixtures;
  expect(Array.isArray(fixtures)).toBe(true);
  if (!Array.isArray(fixtures)) throw new Error("canonical corpus fixtures must be an array");
  expect(fixtures.length).toBeGreaterThanOrEqual(minimumLength);
  if (fixtures.length < minimumLength) {
    throw new Error(`canonical corpus must contain at least ${minimumLength} fixtures`);
  }
  expect(fixtures.every(isFixtureRecord)).toBe(true);
  if (!fixtures.every(isFixtureRecord))
    throw new Error("canonical corpus fixtures must be objects");
  return fixtures;
}

function isFixtureRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

describe("adjudication quality evaluator", () => {
  it("produces a deterministic body-free report for reordered corpus fixtures", async () => {
    const input = await corpus();
    const reordered = structuredClone(input);
    fixtureRecords(reordered).reverse();

    const first = evaluateAdjudicationQuality(input);
    const second = evaluateAdjudicationQuality(reordered);

    expect(first.exit_code).toBe(0);
    expect(first.report).toEqual(second.report);
    expect(digestAdjudicationQualityCorpus(input)).toBe(digestAdjudicationQualityCorpus(reordered));
    expect(first.report.class_counts).toEqual({ promote: 4, hold: 4, reject: 4 });
    expect(first.report.confusion).toEqual({
      promote: { promote: 4, hold: 0, reject: 0 },
      hold: { promote: 0, hold: 4, reject: 0 },
      reject: { promote: 0, hold: 0, reject: 4 },
    });
    expect(first.report.accuracy).toBe(1);
    expect(first.report.false_promotion_rate).toBe(0);
    expect(first.report.authority_writes).toEqual({
      observation_writes: 0,
      claim_writes: 0,
      acceptance_decision_writes: 0,
      total_writes: 0,
    });
    const serialized = JSON.stringify(first.report);
    expect(serialized).not.toContain("sk-synthetic123");
    expect(serialized).not.toContain("deterministic offline checks for every synthetic release");
  });

  it("calculates false-promotion rate using only expected non-promotions", async () => {
    const input = await corpus();
    const fixture = fixtureRecords(input).find(
      (item) => item.id === "adjq-hold-unspanned-decision",
    );
    expect(fixture).toBeDefined();
    if (fixture === undefined) throw new Error("canonical hold fixture is missing");
    fixture.candidate = {
      provider: "synthetic-agent",
      hook_event_name: "SessionEnd",
      signal_text: "Decision: adopt deterministic offline checks for every synthetic release.",
      spans: [
        {
          start: 0,
          end: 68,
          kind: "decision",
          text: "Decision: adopt deterministic offline checks for every synthetic release.",
          evidence_refs: [{ ref_type: "source_event", ref_id: "evt_adjq_formula_0001" }],
        },
      ],
    };

    const evaluation = evaluateAdjudicationQuality(input);
    expect(evaluation.exit_code).toBe(1);
    expect(evaluation.report.valid).toBe(true);
    expect(evaluation.report.false_promotion_count).toBe(1);
    expect(evaluation.report.false_promotion_rate).toBe(1 / 8);
    expect(evaluation.report.accuracy).toBe(11 / 12);
  });

  it("maps threshold failures to exit 1 and malformed corpora to exit 2", async () => {
    const thresholdFailure = await corpus();
    const [firstFixture] = fixtureRecords(thresholdFailure);
    expect(firstFixture).toBeDefined();
    if (firstFixture === undefined || !Array.isArray(firstFixture.required_reason_codes)) {
      throw new Error("canonical fixture required_reason_codes is missing");
    }
    firstFixture.required_reason_codes.push("missing_reason_code");

    expect(adjudicationQualityExitCode(thresholdFailure)).toBe(1);
    const invalid = evaluateAdjudicationQuality({ schema: "carpeos.adjudication-quality/v1" });
    expect(invalid.exit_code).toBe(2);
    expect(invalid.report.accuracy).toBeNull();
    expect(invalid.report.false_promotion_rate).toBeNull();
  });

  it("rejects duplicate and non-public fixture identifiers", async () => {
    const duplicate = await corpus();
    const fixtures = fixtureRecords(duplicate, 2);
    const [duplicateTarget, duplicateSource] = fixtures;
    expect(duplicateTarget).toBeDefined();
    expect(duplicateSource).toBeDefined();
    if (duplicateTarget === undefined || duplicateSource === undefined) {
      throw new Error("canonical duplicate fixtures are missing");
    }
    duplicateSource.id = duplicateTarget.id;
    expect(evaluateAdjudicationQuality(duplicate).report.invalid_reasons).toContain(
      "duplicate_fixture_id",
    );

    const nonPublic = await corpus();
    const [firstFixture] = fixtureRecords(nonPublic);
    expect(firstFixture).toBeDefined();
    if (firstFixture === undefined) throw new Error("canonical fixture is missing");
    firstFixture.id = "adjq-private-record";
    expect(evaluateAdjudicationQuality(nonPublic).report.invalid_reasons).toContain(
      "non_public_fixture_id",
    );
  });
});
