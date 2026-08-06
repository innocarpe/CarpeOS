/**
 * Product 6 P6 — GraphRAG-style ranking on typed promoted meaning units.
 *
 * Local-first: uses rebuildable graph proximity + typed unit features.
 * Never treats graph as SoT. Never invents AcceptanceDecision.
 */

import type { RetrievalChunk } from "@carpeos/schema";
import { buildRetrievalChunk } from "./chunks.js";
import { makeRetrievalDerivation } from "./provenance.js";
import {
  chunkKindPriority,
  isMeaningfulChunkKind,
  rankHybrid,
  type RankWeights,
  type RetrievalCandidate,
  type RankedCandidate,
  scoreFts,
  scoreRecency,
  scoreStructured,
} from "./ranking.js";

/** Extra structured weight for active typed meaning units vs evidence residue. */
export const GRAPHRAG_TYPED_UNIT_FACTOR = 0.45;
/** Draft typed units still beat raw evidence, but below promoted/active. */
export const GRAPHRAG_DRAFT_UNIT_FACTOR = 0.18;

export type GraphRagUnitClass =
  | "promoted_typed_unit"
  | "draft_typed_unit"
  | "evidence_residue"
  | "other";

export type GraphRagFeatures = {
  schema: "carpeos.retrieval.graphrag-features/v1";
  chunk_id: string;
  unit_class: GraphRagUnitClass;
  is_meaningful: boolean;
  is_promoted_active: boolean;
  kind_priority: number;
  /** 0–1 boost multiplier applied under structured weight. */
  typed_boost: number;
};

/**
 * Classify a chunk for GraphRAG: prefer active claim/summary/decision over evidence.
 */
export function classifyGraphRagUnit(chunk: RetrievalChunk): GraphRagFeatures {
  const is_meaningful = isMeaningfulChunkKind(chunk.chunk_kind);
  const kind_priority = chunkKindPriority(chunk.chunk_kind);
  const is_promoted_active = is_meaningful && chunk.lifecycle_status === "active";
  let unit_class: GraphRagUnitClass = "other";
  let typed_boost = 0;

  if (chunk.chunk_kind === "evidence_excerpt") {
    unit_class = "evidence_residue";
    typed_boost = 0;
  } else if (is_promoted_active) {
    unit_class = "promoted_typed_unit";
    typed_boost = GRAPHRAG_TYPED_UNIT_FACTOR * kind_priority;
  } else if (is_meaningful && chunk.lifecycle_status === "draft") {
    unit_class = "draft_typed_unit";
    typed_boost = GRAPHRAG_DRAFT_UNIT_FACTOR * kind_priority;
  } else if (is_meaningful) {
    unit_class = "other";
    typed_boost = GRAPHRAG_DRAFT_UNIT_FACTOR * kind_priority * 0.5;
  }

  return {
    schema: "carpeos.retrieval.graphrag-features/v1",
    chunk_id: chunk.chunk_id,
    unit_class,
    is_meaningful,
    is_promoted_active,
    kind_priority,
    typed_boost,
  };
}

/**
 * Build chunk_id → typed boost map for rankHybrid.
 */
export function buildTypedUnitBoostMap(chunks: readonly RetrievalChunk[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const chunk of chunks) {
    map.set(chunk.chunk_id, classifyGraphRagUnit(chunk).typed_boost);
  }
  return map;
}

export type GraphRagRankInput = {
  query_text: string;
  candidates: readonly {
    chunk_id: string;
    chunk_kind: RetrievalChunk["chunk_kind"];
    lifecycle_status: RetrievalChunk["lifecycle_status"];
    text: string;
    created_at?: string;
    /** Optional hop distance (0 = seed). */
    graph_hop?: number;
  }[];
  weights?: RankWeights;
  limit?: number;
};

/**
 * Offline GraphRAG rank over lightweight candidate descriptors (no SQLite required).
 */
export function rankGraphRagOffline(input: GraphRagRankInput): RankedCandidate[] {
  const weights = input.weights ?? {
    structured: 1,
    fts: 1,
    semantic: 0.5,
    recency: 0.1,
  };
  const now = Date.now();
  const retrievalCandidates: RetrievalCandidate[] = input.candidates.map((c) => {
    const chunk = syntheticChunk(c);
    return {
      chunk,
      structured_score: scoreStructured(input.query_text, chunk),
      fts_score: scoreFts(input.query_text, chunk.text),
      semantic_score: scoreFts(input.query_text, chunk.text) * 0.8,
      recency_score: scoreRecency(chunk, now),
    };
  });
  const typedUnitBoost = buildTypedUnitBoostMap(retrievalCandidates.map((c) => c.chunk));
  const graphProximity = new Map<string, number>();
  for (const c of input.candidates) {
    if (c.graph_hop !== undefined) {
      graphProximity.set(c.chunk_id, c.graph_hop);
    }
  }
  const ranked = rankHybrid(retrievalCandidates, weights, {
    typedUnitBoost,
    ...(graphProximity.size > 0 ? { graphProximity } : {}),
  });
  const limit = input.limit ?? ranked.length;
  return ranked.slice(0, limit);
}

