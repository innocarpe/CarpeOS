import {
  type CanonicalEvent,
  type ProvenanceRef,
  type TrustZone,
  validateConformance,
} from "@carpeos/schema";
import { describe, expect, it } from "vitest";
import { buildMeaningfulChunks, buildRetrievalChunk, normalizeChunkText } from "../src/chunks.js";
import {
  eventSourceRecord,
  makeInputManifestDigest,
  makeRetrievalDerivation,
  normalizeSourceRecords,
} from "../src/provenance.js";

const trustZone: TrustZone = {
  trust_zone_id: "tz_local_default",
  isolation: "local_device",
};

const baseEvent = {
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
  ...baseEvent,
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
  ...baseEvent,
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
  ...baseEvent,
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
  ...baseEvent,
  event_id: "evt_super001",
  event_type: "Supersession",
  recorded_time: { start: "2026-01-01T00:04:00Z", end: null },
  epistemic_authority: "verified",
  request_fingerprint: `sha-256:${"5".repeat(64)}`,
  zone_sequence: 5,
  payload: {
    supersession_id: "sup_alpha",
    supersedes_event_id: "evt_claim001",
    reason: "Synthetic replacement.",
  },
};

const events = [observation, claimAccepted, acceptedDecision, supersession];

describe("retrieval chunk construction", () => {
  it("sorts and deduplicates source records while preserving one-source chunks", () => {
    const primary = eventSourceRecord(claimAccepted, "primary");
    const normalized = normalizeSourceRecords([primary, primary]);

    expect(normalized).toEqual([primary]);
    expect(makeInputManifestDigest([primary])).toMatch(/^sha-256:[a-f0-9]{64}$/);

    const derivation = makeRetrievalDerivation({
      sourceRecords: normalized,
      config: { test: true },
    });
    const chunk = buildRetrievalChunk({
      chunkKind: "claim",
      text: claimAccepted.payload.statement,
      sourceRecords: normalized,
      derivation,
    });

    expect(chunk.chunk_id).toMatch(/^chk_[a-f0-9]{40}$/);
    expect(validateConformance("retrievalProjection", chunk)).toEqual({ valid: true, errors: [] });
  });

  it("derives deterministic chunk IDs from manifest, derivation, and chunk metadata", () => {
    const sourceRecords = [eventSourceRecord(claimAccepted, "primary")];
    const derivation = makeRetrievalDerivation({ sourceRecords, config: { mode: "same" } });
    const first = buildRetrievalChunk({
      chunkKind: "claim",
      text: claimAccepted.payload.statement,
      sourceRecords,
      derivation,
    });
    const second = buildRetrievalChunk({
      chunkKind: "claim",
      text: claimAccepted.payload.statement,
      sourceRecords: [...sourceRecords].reverse(),
      derivation,
    });
    const changed = buildRetrievalChunk({
      chunkKind: "claim",
      text: `${claimAccepted.payload.statement} changed`,
      sourceRecords,
      derivation,
    });

    expect(second.chunk_id).toBe(first.chunk_id);
    expect(changed.chunk_id).not.toBe(first.chunk_id);
  });

  it("builds meaningful multi-source chunks and excludes protected raw payload text", () => {
    const chunks = buildMeaningfulChunks({ events, createdAt: "2026-01-01T00:08:00Z" });
    const claimChunk = chunks.find((chunk) => chunk.text.includes("accepted"));

    expect(claimChunk?.source_records.map((record) => record.relationship_role)).toEqual([
      "support",
      "primary",
      "acceptance",
      "supersession",
    ]);
    expect(() => normalizeChunkText("raw_payload transcript_secret")).toThrow(/protected raw/);
    expect(chunks.every((chunk) => !chunk.text.includes("raw_payload"))).toBe(true);
  });

  it("projects EvidenceArtifact as metadata-only evidence_excerpt chunks", () => {
    const evidence: CanonicalEvent<"EvidenceArtifact"> = {
      ...baseEvent,
      event_id: "evt_evidence001",
      event_type: "EvidenceArtifact",
      recorded_time: { start: "2026-01-01T00:00:30Z", end: null },
      epistemic_authority: "imported",
      request_fingerprint: `sha-256:${"1".repeat(64)}`,
      zone_sequence: 1,
      payload: {
        artifact_id: "art_evidence001",
        kind: "message",
        media_type: "application/json",
        content_ref: {
          ref_type: "protected_value",
          protected_value_id: "pv_synthetic_evidence_001",
          vault_ref: "vault_local",
          key_ref: "key_local",
          encrypted_blob: {
            algorithm: "aes-256-gcm",
            nonce_ref: "nonce_evidence_001",
            tag_ref: "tag_evidence_001",
            digest: { algorithm: "sha-256", value: "a".repeat(64) },
            size_bytes: 32,
          },
        },
      },
    };

    const chunks = buildMeaningfulChunks({
      events: [evidence, ...events],
      createdAt: "2026-01-01T00:08:00Z",
    });
    const evidenceChunk = chunks.find((chunk) => chunk.chunk_kind === "evidence_excerpt");

    expect(evidenceChunk).toBeDefined();
    expect(evidenceChunk?.text).toContain("kind=message");
    expect(evidenceChunk?.text).toContain("artifact_id=art_evidence001");
    expect(evidenceChunk?.text).toContain("event_id=evt_evidence001");
    expect(evidenceChunk?.text).not.toMatch(/ciphertext|plaintext|raw_payload/i);
    expect(evidenceChunk).toBeDefined();
    if (evidenceChunk === undefined) {
      throw new Error("expected evidence_excerpt chunk");
    }
    expect(evidenceChunk.epistemic_authority).toBe("imported");
    expect(evidenceChunk.source_records).toHaveLength(1);
    expect(validateConformance("retrievalProjection", evidenceChunk)).toEqual({
      valid: true,
      errors: [],
    });
  });
});
