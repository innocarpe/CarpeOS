import type { ProtectedValueRef, TrustZone } from "@carpeos/schema";
import { validateConformance } from "@carpeos/schema";
import { describe, expect, it } from "vitest";
import {
  buildEvidenceArtifactEvent,
  buildSyncPushRequest,
  deriveIdempotencyKey,
  fingerprintObject,
  isIdempotencyKey,
  stableCanonicalJson,
} from "../src/index.js";

const trustZone: TrustZone = {
  trust_zone_id: "tz_local_default",
  isolation: "local_device",
  region: "local",
  boundary_purpose: "synthetic local capture tests",
};
const recordedAt = "2026-01-01T00:00:01Z";

const protectedValueRef: ProtectedValueRef = {
  ref_type: "protected_value",
  protected_value_id: "pv_synthetic_capture_001",
  vault_ref: "vault_synthetic",
  key_ref: "key_synthetic_active",
  encrypted_blob: {
    algorithm: "aes-256-gcm",
    nonce_ref: "nonce_synthetic_capture",
    tag_ref: "tag_synthetic_capture",
    digest: {
      algorithm: "sha-256",
      value: "a".repeat(64),
    },
    size_bytes: 42,
  },
};

const baseEnvelope = {
  provider: "synthetic-cli",
  hook_event_name: "SessionEnd",
  captured_at: "2026-01-01T00:00:00Z",
  workspace_root: "/synthetic/workspace",
  session_id: "session_synthetic",
  source_event_id: "source_event_synthetic",
  media_type: "application/json",
  subject_ref: "subject_synthetic_project",
  payload: {
    z: "last",
    a: "first",
    nested: {
      b: 2,
      a: 1,
    },
  },
};