function syntheticChunk(input: {
  chunk_id: string;
  chunk_kind: RetrievalChunk["chunk_kind"];
  lifecycle_status: RetrievalChunk["lifecycle_status"];
  text: string;
  created_at?: string;
}): RetrievalChunk {
  // source_record_id must match evt_[a-z0-9][a-z0-9_-]{7,127}
  const safeId = `gr_${input.chunk_id.replace(/[^a-z0-9_-]/gi, "_")}`.slice(0, 100).padEnd(12, "0");
  const sourceRecords = [
    {
      source_record_kind: "event" as const,
      source_record_id: `evt_${safeId}`,
      trust_zone_id: "tz_graphrag_offline",
      zone_sequence: 1,
      source_fingerprint: `sha-256:${"a".repeat(64)}`,
      relationship_role: "primary" as const,
      event_type:
        input.chunk_kind === "claim"
          ? ("Claim" as const)
          : input.chunk_kind === "decision"
            ? ("AcceptanceDecision" as const)
            : input.chunk_kind === "evidence_excerpt"
              ? ("EvidenceArtifact" as const)
              : ("Observation" as const),
      lifecycle_status: input.lifecycle_status,
      epistemic_authority: "observed" as const,
      valid_time: { start: "2026-08-07T00:00:00.000Z", end: null },
      recorded_time: { start: "2026-08-07T00:00:00.000Z", end: null },
    },
  ];
  const derivation = makeRetrievalDerivation({
    sourceRecords,
    config: { offline_graphrag: true, fixture_id: input.chunk_id },
  });
  const built = buildRetrievalChunk({
    chunkKind: input.chunk_kind,
    text: input.text,
    sourceRecords,
    derivation,
    lifecycleStatus: input.lifecycle_status,
    createdAt: input.created_at ?? "2026-08-07T00:00:00.000Z",
  });
  // Stable fixture id for expect_top_id assertions (override derived hash id).
  return { ...built, chunk_id: input.chunk_id };
}

// --- Offline query-set evaluation (P6 evidence) ---

export type GraphRagQueryCase = {
  id: string;
  query_text: string;
  candidates: GraphRagRankInput["candidates"];
  /** Candidate id that must appear at rank 1 (or in top_k). */
  expect_top_id?: string;
  expect_top_ids_any?: string[];
  top_k?: number;
  /** Noise ids that must not outrank the expected typed unit at position 1. */
  must_not_top_ids?: string[];
};

export type GraphRagQuerySet = {
  schema: "carpeos.agentic.graphrag-query-set/v1";
  description?: string;
  cases: GraphRagQueryCase[];
};

export type GraphRagEvalReport = {
  schema: "carpeos.agentic.graphrag-eval/v1";
  pass: boolean;
  case_count: number;
  pass_count: number;
  fail_count: number;
  /** Fraction of cases where promoted typed unit beat evidence noise. */
  hit_rate: number;
  /** Minimum hit_rate for pass (default 0.9). */
  hit_rate_min: number;
  cases: Array<{
    id: string;
    pass: boolean;
    top_ids: string[];
    reason_codes: string[];
  }>;
  reason_codes: string[];
};

export function evaluateGraphRagQuerySet(
  querySet: GraphRagQuerySet,
  options: { hit_rate_min?: number } = {},
): GraphRagEvalReport {
  const hit_rate_min = options.hit_rate_min ?? 0.9;
  const caseResults: GraphRagEvalReport["cases"] = [];
  let pass_count = 0;

  for (const testCase of querySet.cases) {
    const ranked = rankGraphRagOffline({
      query_text: testCase.query_text,
      candidates: testCase.candidates,
      limit: testCase.top_k ?? 5,
    });
    const top_ids = ranked.map((r) => r.chunk.chunk_id);
    const reason_codes: string[] = [];
    let ok = true;

    if (testCase.expect_top_id !== undefined) {
      if (top_ids[0] !== testCase.expect_top_id) {
        ok = false;
        reason_codes.push(`top1_expected_${testCase.expect_top_id}_got_${top_ids[0] ?? "none"}`);
      } else {
        reason_codes.push("top1_hit");
      }
    }

    if (testCase.expect_top_ids_any !== undefined && testCase.expect_top_ids_any.length > 0) {
      const k = testCase.top_k ?? 3;
      const window = top_ids.slice(0, k);
      const hit = testCase.expect_top_ids_any.some((id) => window.includes(id));
      if (!hit) {
        ok = false;
        reason_codes.push("expected_id_missing_from_topk");
      } else {
        reason_codes.push("topk_hit");
      }
    }

    if (testCase.must_not_top_ids !== undefined && testCase.must_not_top_ids.length > 0) {
      if (top_ids[0] !== undefined && testCase.must_not_top_ids.includes(top_ids[0])) {
        ok = false;
        reason_codes.push(`noise_won_top1_${top_ids[0]}`);
      }
    }

    // Hard judgment: promoted typed unit features should beat pure evidence residue
    // when both match query terms.
    const topFeatures = ranked[0] ? classifyGraphRagUnit(ranked[0].chunk) : null;
    if (
      topFeatures?.unit_class === "evidence_residue" &&
      ranked.some((r) => classifyGraphRagUnit(r.chunk).is_promoted_active)
    ) {
      ok = false;
      reason_codes.push("evidence_outranked_promoted_typed_unit");
    }

    if (ok) {
      pass_count += 1;
      if (reason_codes.length === 0) reason_codes.push("case_pass");
    }

    caseResults.push({
      id: testCase.id,
      pass: ok,
      top_ids,
      reason_codes,
    });
  }

  const case_count = querySet.cases.length;
  const fail_count = case_count - pass_count;
  const hit_rate = case_count === 0 ? 0 : pass_count / case_count;
  const pass = case_count > 0 && hit_rate >= hit_rate_min;

  return {
    schema: "carpeos.agentic.graphrag-eval/v1",
    pass,
    case_count,
    pass_count,
    fail_count,
    hit_rate,
    hit_rate_min,
    cases: caseResults,
    reason_codes: pass ? ["graphrag_query_set_pass"] : ["graphrag_query_set_fail"],
  };
}
