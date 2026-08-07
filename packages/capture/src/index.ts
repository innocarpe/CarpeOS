import { createHash } from "node:crypto";
import type {
  CanonicalEvent,
  ProtectedValueRef,
  ProvenanceRef,
  SyncPushRequest,
  TrustZone,
} from "@carpeos/schema";
import { validateConformance } from "@carpeos/schema";

export {
  buildRunLedgerEntry,
  completeRunLedgerEntry,
  linkEventsToRun,
  type BuildRunLedgerEntryInput,
  type RunLedgerEntry,
  type RunLedgerStatus,
} from "./run-ledger.js";

export {
  DEFAULT_EXTRACTION_EXCLUDED_HOOK_EVENTS,
  DEFAULT_EXTRACTION_HOOK_EVENTS,
  DEFAULT_MEANINGFUL_UNIT_POLICY,
  KNOWN_CAPTURE_HOOK_EVENTS,
  MEANINGFUL_UNIT_POLICY_VERSION,
  OBSERVATION_VS_CLAIM_MVP,
  OPTIONAL_EXTRACTION_NOTIFY_EVENTS,
  assertSafeMeaningfulUnitText,
  containsSecretLikeMaterial,
  defaultMeaningfulUnitPolicySnapshot,
  isHookEligibleForExtraction,
  normalizeCaptureHookEventName,
  recommendExtractionTarget,
  resolveMeaningfulUnitPolicy,
  type CaptureHookEventName,
  type ExtractionTargetKind,
  type MeaningfulUnitPolicyConfig,
  type PostToolUseExtractionMode,
} from "./meaningful-unit-policy.js";

export {
  buildMetadataObservationStatement,
  extractionObservationIdempotencyKey,
  planObservationExtraction,
  type ExtractionMetadataInput,
  type ObservationExtractionPlan,
} from "./extract-observation.js";

export {
  ADJUDICATION_POLICY_VERSION,
  adjudicateKnowledgeCandidate,
  adjudicationIdempotencyKey,
  buildCandidateStatement,
  extractKnowledgeCandidateSpans,
  type AdjudicationResult,
  type AdjudicationScores,
  type KnowledgeCandidate,
  type KnowledgeCandidateKind,
  type KnowledgeCandidateSpan,
  type KnowledgeDisposition,
  type KnowledgeEvidenceRef,
} from "./adjudication.js";

export {
  isAllowedTranscriptPath,
  readTranscriptTail,
  signalsFromTranscriptPath,
  signalsFromTranscriptText,
  type TranscriptSignals,
} from "./transcript-signals.js";

export {
  AGENTIC_FEED_LIFECYCLE_HOOKS,
  agenticFeedHookPreferRankSql,
  isAgenticFeedHookEligible,
  normalizeAgenticFeedHook,
  type AgenticFeedLifecycleHook,
} from "./agentic-feed-policy.js";

/** Media type for agent thinking/tool histories captured as protected evidence. */
export const PROCEDURE_TRACE_MEDIA_TYPE = "application/vnd.carpeos.procedure-trace+json" as const;

export type ProcedureTraceCompleteness = "full" | "partial" | "redacted";

export type ProcedureTraceMetadata = {
  provider: string;
  session_id: string;
  turn_id?: string;
  completeness: ProcedureTraceCompleteness;
  has_reasoning?: boolean;
  has_tool_calls?: boolean;
};

export type CaptureEnvelope = {
  provider: string;
  hook_event_name: string;
  captured_at: string;
  payload: unknown;
  workspace_root?: string;
  session_id?: string;
  source_event_id?: string;
  media_type?: string;
  subject_ref?: string;
  trust_zone_id?: string;
  idempotency_key?: string;
  /** Optional procedure-memory metadata. Does not grant epistemic acceptance. */
  procedure_trace?: ProcedureTraceMetadata;
};

export type ProtectedContentDescriptor = {
  protected_value_id: string;
  vault_ref: string;
  key_ref: string;
  nonce_ref: string;
  tag_ref: string;
  digest: {
    algorithm: "sha-256";
    value: string;
  };
  size_bytes: number;
};

