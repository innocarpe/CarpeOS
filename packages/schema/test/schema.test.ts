import { describe, expect, it } from "vitest";
import {
  type CanonicalEvent,
  type CryptoShredErasureTargetRef,
  type EmbeddingJob,
  type EmbeddingRecord,
  type ErasureLedgerRecord,
  type MemoryCaptureOutput,
  type MemoryProposeClaimInput,
  type MemoryProposeClaimOutput,
  type ObsidianProjectionManifest,
  type ProjectionFreshness,
  type ProtectedValueMetadata,
  type ProtectedValueUploadIntent,
  type ProtectedValueUploadReceipt,
  type ProjectionDeleteErasureTargetRef,
  type ProvenanceRef,
  type RetrievalChunk,
  type RetrievalProjectionMessage,
  type RetrievalQuery,
  type RetrievalResult,
  type RetrievalSourceRecord,
  type SyncApiMessage,
  type TombstoneErasureTargetRef,
  type TrustZone,
  classifyIdempotency,
  compileSchemaValidators,
  collectBitemporalErrors,
  validateConformance,
} from "../src/index.js";

const digest = {
  algorithm: "sha-256",
  value: "a".repeat(64),
} as const;

const trustZone = {
  trust_zone_id: "tz_local_default",
  isolation: "local_device",
  region: "local",
  boundary_purpose: "single-user encrypted store",
} as const;

const protectedContentRef = {
  ref_type: "protected_value",
  protected_value_id: "pv_synthetic_artifact_001",
  vault_ref: "vault_primary",
  key_ref: "key_active",
  encrypted_blob: {
    algorithm: "aes-256-gcm",
    nonce_ref: "nonce_artifact_001",
    tag_ref: "tag_artifact_001",
    digest,
    size_bytes: 512,
  },
} as const;

const syntheticLineage: ProvenanceRef[] = [
  {
    ref_type: "external",
    ref_id: "external_synthetic_seed",
    relationship: "derived_from",
  },
];

type AssertErasureLedgerRecord<T extends ErasureLedgerRecord> = T;
type CompileTimeErasureBase = {
  schema_version: "v1";
  erasure_id: "era_typecheck";
  requested_at: "2026-01-02T00:00:00Z";
  completed_at: null;
  actor_ref: "actor_operator";
  trust_zone: TrustZone;
  zone_sequence: 1;
  evidence_refs: ProvenanceRef[];
};
type _ValidCryptoShredErasure = AssertErasureLedgerRecord<
  CompileTimeErasureBase & {
    method: "crypto_shred";
    target_ref: CryptoShredErasureTargetRef;
  }
>;
type _ValidProjectionDeleteErasure = AssertErasureLedgerRecord<
  CompileTimeErasureBase & {
    method: "projection_delete";
    target_ref: ProjectionDeleteErasureTargetRef;
  }
>;
type _ValidTombstoneErasure = AssertErasureLedgerRecord<
  CompileTimeErasureBase & {
    method: "tombstone";
    target_ref: TombstoneErasureTargetRef;
  }
>;
type _InvalidCryptoShredEvent = AssertErasureLedgerRecord<
  // @ts-expect-error crypto_shred records can only target protected_value or key.
  CompileTimeErasureBase & {
    method: "crypto_shred";
    target_ref: { target_kind: "event"; target_id: "evt_00000001" };
  }
>;
type _InvalidProjectionDeleteKey = AssertErasureLedgerRecord<
  // @ts-expect-error projection_delete records can only target projections.
  CompileTimeErasureBase & {
    method: "projection_delete";
    target_ref: { target_kind: "key"; target_id: "key_active" };
  }
>;
type _InvalidTombstoneProtectedValue = AssertErasureLedgerRecord<
  // @ts-expect-error tombstone records can only target events or artifacts.
  CompileTimeErasureBase & {
    method: "tombstone";
    target_ref: { target_kind: "protected_value"; target_id: "pv_synthetic_artifact_001" };
  }
>;

function makeBaseEvent(overrides: Record<string, unknown> = {}): CanonicalEvent {
  const event = {
    schema_version: "v1",
    event_id: "evt_00000001",
    event_type: "EvidenceArtifact",
    subject_ref: "subject_alpha",
    valid_time: {
      start: "2026-01-01T00:00:00Z",
      end: null,
    },
    recorded_time: {
      start: "2026-01-01T00:00:01Z",
      end: null,
    },
    lifecycle_status: "active",
    epistemic_authority: "observed",
    trust_zone: trustZone,
    provenance: syntheticLineage,
    idempotency_key: "idem_abcdefghijklmnop",
    request_fingerprint: `sha-256:${"b".repeat(64)}`,
    zone_sequence: 1,
    payload: {
      artifact_id: "art_00000001",
      kind: "document",
      media_type: "text/plain",
      content_ref: protectedContentRef,
      lineage: syntheticLineage,
    },
    ...overrides,
  };

  return event as CanonicalEvent;
}

const eventFixtures: CanonicalEvent[] = [
  makeBaseEvent(),
  makeBaseEvent({
    event_id: "evt_00000002",
    event_type: "Observation",
    payload: {
      observation_id: "obs_00000001",
      observed_at: "2026-01-01T00:01:00Z",
      statement: "A synthetic observation was recorded.",
      evidence_artifact_refs: ["art_00000001"],
      confidence: 0.8,
    },
  }),
  makeBaseEvent({
    event_id: "evt_00000003",
    event_type: "Claim",
    payload: {
      claim_id: "claim_00000001",
      statement: "A synthetic claim follows from the observation.",
      claim_type: "inference",
      support: [{ ref_type: "observation", ref_id: "obs_00000001", relationship: "supports" }],
      confidence: 0.7,
    },
  }),
  makeBaseEvent({
    event_id: "evt_00000004",
    event_type: "AcceptanceDecision",
    lifecycle_status: "draft",
    epistemic_authority: "verified",
    payload: {
      decision_id: "decision_00000001",
      claim_refs: ["claim_00000001"],
      decision: "accepted",
      decided_by: "actor_reviewer",
      decided_at: "2026-01-01T00:02:00Z",
      rationale: "Synthetic acceptance for conformance.",
    },
  }),
  makeBaseEvent({
    event_id: "evt_00000005",
    event_type: "Supersession",
    lifecycle_status: "active",
    epistemic_authority: "verified",
    payload: {
      supersession_id: "sup_00000001",
      supersedes_event_id: "evt_00000003",
      replacement_event_id: "evt_00000006",
      reason: "Synthetic replacement with corrected wording.",
    },
  }),
];

