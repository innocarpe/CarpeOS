import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { CanonicalEvent, RetrievalQuery, RetrievalResultItem } from "@carpeos/schema";
import { walkGraphNeighborhood } from "./graph-projection.js";
import {
  migrateLocalRetrievalIndex,
  rebuildLocalRetrievalIndex,
  searchLocalRetrievalIndex,
} from "./local-index.js";

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
  project_id?: string;
  canonical_source?: "present" | "omitted";
};
type EvaluationCase = {
  id: string;
  branch: BranchId;
  candidates: Candidate[];
  relevant_ids: string[];
  forbidden_ids?: string[];
  budget?: { max_nodes: number; required_ids?: string[] };
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
  online_feedback_mutated: boolean;
  adaptive_ranking_mutated: boolean;
};

export class RetrievalQualityInvalidCorpusError extends Error {}

const trustZoneId = "tz_retrieval_quality";
const projectId = "project_retrieval_quality";
const now = new Date("2026-01-01T00:00:00.000Z");

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
  let onlineFeedbackMutated = false;
  let adaptiveRankingMutated = false;
  const rebuildRows: unknown[] = [];

  for (const [caseIndex, evaluationCase] of valid.cases.entries()) {
    branchCounts[evaluationCase.branch] += 1;
    const observed = executeEvidencePath(evaluationCase, caseIndex);
    const topThree = observed.rankedIds.slice(0, 3);
    const relevant = new Set(evaluationCase.relevant_ids);
    recallTotal += topThree.filter((id) => relevant.has(id)).length / relevant.size;
    const firstRelevant = observed.rankedIds.findIndex((id) => relevant.has(id));
    reciprocalRankTotal += firstRelevant === -1 ? 0 : 1 / (firstRelevant + 1);
    leakageCount += observed.leakedIds.length;
    budgetViolations += observed.budgetViolated ? 1 : 0;
    falseAcceptanceCount += observed.falseAcceptance ? 1 : 0;
    assertionFailures +=
      !topThree.some((id) => relevant.has(id)) || !observed.canonicalRechecked ? 1 : 0;
    onlineFeedbackMutated ||= observed.onlineFeedbackMutated;
    adaptiveRankingMutated ||= observed.adaptiveRankingMutated;
    rebuildRows.push({
      id: evaluationCase.id,
      ranked_ids: observed.rankedIds,
      graph: observed.graph,
    });
  }

  const caseCount = valid.cases.length;
  return {
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
    online_feedback_mutated: onlineFeedbackMutated,
    adaptive_ranking_mutated: adaptiveRankingMutated,
  };
}

type ObservedPath = {
  rankedIds: string[];
  leakedIds: string[];
  budgetViolated: boolean;
  falseAcceptance: boolean;
  canonicalRechecked: boolean;
  onlineFeedbackMutated: boolean;
  adaptiveRankingMutated: boolean;
  graph: { nodes_used: number; max_nodes: number } | undefined;
};