export type BuildEvidenceArtifactEventInput = {
  envelope: CaptureEnvelope;
  recordedAt: string;
  trustZone: TrustZone;
  protectedValueRef?: ProtectedValueRef;
  protectedContent?: ProtectedContentDescriptor;
  provenance?: readonly ProvenanceRef[];
};

export type BuildSyncPushRequestInput = {
  envelope: CaptureEnvelope;
  recordedAt: string;
  trustZone: TrustZone;
  protectedValueRef?: ProtectedValueRef;
  protectedContent?: ProtectedContentDescriptor;
  clientId: string;
  provenance?: readonly ProvenanceRef[];
};

export type BuiltEvidenceArtifactEvent = {
  event: CanonicalEvent<"EvidenceArtifact">;
  canonicalJson: string;
  requestFingerprint: string;
};

export type BuiltSyncPushRequest = {
  request: SyncPushRequest;
  canonicalJson: string;
  requestFingerprint: string;
  event: CanonicalEvent<"EvidenceArtifact">;
};

export function buildEvidenceArtifactEvent(
  input: BuildEvidenceArtifactEventInput,
): BuiltEvidenceArtifactEvent {
  validateEnvelope(input.envelope);
  const capturedAt = normalizeTimestamp(input.envelope.captured_at);
  const recordedAt = normalizeTimestamp(input.recordedAt);
  const provenance = [...(input.provenance ?? [deriveSourceProvenance(input.envelope)])];
  const protectedValueRef = resolveProtectedValueRef(input);
  const idempotencyKey =
    input.envelope.idempotency_key ??
    deriveIdempotencyKey(input.envelope, input.trustZone.trust_zone_id);
  const requestFingerprint = fingerprintEnvelope(input.envelope, input.trustZone.trust_zone_id);
  const eventSeed = `${input.trustZone.trust_zone_id}:${idempotencyKey}:${requestFingerprint}`;
  const eventDigest = sha256Hex(eventSeed);
  const event: CanonicalEvent<"EvidenceArtifact"> = {
    schema_version: "v1",
    event_id: `evt_${eventDigest.slice(0, 32)}`,
    event_type: "EvidenceArtifact",
    subject_ref: normalizeIdentifier(
      input.envelope.subject_ref ?? `subject_${eventDigest.slice(0, 16)}`,
    ),
    valid_time: {
      start: capturedAt,
      end: null,
    },
    recorded_time: {
      start: recordedAt,
      end: null,
    },
    lifecycle_status: "active",
    epistemic_authority: "imported",
    trust_zone: input.trustZone,
    provenance,
    idempotency_key: idempotencyKey,
    request_fingerprint: requestFingerprint,
    payload: {
      artifact_id: `art_${eventDigest.slice(32, 64)}`,
      kind: resolveEvidenceKind(input.envelope),
      media_type: resolveMediaType(input.envelope),
      content_ref: protectedValueRef,
      lineage: provenance,
    },
  };

  assertConformance("canonicalEvent", event);

  return {
    event,
    canonicalJson: stableCanonicalJson(event),
    requestFingerprint,
  };
}

export function buildSyncPushRequest(input: BuildSyncPushRequestInput): BuiltSyncPushRequest {
  const builtEvent = buildEvidenceArtifactEvent(input);
  const requestId = makeIdentifier("req", {
    client_id: input.clientId,
    event_id: builtEvent.event.event_id,
    request_fingerprint: builtEvent.requestFingerprint,
  });
  const request: SyncPushRequest = {
    schema_version: "v1",
    request_id: requestId,
    client_id: input.clientId,
    trust_zone_id: input.trustZone.trust_zone_id,
    idempotency_key: builtEvent.event.idempotency_key,
    request_fingerprint: builtEvent.requestFingerprint,
    events: [builtEvent.event],
    erasures: [],
  };

  assertConformance("syncApi", request);

  return {
    request,
    canonicalJson: stableCanonicalJson(request),
    requestFingerprint: builtEvent.requestFingerprint,
    event: builtEvent.event,
  };
}

