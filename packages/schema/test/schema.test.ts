import { describe, expect, it } from "vitest";
import {
  type CanonicalEvent,
  type CryptoShredErasureTargetRef,
  type ErasureLedgerRecord,
  type ProjectionDeleteErasureTargetRef,
  type ProvenanceRef,
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
    target_ref: { target_kind: "protected_value"; target_id: "protected_artifact_001" };
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
    target_id: "protected_artifact_001",
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

const syncFixtures: SyncApiMessage[] = [
  {
    schema_version: "v1",
    request_id: "req_push_001",
    client_id: "client_alpha",
    trust_zone_id: "tz_local_default",
    idempotency_key: "idem_abcdefghijklmnop",
    request_fingerprint: `sha-256:${"b".repeat(64)}`,
    events: eventFixtures,
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

describe("CarpeOS v1 schemas", () => {
  it("compiles every exported schema", () => {
    const validators = compileSchemaValidators();

    expect(Object.keys(validators).sort()).toEqual([
      "canonicalEvent",
      "common",
      "erasureLedger",
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
      expect(validators.syncApi(fixture)).toBe(true);
      expect(validateConformance("syncApi", fixture), JSON.stringify(fixture)).toEqual({
        valid: true,
        errors: [],
      });
    }
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

    expect(validate(withSecretBytes)).toBe(false);
    expect(validate(withCiphertextBytes)).toBe(false);
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
        target_id: "protected_artifact_001",
      },
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
    expect(validators.syncApi(replayMissingReplayOf)).toBe(false);
    expect(validators.syncApi(conflictMissingConflictWith)).toBe(false);
    expect(validators.syncApi(replayWithConflictMarker)).toBe(false);
  });

  it("rejects cross-zone push conformance while allowing same key in another zone as new", () => {
    const crossZoneEvent = {
      ...(syncFixtures[0] as Record<string, unknown>),
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
      ...(syncFixtures[0] as Record<string, unknown>),
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
});
