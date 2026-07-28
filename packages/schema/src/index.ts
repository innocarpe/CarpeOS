import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchemaObject, ValidateFunction } from "ajv/dist/2020.js";
import canonicalEventSchema from "../../../spec/v1/schema/canonical-event.schema.json" with {
  type: "json",
};
import commonSchema from "../../../spec/v1/schema/common.schema.json" with { type: "json" };
import erasureLedgerSchema from "../../../spec/v1/schema/erasure-ledger.schema.json" with {
  type: "json",
};
import syncApiSchema from "../../../spec/v1/schema/sync-api.schema.json" with { type: "json" };

export const SCHEMA_VERSION = "v1" as const;

export const schemas = {
  common: commonSchema,
  canonicalEvent: canonicalEventSchema,
  erasureLedger: erasureLedgerSchema,
  syncApi: syncApiSchema,
} as const;

export type SchemaVersion = typeof SCHEMA_VERSION;

export type LifecycleStatus = "draft" | "active";

export type EpistemicAuthority =
  | "unverified"
  | "self_reported"
  | "observed"
  | "imported"
  | "derived"
  | "verified";

export type BitemporalInterval = {
  start: string;
  end: string | null;
};

export type Digest = {
  algorithm: "sha-256" | "sha-384" | "sha-512" | "blake3";
  value: string;
};

export type ProvenanceRef = {
  ref_type: "event" | "artifact" | "claim" | "observation" | "external";
  ref_id: string;
  relationship?: "derived_from" | "supports" | "contradicts" | "quotes" | "supersedes" | "redacts";
};

export type TrustZone = {
  trust_zone_id: string;
  isolation: "local_device" | "user_cloud" | "managed_service";
  region?: string;
  boundary_purpose?: string;
};

export type ProtectedValueRef = {
  ref_type: "protected_value";
  protected_value_id: string;
  vault_ref: string;
  key_ref: string;
  encrypted_blob: {
    algorithm: "aes-256-gcm" | "xchacha20-poly1305";
    nonce_ref: string;
    tag_ref: string;
    digest: Digest;
    size_bytes: number;
  };
};

export type ExternalContentRef = {
  ref_type: "external_uri";
  uri: string;
  digest: Digest;
  visibility: "private" | "shared" | "public";
  reachability: "online" | "offline_snapshot" | "unreachable";
};

export type EvidenceArtifact = {
  artifact_id: string;
  kind: "document" | "image" | "audio" | "dataset" | "message" | "other";
  media_type: string;
  content_ref: ProtectedValueRef | ExternalContentRef;
  lineage?: ProvenanceRef[];
};

export type Observation = {
  observation_id: string;
  observed_at: string;
  statement: string;
  evidence_artifact_refs: string[];
  confidence?: number;
};

export type Claim = {
  claim_id: string;
  statement: string;
  claim_type: "factual" | "inference" | "decision";
  support: ProvenanceRef[];
  confidence?: number;
};

export type AcceptanceDecision = {
  decision_id: string;
  claim_refs: string[];
  decision: "accepted" | "rejected" | "needs_review";
  decided_by: string;
  decided_at: string;
  rationale?: string;
};

export type Supersession = {
  supersession_id: string;
  supersedes_event_id: string;
  replacement_event_id?: string;
  reason: string;
};

export type EventType =
  | "EvidenceArtifact"
  | "Observation"
  | "Claim"
  | "AcceptanceDecision"
  | "Supersession";

export type EventPayloadByType = {
  EvidenceArtifact: EvidenceArtifact;
  Observation: Observation;
  Claim: Claim;
  AcceptanceDecision: AcceptanceDecision;
  Supersession: Supersession;
};

export type EventPayload = EventPayloadByType[EventType];

type CanonicalEventBase = {
  schema_version: SchemaVersion;
  event_id: string;
  subject_ref: string;
  valid_time: BitemporalInterval;
  recorded_time: BitemporalInterval;
  lifecycle_status: LifecycleStatus;
  epistemic_authority: EpistemicAuthority;
  trust_zone: TrustZone;
  provenance: ProvenanceRef[];
  idempotency_key: string;
  request_fingerprint: string;
  zone_sequence?: number;
};

