import { createHash } from "node:crypto";
import type {
  CanonicalEvent,
  ErasureLedgerRecord,
  RetrievalDerivation,
  RetrievalSourceRecord,
} from "@carpeos/schema";

export const RETRIEVAL_PROJECTION_VERSION = "retrieval/v1";
export const RETRIEVAL_CHUNKER_VERSION = "v1";

export function stableJson(value: unknown): string {
  return JSON.stringify(toStableJsonValue(value));
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Ref(value: string | Uint8Array): `sha-256:${string}` {
  return `sha-256:${sha256Hex(value)}`;
}

export function normalizeSourceRecords(
  records: readonly RetrievalSourceRecord[],
): RetrievalSourceRecord[] {
  if (records.length === 0) {
    throw new Error("source_records must not be empty");
  }

  const byKey = new Map<string, RetrievalSourceRecord>();
  for (const record of records) {
    byKey.set(sourceRecordKey(record), { ...record });
  }

  return [...byKey.values()].sort(compareSourceRecords);
}

export function makeInputManifestDigest(
  records: readonly RetrievalSourceRecord[],
): `sha-256:${string}` {
  return sha256Ref(stableJson(normalizeSourceRecords(records)));
}

export function makeRetrievalDerivation(input: {
  sourceRecords: readonly RetrievalSourceRecord[];
  config: unknown;
  algorithmVersion?: string;
}): RetrievalDerivation {
  return {
    algorithm: "canonical_retrieval_chunk_v1",
    algorithm_version: input.algorithmVersion ?? "v1",
    config_digest: sha256Ref(stableJson(input.config)),
    input_manifest_digest: makeInputManifestDigest(input.sourceRecords),
  };
}

export function eventSourceRecord(
  event: CanonicalEvent,
  relationshipRole: RetrievalSourceRecord["relationship_role"],
): RetrievalSourceRecord {
  if (event.zone_sequence === undefined) {
    throw new Error(`event ${event.event_id} must have zone_sequence for retrieval projection`);
  }

  return {
    source_record_kind: "event",
    source_record_id: event.event_id,
    trust_zone_id: event.trust_zone.trust_zone_id,
    zone_sequence: event.zone_sequence,
    source_fingerprint: event.request_fingerprint,
    relationship_role: relationshipRole,
    event_type: event.event_type,
    lifecycle_status: event.lifecycle_status,
    epistemic_authority: event.epistemic_authority,
    valid_time: event.valid_time,
    recorded_time: event.recorded_time,
  };
}

export function erasureSourceRecord(
  erasure: ErasureLedgerRecord,
  relationshipRole: Extract<RetrievalSourceRecord["relationship_role"], "erasure" | "lineage">,
): RetrievalSourceRecord {
  if (erasure.zone_sequence === undefined) {
    throw new Error(
      `erasure ${erasure.erasure_id} must have zone_sequence for retrieval projection`,
    );
  }

  return {
    source_record_kind: "erasure",
    source_record_id: erasure.erasure_id,
    trust_zone_id: erasure.trust_zone.trust_zone_id,
    zone_sequence: erasure.zone_sequence,
    source_fingerprint: sha256Ref(stableJson(erasure)),
    relationship_role: relationshipRole,
    recorded_time: {
      start: erasure.requested_at,
      end: erasure.completed_at,
    },
  };
}

export function compareSourceRecords(
  left: RetrievalSourceRecord,
  right: RetrievalSourceRecord,
): number {
  return sourceRecordSortKey(left).localeCompare(sourceRecordSortKey(right));
}

export function sourceRecordKey(record: RetrievalSourceRecord): string {
  return [
    record.source_record_kind,
    record.source_record_id,
    record.trust_zone_id,
    record.zone_sequence,
    record.relationship_role,
  ].join("\u0000");
}

export function sourceRecordSortKey(record: RetrievalSourceRecord): string {
  return [
    record.trust_zone_id,
    String(record.zone_sequence).padStart(16, "0"),
    record.source_record_kind,
    record.source_record_id,
    record.relationship_role,
  ].join("\u0000");
}

function toStableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toStableJsonValue(item));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, toStableJsonValue(entryValue)]),
    );
  }

  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