const erasureFixture: ErasureLedgerRecord = {
  schema_version: "v1",
  erasure_id: "era_00000001",
  target_ref: {
    target_kind: "protected_value",
    target_id: "pv_synthetic_artifact_001",
    reason: "Synthetic encrypted content deletion.",
  },
  requested_at: "2026-01-02T00:00:00Z",
  completed_at: "2026-01-02T00:00:05Z",
  method: "crypto_shred",
  actor_ref: "actor_operator",
  trust_zone: trustZone,
  zone_sequence: 1,
  evidence_refs: [{ ref_type: "artifact", ref_id: "art_00000001", relationship: "redacts" }],
};

const wrappedDeviceKeyEnvelope = {
  schema_version: "v1",
  envelope_version: "wrapped-device-key/v1",
  wrapping_algorithm: "aes-256-gcm",
  encoding: "base64url",
  wrap_key_ref: "sync_key_synthetic_zone",
  wrapped_key_ref: "key_active",
  wrap_nonce: "d3JhcF9ub25jZV8wMDE",
  wrap_auth_tag: "d3JhcF90YWdfMDAx",
  wrapped_key_ciphertext: "d3JhcHBlZF9kZXZpY2Vfa2V5XzAwMQ",
  wrapped_key_digest: {
    algorithm: "sha-256",
    value: "d".repeat(64),
  },
  wrapped_key_size_bytes: 48,
  aad: {
    trust_zone_id: "tz_local_default",
    protected_value_id: "pv_synthetic_artifact_001",
    key_ref: "key_active",
  },
} as const;

const protectedValueUploadIntent: ProtectedValueUploadIntent = {
  schema_version: "v1",
  intent_type: "protected_value_upload",
  protected_value_id: "pv_synthetic_artifact_001",
  trust_zone_id: "tz_local_default",
  vault_ref: "vault_primary",
  key_ref: "key_active",
  object_key: `protected-values/tz_local_default/pv_synthetic_artifact_001/${"a".repeat(64)}`,
  encryption_algorithm: "aes-256-gcm",
  encoding: "base64url",
  ciphertext_nonce: "YmxvYl9ub25jZV8wMDE",
  ciphertext_auth_tag: "YmxvYl90YWdfMDAx",
  original_ciphertext_digest: digest,
  original_ciphertext_size_bytes: 512,
  nonce_ref: "nonce_artifact_001",
  tag_ref: "tag_artifact_001",
  wrapped_device_key: wrappedDeviceKeyEnvelope,
};

const protectedValueUploadReceipt: ProtectedValueUploadReceipt = {
  schema_version: "v1",
  receipt_type: "protected_value_upload",
  protected_value_id: "pv_synthetic_artifact_001",
  trust_zone_id: "tz_local_default",
  object_key: protectedValueUploadIntent.object_key,
  original_ciphertext_digest: digest,
  original_ciphertext_size_bytes: 512,
  uploaded_at: "2026-01-01T00:00:02Z",
  status: "uploaded",
  upload_receipt_id: "receipt_synthetic_001",
};

const protectedValueMetadata: ProtectedValueMetadata = {
  schema_version: "v1",
  metadata_type: "protected_value",
  protected_value_id: "pv_synthetic_artifact_001",
  trust_zone_id: "tz_local_default",
  object_key: protectedValueUploadIntent.object_key,
  vault_ref: protectedValueUploadIntent.vault_ref,
  encryption_algorithm: "aes-256-gcm",
  encoding: "base64url",
  ciphertext_nonce: "YmxvYl9ub25jZV8wMDE",
  ciphertext_auth_tag: "YmxvYl90YWdfMDAx",
  original_ciphertext_digest: digest,
  original_ciphertext_size_bytes: 512,
  nonce_ref: "nonce_artifact_001",
  tag_ref: "tag_artifact_001",
  key_ref: "key_active",
  wrapped_device_key: wrappedDeviceKeyEnvelope,
  linked_event_ids: ["evt_00000001"],
  orphan_status: "linked",
  uploaded_at: "2026-01-01T00:00:02Z",
};

const syncFixtures: SyncApiMessage[] = [
  protectedValueUploadIntent,
  protectedValueUploadReceipt,
  protectedValueMetadata,
  {
    schema_version: "v1",
    request_id: "req_push_001",
    client_id: "client_alpha",
    trust_zone_id: "tz_local_default",
    idempotency_key: "idem_abcdefghijklmnop",
    request_fingerprint: `sha-256:${"b".repeat(64)}`,
    events: [eventFixtures[0] as CanonicalEvent],
    erasures: [],
    protected_value_receipts: [protectedValueUploadReceipt],
  },
  {
    schema_version: "v1",
    request_id: "req_push_001_erasure",
    client_id: "client_alpha",
    trust_zone_id: "tz_local_default",
    idempotency_key: "idem_erasureabcdefghi",
    request_fingerprint: `sha-256:${"e".repeat(64)}`,
    events: [],
    erasures: [erasureFixture],
  },
  {
    schema_version: "v1",
    request_id: "req_push_002",
    status: "replay",
    accepted_event_ids: [],
    accepted_erasure_ids: [],
    replay_of: "idem_abcdefghijklmnop",
    errors: [
      {
        code: "replay",
        message: "The idempotency key and request fingerprint match a prior request.",
        ref_id: "req_push_001",
      },
    ],
  },
  {
    schema_version: "v1",
    request_id: "req_push_003",
    status: "idempotency_conflict",
    accepted_event_ids: [],
    accepted_erasure_ids: [],
    conflict_with: "idem_abcdefghijklmnop",
    errors: [
      {
        code: "idempotency_conflict",
        message: "The idempotency key was reused with a different request fingerprint.",
        ref_id: "req_push_001",
      },
    ],
  },
  {
    schema_version: "v1",
    request_id: "req_push_004",
    status: "accepted",
    accepted_event_ids: eventFixtures.map((event) => event.event_id),
    accepted_erasure_ids: [erasureFixture.erasure_id],
    zone_sequences: [{ trust_zone_id: "tz_local_default", last_sequence: 5 }],
    errors: [],
  },
  {
    schema_version: "v1",
    client_id: "client_alpha",
    trust_zone_id: "tz_local_default",
    after_sequence: 1,
    limit: 100,
  },
  {
    schema_version: "v1",
    events: eventFixtures,
    erasures: [erasureFixture],
    cursor: "cursor_next",
    after_sequence: 5,
    has_more: false,
  },
  {
    schema_version: "v1",
    error: {
      code: "idempotency_conflict",
      message: "The idempotency key was reused with a different request fingerprint.",
      ref_id: "req_push_001",
    },
  },
];