function executeEvidencePath(evaluationCase: EvaluationCase, caseIndex: number): ObservedPath {
  const db = openEvaluationDatabase();
  const eventIds = new Map<string, string>();
  const events = evaluationCase.candidates.map((candidate, candidateIndex) => {
    const eventId = `evt_rq_case_${caseIndex}_candidate_${candidateIndex}_synthetic`;
    eventIds.set(candidate.id, eventId);
    return syntheticEvent(eventId, evaluationCase.id, candidate, candidateIndex, eventIds);
  });
  for (const [index, event] of events.entries()) {
    const candidate = requiredCorpusValue(
      evaluationCase.candidates[index],
      "candidate is missing during evaluation",
    );
    db.prepare(
      "INSERT INTO canonical_events (event_id, event_json, local_sequence) VALUES (?, ?, ?)",
    ).run(event.event_id, JSON.stringify(event), index + 1);
    db.prepare(
      "INSERT INTO capture_requests (event_id, project_id, worktree_id, worktree_name, git_branch) VALUES (?, ?, ?, ?, ?)",
    ).run(
      event.event_id,
      candidate.project_id ??
        (evaluationCase.forbidden_ids?.includes(candidate.id) ? "project_foreign" : projectId),
      `wt_${caseIndex.toString(16).padStart(12, "0")}${index.toString(16).padStart(12, "0")}`,
      `worktree_${caseIndex}_${index}`,
      "main",
    );
  }
  rebuildLocalRetrievalIndex(db, now);
  const canonicalSnapshot = readCanonicalSnapshot(db);
  const relevantId = requiredCorpusValue(
    evaluationCase.relevant_ids[0],
    "relevant id is missing during evaluation",
  );
  const query = makeQuery(`${evaluationCase.id} ${relevantId}`, projectId);
  const result = searchLocalRetrievalIndex(db, {
    query,
    events: canonicalEventsForRecheck(events, evaluationCase),
  });
  const rankedIds = candidateIdsFromResults(result.results, eventIds);
  const scopeProbe =
    evaluationCase.forbidden_ids === undefined
      ? []
      : candidateIdsFromResults(
          searchLocalRetrievalIndex(db, {
            query: makeQuery(evaluationCase.id, projectId),
            events: canonicalEventsForRecheck(events, evaluationCase),
          }).results,
          eventIds,
        );
  const graphBudget = evaluationCase.budget;
  const graphEvidence =
    graphBudget === undefined
      ? undefined
      : (() => {
          const rootId = requiredCorpusValue(
            eventIds.get(relevantId),
            "relevant event mapping is missing during evaluation",
          );
          const requiredEventIds = (graphBudget.required_ids ?? []).map((id) =>
            requiredCorpusValue(
              eventIds.get(id),
              "required graph event mapping is missing during evaluation",
            ),
          );
          return {
            maxNodes: graphBudget.max_nodes,
            requiredEventIds,
            walk: walkGraphNeighborhood(db, {
              root_id: rootId,
              max_depth: 2,
              max_nodes: graphBudget.max_nodes,
              visible_trust_zone_ids: [trustZoneId],
            }),
          };
        })();
  const graphSourceIds = new Set(
    graphEvidence?.walk.nodes.map((node) => node.source_event_id) ?? [],
  );
  const canonicalRechecked = result.results.every((item) => item.canonical_rechecked === true);
  const falseAcceptance = result.results.some(
    (item) => item.status === "visible" && item.lineage.accepted_decision_event_ids !== undefined,
  );
  const canonicalAfter = readCanonicalSnapshot(db);
  return {
    rankedIds,
    leakedIds: scopeProbe.filter((id) => evaluationCase.forbidden_ids?.includes(id)),
    budgetViolated:
      graphEvidence !== undefined &&
      (graphEvidence.walk.budgets.nodes_used > graphEvidence.maxNodes ||
        graphEvidence.requiredEventIds.some((eventId) => !graphSourceIds.has(eventId))),
    falseAcceptance,
    canonicalRechecked,
    onlineFeedbackMutated: canonicalSnapshot !== canonicalAfter,
    adaptiveRankingMutated: canonicalSnapshot !== canonicalAfter,
    graph:
      graphEvidence === undefined
        ? undefined
        : {
            nodes_used: graphEvidence.walk.budgets.nodes_used,
            max_nodes: graphEvidence.maxNodes,
          },
  };
}

function canonicalEventsForRecheck(
  events: readonly CanonicalEvent[],
  evaluationCase: EvaluationCase,
): CanonicalEvent[] {
  return events.filter(
    (_event, index) => evaluationCase.candidates[index]?.canonical_source !== "omitted",
  );
}

function candidateIdsFromResults(
  results: readonly RetrievalResultItem[],
  eventIds: ReadonlyMap<string, string>,
): string[] {
  const byEventId = new Map([...eventIds].map(([candidateId, eventId]) => [eventId, candidateId]));
  const rankedIds = results.flatMap((result) =>
    result.status === "visible"
      ? result.lineage.source_records
          .map((source) => byEventId.get(source.source_record_id))
          .filter((id): id is string => id !== undefined)
      : [],
  );
  return [...new Set(rankedIds)];
}

function openEvaluationDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE schema_migrations (migration_id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE canonical_events (event_id TEXT PRIMARY KEY, event_json TEXT NOT NULL, local_sequence INTEGER NOT NULL);
    CREATE TABLE sync_inbox_events (event_id TEXT PRIMARY KEY, event_json TEXT NOT NULL, zone_sequence INTEGER NOT NULL);
    CREATE TABLE sync_inbox_erasures (erasure_id TEXT PRIMARY KEY, erasure_json TEXT NOT NULL);
    CREATE TABLE sync_cursors (trust_zone_id TEXT PRIMARY KEY, after_sequence INTEGER NOT NULL);
    CREATE TABLE erasure_ledger (erasure_id TEXT PRIMARY KEY, erasure_json TEXT NOT NULL);
    CREATE TABLE capture_requests (event_id TEXT PRIMARY KEY, project_id TEXT, worktree_id TEXT, worktree_name TEXT, git_branch TEXT);
  `);
  migrateLocalRetrievalIndex(db, now);
  return db;
}

function syntheticEvent(
  eventId: string,
  caseId: string,
  candidate: Candidate,
  candidateIndex: number,
  eventIds: ReadonlyMap<string, string>,
): CanonicalEvent {
  const previous = candidateIndex === 0 ? undefined : [...eventIds.values()][candidateIndex - 1];
  return {
    schema_version: "v1",
    event_id: eventId,
    event_type: "Observation",
    subject_ref: `subject_${caseId}`,
    valid_time: { start: "2026-01-01T00:00:00Z", end: null },
    recorded_time: { start: "2026-01-01T00:00:00Z", end: null },
    lifecycle_status: "active",
    epistemic_authority: "derived",
    trust_zone: { trust_zone_id: trustZoneId, isolation: "local_device" },
    provenance:
      previous === undefined
        ? []
        : [{ ref_type: "event", ref_id: previous, relationship: "derived_from" }],
    idempotency_key: `idem_${eventId}`,
    request_fingerprint: `sha-256:${String(candidateIndex).padStart(64, "0")}`,
    zone_sequence: candidateIndex + 1,
    payload: {
      observation_id: `obs_${eventId}`,
      observed_at: "2026-01-01T00:00:00Z",
      statement: `Synthetic ${caseId} ${candidate.id} ${candidate.kind}`,
      evidence_artifact_refs: [],
    },
  } as CanonicalEvent;
}

function makeQuery(text: string, scopedProjectId: string): RetrievalQuery {
  return {
    schema_version: "v1",
    record_type: "retrieval_query",
    query_id: `query_${sha256(text).slice(-24)}`,
    query_text: text,
    filters: {
      visible_trust_zone_ids: [trustZoneId],
      lifecycle_status: ["active"],
      protected_value_policy: "metadata_only",
      conflict_policy: "surface_conflicts",
      project_ids: [scopedProjectId],
    },
    ranking: { mode: "hybrid", weights: { structured: 1, fts: 1, semantic: 1, recency: 0 } },
    limit: 10,
  };
}

function readCanonicalSnapshot(db: DatabaseSync): string {
  return stableJson(
    db
      .prepare(
        "SELECT event_id, event_json, local_sequence FROM canonical_events ORDER BY event_id",
      )
      .all(),
  );
}

export function retrievalQualityExitCode(corpus: unknown): 0 | 1 | 2 {
  try {
    const report = evaluateRetrievalQuality(corpus);
    return passesRetrievalQualityGate(report) ? 0 : 1;
  } catch (error) {
    if (error instanceof RetrievalQualityInvalidCorpusError) return 2;
    throw error;
  }
}

export function passesRetrievalQualityGate(report: RetrievalQualityReport): boolean {
  return (
    report.macro_recall_at_3 === 1 &&
    report.mrr >= 0.9 &&
    report.leakage_count === 0 &&
    report.budget_violations === 0 &&
    report.false_acceptance_count === 0 &&
    report.assertion_failures === 0 &&
    !report.online_feedback_mutated &&
    !report.adaptive_ranking_mutated
  );
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
  const branches = new Set<string>();
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
    branches.add(item.branch as string);
    const candidateIds = new Set<string>();
    for (const candidate of item.candidates) {
      if (
        !isRecord(candidate) ||
        typeof candidate.id !== "string" ||
        candidateIds.has(candidate.id) ||
        !["claim", "decision", "summary", "open_loop", "evidence_excerpt"].includes(
          candidate.kind as string,
        ) ||
        (candidate.project_id !== undefined && typeof candidate.project_id !== "string") ||
        (candidate.canonical_source !== undefined &&
          !["present", "omitted"].includes(candidate.canonical_source as string))
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
      item.forbidden_ids !== undefined &&
      (!Array.isArray(item.forbidden_ids) ||
        !item.forbidden_ids.every((id) => typeof id === "string" && candidateIds.has(id)))
    )
      invalid("forbidden ids are invalid");
    if (item.budget !== undefined) {
      const budget = item.budget;
      if (
        !isRecord(budget) ||
        typeof budget.max_nodes !== "number" ||
        !Number.isInteger(budget.max_nodes) ||
        budget.max_nodes < 1 ||
        (budget.required_ids !== undefined &&
          (!Array.isArray(budget.required_ids) ||
            !budget.required_ids.every((id) => typeof id === "string" && candidateIds.has(id))))
      )
        invalid("budget is invalid");
    }
  }
  if (
    branches.size !== RETRIEVAL_QUALITY_BRANCH_IDS.length ||
    RETRIEVAL_QUALITY_BRANCH_IDS.some((id) => !branches.has(id))
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
function requiredCorpusValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) invalid(message);
  return value;
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
  } catch (error) {
    if (error instanceof RetrievalQualityInvalidCorpusError) process.exitCode = 2;
    else throw error;
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main();
