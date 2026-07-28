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
    | "internal_error";
  message: string;
  ref_id?: string;
};

export type SyncPushRequest = {
  schema_version: SchemaVersion;
  request_id: string;
  client_id: string;
  trust_zone_id: string;
  idempotency_key: string;
  request_fingerprint: string;
  events: CanonicalEvent[];
  erasures: ErasureLedgerRecord[];
};

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
  has_more: boolean;
};

export type SyncError = {
  schema_version: SchemaVersion;
  error: SyncErrorItem;
};

export type SyncApiMessage =
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

  for (const event of message.events) {
    if (isCanonicalEventLike(event)) {
      errors.push(...collectBitemporalErrors(event));

      if (event.trust_zone.trust_zone_id !== message.trust_zone_id) {
        errors.push(
          `event ${event.event_id} trust_zone_id must match sync push trust_zone_id ${message.trust_zone_id}`,
        );
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
