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

export type DiversityOptions = {
  /** Soft max items per chunk_kind in the selected window. Defaults to ceil(limit/2). */
  maxPerChunkKind?: number;
  /** Jaccard token similarity above which a later candidate is deferred. */
  nearDuplicateThreshold?: number;
};

/**
 * Quantile-style diversity selection over a score-ranked list.
 * Preserves determinism: walks ranked order, admits when kind/diversity caps allow,
 * then fills remainder from deferred candidates.
 */
export function selectWithDiversity(
  ranked: readonly RankedCandidate[],
  limit: number,
  options: DiversityOptions = {},
): RankedCandidate[] {
  if (limit <= 0 || ranked.length === 0) {
    return [];
  }
  const maxPerChunkKind = options.maxPerChunkKind ?? Math.max(1, Math.ceil(limit / 2));
  const nearDuplicateThreshold = options.nearDuplicateThreshold ?? 0.9;
  const selected: RankedCandidate[] = [];
  const deferred: RankedCandidate[] = [];
  const kindCounts = new Map<string, number>();

  for (const candidate of ranked) {
    if (selected.length >= limit) {
      break;
    }
    const kind = candidate.chunk.chunk_kind;
    const kindCount = kindCounts.get(kind) ?? 0;
    if (kindCount >= maxPerChunkKind) {
      deferred.push(candidate);
      continue;
    }
    if (isNearDuplicate(candidate, selected, nearDuplicateThreshold)) {
      deferred.push(candidate);
      continue;
    }
    selected.push(candidate);
    kindCounts.set(kind, kindCount + 1);
  }

  for (const candidate of deferred) {
    if (selected.length >= limit) {
      break;
    }
    if (isNearDuplicate(candidate, selected, nearDuplicateThreshold)) {
      continue;
    }
    selected.push(candidate);
  }

  return selected;
}

function isNearDuplicate(
  candidate: RankedCandidate,
  selected: readonly RankedCandidate[],
  threshold: number,
): boolean {
  const candidateTokens = new Set(tokenize(candidate.chunk.text));
  for (const prior of selected) {
    const priorTokens = new Set(tokenize(prior.chunk.text));
    if (jaccard(candidateTokens, priorTokens) >= threshold) {
      return true;
    }
  }
  return false;
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 && right.size === 0) {
    return 1;
  }
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
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