const sourceRecords: RetrievalSourceRecord[] = [
  {
    source_record_kind: "event",
    source_record_id: "evt_00000001",
    trust_zone_id: "tz_local_default",
    zone_sequence: 1,
    source_fingerprint: `sha-256:${"1".repeat(64)}`,
    relationship_role: "primary",
    event_type: "EvidenceArtifact",
    lifecycle_status: "active",
    epistemic_authority: "observed",
    valid_time: {
      start: "2026-01-01T00:00:00Z",
      end: null,
    },
    recorded_time: {
      start: "2026-01-01T00:00:01Z",
      end: null,
    },
  },
  {
    source_record_kind: "event",
    source_record_id: "evt_00000003",
    trust_zone_id: "tz_local_default",
    zone_sequence: 3,
    source_fingerprint: `sha-256:${"3".repeat(64)}`,
    relationship_role: "support",
    event_type: "Claim",
    lifecycle_status: "active",
    epistemic_authority: "derived",
    valid_time: {
      start: "2026-01-01T00:00:00Z",
      end: null,
    },
    recorded_time: {
      start: "2026-01-01T00:03:00Z",
      end: null,
    },
  },
  {
    source_record_kind: "event",
    source_record_id: "evt_00000004",
    trust_zone_id: "tz_local_default",
    zone_sequence: 4,
    source_fingerprint: `sha-256:${"4".repeat(64)}`,
    relationship_role: "acceptance",
    event_type: "AcceptanceDecision",
    lifecycle_status: "active",
    epistemic_authority: "verified",
    valid_time: {
      start: "2026-01-01T00:00:00Z",
      end: null,
    },
    recorded_time: {
      start: "2026-01-01T00:04:00Z",
      end: null,
    },
  },
  {
    source_record_kind: "event",
    source_record_id: "evt_00000005",
    trust_zone_id: "tz_local_default",
    zone_sequence: 5,
    source_fingerprint: `sha-256:${"5".repeat(64)}`,
    relationship_role: "supersession",
    event_type: "Supersession",
    lifecycle_status: "active",
    epistemic_authority: "verified",
    valid_time: {
      start: "2026-01-01T00:00:00Z",
      end: null,
    },
    recorded_time: {
      start: "2026-01-01T00:05:00Z",
      end: null,
    },
  },
  {
    source_record_kind: "erasure",
    source_record_id: "era_00000001",
    trust_zone_id: "tz_local_default",
    zone_sequence: 6,
    source_fingerprint: `sha-256:${"6".repeat(64)}`,
    relationship_role: "erasure",
    recorded_time: {
      start: "2026-01-02T00:00:00Z",
      end: null,
    },
  },
];

const retrievalChunk: RetrievalChunk = {
  schema_version: "v1",
  record_type: "retrieval_chunk",
  chunk_id: `chk_${"a".repeat(40)}`,
  chunk_kind: "claim",
  trust_zone_id: "tz_local_default",
  projection_version: "retrieval/v1",
  chunker_version: "v1",
  chunk_index: 0,
  text: "Synthetic accepted claim chunk with lineage.",
  text_digest: `sha-256:${"7".repeat(64)}`,
  source_records: sourceRecords,
  derivation: {
    algorithm: "canonical_retrieval_chunk_v1",
    algorithm_version: "v1",
    config_digest: `sha-256:${"8".repeat(64)}`,
    input_manifest_digest: `sha-256:${"9".repeat(64)}`,
  },
  lifecycle_status: "active",
  epistemic_authority: "derived",
  status: "active",
  created_at: "2026-01-02T00:00:00Z",
};

const embeddingJob: EmbeddingJob = {
  schema_version: "v1",
  record_type: "embedding_job",
  job_id: `embjob_${"a".repeat(32)}`,
  chunk_id: retrievalChunk.chunk_id,
  embedding_model: "@cf/baai/bge-base-en-v1.5",
  embedding_version: "v1",
  pooling: "mean",
  state: "retryable_failed",
  attempts: 1,
  available_at: "2026-01-02T00:00:00Z",
  failure_kind: "workers_ai_allocation_exhausted",
  retry_after: "2026-01-02T00:00:00Z",
  quota_reset_at: "2026-01-02T00:00:00Z",
  last_error: "workers ai allocation exhausted",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:30:00Z",
};

const embeddingRecord: EmbeddingRecord = {
  schema_version: "v1",
  record_type: "embedding_record",
  embedding_id: `emb_${"b".repeat(40)}`,
  chunk_id: retrievalChunk.chunk_id,
  vector_ref: "local_vector:retrieval:v1:chunk_0001",
  vector_digest: `sha-256:${"b".repeat(64)}`,
  provenance: {
    embedding_model: "@cf/baai/bge-base-en-v1.5",
    embedding_dimensions: 768,
    embedding_version: "v1",
    pooling: "mean",
    input_token_limit: 512,
    input_text_sha256: retrievalChunk.text_digest,
    created_at: "2026-01-02T00:00:00Z",
  },
  created_at: "2026-01-02T00:00:00Z",
};

const projectionFreshness: ProjectionFreshness = {
  schema_version: "v1",
  record_type: "projection_freshness",
  projection_name: "retrieval_projection",
  projection_version: "retrieval/v1",
  trust_zone_id: "tz_local_default",
  last_indexed_zone_sequence: 6,
  sync_cursor_after_sequence: 6,
  stale: false,
  checked_at: "2026-01-02T00:00:00Z",
};

const retrievalQuery: RetrievalQuery = {
  schema_version: "v1",
  record_type: "retrieval_query",
  query_id: `query_${"c".repeat(24)}`,
  query_text: "synthetic accepted claim",
  filters: {
    visible_trust_zone_ids: ["tz_local_default"],
    lifecycle_status: ["active"],
    epistemic_authority: ["derived", "verified"],
    protected_value_policy: "metadata_only",
    conflict_policy: "surface_conflicts",
  },
  ranking: {
    mode: "hybrid",
    weights: {
      structured: 1,
      fts: 1,
      semantic: 1,
      recency: 0.25,
    },
  },
  limit: 10,
};

