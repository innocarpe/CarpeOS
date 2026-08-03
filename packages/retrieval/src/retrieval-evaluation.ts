import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildRetrievalChunk } from "./chunks.js";
import { makeRetrievalDerivation } from "./provenance.js";
import { rankHybrid, type RankWeights } from "./ranking.js";

export const RETRIEVAL_QUALITY_CORPUS_VERSION = "retrieval-quality/v1" as const;
export const RETRIEVAL_QUALITY_REPORT_VERSION = "carpeos.retrieval-quality-report/v1" as const;

export const RETRIEVAL_QUALITY_BRANCH_IDS = [
  "local-index-recall",
  "local-index-scope-isolation",
  "local-index-kind-priority",
  "graph-provenance-multihop",
  "graph-budget-omission",
  "graph-no-acceptance-inference",
  "canonical-recheck-determinism",
  "canonical-recheck-no-false-acceptance",
] as const;

type BranchId = (typeof RETRIEVAL_QUALITY_BRANCH_IDS)[number];

type Candidate = {
  id: string;
  kind: "claim" | "decision" | "summary" | "open_loop" | "evidence_excerpt";
  structured: number;
  fts: number;
  semantic: number;
  recency: number;
  graph_hop?: number;
};

type EvaluationCase = {
  id: string;
  branch: BranchId;
  candidates: Candidate[];
  relevant_ids: string[];
  forbidden_ids?: string[];
  budget?: { nodes_used: number; max_nodes: number };
  acceptance_decision?: boolean;
};

export type RetrievalQualityCorpus = {
  corpus_version: typeof RETRIEVAL_QUALITY_CORPUS_VERSION;
  cases: EvaluationCase[];
};

export type RetrievalQualityReport = {
  report_version: typeof RETRIEVAL_QUALITY_REPORT_VERSION;
  corpus_version: typeof RETRIEVAL_QUALITY_CORPUS_VERSION;
  corpus_digest: `sha-256:${string}`;
  rebuild_digest: `sha-256:${string}`;
  query_count: number;
  case_count: number;
  branch_counts: Record<BranchId, number>;
  macro_recall_at_3: number;
  mrr: number;
  leakage_count: number;
  budget_violations: number;
  false_acceptance_count: number;
  assertion_failures: number;
  online_feedback_mutated: false;
  adaptive_ranking_mutated: false;
};

export class RetrievalQualityInvalidCorpusError extends Error {}

const weights: RankWeights = { structured: 1, fts: 1, semantic: 1, recency: 1 };
const source = {
  source_record_kind: "event" as const,
  source_record_id: "evt_retrieval_quality",
  trust_zone_id: "tz_retrieval_quality",
  zone_sequence: 1,
  source_fingerprint: `sha-256:${"0".repeat(64)}`,
  relationship_role: "primary" as const,
  event_type: "Observation" as const,
  lifecycle_status: "active" as const,
  epistemic_authority: "derived" as const,
  valid_time: { start: "2026-01-01T00:00:00.000Z", end: null },
  recorded_time: { start: "2026-01-01T00:00:00.000Z", end: null },
};

export function evaluateRetrievalQuality(corpus: unknown): RetrievalQualityReport {
  const valid = validateCorpus(corpus);
  const branchCounts = Object.fromEntries(
    RETRIEVAL_QUALITY_BRANCH_IDS.map((branch) => [branch, 0]),
  ) as Record<BranchId, number>;
  let recallTotal = 0;
  let reciprocalRankTotal = 0;
  let leakageCount = 0;
  let budgetViolations = 0;
  let falseAcceptanceCount = 0;
  let assertionFailures = 0;
  const rebuildRows: unknown[] = [];

  for (const evaluationCase of valid.cases) {
    branchCounts[evaluationCase.branch] += 1;
    const rankedIds = rankCase(evaluationCase);
    const topThree = rankedIds.slice(0, 3);
    const relevant = new Set(evaluationCase.relevant_ids);
    recallTotal += topThree.filter((id) => relevant.has(id)).length / relevant.size;
    const firstRelevant = rankedIds.findIndex((id) => relevant.has(id));
    reciprocalRankTotal += firstRelevant === -1 ? 0 : 1 / (firstRelevant + 1);
    leakageCount += topThree.filter((id) => evaluationCase.forbidden_ids?.includes(id)).length;
    if (evaluationCase.budget && evaluationCase.budget.nodes_used > evaluationCase.budget.max_nodes)
      budgetViolations += 1;
    if (evaluationCase.acceptance_decision === true) falseAcceptanceCount += 1;
    if (!topThree.some((id) => relevant.has(id))) assertionFailures += 1;
    rebuildRows.push({ id: evaluationCase.id, ranked_ids: rankedIds });
  }

  const caseCount = valid.cases.length;
  const report: RetrievalQualityReport = {
    report_version: RETRIEVAL_QUALITY_REPORT_VERSION,
    corpus_version: valid.corpus_version,
    corpus_digest: sha256(stableJson(valid)),
    rebuild_digest: sha256(stableJson(rebuildRows)),
    query_count: caseCount,
    case_count: caseCount,
    branch_counts: branchCounts,
    macro_recall_at_3: recallTotal / caseCount,
    mrr: reciprocalRankTotal / caseCount,
    leakage_count: leakageCount,
    budget_violations: budgetViolations,
    false_acceptance_count: falseAcceptanceCount,
    assertion_failures: assertionFailures,
    online_feedback_mutated: false,
    adaptive_ranking_mutated: false,
  };
  return report;
}