export function deriveIdempotencyKey(envelope: CaptureEnvelope, trustZoneId: string): string {
  validateEnvelope(envelope);
  return `idem_${sha256Hex(
    stableCanonicalJson({
      provider: envelope.provider,
      hook_event_name: envelope.hook_event_name,
      captured_at: normalizeTimestamp(envelope.captured_at),
      session_id: envelope.session_id,
      source_event_id: envelope.source_event_id,
      subject_ref: envelope.subject_ref,
      trust_zone_id: trustZoneId,
      envelope_trust_zone_id: envelope.trust_zone_id,
      media_type: resolveMediaType(envelope),
      procedure_trace: envelope.procedure_trace ?? null,
      payload: envelope.payload,
    }),
  ).slice(0, 32)}`;
}

export function isIdempotencyKey(value: string): boolean {
  return /^idem_[A-Za-z0-9_-]{16,128}$/.test(value);
}

export function fingerprintEnvelope(envelope: CaptureEnvelope, trustZoneId: string): string {
  validateEnvelope(envelope);
  return fingerprintObject({
    provider: envelope.provider,
    hook_event_name: envelope.hook_event_name,
    captured_at: normalizeTimestamp(envelope.captured_at),
    session_id: envelope.session_id,
    source_event_id: envelope.source_event_id,
    media_type: resolveMediaType(envelope),
    subject_ref: envelope.subject_ref,
    trust_zone_id: trustZoneId,
    envelope_trust_zone_id: envelope.trust_zone_id,
    procedure_trace: envelope.procedure_trace ?? null,
    payload: envelope.payload,
  });
}

export function isProcedureTraceMediaType(mediaType: string | undefined): boolean {
  return mediaType === PROCEDURE_TRACE_MEDIA_TYPE;
}

export function isProcedureTraceEnvelope(envelope: CaptureEnvelope): boolean {
  return envelope.procedure_trace !== undefined || isProcedureTraceMediaType(envelope.media_type);
}

export function resolveMediaType(envelope: CaptureEnvelope): string {
  if (envelope.media_type !== undefined && envelope.media_type.trim() !== "") {
    return envelope.media_type;
  }
  if (envelope.procedure_trace !== undefined) {
    return PROCEDURE_TRACE_MEDIA_TYPE;
  }
  return "application/json";
}

export function resolveEvidenceKind(envelope: CaptureEnvelope): "message" | "procedure_trace" {
  return isProcedureTraceEnvelope(envelope) ? "procedure_trace" : "message";
}

/**
 * Build a capture envelope for synthetic or adapter-supplied procedure traces.
 * Payload remains opaque JSON; callers encrypt it via the local store path.
 */
export function buildProcedureTraceEnvelope(input: {
  provider: string;
  hook_event_name: string;
  captured_at: string;
  session_id: string;
  payload: unknown;
  completeness?: ProcedureTraceCompleteness;
  turn_id?: string;
  has_reasoning?: boolean;
  has_tool_calls?: boolean;
  subject_ref?: string;
  workspace_root?: string;
  source_event_id?: string;
  idempotency_key?: string;
}): CaptureEnvelope {
  const completeness = input.completeness ?? "partial";
  return {
    provider: input.provider,
    hook_event_name: input.hook_event_name,
    captured_at: input.captured_at,
    session_id: input.session_id,
    media_type: PROCEDURE_TRACE_MEDIA_TYPE,
    payload: input.payload,
    procedure_trace: {
      provider: input.provider,
      session_id: input.session_id,
      completeness,
      ...(input.turn_id === undefined ? {} : { turn_id: input.turn_id }),
      ...(input.has_reasoning === undefined ? {} : { has_reasoning: input.has_reasoning }),
      ...(input.has_tool_calls === undefined ? {} : { has_tool_calls: input.has_tool_calls }),
    },
    ...(input.subject_ref === undefined ? {} : { subject_ref: input.subject_ref }),
    ...(input.workspace_root === undefined ? {} : { workspace_root: input.workspace_root }),
    ...(input.source_event_id === undefined ? {} : { source_event_id: input.source_event_id }),
    ...(input.idempotency_key === undefined ? {} : { idempotency_key: input.idempotency_key }),
  };
}