export type CanonicalEvent<TEventType extends EventType = EventType> = TEventType extends EventType
  ? CanonicalEventBase & {
      event_type: TEventType;
      payload: EventPayloadByType[TEventType];
    }
  : never;

export type CryptoShredErasureTargetRef = {
  target_kind: "protected_value" | "key";
  target_id: string;
  reason?: string;
};

export type ProjectionDeleteErasureTargetRef = {
  target_kind: "projection";
  target_id: string;
  reason?: string;
};

export type TombstoneErasureTargetRef =
  | {
      target_kind: "event";
      target_id: string;
      reason?: string;
    }
  | {
      target_kind: "artifact";
      target_id: string;
      reason?: string;
    };

export type ErasureTargetRef =
  | CryptoShredErasureTargetRef
  | ProjectionDeleteErasureTargetRef
  | TombstoneErasureTargetRef;

type ErasureLedgerRecordBase = {
  schema_version: SchemaVersion;
  erasure_id: string;
  requested_at: string;
  completed_at: string | null;
  actor_ref: string;
  trust_zone: TrustZone;
  zone_sequence?: number;
  evidence_refs: ProvenanceRef[];
};

export type CryptoShredErasureLedgerRecord = ErasureLedgerRecordBase & {
  method: "crypto_shred";
  target_ref: CryptoShredErasureTargetRef;
};

export type ProjectionDeleteErasureLedgerRecord = ErasureLedgerRecordBase & {
  method: "projection_delete";
  target_ref: ProjectionDeleteErasureTargetRef;
};

export type TombstoneErasureLedgerRecord = ErasureLedgerRecordBase & {
  method: "tombstone";
  target_ref: TombstoneErasureTargetRef;
};

export type ErasureLedgerRecord =
  | CryptoShredErasureLedgerRecord
  | ProjectionDeleteErasureLedgerRecord
  | TombstoneErasureLedgerRecord;

export type SyncErrorItem = {
  code:
    | "invalid_schema"
    | "replay"
    | "idempotency_conflict"
    | "unauthorized"
    | "not_found"
    | "protected_value_missing"
    | "protected_value_digest_mismatch"
    | "protected_value_orphaned"
    | "internal_error";
  message: string;
  ref_id?: string;
};

export type WrappedDeviceKeyEnvelope = {
  schema_version: SchemaVersion;
  envelope_version: "wrapped-device-key/v1";
  wrapping_algorithm: "aes-256-gcm";
  encoding: "base64url";
  wrap_key_ref: string;
  wrapped_key_ref: string;
  wrap_nonce: string;
  wrap_auth_tag: string;
  wrapped_key_ciphertext: string;
  wrapped_key_digest: Digest;
  wrapped_key_size_bytes: number;
  aad: {
    trust_zone_id: string;
    protected_value_id: string;
    key_ref: string;
  };
};

export type ProtectedValueUploadIntent = {
  schema_version: SchemaVersion;
  intent_type: "protected_value_upload";
  protected_value_id: string;
  trust_zone_id: string;
  vault_ref: string;
  key_ref: string;
  object_key: string;
  encryption_algorithm: "aes-256-gcm";
  encoding: "base64url";
  ciphertext_nonce: string;
  ciphertext_auth_tag: string;
  original_ciphertext_digest: Digest;
  original_ciphertext_size_bytes: number;
  nonce_ref?: string;
  tag_ref?: string;
  wrapped_device_key: WrappedDeviceKeyEnvelope;
};

export type ProtectedValueUploadReceipt = {
  schema_version: SchemaVersion;
  receipt_type: "protected_value_upload";
  protected_value_id: string;
  trust_zone_id: string;
  object_key: string;
  original_ciphertext_digest: Digest;
  original_ciphertext_size_bytes: number;
  uploaded_at: string;
  status: "uploaded" | "already_exists";
  upload_receipt_id: string;
};

