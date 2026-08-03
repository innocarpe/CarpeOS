import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ADJUDICATION_POLICY_VERSION } from "../src/adjudication.js";
import {
  digestKnowledgeFormCorpus,
  evaluateKnowledgeFormQuality,
  knowledgeFormQualityExitCode,
} from "../src/knowledge-form-evaluation.js";

async function corpus(): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(
    await readFile(new URL("./fixtures/knowledge-form-support-v1.json", import.meta.url), "utf8"),
  ) as Record<string, unknown>;
  parsed.policy_version = ADJUDICATION_POLICY_VERSION;
  return parsed;
}
function fixtures(input: Record<string, unknown>): Record<string, unknown>[] {
  const value = input.fixtures;
  expect(Array.isArray(value)).toBe(true);
  if (!Array.isArray(value) || !value.every(isRecord))
    throw new Error("canonical fixtures must be records");
  return value;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

describe("knowledge form evidence evaluator", () => {
  it("evaluates all sixteen canonical cases with deterministic body-free evidence", async () => {
    const input = await corpus();
    const result = evaluateKnowledgeFormQuality(input);
    expect(fixtures(input)).toHaveLength(16);
    expect(result.exit_code).toBe(0);
    expect(result.report.class_counts).toEqual({
      must_observation: 4,
      must_claim_candidate: 4,
      must_reject: 4,
      must_insufficient_support: 4,
    });
    expect(result.report.confusion).toEqual({
      must_observation: {
        must_observation: 4,
        must_claim_candidate: 0,
        must_reject: 0,
        must_insufficient_support: 0,
      },
      must_claim_candidate: {
        must_observation: 0,
        must_claim_candidate: 4,
        must_reject: 0,
        must_insufficient_support: 0,
      },
      must_reject: {
        must_observation: 0,
        must_claim_candidate: 0,
        must_reject: 4,
        must_insufficient_support: 0,
      },
      must_insufficient_support: {
        must_observation: 0,
        must_claim_candidate: 0,
        must_reject: 0,
        must_insufficient_support: 4,
      },
    });
    expect(result.report.accuracy).toBe(1);
    expect(result.report.claim_precision).toBe(1);
    expect(result.report.claim_recall).toBe(1);
    expect(result.report.observation_preservation).toBe(1);
    expect(result.report.false_candidate_rate).toBe(0);
    expect(result.report.reason_assertion_failures).toBe(0);
    expect(result.report.safety_assertion_failures).toBe(0);
    expect(result.report.support_assertion_failures).toBe(0);
    expect(result.report.provenance_assertion_failures).toBe(0);
    expect(result.report.invariants).toEqual({
      allow_auto_claim: false,
      evaluation_only: true,
      automatic_claim_writes: 0,
      automatic_acceptance_decision_writes: 0,
    });
    const bodyFree = JSON.stringify(result.report);
    expect(bodyFree).not.toContain("sk-synthetic123");
    expect(bodyFree).not.toContain("Synthetic validation confirms");
  });

  it("has order-independent corpus and provenance digests", async () => {
    const input = await corpus();
    const reordered = structuredClone(input);
    fixtures(reordered).reverse();
    expect(digestKnowledgeFormCorpus(input)).toBe(digestKnowledgeFormCorpus(reordered));
    expect(evaluateKnowledgeFormQuality(input).report).toEqual(
      evaluateKnowledgeFormQuality(reordered).report,
    );
  });

  it("uses exact metric denominators and maps valid threshold failure to exit 1", async () => {
    const input = await corpus();
    const candidate = fixtures(input).find((fixture) => fixture.id === "kfq-claim-fact");
    expect(candidate).toBeDefined();
    if (!candidate) throw new Error("canonical candidate missing");
    candidate.support_refs = [];
    const result = evaluateKnowledgeFormQuality(input);
    expect(result.exit_code).toBe(1);
    expect(result.report.claim_precision).toBe(1);
    expect(result.report.claim_recall).toBe(3 / 4);
    expect(result.report.accuracy).toBe(15 / 16);
    expect(result.report.reject_insufficient_denominator).toBe(8);
    expect(knowledgeFormQualityExitCode(input)).toBe(1);
  });

  it("fails malformed, duplicate, private-looking, and undefined-denominator corpora closed with exit 2", async () => {
    expect(evaluateKnowledgeFormQuality({}).exit_code).toBe(2);
    const duplicate = await corpus();
    const duplicateFixtures = fixtures(duplicate);
    const [first, second] = duplicateFixtures;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (!first || !second) throw new Error("canonical fixtures missing");
    second.id = first.id;
    expect(evaluateKnowledgeFormQuality(duplicate).report.invalid_reasons).toContain(
      "duplicate_fixture_id",
    );
    const privateId = await corpus();
    const [privateFixture] = fixtures(privateId);
    expect(privateFixture).toBeDefined();
    if (!privateFixture) throw new Error("canonical fixture missing");
    privateFixture.id = "kfq-private-record";
    expect(evaluateKnowledgeFormQuality(privateId).exit_code).toBe(2);
    const noClaims = await corpus();
    for (const fixture of fixtures(noClaims))
      if (fixture.expected_class === "must_claim_candidate")
        fixture.expected_class = "must_observation";
    const invalid = evaluateKnowledgeFormQuality(noClaims);
    expect(invalid.exit_code).toBe(2);
    expect(invalid.report.claim_precision).toBeNull();
  });

  it("keeps the rubric unexported, store-free, and absent from runtime exports", async () => {
    const source = await readFile(
      new URL("../src/knowledge-form-evaluation.ts", import.meta.url),
      "utf8",
    );
    const runtime = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(source).toContain("function applyKnowledgeFormEvaluationRubric");
    expect(source).not.toContain("export function applyKnowledgeFormEvaluationRubric");
    expect(source).not.toMatch(
      /(?:@carpeos\/local-store|\b(?:insert|delete)\s*\(|\b(?:store|database|db)\s*\.\s*(?:insert|update|delete|write)\s*\(|\bwriteFile\s*\()/i,
    );
    expect(runtime).not.toContain("knowledge-form-evaluation");
  });
});
