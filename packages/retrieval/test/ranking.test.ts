import { describe, expect, it } from "vitest";
import { buildRetrievalChunk } from "../src/chunks.js";
import { makeRetrievalDerivation } from "../src/provenance.js";
import {
  fakeVector,
  rankHybrid,
  scoreFts,
  scoreStructured,
  cosineSimilarity,
  selectWithDiversity,
  chunkKindPriority,
} from "../src/ranking.js";

const sourceRecords = [
  {
    source_record_kind: "event" as const,
    source_record_id: "evt_claim001",
    trust_zone_id: "tz_local_default",
    zone_sequence: 1,
    source_fingerprint: `sha-256:${"1".repeat(64)}`,
    relationship_role: "primary" as const,
    event_type: "Claim" as const,
    lifecycle_status: "active" as const,
    epistemic_authority: "derived" as const,
    valid_time: { start: "2026-01-01T00:00:00Z", end: null },
    recorded_time: { start: "2026-01-01T00:00:00Z", end: null },
  },
];

const derivation = makeRetrievalDerivation({ sourceRecords, config: { test: true } });

describe("retrieval ranking", () => {
  it("scores structured, FTS, and semantic signals deterministically", () => {
    const accepted = buildRetrievalChunk({
      chunkKind: "claim",
      text: "Example Alpha deterministic accepted retrieval",
      sourceRecords,
      derivation,
    });

    expect(scoreFts("deterministic accepted", accepted.text)).toBe(1);
    expect(scoreStructured("claim active", accepted)).toBeGreaterThan(0);
    expect(cosineSimilarity(fakeVector("alpha beta"), fakeVector("alpha beta"))).toBeCloseTo(1);
  });

  it("applies deterministic hybrid tie-breaks", () => {
    const chunks = [
      buildRetrievalChunk({
        chunkKind: "claim",
        text: "Example Alpha retrieval",
        sourceRecords,
        derivation,
        createdAt: "2026-01-01T00:00:00Z",
      }),
      buildRetrievalChunk({
        chunkKind: "claim",
        text: "Example Beta retrieval",
        sourceRecords,
        derivation,
        chunkIndex: 1,
        createdAt: "2026-01-01T00:00:00Z",
      }),
    ];
    const ranked = rankHybrid(
      chunks.slice(0, 2).map((chunk) => ({
        chunk,
        structured_score: 1,
        fts_score: 1,
        semantic_score: 1,
        recency_score: 1,
      })),
      { structured: 1, fts: 1, semantic: 1, recency: 1 },
    );

    expect(ranked.map((candidate) => candidate.chunk.chunk_id)).toEqual(
      [...ranked.map((candidate) => candidate.chunk.chunk_id)].sort(),
    );
  });

  it("ranks Observation (summary) above equal-score evidence_excerpt", () => {
    const observation = buildRetrievalChunk({
      chunkKind: "summary",
      text: "Captured codex SessionEnd evidence (transcript, application/json) for subject_alpha.",
      sourceRecords: [
        {
          ...sourceRecords[0]!,
          event_type: "Observation",
          source_record_id: "evt_obs_alpha",
          epistemic_authority: "observed",
        },
      ],
      derivation,
      createdAt: "2026-01-01T00:00:00Z",
    });
    const evidence = buildRetrievalChunk({
      chunkKind: "evidence_excerpt",
      text: "EvidenceArtifact kind=transcript media_type=application/json artifact_id=art_x subject_ref=subject_alpha event_id=evt_evi",
      sourceRecords: [
        {
          ...sourceRecords[0]!,
          event_type: "EvidenceArtifact",
          source_record_id: "evt_evi_alpha",
          epistemic_authority: "imported",
        },
      ],
      derivation,
      chunkIndex: 1,
      createdAt: "2026-01-01T00:00:01Z",
    });
    expect(chunkKindPriority("summary")).toBeGreaterThan(chunkKindPriority("evidence_excerpt"));
    const ranked = rankHybrid(
      [
        {
          chunk: evidence,
          structured_score: 0.2,
          fts_score: 0.8,
          semantic_score: 0.5,
          recency_score: 1,
        },
        {
          chunk: observation,
          structured_score: 0.2,
          fts_score: 0.8,
          semantic_score: 0.5,
          recency_score: 0.5,
        },
      ],
      { structured: 1, fts: 1, semantic: 1, recency: 0.1 },
    );
    expect(ranked[0]?.chunk.chunk_kind).toBe("summary");
    expect(ranked[1]?.chunk.chunk_kind).toBe("evidence_excerpt");

    const selected = selectWithDiversity(ranked, 1);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.chunk.chunk_kind).toBe("summary");
  });

  it("selects with chunk_kind diversity instead of pure score monopoly", () => {
    const claimA = buildRetrievalChunk({
      chunkKind: "claim",
      text: "claim alpha unique wording",
      sourceRecords,
      derivation,
      createdAt: "2026-01-01T00:00:00Z",
    });
    const claimB = buildRetrievalChunk({
      chunkKind: "claim",
      text: "claim beta distinct text",
      sourceRecords,
      derivation,
      chunkIndex: 1,
      createdAt: "2026-01-01T00:00:01Z",
    });
    const decision = buildRetrievalChunk({
      chunkKind: "decision",
      text: "decision gamma different content",
      sourceRecords: [
        {
          ...sourceRecords[0]!,
          event_type: "AcceptanceDecision",
          source_record_id: "evt_decision_gamma_000000000001",
          zone_sequence: 2,
        },
      ],
      derivation,
      chunkIndex: 2,
      createdAt: "2026-01-01T00:00:02Z",
    });
    const ranked = rankHybrid(
      [
        {
          chunk: claimA,
          structured_score: 1,
          fts_score: 1,
          semantic_score: 1,
          recency_score: 1,
        },
        {
          chunk: claimB,
          structured_score: 0.9,
          fts_score: 0.9,
          semantic_score: 0.9,
          recency_score: 0.9,
        },
        {
          chunk: decision,
          structured_score: 0.5,
          fts_score: 0.5,
          semantic_score: 0.5,
          recency_score: 0.5,
        },
      ],
      { structured: 1, fts: 1, semantic: 1, recency: 1 },
    );
    const selected = selectWithDiversity(ranked, 2, { maxPerChunkKind: 1 });
    const kinds = selected.map((item) => item.chunk.chunk_kind).sort();
    expect(kinds).toEqual(["claim", "decision"]);
  });
});