const retrievalResult: RetrievalResult = {
  schema_version: "v1",
  record_type: "retrieval_result",
  query_id: retrievalQuery.query_id,
  projection_freshness: [projectionFreshness],
  filters_applied: retrievalQuery.filters,
  results: [
    {
      candidate_id: `cand_${"d".repeat(24)}`,
      chunk_id: retrievalChunk.chunk_id,
      status: "visible",
      text: retrievalChunk.text,
      score: {
        total: 2.5,
        structured: 1,
        fts: 0.75,
        semantic: 0.5,
        recency: 0.25,
      },
      lineage: {
        source_records: sourceRecords,
        canonical_rechecked: true,
        accepted_decision_event_ids: ["evt_00000004"],
        supersession_event_ids: ["evt_00000005"],
        erasure_ids: ["era_00000001"],
      },
      canonical_rechecked: true,
    },
    {
      candidate_id: `cand_${"e".repeat(24)}`,
      chunk_id: `chk_${"e".repeat(40)}`,
      status: "redacted",
      reason: "protected value denied",
      score: {
        total: 0.5,
        structured: 0.5,
        fts: 0,
        semantic: 0,
        recency: 0,
      },
      lineage: {
        source_records: [sourceRecords[0] as RetrievalSourceRecord],
        canonical_rechecked: true,
      },
      canonical_rechecked: true,
    },
  ],
  warnings: ["synthetic projection warning"],
};

const retrievalFixtures: RetrievalProjectionMessage[] = [
  retrievalChunk,
  embeddingJob,
  embeddingRecord,
  projectionFreshness,
  retrievalQuery,
  retrievalResult,
];

