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