export type ProtectedValueMetadata = {
  schema_version: SchemaVersion;
  metadata_type: "protected_value";
  protected_value_id: string;
  trust_zone_id: string;
  object_key: string;
  vault_ref: string;
  encryption_algorithm: "aes-256-gcm";
  encoding: "base64url";
  ciphertext_nonce: string;
  ciphertext_auth_tag: string;
  original_ciphertext_digest: Digest;
  original_ciphertext_size_bytes: number;
  nonce_ref?: string;
  tag_ref?: string;
  key_ref: string;
  wrapped_device_key: WrappedDeviceKeyEnvelope;
  linked_event_ids: string[];
  orphan_status: "linked" | "orphaned";
  uploaded_at: string;
};

export type SyncPushRequestBase = {
  schema_version: SchemaVersion;
  request_id: string;
  client_id: string;
  trust_zone_id: string;
  idempotency_key: string;
  request_fingerprint: string;
  protected_value_receipts?: ProtectedValueUploadReceipt[];
};

export type SyncPushEventRequest = SyncPushRequestBase & {
  events: [CanonicalEvent];
  erasures: [];
};

export type SyncPushErasureRequest = SyncPushRequestBase & {
  events: [];
  erasures: [ErasureLedgerRecord];
};

export type SyncPushRequest = SyncPushEventRequest | SyncPushErasureRequest;

export type SyncPushResult = {
  schema_version: SchemaVersion;
  request_id: string;
  status: "accepted" | "replay" | "idempotency_conflict" | "partial_error";
  accepted_event_ids: string[];
  accepted_erasure_ids: string[];
  zone_sequences?: Array<{ trust_zone_id: string; last_sequence: number }>;
  replay_of?: string;
  conflict_with?: string;
  errors: SyncErrorItem[];
};

export type SyncPullRequest = {
  schema_version: SchemaVersion;
  client_id: string;
  trust_zone_id: string;
  after_sequence?: number;
  recorded_after?: string;
  limit: number;
};

export type SyncPullResult = {
  schema_version: SchemaVersion;
  events: CanonicalEvent[];
  erasures: ErasureLedgerRecord[];
  cursor?: string;
  after_sequence?: number;
  has_more: boolean;
};

export type SyncError = {
  schema_version: SchemaVersion;
  error: SyncErrorItem;
};

export type SyncApiMessage =
  | ProtectedValueUploadIntent
  | ProtectedValueUploadReceipt
  | ProtectedValueMetadata
  | SyncPushRequest
  | SyncPushResult
  | SyncPullRequest
  | SyncPullResult
  | SyncError;

export type IdempotencyInput = {
  trust_zone_id: string;
  idempotency_key: string;
  request_fingerprint: string;
};

export type IdempotencyClassification = "new_request" | "replay" | "idempotency_conflict";

export type SchemaName = keyof typeof schemas;

export type SchemaValidatorSet = Record<SchemaName, ValidateFunction>;

export type ConformanceResult = {
  valid: boolean;
  errors: string[];
};

export function createAjv2020() {
  const ajv = new Ajv2020({ allErrors: true });

  for (const schema of Object.values(schemas)) {
    ajv.addSchema(schema as AnySchemaObject);
  }

  return ajv;
}

export function compileSchemaValidators(): SchemaValidatorSet {
  const ajv = createAjv2020();

  return {
    common: mustGetSchema(ajv, schemas.common.$id),
    canonicalEvent: mustGetSchema(ajv, schemas.canonicalEvent.$id),
    erasureLedger: mustGetSchema(ajv, schemas.erasureLedger.$id),
    syncApi: mustGetSchema(ajv, schemas.syncApi.$id),
  };
}

export function classifyIdempotency(
  existing: IdempotencyInput | undefined,
  incoming: IdempotencyInput,
): IdempotencyClassification {
  if (
    existing === undefined ||
    existing.trust_zone_id !== incoming.trust_zone_id ||
    existing.idempotency_key !== incoming.idempotency_key
  ) {
    return "new_request";
  }

  if (existing.request_fingerprint === incoming.request_fingerprint) {
    return "replay";
  }

  return "idempotency_conflict";
}