describe("CarpeOS v1 schemas", () => {
  it("compiles every exported schema", () => {
    const validators = compileSchemaValidators();

    expect(Object.keys(validators).sort()).toEqual([
      "canonicalEvent",
      "common",
      "erasureLedger",
      "mcpApi",
      "obsidianProjection",
      "retrievalProjection",
      "syncApi",
    ]);
  });

  it("accepts complete synthetic examples for every event payload type", () => {
    const validate = compileSchemaValidators().canonicalEvent;

    expect(validate).toBeDefined();
    for (const event of eventFixtures) {
      expect(validate(event), event.event_type).toBe(true);
      expect(validateConformance("canonicalEvent", event)).toEqual({ valid: true, errors: [] });
    }
  });

  it("accepts complete synthetic erasure and sync API examples", () => {
    const validators = compileSchemaValidators();

    expect(validators.erasureLedger(erasureFixture)).toBe(true);
    for (const fixture of syncFixtures) {
      expect(validators.syncApi(fixture), JSON.stringify(validators.syncApi.errors)).toBe(true);
      expect(validateConformance("syncApi", fixture), JSON.stringify(fixture)).toEqual({
        valid: true,
        errors: [],
      });
    }
  });

  it("accepts schema-backed retrieval projection examples", () => {
    const validators = compileSchemaValidators();

    for (const fixture of retrievalFixtures) {
      expect(
        validators.retrievalProjection(fixture),
        JSON.stringify(validators.retrievalProjection.errors),
      ).toBe(true);
      expect(validateConformance("retrievalProjection", fixture), JSON.stringify(fixture)).toEqual({
        valid: true,
        errors: [],
      });
    }
  });

  it("rejects invalid retrieval source manifests and derivation metadata", () => {
    const validators = compileSchemaValidators();
    const emptySources = {
      ...retrievalChunk,
      source_records: [],
    };
    const unsortedSources = {
      ...retrievalChunk,
      source_records: [sourceRecords[1], sourceRecords[0]],
    };
    const duplicatedSources = {
      ...retrievalChunk,
      source_records: [sourceRecords[0], sourceRecords[0]],
    };
    const missingDerivationDigest = {
      ...retrievalChunk,
      derivation: {
        algorithm: "canonical_retrieval_chunk_v1",
        algorithm_version: "v1",
        config_digest: `sha-256:${"8".repeat(64)}`,
      },
    };
    const crossZoneManifest = {
      ...retrievalChunk,
      source_records: [
        sourceRecords[0],
        {
          ...(sourceRecords[1] as RetrievalSourceRecord),
          trust_zone_id: "tz_remote_default",
        },
      ],
    };

    expect(validators.retrievalProjection(emptySources)).toBe(false);
    expect(validateConformance("retrievalProjection", unsortedSources).errors).toContain(
      "source_records must be sorted deterministically",
    );
    expect(validateConformance("retrievalProjection", duplicatedSources).errors).toContain(
      "source_records must be deduplicated",
    );
    expect(validators.retrievalProjection(missingDerivationDigest)).toBe(false);
    expect(validateConformance("retrievalProjection", crossZoneManifest).errors).toContain(
      "retrieval chunk trust_zone_id must match every source_records trust_zone_id",
    );
  });

  it("enforces embedding provenance, retry fields, and vector-non-authority result contracts", () => {
    const validators = compileSchemaValidators();
    const invalidDimensions = {
      ...embeddingRecord,
      provenance: {
        ...embeddingRecord.provenance,
        embedding_dimensions: 1536,
      },
    };
    const retryMissingFailureKind = {
      ...embeddingJob,
      failure_kind: undefined,
    } as Record<string, unknown>;
    delete retryMissingFailureKind.failure_kind;
    const quotaMissingReset = {
      ...embeddingJob,
      quota_reset_at: undefined,
    } as Record<string, unknown>;
    delete quotaMissingReset.quota_reset_at;
    const vectorAsAuthority = {
      ...retrievalResult,
      results: [
        {
          ...(retrievalResult.results[0] as NonNullable<RetrievalResult["results"][number]>),
          canonical_rechecked: false,
          lineage: {
            ...(retrievalResult.results[0]?.lineage as NonNullable<
              RetrievalResult["results"][number]["lineage"]
            >),
            canonical_rechecked: false,
          },
        },
      ],
    };

    expect(validators.retrievalProjection(invalidDimensions)).toBe(false);
    expect(validateConformance("retrievalProjection", retryMissingFailureKind).errors).toContain(
      "retryable embedding jobs must include failure_kind",
    );
    expect(validateConformance("retrievalProjection", quotaMissingReset).errors).toContain(
      "Workers AI allocation failures must include quota_reset_at",
    );
    expect(validators.retrievalProjection(vectorAsAuthority)).toBe(false);
  });

  it("enforces retrieval result status-dependent text and reason contracts", () => {
    const visibleWithoutText = {
      ...retrievalResult,
      results: [
        {
          ...(retrievalResult.results[0] as RetrievalResult["results"][number]),
          text: undefined,
        },
      ],
    } as Record<string, unknown>;
    delete ((visibleWithoutText.results as Record<string, unknown>[])[0] as Record<string, unknown>)
      .text;

    const visibleWithReason = {
      ...retrievalResult,
      results: [
        {
          ...(retrievalResult.results[0] as RetrievalResult["results"][number]),
          reason: "not allowed on visible results",
        },
      ],
    };
    const redactedWithText = {
      ...retrievalResult,
      results: [
        {
          ...(retrievalResult.results[1] as RetrievalResult["results"][number]),
          text: "must not appear",
        },
      ],
    };
    const excludedWithoutReason = {
      ...retrievalResult,
      results: [
        {
          ...(retrievalResult.results[1] as RetrievalResult["results"][number]),
          status: "excluded",
          reason: undefined,
        },
      ],
    } as Record<string, unknown>;
    delete (
      (excludedWithoutReason.results as Record<string, unknown>[])[0] as Record<string, unknown>
    ).reason;

    expect(compileSchemaValidators().retrievalProjection(visibleWithoutText)).toBe(false);
    expect(compileSchemaValidators().retrievalProjection(visibleWithReason)).toBe(false);
    expect(compileSchemaValidators().retrievalProjection(redactedWithText)).toBe(false);
    expect(compileSchemaValidators().retrievalProjection(excludedWithoutReason)).toBe(false);
  });

  it("recursively validates retrieval result lineage manifests and visible trust zones", () => {
    const unsortedLineage = {
      ...retrievalResult,
      results: [
        {
          ...(retrievalResult.results[0] as RetrievalResult["results"][number]),
          lineage: {
            ...(retrievalResult.results[0]?.lineage as NonNullable<
              RetrievalResult["results"][number]["lineage"]
            >),
            source_records: [sourceRecords[1], sourceRecords[0]],
          },
        },
      ],
    };
    const duplicatedLineage = {
      ...retrievalResult,
      results: [
        {
          ...(retrievalResult.results[0] as RetrievalResult["results"][number]),
          lineage: {
            ...(retrievalResult.results[0]?.lineage as NonNullable<
              RetrievalResult["results"][number]["lineage"]
            >),
            source_records: [sourceRecords[0], sourceRecords[0]],
          },
        },
      ],
    };
    const invisibleZoneLineage = {
      ...retrievalResult,
      results: [
        {
          ...(retrievalResult.results[0] as RetrievalResult["results"][number]),
          lineage: {
            ...(retrievalResult.results[0]?.lineage as NonNullable<
              RetrievalResult["results"][number]["lineage"]
            >),
            source_records: [
              {
                ...(sourceRecords[0] as RetrievalSourceRecord),
                trust_zone_id: "tz_remote_default",
              },
            ],
          },
        },
      ],
    };

    expect(validateConformance("retrievalProjection", unsortedLineage).errors).toContain(
      "source_records must be sorted deterministically",
    );
    expect(validateConformance("retrievalProjection", duplicatedLineage).errors).toContain(
      "source_records must be deduplicated",
    );
    expect(validateConformance("retrievalProjection", invisibleZoneLineage).errors).toContain(
      "lineage source trust_zone_id tz_remote_default must be visible in filters_applied.visible_trust_zone_ids",
    );
  });

  it("enforces projection freshness sequence and stale reason consistency", () => {
    const behindWithoutReason = {
      ...projectionFreshness,
      last_indexed_zone_sequence: 5,
      sync_cursor_after_sequence: 6,
      stale: false,
    };
    const staleWithoutReason = {
      ...projectionFreshness,
      stale: true,
    } as Record<string, unknown>;
    const freshWithReason = {
      ...projectionFreshness,
      stale: false,
      reason: "version_changed",
    };
    const futureIndexed = {
      ...projectionFreshness,
      last_indexed_zone_sequence: 7,
      sync_cursor_after_sequence: 6,
      stale: false,
    };
    const validBehind = {
      ...projectionFreshness,
      last_indexed_zone_sequence: 5,
      sync_cursor_after_sequence: 6,
      stale: true,
      reason: "behind_sync_cursor",
    };

    expect(validateConformance("retrievalProjection", behindWithoutReason).errors).toContain(
      "projection freshness behind sync cursor must be stale with reason behind_sync_cursor",
    );
    expect(compileSchemaValidators().retrievalProjection(staleWithoutReason)).toBe(false);
    expect(validateConformance("retrievalProjection", freshWithReason).errors).toContain(
      "fresh projection freshness must not include reason",
    );
    expect(validateConformance("retrievalProjection", futureIndexed).errors).toContain(
      "projection freshness last_indexed_zone_sequence must not exceed sync_cursor_after_sequence",
    );
    expect(validateConformance("retrievalProjection", validBehind)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it("rejects missing and invalid canonical event fields", () => {
    const validate = compileSchemaValidators().canonicalEvent;
    const missingSubject: Record<string, unknown> = { ...makeBaseEvent(), subject_ref: undefined };
    const invalidSequence = { ...makeBaseEvent(), zone_sequence: 0 };

    delete missingSubject.subject_ref;

    expect(validate(missingSubject)).toBe(false);
    expect(validate(invalidSequence)).toBe(false);
  });

  it("rejects event type and payload discriminator mismatches", () => {
    const validate = compileSchemaValidators().canonicalEvent;
    const mismatched = makeBaseEvent({
      event_type: "Claim",
      payload: {
        artifact_id: "art_00000001",
        kind: "document",
        media_type: "text/plain",
        content_ref: protectedContentRef,
      },
    });

    expect(validate(mismatched)).toBe(false);
  });

  it("rejects inline protected value material and encrypted blob bytes", () => {
    const validate = compileSchemaValidators().canonicalEvent;
    const event = makeBaseEvent();

    const withSecretBytes = {
      ...event,
      payload: {
        ...event.payload,
        content_ref: {
          ...protectedContentRef,
          secret_bytes: "not allowed",
        },
      },
    };

    const withCiphertextBytes = {
      ...event,
      payload: {
        ...event.payload,
        content_ref: {
          ...protectedContentRef,
          encrypted_blob: {
            ...protectedContentRef.encrypted_blob,
            ciphertext_bytes: "not allowed",
          },
        },
      },
    };
    const withoutProtectedValueId = {
      ...event,
      payload: {
        ...event.payload,
        content_ref: {
          ref_type: protectedContentRef.ref_type,
          vault_ref: protectedContentRef.vault_ref,
          key_ref: protectedContentRef.key_ref,
          encrypted_blob: protectedContentRef.encrypted_blob,
        },
      },
    };

    expect(validate(withSecretBytes)).toBe(false);
    expect(validate(withCiphertextBytes)).toBe(false);
    expect(validate(withoutProtectedValueId)).toBe(false);
  });

  it("keeps acceptance and rejection only on decision payloads", () => {
    const validate = compileSchemaValidators().canonicalEvent;
    const acceptedAuthority = makeBaseEvent({
      lifecycle_status: "active",
      epistemic_authority: "accepted",
    });
    const rejectedAuthority = makeBaseEvent({
      lifecycle_status: "active",
      epistemic_authority: "rejected",
    });

    expect(validate(acceptedAuthority)).toBe(false);
    expect(validate(rejectedAuthority)).toBe(false);
    expect(validate(eventFixtures[3])).toBe(true);
  });

  it("rejects standalone superseded and erased lifecycle statuses", () => {
    const validate = compileSchemaValidators().canonicalEvent;

    expect(validate(makeBaseEvent({ lifecycle_status: "superseded" }))).toBe(false);
    expect(validate(makeBaseEvent({ lifecycle_status: "erased" }))).toBe(false);
    expect(
      validate(
        makeBaseEvent({
          event_id: "evt_00000007",
          event_type: "Supersession",
          lifecycle_status: "draft",
          payload: {
            supersession_id: "sup_00000002",
            supersedes_event_id: "evt_00000003",
            reason: "Synthetic invalid draft supersession.",
          },
        }),
      ),
    ).toBe(false);
  });

  it("rejects empty provenance, observation evidence refs, and claim support", () => {
    const validate = compileSchemaValidators().canonicalEvent;

    expect(validate(makeBaseEvent({ provenance: [] }))).toBe(false);
    expect(
      validate(
        makeBaseEvent({
          event_id: "evt_00000008",
          event_type: "Observation",
          payload: {
            observation_id: "obs_00000002",
            observed_at: "2026-01-01T00:01:00Z",
            statement: "A synthetic observation has no evidence.",
            evidence_artifact_refs: [],
          },
        }),
      ),
    ).toBe(false);
    expect(
      validate(
        makeBaseEvent({
          event_id: "evt_00000009",
          event_type: "Claim",
          payload: {
            claim_id: "claim_00000002",
            statement: "A synthetic claim has no support.",
            claim_type: "inference",
            support: [],
          },
        }),
      ),
    ).toBe(false);
  });

  it("enforces bitemporal timestamp validity and interval ordering", () => {
    const invalid = makeBaseEvent({
      valid_time: {
        start: "2026-01-03T00:00:00Z",
        end: "2026-01-02T00:00:00Z",
      },
    });

    expect(collectBitemporalErrors(invalid)).toEqual([
      "valid_time.start must be before or equal to valid_time.end",
    ]);

    expect(
      collectBitemporalErrors(
        makeBaseEvent({
          recorded_time: {
            start: "2026-99-01T00:00:00Z",
            end: null,
          },
        }),
      ),
    ).toEqual(["recorded_time.start must be before or equal to recorded_time.end"]);
  });

  it("rejects invalid erasure records, method targets, and sync replay-conflict contract violations", () => {
    const validators = compileSchemaValidators();
    const erasureWithExtraField = {
      ...erasureFixture,
      erased_bytes: 128,
    };
    const erasureWithInvalidSequence = {
      ...erasureFixture,
      zone_sequence: 0,
    };
    const cryptoShredEvent = {
      ...erasureFixture,
      target_ref: {
        target_kind: "event",
        target_id: "evt_00000001",
      },
    };
    const projectionDeleteKey = {
      ...erasureFixture,
      method: "projection_delete",
      target_ref: {
        target_kind: "key",
        target_id: "key_active",
      },
    };
    const tombstoneProtectedValue = {
      ...erasureFixture,
      method: "tombstone",
      target_ref: {
        target_kind: "protected_value",
        target_id: "pv_synthetic_artifact_001",
      },
    };
    const cryptoShredWithNonProtectedValueId = {
      ...erasureFixture,
      target_ref: {
        target_kind: "protected_value",
        target_id: "artifact_not_a_protected_value",
      },
    };
    const emptyPush = {
      ...(syncFixtures[0] as Record<string, unknown>),
      events: [],
      erasures: [],
    };
    const mixedPush = {
      ...(syncFixtures[0] as Record<string, unknown>),
      events: [eventFixtures[0]],
      erasures: [erasureFixture],
    };
    const multiEventPush = {
      ...(syncFixtures[0] as Record<string, unknown>),
      events: [eventFixtures[0], eventFixtures[1]],
      erasures: [],
    };
    const replayMissingReplayOf = {
      schema_version: "v1",
      request_id: "req_push_005",
      status: "replay",
      accepted_event_ids: [],
      accepted_erasure_ids: [],
      errors: [{ code: "replay", message: "Replay detected." }],
    };
    const conflictMissingConflictWith = {
      schema_version: "v1",
      request_id: "req_push_006",
      status: "idempotency_conflict",
      accepted_event_ids: [],
      accepted_erasure_ids: [],
      errors: [{ code: "idempotency_conflict", message: "Conflict detected." }],
    };
    const replayWithConflictMarker = {
      ...syncFixtures[1],
      conflict_with: "idem_otherabcdefghijkl",
    };

    expect(validators.erasureLedger(erasureWithExtraField)).toBe(false);
    expect(validators.erasureLedger(erasureWithInvalidSequence)).toBe(false);
    expect(validators.erasureLedger(cryptoShredEvent)).toBe(false);
    expect(validators.erasureLedger(projectionDeleteKey)).toBe(false);
    expect(validators.erasureLedger(tombstoneProtectedValue)).toBe(false);
    expect(validators.erasureLedger(cryptoShredWithNonProtectedValueId)).toBe(false);
    expect(validators.syncApi(emptyPush)).toBe(false);
    expect(validators.syncApi(mixedPush)).toBe(false);
    expect(validators.syncApi(multiEventPush)).toBe(false);
    expect(validateConformance("syncApi", emptyPush).errors).toContain(
      "sync push request must contain at least one event or erasure",
    );
    expect(validators.syncApi(replayMissingReplayOf)).toBe(false);
    expect(validators.syncApi(conflictMissingConflictWith)).toBe(false);
    expect(validators.syncApi(replayWithConflictMarker)).toBe(false);
  });

  it("keeps G004 push compatibility while validating optional protected-value receipts", () => {
    const compatibleG004Push: Record<string, unknown> = {
      ...(syncFixtures[3] as Record<string, unknown>),
      protected_value_receipts: undefined,
    };
    delete compatibleG004Push.protected_value_receipts;

    const mismatchedReceiptPush = {
      ...(syncFixtures[3] as Record<string, unknown>),
      protected_value_receipts: [
        {
          ...protectedValueUploadReceipt,
          original_ciphertext_size_bytes: 513,
        },
      ],
    };
    const missingReceiptPush = {
      ...(syncFixtures[3] as Record<string, unknown>),
      protected_value_receipts: [],
    };

    expect(compileSchemaValidators().syncApi(compatibleG004Push)).toBe(true);
    expect(validateConformance("syncApi", compatibleG004Push).valid).toBe(true);
    expect(validateConformance("syncApi", mismatchedReceiptPush).errors).toContain(
      "upload receipt pv_synthetic_artifact_001 size must match event protected value size",
    );
    expect(validateConformance("syncApi", missingReceiptPush).errors).toContain(
      "event evt_00000001 protected_value_id pv_synthetic_artifact_001 has no matching upload receipt",
    );
  });

  it("validates decryptable protected-value transfer metadata without accepting secret material", () => {
    const invalidWrappedAad = {
      ...protectedValueUploadIntent,
      wrapped_device_key: {
        ...wrappedDeviceKeyEnvelope,
        aad: {
          ...wrappedDeviceKeyEnvelope.aad,
          protected_value_id: "pv_synthetic_other_001",
        },
      },
    };
    const missingCiphertextNonce = {
      ...protectedValueMetadata,
      ciphertext_nonce: undefined,
    } as Record<string, unknown>;
    delete missingCiphertextNonce.ciphertext_nonce;
    const invalidPlaintextLeak = {
      ...protectedValueUploadIntent,
      plaintext_device_key: "not allowed",
    };

    expect(validateConformance("syncApi", protectedValueUploadIntent)).toEqual({
      valid: true,
      errors: [],
    });
    expect(validateConformance("syncApi", protectedValueMetadata)).toEqual({
      valid: true,
      errors: [],
    });
    expect(validateConformance("syncApi", invalidWrappedAad).errors).toContain(
      "wrapped device-key aad.protected_value_id must match protected_value_id",
    );
    expect(compileSchemaValidators().syncApi(missingCiphertextNonce)).toBe(false);
    expect(compileSchemaValidators().syncApi(invalidPlaintextLeak)).toBe(false);
  });

  it("rejects cross-zone push conformance while allowing same key in another zone as new", () => {
    const crossZoneEvent = {
      ...(syncFixtures[3] as Record<string, unknown>),
      events: [
        makeBaseEvent({
          trust_zone: {
            ...trustZone,
            trust_zone_id: "tz_remote_default",
          },
        }),
      ],
    };
    const crossZoneErasure = {
      ...(syncFixtures[3] as Record<string, unknown>),
      events: [],
      erasures: [
        {
          ...erasureFixture,
          trust_zone: {
            ...trustZone,
            trust_zone_id: "tz_remote_default",
          },
        },
      ],
    };

    expect(compileSchemaValidators().syncApi(crossZoneEvent)).toBe(true);
    expect(validateConformance("syncApi", crossZoneEvent).valid).toBe(false);
    expect(validateConformance("syncApi", crossZoneErasure).valid).toBe(false);
    expect(
      classifyIdempotency(
        {
          trust_zone_id: "tz_local_default",
          idempotency_key: "idem_abcdefghijklmnop",
          request_fingerprint: `sha-256:${"b".repeat(64)}`,
        },
        {
          trust_zone_id: "tz_remote_default",
          idempotency_key: "idem_abcdefghijklmnop",
          request_fingerprint: `sha-256:${"b".repeat(64)}`,
        },
      ),
    ).toBe("new_request");
  });

  it("classifies idempotent replay and conflicting request fingerprints", () => {
    const existing = {
      trust_zone_id: "tz_local_default",
      idempotency_key: "idem_abcdefghijklmnop",
      request_fingerprint: `sha-256:${"b".repeat(64)}`,
    };

    expect(classifyIdempotency(undefined, existing)).toBe("new_request");
    expect(classifyIdempotency(existing, existing)).toBe("replay");
    expect(
      classifyIdempotency(existing, {
        ...existing,
        request_fingerprint: `sha-256:${"c".repeat(64)}`,
      }),
    ).toBe("idempotency_conflict");
  });

  it("validates the G007 MCP tool schemas and keeps propose-claim draft-only", () => {
    const visibility = {
      visible_trust_zone_ids: ["tz_local_default"],
      protected_value_policy: "metadata_only",
    } satisfies MemoryProposeClaimInput["visibility"];
    const context_budget = { max_items: 8, max_characters: 4000 };
    const support: ProvenanceRef[] = [
      { ref_type: "event", ref_id: "evt_support_0001", relationship: "supports" },
    ];
    const proposeInput: MemoryProposeClaimInput = {
      schema_version: "v1",
      tool: "memory_propose_claim",
      visibility,
      statement: "Synthetic claim remains draft until accepted elsewhere.",
      claim_type: "inference",
      support,
      valid_time: { start: "2025-01-01T00:00:00Z", end: null },
      idempotency_key: "idem_mcp_claim_00000001",
    };
    const proposeOutput: MemoryProposeClaimOutput = {
      schema_version: "v1",
      tool: "memory_propose_claim",
      status: "proposed",
      event_id: "evt_mcp_claim_0001",
      claim_id: "claim_mcp_claim_0001",
      lifecycle_status: "draft",
      valid_time: { start: "2025-01-01T00:00:00Z", end: null },
      recorded_time: { start: "2026-01-01T00:00:00Z", end: null },
      valid_time_defaulted: false,
      acceptance_decision_event_ids: [],
    };
    const captureOutput: MemoryCaptureOutput = {
      schema_version: "v1",
      tool: "memory_capture",
      status: "captured",
      event_id: "evt_capture_0001",
      recorded_time: { start: "2026-01-01T00:00:00Z", end: null },
    };
    const captureErrorOutput: MemoryCaptureOutput = {
      schema_version: "v1",
      tool: "memory_capture",
      error: {
        code: "unauthorized",
        message: "visible trust zone is not authorized",
      },
    };
    const proposeErrorOutput: MemoryProposeClaimOutput = {
      schema_version: "v1",
      tool: "memory_propose_claim",
      error: {
        code: "not_found",
        message: "support reference was not found or authorized",
        ref_id: "evt_missing_support",
      },
    };
    const toolInputs = [
      {
        schema_version: "v1",
        tool: "memory_search",
        visibility,
        query: "synthetic",
        context_budget,
      },
      { schema_version: "v1", tool: "memory_get", visibility, record_id: "evt_support_0001" },
      {
        schema_version: "v1",
        tool: "memory_context_pack",
        visibility,
        task: "assemble synthetic context",
        context_budget,
      },
      {
        schema_version: "v1",
        tool: "memory_trace",
        visibility,
        record_id: "evt_support_0001",
        context_budget,
      },
      { schema_version: "v1", tool: "memory_timeline", visibility, context_budget },
      {
        schema_version: "v1",
        tool: "memory_related",
        visibility,
        record_id: "evt_support_0001",
        context_budget,
      },
      {
        schema_version: "v1",
        tool: "memory_capture",
        visibility,
        provider: "codex",
        hook_event_name: "SessionEnd",
        captured_at: "2026-01-01T00:00:00Z",
        media_type: "application/json",
        subject_ref: "subject_synthetic",
        payload: { note: "synthetic" },
      },
      proposeInput,
    ];

    for (const input of toolInputs) {
      expect(validateConformance("mcpApi", input), JSON.stringify(input)).toEqual({
        valid: true,
        errors: [],
      });
    }
    expect(validateConformance("mcpApi", captureOutput)).toEqual({ valid: true, errors: [] });
    expect(validateConformance("mcpApi", captureErrorOutput)).toEqual({
      valid: true,
      errors: [],
    });
    expect(validateConformance("mcpApi", proposeOutput)).toEqual({ valid: true, errors: [] });
    expect(validateConformance("mcpApi", proposeErrorOutput)).toEqual({ valid: true, errors: [] });
    expect(
      validateConformance("mcpApi", {
        ...captureErrorOutput,
        status: "replay",
        event_id: "evt_fake_capture",
      }).valid,
    ).toBe(false);
    expect(
      validateConformance("mcpApi", {
        ...proposeErrorOutput,
        status: "replay",
        event_id: "evt_fake_claim",
        claim_id: "claim_fake_claim",
      }).valid,
    ).toBe(false);
    expect(
      validateConformance("mcpApi", {
        ...proposeOutput,
        acceptance_decision_event_ids: ["evt_decision_0001"],
      }).errors,
    ).toContain("memory_propose_claim output must not include AcceptanceDecision ids");
  });

  it("enforces accepted-fact lineage and deterministic budget semantics in MCP outputs", () => {
    const output = {
      schema_version: "v1",
      tool: "memory_context_pack",
      accepted_facts: [
        {
          claim_event_id: "evt_claim_0001",
          acceptance_decision_event_id: "evt_decision_0001",
          statement: "Synthetic fact has visible acceptance lineage.",
          source_event_ids: ["evt_claim_0001", "evt_decision_0001"],
        },
      ],
      draft_claims: [],
      rejected_claims: [],
      observations: [],
      evidence_summaries: [],
      conflicts: [],
      supersessions: [],
      erasures: [],
      verification_gaps: [],
      redactions: [],
      budget: {
        used: { items: 1, characters: 47 },
        truncated: false,
        omitted: { items: 0, characters: 0 },
      },
    };

    expect(validateConformance("mcpApi", output)).toEqual({ valid: true, errors: [] });
    expect(
      validateConformance("mcpApi", {
        ...output,
        accepted_facts: [{ ...output.accepted_facts[0], source_event_ids: ["evt_claim_0001"] }],
      }).errors,
    ).toContain("accepted fact source_event_ids must include the AcceptanceDecision event id");
    expect(
      validateConformance("mcpApi", {
        ...output,
        budget: { ...output.budget, truncated: true },
      }).errors,
    ).toContain("budget truncated must match omitted item or character counts");
  });

  it("validates closed Obsidian projection manifests and category lineage", () => {
    const manifest: ObsidianProjectionManifest = {
      schema_version: "v1",
      manifest_type: "obsidian_projection_manifest",
      projection_version: "obsidian/v1",
      output_root: "SyntheticVault",
      generated_at_policy: "fixed_input",
      config_digest: `sha-256:${"a".repeat(64)}`,
      visible_trust_zone_ids: ["tz_local_default"],
      path_policy: "tombstone_missing",
      files: [
        {
          path: "Accepted/synthetic-fact.md",
          category: "accepted_fact",
          source_lineage: [
            {
              source_kind: "event",
              source_id: "evt_claim_0001",
              trust_zone_id: "tz_local_default",
              zone_sequence: 1,
              source_fingerprint: `sha-256:${"b".repeat(64)}`,
              relationship: "primary",
            },
            {
              source_kind: "event",
              source_id: "evt_decision_0001",
              trust_zone_id: "tz_local_default",
              zone_sequence: 2,
              source_fingerprint: `sha-256:${"c".repeat(64)}`,
              relationship: "acceptance",
            },
          ],
          content_digest: `sha-256:${"d".repeat(64)}`,
          tombstoned: false,
        },
        {
          path: "Claims/synthetic-draft.md",
          category: "proposed_claim",
          source_lineage: [
            {
              source_kind: "event",
              source_id: "evt_claim_0002",
              trust_zone_id: "tz_local_default",
              zone_sequence: 3,
              source_fingerprint: `sha-256:${"e".repeat(64)}`,
              relationship: "primary",
            },
          ],
          content_digest: `sha-256:${"f".repeat(64)}`,
          tombstoned: false,
        },
      ],
    };

    expect(validateConformance("obsidianProjection", manifest)).toEqual({
      valid: true,
      errors: [],
    });
    expect(
      validateConformance("obsidianProjection", {
        ...manifest,
        files: [...manifest.files].reverse(),
      }).errors,
    ).toContain("obsidian manifest files must be sorted deterministically by path");
    const firstManifestFile = manifest.files[0];
    if (firstManifestFile === undefined) {
      throw new Error("expected manifest file");
    }
    const firstLineage = firstManifestFile.source_lineage[0];
    if (firstLineage === undefined) {
      throw new Error("expected manifest lineage");
    }
    expect(
      validateConformance("obsidianProjection", {
        ...manifest,
        files: [{ ...firstManifestFile, source_lineage: [firstLineage] }],
      }).errors,
    ).toContain("accepted_fact notes require acceptance lineage");
    expect(
      validateConformance("obsidianProjection", {
        ...manifest,
        files: [{ ...firstManifestFile, category: "private_note" }],
      }).valid,
    ).toBe(false);
  });
});
