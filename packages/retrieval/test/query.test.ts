import type {
  CanonicalEvent,
  ErasureLedgerRecord,
  ProjectionFreshness,
  RetrievalQuery,
  TrustZone,
} from "@carpeos/schema";
import { validateConformance } from "@carpeos/schema";
import { describe, expect, it } from "vitest";
import { buildRetrievalChunk } from "../src/chunks.js";
import { eventSourceRecord, makeRetrievalDerivation } from "../src/provenance.js";
import { recheckCandidate, searchMemory } from "../src/query.js";

const trustZone: TrustZone = { trust_zone_id: "tz_local_default", isolation: "local_device" };
const claimAccepted: CanonicalEvent<"Claim"> = {
  schema_version: "v1",
  event_id: "evt_claim001",
  event_type: "Claim",
  subject_ref: "subject_alpha",
  valid_time: { start: "2026-01-01T00:00:00Z", end: null },
  recorded_time: { start: "2026-01-01T00:02:00Z", end: null },
  lifecycle_status: "active",
  epistemic_authority: "derived",
  trust_zone: trustZone,
  provenance: [{ ref_type: "external", ref_id: "external_fixture", relationship: "derived_from" }],
  idempotency_key: "idem_claim001",
  request_fingerprint: `sha-256:${"3".repeat(64)}`,
  zone_sequence: 3,
  payload: {
    claim_id: "claim_alpha",
    statement: "Example Alpha retrieval is deterministic and accepted.",
    claim_type: "inference",
    support: [{ ref_type: "external", ref_id: "external_fixture", relationship: "supports" }],
  },
};
const events = [claimAccepted];
const replacementClaim: CanonicalEvent<"Claim"> = {
  ...claimAccepted,
  event_id: "evt_claim002",
  idempotency_key: "idem_claim002",
  request_fingerprint: `sha-256:${"4".repeat(64)}`,
  zone_sequence: 4,
  payload: {
    claim_id: "claim_beta",
    statement: "Example Beta retrieval replaces Example Alpha.",
    claim_type: "inference",
    support: [{ ref_type: "external", ref_id: "external_fixture", relationship: "supports" }],
  },
};
const supersession: CanonicalEvent<"Supersession"> = {
  ...claimAccepted,
  event_id: "evt_super001",
  event_type: "Supersession",
  idempotency_key: "idem_super001",
  request_fingerprint: `sha-256:${"5".repeat(64)}`,
  zone_sequence: 5,
  epistemic_authority: "verified",
  payload: {
    supersession_id: "sup_alpha",
    supersedes_event_id: "evt_claim001",
    replacement_event_id: "evt_claim002",
    reason: "Synthetic replacement.",
  },
};
const freshProjection: ProjectionFreshness = {
  schema_version: "v1",
  record_type: "projection_freshness",
  projection_name: "retrieval_projection",
  projection_version: "retrieval/v1",
  trust_zone_id: "tz_local_default",
  last_indexed_zone_sequence: 3,
  sync_cursor_after_sequence: 3,
  stale: false,
  checked_at: "2026-01-01T00:03:00Z",
};
const query: RetrievalQuery = {
  schema_version: "v1",
  record_type: "retrieval_query",
  query_id: `query_${"a".repeat(24)}`,
  query_text: "Example Alpha",
  filters: {
    visible_trust_zone_ids: ["tz_local_default"],
    lifecycle_status: ["active"],
    epistemic_authority: ["derived"],
    protected_value_policy: "metadata_only",
    conflict_policy: "surface_conflicts",
  },
  ranking: { mode: "hybrid", weights: { structured: 1, fts: 1, semantic: 1, recency: 1 } },
  limit: 10,
};
const projectionDelete: ErasureLedgerRecord = {
  schema_version: "v1",
  erasure_id: "era_projection001",
  target_ref: { target_kind: "projection", target_id: "retrieval/v1" },
  requested_at: "2026-01-01T00:04:00Z",
  completed_at: "2026-01-01T00:05:00Z",
  method: "projection_delete",
  actor_ref: "actor_operator",
  trust_zone: trustZone,
  zone_sequence: 4,
  evidence_refs: [{ ref_type: "event", ref_id: "evt_claim001", relationship: "redacts" }],
};

