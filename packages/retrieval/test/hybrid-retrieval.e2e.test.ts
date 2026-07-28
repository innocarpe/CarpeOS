import {
  validateConformance,
  type CanonicalEvent,
  type ProjectionFreshness,
  type ProvenanceRef,
  type RetrievalQuery,
  type TrustZone,
} from "@carpeos/schema";
import { describe, expect, it } from "vitest";
import { buildMeaningfulChunks } from "../src/chunks.js";
import { fakeVector, cosineSimilarity } from "../src/ranking.js";
import { searchMemory } from "../src/query.js";

const trustZone: TrustZone = { trust_zone_id: "tz_local_default", isolation: "local_device" };
const base = {
  schema_version: "v1",
  subject_ref: "subject_alpha",
  valid_time: { start: "2026-01-01T00:00:00Z", end: null },
  lifecycle_status: "active",
  trust_zone: trustZone,
  provenance: [
    { ref_type: "external", ref_id: "external_fixture", relationship: "derived_from" },
  ] satisfies ProvenanceRef[],
  idempotency_key: "idem_fixture001",
} as const;
const observation: CanonicalEvent<"Observation"> = {
  ...base,
  event_id: "evt_observe001",
  event_type: "Observation",
  recorded_time: { start: "2026-01-01T00:01:00Z", end: null },
  epistemic_authority: "observed",
  request_fingerprint: `sha-256:${"2".repeat(64)}`,
  zone_sequence: 2,
  payload: {
    observation_id: "obs_alpha",
    observed_at: "2026-01-01T00:01:00Z",
    statement: "Example Alpha uses a deterministic retrieval queue.",
    evidence_artifact_refs: ["art_evidence001"],
  },
};
const claimAccepted: CanonicalEvent<"Claim"> = {
  ...base,
  event_id: "evt_claim001",
  event_type: "Claim",
  recorded_time: { start: "2026-01-01T00:02:00Z", end: null },
  epistemic_authority: "derived",
  request_fingerprint: `sha-256:${"3".repeat(64)}`,
  zone_sequence: 3,
  payload: {
    claim_id: "claim_alpha",
    statement: "Example Alpha retrieval is deterministic and accepted.",
    claim_type: "inference",
    support: [{ ref_type: "observation", ref_id: "obs_alpha", relationship: "supports" }],
  },
};
const acceptedDecision: CanonicalEvent<"AcceptanceDecision"> = {
  ...base,
  event_id: "evt_decision001",
  event_type: "AcceptanceDecision",
  recorded_time: { start: "2026-01-01T00:03:00Z", end: null },
  epistemic_authority: "verified",
  request_fingerprint: `sha-256:${"4".repeat(64)}`,
  zone_sequence: 4,
  payload: {
    decision_id: "decision_alpha",
    claim_refs: ["claim_alpha"],
    decision: "accepted",
    decided_by: "actor_reviewer",
    decided_at: "2026-01-01T00:03:00Z",
  },
};
const supersession: CanonicalEvent<"Supersession"> = {
  ...base,
  event_id: "evt_super001",
  event_type: "Supersession",
  recorded_time: { start: "2026-01-01T00:04:00Z", end: null },
  epistemic_authority: "verified",
  request_fingerprint: `sha-256:${"5".repeat(64)}`,
  zone_sequence: 5,
  payload: {
    supersession_id: "sup_alpha",
    supersedes_event_id: "evt_claim001",
    replacement_event_id: "evt_claim002",
    reason: "Synthetic replacement.",
  },
};
const claimRejected: CanonicalEvent<"Claim"> = {
  ...base,
  event_id: "evt_claim002",
  event_type: "Claim",
  recorded_time: { start: "2026-01-01T00:05:00Z", end: null },
  epistemic_authority: "derived",
  request_fingerprint: `sha-256:${"6".repeat(64)}`,
  zone_sequence: 6,
  payload: {
    claim_id: "claim_beta",
    statement: "Example Beta retrieval should retain rejected lineage.",
    claim_type: "inference",
    support: [{ ref_type: "observation", ref_id: "obs_alpha", relationship: "supports" }],
  },
};
const rejectedDecision: CanonicalEvent<"AcceptanceDecision"> = {
  ...base,
  event_id: "evt_decision002",
  event_type: "AcceptanceDecision",
  recorded_time: { start: "2026-01-01T00:06:00Z", end: null },
  epistemic_authority: "verified",
  request_fingerprint: `sha-256:${"7".repeat(64)}`,
  zone_sequence: 7,
  payload: {
    decision_id: "decision_beta",
    claim_refs: ["claim_beta"],
    decision: "rejected",
    decided_by: "actor_reviewer",
    decided_at: "2026-01-01T00:06:00Z",
  },
};
const events = [
  observation,
  claimAccepted,
  acceptedDecision,
  supersession,
  claimRejected,
  rejectedDecision,
];
const freshProjection: ProjectionFreshness = {
  schema_version: "v1",
  record_type: "projection_freshness",
  projection_name: "retrieval_projection",
  projection_version: "retrieval/v1",
  trust_zone_id: "tz_local_default",
  last_indexed_zone_sequence: 7,
  sync_cursor_after_sequence: 7,
  stale: false,
  checked_at: "2026-01-01T00:07:00Z",
};
const query: RetrievalQuery = {
  schema_version: "v1",
  record_type: "retrieval_query",
  query_id: `query_${"a".repeat(24)}`,
  query_text: "Example Alpha deterministic retrieval accepted",
  filters: {
    visible_trust_zone_ids: ["tz_local_default"],
    lifecycle_status: ["active"],
    epistemic_authority: ["observed", "derived", "verified"],
    protected_value_policy: "metadata_only",
    conflict_policy: "surface_conflicts",
  },
  ranking: { mode: "hybrid", weights: { structured: 0.2, fts: 1, semantic: 1, recency: 0.1 } },
  limit: 10,
};