export function retrievalQualityExitCode(corpus: unknown): 0 | 1 | 2 {
  try {
    const report = evaluateRetrievalQuality(corpus);
    return passesRetrievalQualityGate(report) ? 0 : 1;
  } catch (error) {
    return error instanceof RetrievalQualityInvalidCorpusError ? 2 : 2;
  }
}

export function passesRetrievalQualityGate(report: RetrievalQualityReport): boolean {
  return (
    report.macro_recall_at_3 === 1 &&
    report.mrr >= 0.9 &&
    report.leakage_count === 0 &&
    report.budget_violations === 0 &&
    report.false_acceptance_count === 0 &&
    report.assertion_failures === 0
  );
}

function rankCase(evaluationCase: EvaluationCase): string[] {
  const derivation = makeRetrievalDerivation({
    sourceRecords: [source],
    config: { corpus: RETRIEVAL_QUALITY_CORPUS_VERSION },
  });
  const graphProximity = new Map<string, number>();
  const ranked = rankHybrid(
    evaluationCase.candidates.map((candidate, index) => {
      const chunk = buildRetrievalChunk({
        chunkKind: candidate.kind,
        text: `metadata ${candidate.id}`,
        sourceRecords: [source],
        derivation,
        chunkIndex: index,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      if (candidate.graph_hop !== undefined) graphProximity.set(candidate.id, candidate.graph_hop);
      return {
        chunk: { ...chunk, chunk_id: candidate.id },
        structured_score: candidate.structured,
        fts_score: candidate.fts,
        semantic_score: candidate.semantic,
        recency_score: candidate.recency,
      };
    }),
    weights,
    { graphProximity },
  );
  return ranked.map((candidate) => candidate.chunk.chunk_id);
}

function validateCorpus(value: unknown): RetrievalQualityCorpus {
  if (
    !isRecord(value) ||
    value.corpus_version !== RETRIEVAL_QUALITY_CORPUS_VERSION ||
    !Array.isArray(value.cases) ||
    value.cases.length === 0
  )
    invalid("corpus version and non-empty cases are required");
  rejectBodies(value);
  const caseIds = new Set<string>();
  const branchCounts = new Set<string>();
  for (const item of value.cases) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      caseIds.has(item.id) ||
      !RETRIEVAL_QUALITY_BRANCH_IDS.includes(item.branch as BranchId) ||
      !Array.isArray(item.candidates) ||
      !Array.isArray(item.relevant_ids) ||
      item.relevant_ids.length === 0
    )
      invalid("case is malformed");
    caseIds.add(item.id);
    branchCounts.add(item.branch as string);
    const candidateIds = new Set<string>();
    for (const candidate of item.candidates) {
      if (
        !isRecord(candidate) ||
        typeof candidate.id !== "string" ||
        candidateIds.has(candidate.id) ||
        !["claim", "decision", "summary", "open_loop", "evidence_excerpt"].includes(
          candidate.kind as string,
        ) ||
        ![candidate.structured, candidate.fts, candidate.semantic, candidate.recency].every(
          (score) => typeof score === "number" && Number.isFinite(score),
        )
      )
        invalid("candidate is malformed");
      candidateIds.add(candidate.id);
    }
    if (
      new Set(item.relevant_ids).size !== item.relevant_ids.length ||
      !item.relevant_ids.every((id) => typeof id === "string" && candidateIds.has(id))
    )
      invalid("relevant ids are invalid");
    if (
      item.forbidden_ids &&
      (!Array.isArray(item.forbidden_ids) ||
        !item.forbidden_ids.every((id) => typeof id === "string" && candidateIds.has(id)))
    )
      invalid("forbidden ids are invalid");
    if (item.budget !== undefined) {
      const budget = item.budget;
      if (
        !isRecord(budget) ||
        typeof budget.nodes_used !== "number" ||
        !Number.isInteger(budget.nodes_used) ||
        typeof budget.max_nodes !== "number" ||
        !Number.isInteger(budget.max_nodes) ||
        budget.max_nodes <= 0
      )
        invalid("budget is invalid");
    }
    if (item.acceptance_decision !== undefined && typeof item.acceptance_decision !== "boolean")
      invalid("acceptance decision is invalid");
  }
  if (
    branchCounts.size !== RETRIEVAL_QUALITY_BRANCH_IDS.length ||
    RETRIEVAL_QUALITY_BRANCH_IDS.some((id) => !branchCounts.has(id))
  )
    invalid("all required branches must be present");
  return value as RetrievalQualityCorpus;
}

function rejectBodies(value: unknown): void {
  const forbidden = new Set(["body", "text", "query", "query_text", "document", "content"]);
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) item.forEach(visit);
    else if (isRecord(item))
      for (const [key, nested] of Object.entries(item)) {
        if (forbidden.has(key)) invalid("corpus must be body-free");
        visit(nested);
      }
  };
  visit(value);
}
function invalid(message: string): never {
  throw new RetrievalQualityInvalidCorpusError(message);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function sha256(value: string): `sha-256:${string}` {
  return `sha-256:${createHash("sha256").update(value).digest("hex")}`;
}

async function main(): Promise<void> {
  const fixturePath = process.argv[2];
  if (!fixturePath) {
    process.exitCode = 2;
    return;
  }
  try {
    const corpus = JSON.parse(await readFile(fixturePath, "utf8")) as unknown;
    const report = evaluateRetrievalQuality(corpus);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exitCode = passesRetrievalQualityGate(report) ? 0 : 1;
  } catch {
    process.exitCode = 2;
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main();