describe("canonical recheck", () => {
  it("returns visible text only after trust-zone, lifecycle, authority, and freshness checks", () => {
    const sourceRecords = [eventSourceRecord(claimAccepted, "primary")];
    const chunk = buildRetrievalChunk({
      chunkKind: "claim",
      text: claimAccepted.payload.statement,
      sourceRecords,
      derivation: makeRetrievalDerivation({ sourceRecords, config: {} }),
    });
    const result = recheckCandidate({
      chunk,
      score: { total: 1, structured: 1, fts: 0, semantic: 0, recency: 0 },
      filters: query.filters,
      events,
      erasures: [],
      freshness: [freshProjection],
    });

    expect(result.status).toBe("visible");
    if (result.status !== "visible") {
      throw new Error("expected visible result");
    }
    expect(result.text).toBe(claimAccepted.payload.statement);
  });

  it("scopes by project and worktree origin without excluding unknown origin", () => {
    const sourceRecords = [eventSourceRecord(claimAccepted, "primary")];
    const base = {
      chunkKind: "claim" as const,
      text: claimAccepted.payload.statement,
      sourceRecords,
      derivation: makeRetrievalDerivation({ sourceRecords, config: {} }),
    };
    const scored = { total: 1, structured: 1, fts: 0, semantic: 0, recency: 0 };
    const common = {
      score: scored,
      events,
      erasures: [],
      freshness: [freshProjection],
    };

    const owned = {
      ...buildRetrievalChunk(base),
      origin: {
        project_id: "project_alpha",
        worktree_id: `wt_${"a".repeat(24)}`,
        worktree_name: "alpha-main",
      },
    };
    const foreign = {
      ...buildRetrievalChunk(base),
      origin: {
        project_id: "project_beta",
        worktree_id: `wt_${"b".repeat(24)}`,
        worktree_name: "beta-main",
      },
    };
    // Captured before the identity migration: origin is unknown.
    const legacy = buildRetrievalChunk(base);

    const projectScoped = { ...query.filters, project_ids: ["project_alpha"] };
    expect(recheckCandidate({ ...common, chunk: owned, filters: projectScoped }).status).toBe(
      "visible",
    );
    expect(recheckCandidate({ ...common, chunk: foreign, filters: projectScoped }).status).toBe(
      "excluded",
    );
    // Unknown origin must stay retrievable rather than silently disappearing.
    expect(recheckCandidate({ ...common, chunk: legacy, filters: projectScoped }).status).toBe(
      "visible",
    );

    const worktreeScoped = { ...query.filters, worktree_ids: [`wt_${"a".repeat(24)}`] };
    expect(recheckCandidate({ ...common, chunk: owned, filters: worktreeScoped }).status).toBe(
      "visible",
    );
    expect(recheckCandidate({ ...common, chunk: foreign, filters: worktreeScoped }).status).toBe(
      "excluded",
    );
    expect(recheckCandidate({ ...common, chunk: legacy, filters: worktreeScoped }).status).toBe(
      "visible",
    );
  });

  it("excludes invisible trust zones, stale projections, and projection deletes", () => {
    const sourceRecords = [eventSourceRecord(claimAccepted, "primary")];
    const chunk = buildRetrievalChunk({
      chunkKind: "claim",
      text: claimAccepted.payload.statement,
      sourceRecords,
      derivation: makeRetrievalDerivation({ sourceRecords, config: {} }),
    });
    const invisible = recheckCandidate({
      chunk,
      score: { total: 1, structured: 1, fts: 0, semantic: 0, recency: 0 },
      filters: { ...query.filters, visible_trust_zone_ids: ["tz_other_zone"] },
      events,
      erasures: [],
      freshness: [freshProjection],
    });
    const stale = recheckCandidate({
      chunk,
      score: { total: 1, structured: 1, fts: 0, semantic: 0, recency: 0 },
      filters: query.filters,
      events,
      erasures: [],
      freshness: [{ ...freshProjection, stale: true, reason: "behind_sync_cursor" }],
    });
    const erased = recheckCandidate({
      chunk,
      score: { total: 1, structured: 1, fts: 0, semantic: 0, recency: 0 },
      filters: query.filters,
      events,
      erasures: [projectionDelete],
      freshness: [freshProjection],
    });

    expect(invisible).toMatchObject({ status: "excluded", reason: "trust zone not visible" });
    expect(stale).toMatchObject({
      status: "excluded",
      reason: "projection stale: behind_sync_cursor",
    });
    expect(erased).toMatchObject({ status: "excluded", reason: "erasure applies" });
  });

  it("uses canonical source metadata instead of stale projected chunk metadata", () => {
    const sourceRecords = [eventSourceRecord(claimAccepted, "primary")];
    const chunk = buildRetrievalChunk({
      chunkKind: "claim",
      text: claimAccepted.payload.statement,
      sourceRecords,
      derivation: makeRetrievalDerivation({ sourceRecords, config: {} }),
    });
    const staleProjectedChunk = {
      ...chunk,
      lifecycle_status: "draft" as const,
      epistemic_authority: "verified" as const,
      source_records: chunk.source_records.map((record) => ({
        ...record,
        lifecycle_status: "draft" as const,
        epistemic_authority: "verified" as const,
      })),
    };

    const result = searchMemory({
      query,
      chunks: [staleProjectedChunk],
      events,
      erasures: [],
      freshness: [freshProjection],
    });

    expect(validateConformance("retrievalProjection", result)).toEqual({ valid: true, errors: [] });
    expect(result.results[0]).toMatchObject({
      status: "visible",
      text: claimAccepted.payload.statement,
    });
    expect(result.results[0]?.lineage.source_records[0]).toMatchObject({
      lifecycle_status: "active",
      epistemic_authority: "derived",
    });
  });

  it("fails closed when a projected source record has no canonical source", () => {
    const sourceRecords = [eventSourceRecord(claimAccepted, "primary")];
    const chunk = buildRetrievalChunk({
      chunkKind: "claim",
      text: claimAccepted.payload.statement,
      sourceRecords,
      derivation: makeRetrievalDerivation({ sourceRecords, config: {} }),
    });

    const result = searchMemory({
      query,
      chunks: [chunk],
      events: [],
      erasures: [],
      freshness: [freshProjection],
    });

    expect(validateConformance("retrievalProjection", result)).toEqual({ valid: true, errors: [] });
    expect(result.results[0]).toMatchObject({
      status: "excluded",
      reason: "canonical source missing",
    });
  });

  it("excludes superseded source chunks and surfaces replacement lineage", () => {
    const sourceRecords = [eventSourceRecord(claimAccepted, "primary")];
    const chunk = buildRetrievalChunk({
      chunkKind: "claim",
      text: claimAccepted.payload.statement,
      sourceRecords,
      derivation: makeRetrievalDerivation({ sourceRecords, config: {} }),
    });

    const result = searchMemory({
      query: {
        ...query,
        filters: { ...query.filters, epistemic_authority: ["derived", "verified"] },
      },
      chunks: [chunk],
      events: [claimAccepted, replacementClaim, supersession],
      erasures: [],
      freshness: [freshProjection],
    });

    expect(validateConformance("retrievalProjection", result)).toEqual({ valid: true, errors: [] });
    expect(result.results[0]).toMatchObject({
      status: "excluded",
      reason: "source superseded",
    });
    expect(result.results[0]?.lineage.supersession_event_ids).toEqual(["evt_super001"]);
    expect(
      result.results[0]?.lineage.source_records.map((record) => record.source_record_id),
    ).toContain("evt_claim002");
  });
});
