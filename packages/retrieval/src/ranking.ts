import type { RetrievalChunk, RetrievalScore } from "@carpeos/schema";
import { deterministicLocalDevEmbedding } from "./deterministic-local-dev.js";

export type RankWeights = {
  structured: number;
  fts: number;
  semantic: number;
  recency: number;
};

export type RetrievalCandidate = {
  chunk: RetrievalChunk;
  structured_score: number;
  fts_score: number;
  semantic_score: number;
  recency_score: number;
};

export type RankedCandidate = RetrievalCandidate & {
  score: RetrievalScore;
};

export type Vector = readonly number[];

export function rankHybrid(
  candidates: readonly RetrievalCandidate[],
  weights: RankWeights,
): RankedCandidate[] {
  return candidates
    .map((candidate) => {
      const score = scoreCandidate(candidate, weights);
      return { ...candidate, score };
    })
    .sort(compareRankedCandidates);
}

export function scoreCandidate(
  candidate: RetrievalCandidate,
  weights: RankWeights,
): RetrievalScore {
  const structured = candidate.structured_score * weights.structured;
  const fts = candidate.fts_score * weights.fts;
  const semantic = candidate.semantic_score * weights.semantic;
  const recency = candidate.recency_score * weights.recency;
  return {
    structured,
    fts,
    semantic,
    recency,
    total: structured + fts + semantic + recency,
  };
}

export function scoreFts(query: string, text: string): number {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) {
    return 0;
  }
  const textTerms = new Set(tokenize(text));
  const matches = queryTerms.filter((term) => textTerms.has(term)).length;
  return matches / queryTerms.length;
}

export function scoreStructured(query: string, chunk: RetrievalChunk): number {
  const queryTerms = new Set(tokenize(query));
  const haystack = tokenize(
    `${chunk.chunk_kind} ${chunk.lifecycle_status} ${chunk.epistemic_authority}`,
  );
  const matches = haystack.filter((term) => queryTerms.has(term)).length;
  return Math.min(1, matches / Math.max(1, queryTerms.size));
}

export function scoreRecency(chunk: RetrievalChunk, newestEpochMs: number): number {
  const created = Date.parse(chunk.created_at);
  if (!Number.isFinite(created) || !Number.isFinite(newestEpochMs)) {
    return 0;
  }
  const ageDays = Math.max(0, (newestEpochMs - created) / 86_400_000);
  return 1 / (1 + ageDays);
}

export function cosineSimilarity(left: Vector, right: Vector): number {
  if (left.length !== right.length || left.length === 0) {
    throw new Error("vectors must have the same non-zero dimension");
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function fakeVector(text: string): number[] {
  return deterministicLocalDevEmbedding(text);
}

export function compareRankedCandidates(left: RankedCandidate, right: RankedCandidate): number {
  return (
    right.score.total - left.score.total ||
    right.score.semantic - left.score.semantic ||
    right.score.fts - left.score.fts ||
    right.chunk.created_at.localeCompare(left.chunk.created_at) ||
    maxZoneSequence(right.chunk) - maxZoneSequence(left.chunk) ||
    left.chunk.chunk_id.localeCompare(right.chunk.chunk_id)
  );
}

export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function maxZoneSequence(chunk: RetrievalChunk): number {
  return Math.max(...chunk.source_records.map((record) => record.zone_sequence));
}