export function fingerprintObject(value: unknown): string {
  return `sha-256:${sha256Hex(stableCanonicalJson(value))}`;
}

export function stableCanonicalJson(value: unknown): string {
  return JSON.stringify(toCanonicalJsonValue(value));
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export const stableJson = stableCanonicalJson;
export const hashHex = sha256Hex;

function validateEnvelope(envelope: CaptureEnvelope): void {
  if (envelope.provider.trim().length === 0) {
    throw new Error("provider is required");
  }

  if (envelope.hook_event_name.trim().length === 0) {
    throw new Error("hook_event_name is required");
  }

  if (envelope.idempotency_key !== undefined && !isIdempotencyKey(envelope.idempotency_key)) {
    throw new Error("idempotency_key must match idem_[A-Za-z0-9_-]{16,128}");
  }
}

function assertConformance(schemaName: "canonicalEvent" | "syncApi", value: unknown): void {
  const conformance = validateConformance(schemaName, value);

  if (!conformance.valid) {
    throw new Error(`invalid ${schemaName}: ${conformance.errors.join("; ")}`);
  }
}

function deriveSourceProvenance(envelope: CaptureEnvelope): ProvenanceRef {
  const providerSlug = slugIdentifierPart(envelope.provider);
  const lineageHash = sha256Hex(
    stableCanonicalJson({
      provider: envelope.provider,
      hook_event_name: envelope.hook_event_name,
      session_id: envelope.session_id,
      source_event_id: envelope.source_event_id,
    }),
  ).slice(0, 24);

  return {
    ref_type: "external",
    ref_id: `external_${providerSlug}_${lineageHash}`,
    relationship: "derived_from",
  };
}

function resolveProtectedValueRef(input: BuildEvidenceArtifactEventInput): ProtectedValueRef {
  if (input.protectedValueRef !== undefined) {
    return input.protectedValueRef;
  }

  if (input.protectedContent !== undefined) {
    return {
      ref_type: "protected_value",
      protected_value_id: input.protectedContent.protected_value_id,
      vault_ref: input.protectedContent.vault_ref,
      key_ref: input.protectedContent.key_ref,
      encrypted_blob: {
        algorithm: "aes-256-gcm",
        nonce_ref: input.protectedContent.nonce_ref,
        tag_ref: input.protectedContent.tag_ref,
        digest: input.protectedContent.digest,
        size_bytes: input.protectedContent.size_bytes,
      },
    };
  }

  throw new Error("protectedValueRef or protectedContent is required");
}

function slugIdentifierPart(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+/g, "_")
    .slice(0, 40);

  return /^[a-z][a-z0-9_:-]{0,39}$/.test(slug) ? slug : "provider";
}

function normalizeTimestamp(value: string): string {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`invalid timestamp: ${value}`);
  }

  return parsed.toISOString().replace(".000Z", "Z");
}

function normalizeIdentifier(value: string): string {
  const candidate = value
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, "_")
    .replace(/^[^a-z]+/, "subject_")
    .replace(/_+/g, "_")
    .slice(0, 128);

  if (/^[a-z][a-z0-9_:-]{2,127}$/.test(candidate)) {
    return candidate;
  }

  return `subject_${sha256Hex(value).slice(0, 16)}`;
}

function makeIdentifier(prefix: string, value: unknown): string {
  return `${prefix}_${sha256Hex(stableCanonicalJson(value)).slice(0, 32)}`;
}

function toCanonicalJsonValue(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("canonical JSON does not support non-finite numbers");
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => {
      const canonicalItem = toCanonicalJsonValue(item);
      return canonicalItem === undefined ? null : canonicalItem;
    });
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, entryValue]) => [key, toCanonicalJsonValue(entryValue)] as const)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => compareCodePointOrder(left, right));

    return Object.fromEntries(entries);
  }

  throw new Error(`canonical JSON does not support ${typeof value}`);
}

function compareCodePointOrder(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}
