import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RETRIEVAL_QUALITY_BRANCH_IDS,
  RetrievalQualityInvalidCorpusError,
  evaluateRetrievalQuality,
  passesRetrievalQualityGate,
  retrievalQualityExitCode,
} from "../src/retrieval-evaluation.js";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/retrieval-quality-v1.json", import.meta.url), "utf8"),
) as Record<string, unknown>;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("retrieval quality evaluation", () => {
  it("evaluates every canonical branch with a passing, body-free report", () => {
    const report = evaluateRetrievalQuality(fixture);
    expect(Object.keys(report.branch_counts)).toEqual([...RETRIEVAL_QUALITY_BRANCH_IDS]);
    expect(Object.values(report.branch_counts)).toEqual(Array(8).fill(1));
    expect(report.macro_recall_at_3).toBe(1);
    expect(report.mrr).toBeGreaterThanOrEqual(0.9);
    expect(report.leakage_count).toBe(0);
    expect(report.budget_violations).toBe(0);
    expect(report.false_acceptance_count).toBe(0);
    expect(report.assertion_failures).toBe(0);
    expect(report.online_feedback_mutated).toBe(false);
    expect(report.adaptive_ranking_mutated).toBe(false);
    expect(JSON.stringify(report)).not.toContain("query_text");
    expect(JSON.stringify(report)).not.toContain("document");
  });

  it("is stable across corpus rebuilds", () => {
    const first = evaluateRetrievalQuality(fixture);
    const second = evaluateRetrievalQuality(clone(fixture));
    expect(second.corpus_digest).toBe(first.corpus_digest);
    expect(second.rebuild_digest).toBe(first.rebuild_digest);
  });

  it("computes recall at three and reciprocal rank from ranked candidate ids", () => {
    const corpus = clone(fixture);
    const cases = corpus.cases as Array<Record<string, unknown>>;
    const first = cases[0]!;
    first.candidates = [
      { id: "not-relevant", kind: "claim", structured: 2, fts: 2, semantic: 2, recency: 0 },
      { id: "doc-local-relevant", kind: "claim", structured: 1, fts: 1, semantic: 1, recency: 0 },
    ];
    const report = evaluateRetrievalQuality(corpus);
    expect(report.macro_recall_at_3).toBe(1);
    expect(report.mrr).toBeCloseTo((0.5 + 7) / 8);
  });

  it("maps threshold failures to one", () => {
    const corpus = clone(fixture);
    (corpus.cases as Array<Record<string, unknown>>)[0]!.acceptance_decision = true;
    const report = evaluateRetrievalQuality(corpus);
    expect(passesRetrievalQualityGate(report)).toBe(false);
    expect(retrievalQualityExitCode(corpus)).toBe(1);
  });

  it("rejects invalid denominators, missing branches, duplicate ids, and bodies as usage failures", () => {
    const noRelevant = clone(fixture);
    (noRelevant.cases as Array<Record<string, unknown>>)[0]!.relevant_ids = [];
    expect(() => evaluateRetrievalQuality(noRelevant)).toThrow(RetrievalQualityInvalidCorpusError);
    expect(retrievalQualityExitCode(noRelevant)).toBe(2);

    const missingBranch = clone(fixture);
    missingBranch.cases = (missingBranch.cases as unknown[]).slice(1);
    expect(retrievalQualityExitCode(missingBranch)).toBe(2);

    const duplicate = clone(fixture);
    (duplicate.cases as Array<Record<string, unknown>>)[1]!.id = "rq-local-recall";
    expect(retrievalQualityExitCode(duplicate)).toBe(2);

    const withBody = clone(fixture);
    (withBody.cases as Array<Record<string, unknown>>)[0]!.body = "forbidden";
    expect(retrievalQualityExitCode(withBody)).toBe(2);
  });

  it("maps a passing corpus to zero", () => {
    expect(retrievalQualityExitCode(fixture)).toBe(0);
  });
});