export function isBitemporalIntervalValid(interval: BitemporalInterval): boolean {
  if (!isTimestampValid(interval.start)) {
    return false;
  }

  if (interval.end === null) {
    return true;
  }

  if (!isTimestampValid(interval.end)) {
    return false;
  }

  return Date.parse(interval.start) <= Date.parse(interval.end);
}

export function collectBitemporalErrors(
  event: Pick<CanonicalEvent, "valid_time" | "recorded_time">,
): string[] {
  const errors: string[] = [];

  if (!isBitemporalIntervalValid(event.valid_time)) {
    errors.push("valid_time.start must be before or equal to valid_time.end");
  }

  if (!isBitemporalIntervalValid(event.recorded_time)) {
    errors.push("recorded_time.start must be before or equal to recorded_time.end");
  }

  return errors;
}

export function validateConformance(schemaName: SchemaName, value: unknown): ConformanceResult {
  const validate = compileSchemaValidators()[schemaName];
  const shapeValid = validate(value);
  const errors = shapeValid ? [] : normalizeAjvErrors(validate);

  if (schemaName === "canonicalEvent" && isCanonicalEventLike(value)) {
    errors.push(...collectBitemporalErrors(value));
  }

  if (schemaName === "syncApi" && isObject(value)) {
    errors.push(...collectSyncSemanticErrors(value));
    errors.push(...collectProtectedTransferSemanticErrors(value));
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function mustGetSchema(ajv: Ajv2020, schemaId: string): ValidateFunction {
  const validate = ajv.getSchema(schemaId);

  if (validate === undefined) {
    throw new Error(`Schema was not compiled: ${schemaId}`);
  }

  return validate;
}

function isTimestampValid(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    return false;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  const normalized = parsed.toISOString();
  return normalized === value || normalized.replace(".000Z", "Z") === value;
}

function normalizeAjvErrors(validate: ValidateFunction): string[] {
  return (validate.errors ?? []).map((error) => {
    const location = error.instancePath || "/";
    return `${location} ${error.message ?? "failed schema validation"}`;
  });
}

function collectSyncSemanticErrors(message: Record<string, unknown>): string[] {
  if (!isSyncPushRequestLike(message)) {
    return [];
  }

  const errors: string[] = [];

  if (message.events.length === 0 && message.erasures.length === 0) {
    errors.push("sync push request must contain at least one event or erasure");
  }

  for (const event of message.events) {
    if (isCanonicalEventLike(event)) {
      errors.push(...collectBitemporalErrors(event));

      if (event.trust_zone.trust_zone_id !== message.trust_zone_id) {
        errors.push(
          `event ${event.event_id} trust_zone_id must match sync push trust_zone_id ${message.trust_zone_id}`,
        );
      }

      const protectedRef = getEventProtectedValueRef(event);
      if (protectedRef !== undefined && Array.isArray(message.protected_value_receipts)) {
        const receipt = message.protected_value_receipts.find(
          (item) => isObject(item) && item.protected_value_id === protectedRef.protected_value_id,
        );

        if (receipt === undefined) {
          errors.push(
            `event ${event.event_id} protected_value_id ${protectedRef.protected_value_id} has no matching upload receipt`,
          );
        } else {
          if (receipt.trust_zone_id !== message.trust_zone_id) {
            errors.push(
              `upload receipt ${protectedRef.protected_value_id} trust_zone_id must match sync push trust_zone_id ${message.trust_zone_id}`,
            );
          }

          const receiptDigest = isObject(receipt.original_ciphertext_digest)
            ? receipt.original_ciphertext_digest
            : undefined;
          if (
            isDigestLike(receiptDigest) &&
            (receiptDigest.algorithm !== protectedRef.encrypted_blob.digest.algorithm ||
              receiptDigest.value !== protectedRef.encrypted_blob.digest.value)
          ) {
            errors.push(
              `upload receipt ${protectedRef.protected_value_id} digest must match event protected value digest`,
            );
          }

          if (receipt.original_ciphertext_size_bytes !== protectedRef.encrypted_blob.size_bytes) {
            errors.push(
              `upload receipt ${protectedRef.protected_value_id} size must match event protected value size`,
            );
          }
        }
      }
    }
  }

  for (const erasure of message.erasures) {
    if (
      isObject(erasure) &&
      isObject(erasure.trust_zone) &&
      typeof erasure.erasure_id === "string" &&
      erasure.trust_zone.trust_zone_id !== message.trust_zone_id
    ) {
      errors.push(
        `erasure ${erasure.erasure_id} trust_zone_id must match sync push trust_zone_id ${message.trust_zone_id}`,
      );
    }
  }

  return errors;
}

function collectProtectedTransferSemanticErrors(message: Record<string, unknown>): string[] {
  if (!isProtectedTransferLike(message)) {
    return [];
  }

  const errors: string[] = [];
  const aad = message.wrapped_device_key.aad;

  if (aad.trust_zone_id !== message.trust_zone_id) {
    errors.push("wrapped device-key aad.trust_zone_id must match protected value trust_zone_id");
  }

  if (aad.protected_value_id !== message.protected_value_id) {
    errors.push("wrapped device-key aad.protected_value_id must match protected_value_id");
  }

  if (aad.key_ref !== message.key_ref) {
    errors.push("wrapped device-key aad.key_ref must match key_ref");
  }

  if (
    typeof message.object_key === "string" &&
    !message.object_key.includes(`/${message.protected_value_id}/`)
  ) {
    errors.push("protected value object_key must include protected_value_id");
  }

  return errors;
}

function isSyncPushRequestLike(value: Record<string, unknown>): value is SyncPushRequest {
  return (
    typeof value.trust_zone_id === "string" &&
    Array.isArray(value.events) &&
    Array.isArray(value.erasures)
  );
}

function isCanonicalEventLike(value: unknown): value is CanonicalEvent {
  return (
    isObject(value) &&
    isObject(value.valid_time) &&
    isObject(value.recorded_time) &&
    isObject(value.trust_zone) &&
    typeof value.event_id === "string" &&
    typeof value.trust_zone.trust_zone_id === "string" &&
    typeof value.valid_time.start === "string" &&
    (typeof value.valid_time.end === "string" || value.valid_time.end === null) &&
    typeof value.recorded_time.start === "string" &&
    (typeof value.recorded_time.end === "string" || value.recorded_time.end === null)
  );
}

function getEventProtectedValueRef(event: CanonicalEvent): ProtectedValueRef | undefined {
  const payload: unknown = event.payload;

  if (
    isObject(payload) &&
    isObject(payload.content_ref) &&
    payload.content_ref.ref_type === "protected_value" &&
    typeof payload.content_ref.protected_value_id === "string" &&
    isObject(payload.content_ref.encrypted_blob) &&
    isObject(payload.content_ref.encrypted_blob.digest) &&
    typeof payload.content_ref.encrypted_blob.size_bytes === "number"
  ) {
    return payload.content_ref as ProtectedValueRef;
  }

  return undefined;
}

function isProtectedTransferLike(
  value: Record<string, unknown>,
): value is ProtectedValueUploadIntent | ProtectedValueMetadata {
  return (
    (value.intent_type === "protected_value_upload" || value.metadata_type === "protected_value") &&
    typeof value.protected_value_id === "string" &&
    typeof value.trust_zone_id === "string" &&
    typeof value.key_ref === "string" &&
    typeof value.object_key === "string" &&
    isObject(value.wrapped_device_key) &&
    isObject(value.wrapped_device_key.aad) &&
    typeof value.wrapped_device_key.aad.trust_zone_id === "string" &&
    typeof value.wrapped_device_key.aad.protected_value_id === "string" &&
    typeof value.wrapped_device_key.aad.key_ref === "string"
  );
}

function isDigestLike(value: unknown): value is Digest {
  return isObject(value) && typeof value.algorithm === "string" && typeof value.value === "string";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