describe("worktree ranking boost", () => {
  it("ranks the current worktree higher without hiding sibling checkouts", () => {
    const makeCandidate = (label: string, worktreeId: string) => {
      const chunk = {
        ...buildRetrievalChunk({
          chunkKind: "claim" as const,
          text: `Synthetic decision ${label}`,
          sourceRecords,
          derivation: makeRetrievalDerivation({ sourceRecords, config: {} }),
        }),
        origin: { project_id: "project_alpha", worktree_id: worktreeId },
      };
      return {
        chunk,
        structured_score: 0.5,
        fts_score: 0.5,
        semantic_score: 0.5,
        recency_score: 0.5,
        label,
      };
    };

    const current = `wt_${"a".repeat(24)}`;
    const sibling = `wt_${"b".repeat(24)}`;
    const siblingCandidate = makeCandidate("sibling", sibling);
    const currentCandidate = makeCandidate("current", current);
    const candidates = [siblingCandidate, currentCandidate];
    const weights = { structured: 1, fts: 1, semantic: 1, recency: 0.1 };

    const boosted = rankHybrid(candidates, weights, { boostWorktreeId: current });
    expect(boosted[0]?.chunk.origin?.worktree_id).toBe(current);
    // The sibling checkout stays retrievable; only its rank changes.
    expect(boosted.map((item) => item.chunk.origin?.worktree_id)).toContain(sibling);

    const unboosted = rankHybrid(candidates, weights);
    const currentScore = unboosted.find((item) => item.chunk.origin?.worktree_id === current)?.score
      .total;
    const boostedScore = boosted.find((item) => item.chunk.origin?.worktree_id === current)?.score
      .total;
    expect(boostedScore ?? 0).toBeGreaterThan(currentScore ?? 0);
  });
});

describe("graph-aware ranking", () => {
  it("boosts nearer graph neighbors without hiding distant candidates", () => {
    const near = {
      chunk: {
        ...buildRetrievalChunk({
          chunkKind: "claim" as const,
          text: "Synthetic near neighbor decision",
          sourceRecords,
          derivation: makeRetrievalDerivation({ sourceRecords, config: {} }),
        }),
        chunk_id: "chk_near",
      },
      structured_score: 0.4,
      fts_score: 0.4,
      semantic_score: 0.4,
      recency_score: 0.4,
    };
    const far = {
      chunk: {
        ...buildRetrievalChunk({
          chunkKind: "claim" as const,
          text: "Synthetic far neighbor decision",
          sourceRecords,
          derivation: makeRetrievalDerivation({ sourceRecords, config: {} }),
        }),
        chunk_id: "chk_far",
      },
      structured_score: 0.4,
      fts_score: 0.4,
      semantic_score: 0.4,
      recency_score: 0.4,
    };
    const weights = { structured: 1, fts: 1, semantic: 1, recency: 0.1 };
    const proximity = new Map<string, number>([
      [near.chunk.chunk_id, 0],
      [far.chunk.chunk_id, 2],
    ]);
    const ranked = rankHybrid([far, near], weights, { graphProximity: proximity });
    expect(ranked[0]?.chunk.chunk_id).toBe(near.chunk.chunk_id);
    expect(ranked.map((item) => item.chunk.chunk_id)).toContain(far.chunk.chunk_id);
  });
});