describe("deterministic hybrid retrieval e2e", () => {
  it("returns deterministic ranking with canonical recheck and supersession lineage", () => {
    const chunks = buildMeaningfulChunks({
      events,
      createdAt: "2026-01-01T00:08:00Z",
    });
    const queryVector = fakeVector(query.query_text);
    const semanticScores = new Map(
      chunks.map((chunk) => [
        chunk.chunk_id,
        cosineSimilarity(queryVector, fakeVector(chunk.text)),
      ]),
    );

    const result = searchMemory({
      query,
      chunks,
      events,
      erasures: [],
      freshness: [freshProjection],
      semanticScores,
    });
    const repeatedResult = searchMemory({
      query,
      chunks,
      events,
      erasures: [],
      freshness: [freshProjection],
      semanticScores,
    });

    expect(validateConformance("retrievalProjection", result)).toEqual({ valid: true, errors: [] });
    expect(result.results[0]).toMatchObject({
      status: "excluded",
      reason: "source superseded",
    });
    expect(result.results[0]?.lineage.accepted_decision_event_ids).toEqual(["evt_decision001"]);
    expect(result.results[0]?.lineage.supersession_event_ids).toEqual(["evt_super001"]);
    expect(
      result.results[0]?.lineage.source_records.map((record) => record.source_record_id),
    ).toContain("evt_claim002");

    const replacementResult = result.results.find(
      (item) => item.status === "visible" && item.text.includes("Example Beta"),
    );
    expect(replacementResult).toMatchObject({
      status: "visible",
      text: "Example Beta retrieval should retain rejected lineage.",
    });
    expect(result.results.map((item) => item.chunk_id)).toEqual(
      repeatedResult.results.map((item) => item.chunk_id),
    );
  });

  it("surfaces rejected lineage without promoting vector hits into authority", () => {
    const chunks = buildMeaningfulChunks({
      events,
      createdAt: "2026-01-01T00:08:00Z",
    });
    const rejectedChunk = chunks.find((chunk) => chunk.text.includes("Beta"));
    if (rejectedChunk === undefined) {
      throw new Error("missing rejected chunk");
    }

    const result = searchMemory({
      query: {
        ...query,
        filters: { ...query.filters, conflict_policy: "surface_conflicts" },
        query_text: "Example Beta retrieval",
      },
      chunks: [rejectedChunk],
      events,
      erasures: [],
      freshness: [freshProjection],
      semanticScores: new Map([[rejectedChunk.chunk_id, 1]]),
    });

    expect(result.results[0]?.status).toBe("visible");
    expect(result.results[0]?.lineage.rejected_decision_event_ids).toEqual(["evt_decision002"]);
  });
});
