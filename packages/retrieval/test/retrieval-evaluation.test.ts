import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  evaluateRetrievalQuality,
  passesRetrievalQualityGate,
  RETRIEVAL_QUALITY_BRANCH_IDS,
  RetrievalQualityInvalidCorpusError,
  retrievalQualityExitCode,
} from "../src/retrieval-evaluation.js";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/retrieval-quality-v1.json", import.meta.url), "utf8"),
) as Record<string, unknown>;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const cases = (corpus: Record<string, unknown>) => corpus.cases as Array<Record<string, unknown>>;
const requiredCase = (corpus: Record<string, unknown>, id: string): Record<string, unknown> => {
  const evaluationCase = cases(corpus).find((item) => item.id === id);
  if (evaluationCase === undefined) throw new Error(`missing fixture case: ${id}`);
  return evaluationCase;
};
const requiredCandidate = (
  evaluationCase: Record<string, unknown>,
  id: string,
): Record<string, unknown> => {
  const candidate = (evaluationCase.candidates as Array<Record<string, unknown>>).find(
    (item) => item.id === id,
  );
  if (candidate === undefined) throw new Error(`missing fixture candidate: ${id}`);
  return candidate;
};
const requiredAt = <T>(items: readonly T[], index: number): T => {
  const item = items[index];
  if (item === undefined) throw new Error(`missing fixture item at index ${index}`);
  return item;
};

describe("retrieval quality evaluation", () => {
  it("executes deterministic local-index, graph, scope, and canonical-recheck evidence", () => {
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
  });

  it("is stable across separately rebuilt synthetic indexes", () => {
    const first = evaluateRetrievalQuality(fixture);
    const second = evaluateRetrievalQuality(clone(fixture));
    expect(second.corpus_digest).toBe(first.corpus_digest);
    expect(second.rebuild_digest).toBe(first.rebuild_digest);
  });

  it("fails a graph contract when the executed bounded walk omits a required node", () => {
    const corpus = clone(fixture);
    const graphCase = requiredCase(corpus, "rq-graph-multihop");
    graphCase.budget = { max_nodes: 1, required_ids: ["evidence-graph-distal"] };
    const report = evaluateRetrievalQuality(corpus);
    expect(report.budget_violations).toBe(1);
    expect(passesRetrievalQualityGate(report)).toBe(false);
    expect(retrievalQualityExitCode(corpus)).toBe(1);
  });
  it("fails when the middle provenance edge no longer connects the required distal event", () => {
    const corpus = clone(fixture);
    const graphCase = requiredCase(corpus, "rq-graph-multihop");
    requiredCandidate(graphCase, "evidence-graph-distal").provenance = "none";
    const report = evaluateRetrievalQuality(corpus);
    expect(report.budget_violations).toBeGreaterThan(0);
    expect(passesRetrievalQualityGate(report)).toBe(false);
  });

  it("fails when a foreign synthetic origin is observable through the scoped query", () => {
    const corpus = clone(fixture);
    const scopeCase = requiredCase(corpus, "rq-local-scope");
    const foreign = requiredCandidate(scopeCase, "summary-scope-foreign");
    foreign.project_id = "project_retrieval_quality";
    const report = evaluateRetrievalQuality(corpus);
    expect(report.leakage_count).toBeGreaterThan(0);
    expect(passesRetrievalQualityGate(report)).toBe(false);
  });

  it("fails when canonical recheck excludes the ranked synthetic source", () => {
    const corpus = clone(fixture);
    const recheckCase = requiredCase(corpus, "rq-recheck-acceptance");
    requiredAt(recheckCase.candidates as Array<Record<string, unknown>>, 0).canonical_source =
      "omitted";
    const report = evaluateRetrievalQuality(corpus);
    expect(report.assertion_failures).toBeGreaterThan(0);
    expect(passesRetrievalQualityGate(report)).toBe(false);
  });
  it("fails when an observed accepted decision would falsely accept its claim", () => {
    const corpus = clone(fixture);
    const acceptanceCase = requiredCase(corpus, "rq-graph-acceptance");
    requiredCandidate(acceptanceCase, "decision-graph-review").acceptance = "accepted";
    const report = evaluateRetrievalQuality(corpus);
    expect(report.false_acceptance_count).toBeGreaterThan(0);
    expect(passesRetrievalQualityGate(report)).toBe(false);
  });

  it("does not mutate an immutable input while collecting no-mutation evidence", () => {
    const corpus = clone(fixture);
    Object.freeze(corpus);
    Object.freeze(cases(corpus));
    for (const item of cases(corpus)) Object.freeze(item);
    const report = evaluateRetrievalQuality(corpus);
    expect(report.online_feedback_mutated).toBe(false);
    expect(report.adaptive_ranking_mutated).toBe(false);
  });

  it("rejects invalid denominators, missing branches, duplicate ids, and bodies as usage failures", () => {
    const noRelevant = clone(fixture);
    requiredAt(cases(noRelevant), 0).relevant_ids = [];
    expect(() => evaluateRetrievalQuality(noRelevant)).toThrow(RetrievalQualityInvalidCorpusError);
    expect(retrievalQualityExitCode(noRelevant)).toBe(2);

    const missingBranch = clone(fixture);
    missingBranch.cases = (missingBranch.cases as unknown[]).slice(1);
    expect(retrievalQualityExitCode(missingBranch)).toBe(2);

    const duplicate = clone(fixture);
    requiredAt(cases(duplicate), 1).id = "rq-local-recall";
    expect(retrievalQualityExitCode(duplicate)).toBe(2);

    const withBody = clone(fixture);
    requiredAt(cases(withBody), 0).body = "forbidden";
    expect(retrievalQualityExitCode(withBody)).toBe(2);
  });
  it.each(RETRIEVAL_QUALITY_BRANCH_IDS)(
    "rejects a corpus when %s has no independently observed case",
    (branch) => {
      const corpus = clone(fixture);
      corpus.cases = cases(corpus).filter((evaluationCase) => evaluationCase.branch !== branch);
      expect(retrievalQualityExitCode(corpus)).toBe(2);
    },
  );

  it("maps a passing corpus to zero", () => {
    expect(retrievalQualityExitCode(fixture)).toBe(0);
  });
});
