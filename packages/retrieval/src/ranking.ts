import type { RetrievalChunk, RetrievalScore } from "@carpeos/schema";
import { deterministicLocalDevEmbedding } from "./deterministic-local-dev.js";

export type RankWeights = {
  structured: number;
  fts: number;
  semantic: number;
  recency: number;
};

/**
 * Product 1.0: Observation (summary), Claim, Decision rank above evidence metadata.
 * Values are 0–1 and fold into hybrid structured boost + sort tie-break.
 */
export const CHUNK_KIND_PRIORITY: Readonly<Record<string, number>> = {
  claim: 1,
  decision: 0.95,
  summary: 0.9,
  open_loop: 0.7,
  evidence_excerpt: 0.2,
};

export function isMeaningfulChunkKind(kind: string): boolean {
  return kind === "claim" || kind === "decision" || kind === "summary" || kind === "open_loop";
}

export function chunkKindPriority(kind: string): number {
  return CHUNK_KIND_PRIORITY[kind] ?? 0.5;
}

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
  options: { boostWorktreeId?: string } = {},
): RankedCandidate[] {
  return candidates
    .map((candidate) => {
      const score = scoreCandidate(candidate, weights, options);
      return { ...candidate, score };
    })
    .sort(compareRankedCandidates);
}

export type DiversityOptions = {
  /** Soft max items per chunk_kind in the selected window. Defaults to ceil(limit/2). */
  maxPerChunkKind?: number;
  /** Jaccard token similarity above which a later candidate is deferred. */
  nearDuplicateThreshold?: number;
  /**
   * Prefer claim/summary/decision over evidence_excerpt when filling the limit.
   * Product default true (meaningful units first-class).
   */
  preferMeaningfulFirst?: boolean;
};

/**
 * Quantile-style diversity selection over a score-ranked list.
 * Preserves determinism: walks ranked order, admits when kind/diversity caps allow,
 * then fills remainder from deferred candidates.
 * With preferMeaningfulFirst (default), meaningful kinds fill before evidence_excerpt.
 */
export function selectWithDiversity(
  ranked: readonly RankedCandidate[],
  limit: number,
  options: DiversityOptions = {},
): RankedCandidate[] {
  if (limit <= 0 || ranked.length === 0) {
    return [];
  }
  const preferMeaningfulFirst = options.preferMeaningfulFirst !== false;
  if (!preferMeaningfulFirst) {
    return selectWithDiversityCore(ranked, limit, options);
  }
  const meaningful = ranked.filter((candidate) =>
    isMeaningfulChunkKind(candidate.chunk.chunk_kind),
  );
  const secondary = ranked.filter(
    (candidate) => !isMeaningfulChunkKind(candidate.chunk.chunk_kind),
  );
  const primary = selectWithDiversityCore(meaningful, limit, options);
  if (primary.length >= limit) {
    return primary;
  }
  return [...primary, ...selectWithDiversityCore(secondary, limit - primary.length, options)];
}

function selectWithDiversityCore(
  ranked: readonly RankedCandidate[],
  limit: number,
  options: DiversityOptions,
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

/** Same-worktree results rank higher without hiding sibling checkouts (ADR 0013). */
const WORKTREE_BOOST_FACTOR = 0.25;

export function scoreCandidate(
  candidate: RetrievalCandidate,
  weights: RankWeights,
  options: { boostWorktreeId?: string } = {},
): RetrievalScore {
  // Fold kind priority into structured so schema score shape stays unchanged.
  const kindBoost =
    chunkKindPriority(candidate.chunk.chunk_kind) * Math.max(weights.structured, 0) * 0.4;
  const worktreeBoost =
    options.boostWorktreeId !== undefined &&
    candidate.chunk.origin?.worktree_id === options.boostWorktreeId
      ? Math.max(weights.structured, 0) * WORKTREE_BOOST_FACTOR
      : 0;
  const structured = candidate.structured_score * weights.structured + kindBoost + worktreeBoost;
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
    chunkKindPriority(right.chunk.chunk_kind) - chunkKindPriority(left.chunk.chunk_kind) ||
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