describe("provider-neutral capture", () => {
  it("uses stable key ordering for canonical JSON, fingerprints, and derived idempotency", () => {
    const left = { z: 3, a: { d: 2, c: 1 } };
    const right = { a: { c: 1, d: 2 }, z: 3 };

    expect(stableCanonicalJson(left)).toBe('{"a":{"c":1,"d":2},"z":3}');
    expect(fingerprintObject(left)).toBe(fingerprintObject(right));
    expect(
      deriveIdempotencyKey(
        {
          ...baseEnvelope,
          payload: left,
        },
        trustZone.trust_zone_id,
      ),
    ).toBe(
      deriveIdempotencyKey(
        {
          ...baseEnvelope,
          payload: right,
        },
        trustZone.trust_zone_id,
      ),
    );
  });

  it("builds exactly one valid protected EvidenceArtifact event without zone_sequence", () => {
    const built = buildEvidenceArtifactEvent({
      envelope: baseEnvelope,
      recordedAt,
      trustZone,
      protectedValueRef,
    });

    expect(built.event.event_type).toBe("EvidenceArtifact");
    expect(built.event.zone_sequence).toBeUndefined();
    expect(built.event.payload.content_ref).toEqual(protectedValueRef);
    expect(built.event.payload.lineage).toHaveLength(1);
    expect(built.event.provenance).toHaveLength(1);
    expect(built.event.provenance[0]?.ref_id).toMatch(/^external_synthetic-cli_[a-f0-9]{24}$/);
    expect(built.event.epistemic_authority).toBe("imported");
    expect(built.event.valid_time.start).toBe("2026-01-01T00:00:00Z");
    expect(built.event.recorded_time.start).toBe(recordedAt);
    expect(built.event.request_fingerprint).toMatch(/^sha-256:[a-f0-9]{64}$/);
    expect(validateConformance("canonicalEvent", built.event)).toEqual({ valid: true, errors: [] });
  });

  it("builds exactly one schema-valid non-empty SyncPushRequest", () => {
    const built = buildSyncPushRequest({
      envelope: {
        ...baseEnvelope,
        idempotency_key: "idem_explicit_synthetic_key_001",
      },
      recordedAt,
      trustZone,
      protectedValueRef,
      clientId: "client_synthetic",
    });

    expect(built.request.events).toHaveLength(1);
    expect(built.request.erasures).toEqual([]);
    expect(built.request.idempotency_key).toBe("idem_explicit_synthetic_key_001");
    expect(built.request.events[0]?.event_type).toBe("EvidenceArtifact");
    expect(validateConformance("syncApi", built.request)).toEqual({ valid: true, errors: [] });
  });

  it("does not store raw provider payload inline in the canonical event or push request", () => {
    const built = buildSyncPushRequest({
      envelope: {
        ...baseEnvelope,
        payload: {
          raw_secret_transcript: "SYNTHETIC_RAW_PAYLOAD_SENTINEL",
        },
      },
      recordedAt,
      trustZone,
      protectedValueRef,
      clientId: "client_synthetic",
    });

    expect(built.canonicalJson).not.toContain("SYNTHETIC_RAW_PAYLOAD_SENTINEL");
    expect(stableCanonicalJson(built.event)).not.toContain("SYNTHETIC_RAW_PAYLOAD_SENTINEL");
  });

  it("rejects invalid timestamps and invalid empty provenance", () => {
    expect(() =>
      buildEvidenceArtifactEvent({
        envelope: {
          ...baseEnvelope,
          captured_at: "not-a-timestamp",
        },
        recordedAt,
        trustZone,
        protectedValueRef,
      }),
    ).toThrow(/invalid timestamp/);

    expect(() =>
      buildEvidenceArtifactEvent({
        envelope: baseEnvelope,
        recordedAt: "not-a-timestamp",
        trustZone,
        protectedValueRef,
      }),
    ).toThrow(/invalid timestamp/);

    expect(() =>
      buildEvidenceArtifactEvent({
        envelope: {
          ...baseEnvelope,
          provider: "",
        },
        recordedAt,
        trustZone,
        protectedValueRef,
      }),
    ).toThrow(/provider is required/);

    expect(() =>
      buildEvidenceArtifactEvent({
        envelope: {
          ...baseEnvelope,
          hook_event_name: " ",
        },
        recordedAt,
        trustZone,
        protectedValueRef,
      }),
    ).toThrow(/hook_event_name is required/);

    expect(isIdempotencyKey("idem_explicit_synthetic_key_001")).toBe(true);
    expect(isIdempotencyKey("bad")).toBe(false);
    expect(() =>
      buildEvidenceArtifactEvent({
        envelope: {
          ...baseEnvelope,
          idempotency_key: "bad",
        },
        recordedAt,
        trustZone,
        protectedValueRef,
      }),
    ).toThrow(/idempotency_key must match/);

    expect(() =>
      buildEvidenceArtifactEvent({
        envelope: baseEnvelope,
        recordedAt,
        trustZone,
        protectedValueRef,
        provenance: [],
      }),
    ).toThrow(/invalid canonicalEvent/);
  });

  it("does not invent downstream knowledge events during raw capture", () => {
    const built = buildSyncPushRequest({
      envelope: baseEnvelope,
      recordedAt,
      trustZone,
      protectedValueRef,
      clientId: "client_synthetic",
    });

    expect(built.request.events.map((event) => event.event_type)).toEqual(["EvidenceArtifact"]);
    expect(built.canonicalJson).not.toContain("Observation");
    expect(built.canonicalJson).not.toContain("Claim");
    expect(built.canonicalJson).not.toContain("AcceptanceDecision");
  });

  it("keeps logical identity stable across recording metadata and encryption refs", () => {
    const changedProtectedValueRef: ProtectedValueRef = {
      ...protectedValueRef,
      vault_ref: "vault_synthetic_rotated",
      encrypted_blob: {
        ...protectedValueRef.encrypted_blob,
        nonce_ref: "nonce_synthetic_capture_fresh",
        tag_ref: "tag_synthetic_capture_fresh",
        digest: {
          algorithm: "sha-256",
          value: "b".repeat(64),
        },
      },
    };

    const first = buildEvidenceArtifactEvent({
      envelope: baseEnvelope,
      recordedAt,
      trustZone,
      protectedValueRef,
    });
    const second = buildEvidenceArtifactEvent({
      envelope: {
        ...baseEnvelope,
        workspace_root: "/synthetic/other-workspace",
      },
      recordedAt: "2026-01-01T01:02:04Z",
      trustZone,
      protectedValueRef: changedProtectedValueRef,
    });

    expect(second.event.idempotency_key).toBe(first.event.idempotency_key);
    expect(second.event.request_fingerprint).toBe(first.event.request_fingerprint);
    expect(second.event.recorded_time.start).not.toBe(first.event.recorded_time.start);
  });

  it("changes derived identity when source-valid capture time changes", () => {
    const first = buildEvidenceArtifactEvent({
      envelope: baseEnvelope,
      recordedAt,
      trustZone,
      protectedValueRef,
    });
    const second = buildEvidenceArtifactEvent({
      envelope: {
        ...baseEnvelope,
        captured_at: "2026-01-01T01:02:03Z",
      },
      recordedAt,
      trustZone,
      protectedValueRef,
    });

    expect(second.event.idempotency_key).not.toBe(first.event.idempotency_key);
    expect(second.event.request_fingerprint).not.toBe(first.event.request_fingerprint);
    expect(second.event.event_id).not.toBe(first.event.event_id);
  });

  it("changes fingerprint for changed payload even when explicit idempotency is reused", () => {
    const first = buildEvidenceArtifactEvent({
      envelope: {
        ...baseEnvelope,
        idempotency_key: "idem_explicit_synthetic_key_002",
        payload: { value: "first" },
      },
      recordedAt,
      trustZone,
      protectedValueRef,
    });
    const second = buildEvidenceArtifactEvent({
      envelope: {
        ...baseEnvelope,
        idempotency_key: "idem_explicit_synthetic_key_002",
        payload: { value: "second" },
      },
      recordedAt,
      trustZone,
      protectedValueRef,
    });

    expect(second.event.idempotency_key).toBe(first.event.idempotency_key);
    expect(second.event.request_fingerprint).not.toBe(first.event.request_fingerprint);
  });
});
