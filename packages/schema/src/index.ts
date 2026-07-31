import type { AnySchemaObject } from "ajv/dist/2020.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import canonicalEventSchema from "../../../spec/v1/schema/canonical-event.schema.json" with {
  type: "json",
};
import commonSchema from "../../../spec/v1/schema/common.schema.json" with { type: "json" };
import erasureLedgerSchema from "../../../spec/v1/schema/erasure-ledger.schema.json" with {
  type: "json",
};
import mcpApiSchema from "../../../spec/v1/schema/mcp-api.schema.json" with { type: "json" };
import obsidianProjectionSchema from "../../../spec/v1/schema/obsidian-projection.schema.json" with {
  type: "json",
};
import retrievalProjectionSchema from "../../../spec/v1/schema/retrieval-projection.schema.json" with {
  type: "json",
};
import syncApiSchema from "../../../spec/v1/schema/sync-api.schema.json" with { type: "json" };
import { standaloneValidators } from "./generated/standalone-validators.js";

export const SCHEMA_VERSION = "v1" as const;

export const schemas = {
  common: commonSchema,
  canonicalEvent: canonicalEventSchema,
  erasureLedger: erasureLedgerSchema,
  mcpApi: mcpApiSchema,
  obsidianProjection: obsidianProjectionSchema,
  retrievalProjection: retrievalProjectionSchema,
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

export type EvidenceKind =
  | "document"
  | "image"
  | "audio"
  | "dataset"
  | "message"
  | "procedure_trace"
  | "other";

export type EvidenceArtifact = {
  artifact_id: string;
  kind: EvidenceKind;
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

export type RetrievalSourceRecordKind = "event" | "erasure";

export type RetrievalRelationshipRole =
  | "primary"
  | "support"
  | "acceptance"
  | "supersession"
  | "erasure"
  | "lineage";

export type RetrievalSourceRecord = {
  source_record_kind: RetrievalSourceRecordKind;
  source_record_id: string;
  trust_zone_id: string;
  zone_sequence: number;
  source_fingerprint: string;
  relationship_role: RetrievalRelationshipRole;
  event_type?: EventType;
  lifecycle_status?: LifecycleStatus;
  epistemic_authority?: EpistemicAuthority;
  valid_time?: BitemporalInterval;
  recorded_time: BitemporalInterval;
};

export type RetrievalDerivation = {
  algorithm: "canonical_retrieval_chunk_v1";
  algorithm_version: string;
  config_digest: string;
  input_manifest_digest: string;
};

/**
 * Capture origin facets carried into the retrieval projection.
 *
 * `project_id` partitions knowledge; worktree fields are facets used for
 * filtering, ranking boosts, and provenance. Absolute paths are never included.
 * See ADR 0013.
 */
export type RetrievalOrigin = {
  project_id?: string;
  worktree_id?: string;
  worktree_name?: string;
  git_branch?: string;
};

export type RetrievalChunk = {
  schema_version: SchemaVersion;
  record_type: "retrieval_chunk";
  chunk_id: string;
  chunk_kind: "summary" | "claim" | "decision" | "evidence_excerpt" | "open_loop";
  trust_zone_id: string;
  projection_version: string;
  chunker_version: string;
  chunk_index: number;
  text: string;
  text_digest: string;
  source_records: RetrievalSourceRecord[];
  derivation: RetrievalDerivation;
  lifecycle_status: LifecycleStatus;
  epistemic_authority: EpistemicAuthority;
  status: "active" | "stale" | "projection_deleted";
  created_at: string;
  origin?: RetrievalOrigin;
};

export type EmbeddingFailureKind =
  | "workers_ai_allocation_exhausted"
  | "rate_limited"
  | "server_error"
  | "timeout"
  | "dimension_mismatch"
  | "invalid_request"
  | "metadata_limit"
  | "vector_id_limit"
  | "unknown_retryable"
  | "unknown_blocked";

export type EmbeddingJob = {
  schema_version: SchemaVersion;
  record_type: "embedding_job";
  job_id: string;
  chunk_id: string;
  embedding_model: string;
  embedding_version: string;
  pooling: "mean" | "cls";
  state: "pending" | "leased" | "retryable_failed" | "blocked" | "embedded";
  attempts: number;
  available_at: string;
  lease_id?: string;
  lease_expires_at?: string;
  failure_kind?: EmbeddingFailureKind;
  retry_after?: string;
  quota_reset_at?: string;
  last_error?: string;
  created_at: string;
  updated_at: string;
};

export type EmbeddingProvenance = {
  embedding_model: string;
  embedding_dimensions: 768;
  embedding_version: string;
  pooling: "mean" | "cls";
  input_token_limit: 512;
  input_text_sha256: string;
  created_at: string;
};

export type EmbeddingRecord = {
  schema_version: SchemaVersion;
  record_type: "embedding_record";
  embedding_id: string;
  chunk_id: string;
  vector_ref: string;
  vector_digest: string;
  provenance: EmbeddingProvenance;
  created_at: string;
};

export type ProjectionFreshness = {
  schema_version: SchemaVersion;
  record_type: "projection_freshness";
  projection_name: string;
  projection_version: string;
  trust_zone_id: string;
  last_indexed_zone_sequence: number;
  sync_cursor_after_sequence: number;
  stale: boolean;
  reason?: "behind_sync_cursor" | "version_changed" | "erasure_pending";
  checked_at: string;
} & (
  | {
      stale: true;
      reason: "behind_sync_cursor" | "version_changed" | "erasure_pending";
    }
  | {
      stale: false;
      reason?: undefined;
    }
);

export type RetrievalFilters = {
  visible_trust_zone_ids: string[];
  lifecycle_status?: LifecycleStatus[];
  epistemic_authority?: EpistemicAuthority[];
  valid_time?: BitemporalInterval;
  recorded_time?: BitemporalInterval;
  protected_value_policy: "metadata_only" | "allow_decrypt" | "deny";
  conflict_policy: "surface_conflicts" | "exclude_conflicts" | "review_required";
  /** Partition scope. Unknown-origin chunks are never excluded by this filter. */
  project_ids?: string[];
  /** Facet scope. Unknown-origin chunks are never excluded by this filter. */
  worktree_ids?: string[];
};

export type RetrievalScore = {
  total: number;
  structured: number;
  fts: number;
  semantic: number;
  recency: number;
};

export type RetrievalLineage = {
  source_records: RetrievalSourceRecord[];
  canonical_rechecked: true;
  accepted_decision_event_ids?: string[];
  rejected_decision_event_ids?: string[];
  supersession_event_ids?: string[];
  erasure_ids?: string[];
};

export type RetrievalQuery = {
  schema_version: SchemaVersion;
  record_type: "retrieval_query";
  query_id: string;
  query_text: string;
  filters: RetrievalFilters;
  ranking: {
    mode: "structured" | "fts" | "semantic" | "hybrid";
    weights: {
      structured: number;
      fts: number;
      semantic: number;
      recency: number;
    };
    /** Rank results from this worktree higher without hiding others. */
    boost_worktree_id?: string;
  };
  limit: number;
};

export type VisibleRetrievalResultItem = {
  candidate_id: string;
  chunk_id: string;
  status: "visible";
  text: string;
  score: RetrievalScore;
  lineage: RetrievalLineage;
  canonical_rechecked: true;
};

export type HiddenRetrievalResultItem = {
  candidate_id: string;
  chunk_id: string;
  status: "redacted" | "excluded";
  score: RetrievalScore;
  lineage: RetrievalLineage;
  canonical_rechecked: true;
  reason: string;
};

export type RetrievalResultItem = VisibleRetrievalResultItem | HiddenRetrievalResultItem;

export type RetrievalResult = {
  schema_version: SchemaVersion;
  record_type: "retrieval_result";
  query_id: string;
  projection_freshness: ProjectionFreshness[];
  filters_applied: RetrievalFilters;
  results: RetrievalResultItem[];
  warnings: string[];
};

export type RetrievalProjectionMessage =
  | RetrievalChunk
  | EmbeddingJob
  | EmbeddingRecord
  | ProjectionFreshness
  | RetrievalQuery
  | RetrievalResult;

export type ContextBudget = {
  max_items: number;
  max_characters: number;
};

export type ContextBudgetUsage = {
  used: { items: number; characters: number };
  truncated: boolean;
  omitted: { items: number; characters: number };
};

export type McpVisibility = {
  visible_trust_zone_ids: string[];
  protected_value_policy: "metadata_only" | "allow_decrypt" | "deny";
};

export type McpToolName =
  | "memory_search"
  | "memory_get"
  | "memory_context_pack"
  | "memory_trace"
  | "memory_timeline"
  | "memory_related"
  | "memory_capture"
  | "memory_propose_claim";

export type McpSafeError = {
  code:
    | "invalid_schema"
    | "unauthorized"
    | "not_found"
    | "idempotency_conflict"
    | "protected_value_denied"
    | "budget_exceeded"
    | "internal_error";
  message: string;
  ref_id?: string;
};

export type McpCommonInput<TTool extends McpToolName = McpToolName> = {
  schema_version: SchemaVersion;
  tool: TTool;
  visibility: McpVisibility;
  context_budget?: ContextBudget;
  valid_time?: BitemporalInterval;
  recorded_time?: BitemporalInterval;
};

export type McpRecordRef = {
  record_id: string;
  record_kind: "event" | "erasure" | "projection";
  event_type?: EventType;
  trust_zone_id: string;
  lifecycle_status: LifecycleStatus;
  epistemic_authority: EpistemicAuthority;
  source_event_ids?: string[];
  redactions?: string[];
};

export type MemorySearchInput = McpCommonInput<"memory_search"> & {
  query: string;
  context_budget: ContextBudget;
  /** When true, include draft/held units. Default false = active/promoted only. */
  include_held?: boolean;
  /** Partition scope. Unknown-origin chunks are never excluded. */
  project_ids?: string[];
  /** Facet scope. Unknown-origin chunks are never excluded. */
  worktree_ids?: string[];
  /** Rank results from this worktree higher without hiding others. */
  boost_worktree_id?: string;
};

export type MemoryGetInput = McpCommonInput<"memory_get"> & {
  record_id: string;
};

export type MemoryContextPackInput = McpCommonInput<"memory_context_pack"> & {
  task: string;
  context_budget: ContextBudget;
  /** When true, include draft/held units. Default false = active/promoted only. */
  include_held?: boolean;
};

export type MemoryTraceInput = McpCommonInput<"memory_trace"> & {
  record_id: string;
  max_depth?: number;
  context_budget: ContextBudget;
};

export type MemoryTimelineInput = McpCommonInput<"memory_timeline"> & {
  context_budget: ContextBudget;
};

export type MemoryRelatedInput = McpCommonInput<"memory_related"> & {
  record_id: string;
  max_depth?: number;
  context_budget: ContextBudget;
};

export type MemoryCaptureInput = {
  schema_version: SchemaVersion;
  tool: "memory_capture";
  visibility: McpVisibility;
  provider: string;
  hook_event_name: string;
  captured_at: string;
  media_type: string;
  subject_ref: string;
  payload: Record<string, unknown>;
  idempotency_key?: string;
};

export type MemoryCaptureOutput =
  | {
      schema_version: SchemaVersion;
      tool: "memory_capture";
      status: "captured" | "replay";
      event_id: string;
      recorded_time: BitemporalInterval;
    }
  | {
      schema_version: SchemaVersion;
      tool: "memory_capture";
      error: McpSafeError;
    };

export type MemoryProposeClaimInput = {
  schema_version: SchemaVersion;
  tool: "memory_propose_claim";
  visibility: McpVisibility;
  statement: string;
  claim_type?: Claim["claim_type"];
  support: ProvenanceRef[];
  confidence?: number;
  subject_ref?: string;
  valid_time?: BitemporalInterval;
  idempotency_key?: string;
};

export type MemoryProposeClaimOutput =
  | {
      schema_version: SchemaVersion;
      tool: "memory_propose_claim";
      status: "proposed" | "replay";
      event_id: string;
      claim_id: string;
      lifecycle_status: "draft";
      valid_time: BitemporalInterval;
      recorded_time: BitemporalInterval;
      valid_time_defaulted: boolean;
      acceptance_decision_event_ids: [];
    }
  | {
      schema_version: SchemaVersion;
      tool: "memory_propose_claim";
      error: McpSafeError;
    };

export type McpApiMessage =
  | MemorySearchInput
  | {
      schema_version: SchemaVersion;
      tool: "memory_search";
      records: McpRecordRef[];
      budget: ContextBudgetUsage;
      error?: McpSafeError;
    }
  | MemoryGetInput
  | {
      schema_version: SchemaVersion;
      tool: "memory_get";
      record: McpRecordRef;
      error?: McpSafeError;
    }
  | MemoryContextPackInput
  | Record<string, unknown>
  | MemoryTraceInput
  | {
      schema_version: SchemaVersion;
      tool: "memory_trace";
      records: McpRecordRef[];
      budget: ContextBudgetUsage;
      error?: McpSafeError;
    }
  | MemoryTimelineInput
  | {
      schema_version: SchemaVersion;
      tool: "memory_timeline";
      records: McpRecordRef[];
      budget: ContextBudgetUsage;
      error?: McpSafeError;
    }
  | MemoryRelatedInput
  | {
      schema_version: SchemaVersion;
      tool: "memory_related";
      records: McpRecordRef[];
      budget: ContextBudgetUsage;
      error?: McpSafeError;
    }
  | MemoryCaptureInput
  | MemoryCaptureOutput
  | MemoryProposeClaimInput
  | MemoryProposeClaimOutput;

export type ObsidianProjectionCategory =
  | "accepted_fact"
  | "observation"
  | "evidence_summary"
  | "proposed_claim"
  | "rejected_claim"
  | "conflict"
  | "supersession"
  | "erasure"
  | "index";

export type ObsidianSourceLineage = {
  source_kind: "event" | "erasure" | "config";
  source_id: string;
  trust_zone_id: string;
  zone_sequence: number;
  source_fingerprint: string;
  relationship?:
    | "primary"
    | "support"
    | "acceptance"
    | "rejection"
    | "contradiction"
    | "supersession"
    | "erasure"
    | "config";
};

export type ObsidianGeneratedFile = {
  path: string;
  category: ObsidianProjectionCategory;
  source_lineage: ObsidianSourceLineage[];
  content_digest: string;
  tombstoned: boolean;
};

export type ObsidianProjectionManifest = {
  schema_version: SchemaVersion;
  manifest_type: "obsidian_projection_manifest";
  projection_version: string;
  output_root: string;
  generated_at_policy: "fixed_input" | "wall_clock_disclosed";
  config_digest: string;
  visible_trust_zone_ids: string[];
  path_policy: "delete_missing" | "tombstone_missing";
  files: ObsidianGeneratedFile[];
};

export type ObsidianProjectionNote = {
  schema_version: SchemaVersion;
  note_type: "obsidian_projection_note";
  path: string;
  category: ObsidianProjectionCategory;
  source_lineage: ObsidianSourceLineage[];
  front_matter: {
    carpeos_projection: true;
    category: ObsidianProjectionCategory;
    source_ids: string[];
    canonical_effect: "none";
  };
};

export type ObsidianProjectionMessage = ObsidianProjectionManifest | ObsidianProjectionNote;

export type IdempotencyInput = {
  trust_zone_id: string;
  idempotency_key: string;
  request_fingerprint: string;
};

export type IdempotencyClassification = "new_request" | "replay" | "idempotency_conflict";

export type SchemaName = keyof typeof schemas;

export type SchemaValidateFunction = ((value: unknown) => boolean) & {
  errors?: Array<{ instancePath?: string; message?: string }> | null;
};

export type SchemaValidatorSet = Record<SchemaName, SchemaValidateFunction>;

export type ConformanceResult = {
  valid: boolean;
  errors: string[];
};

export function createAjv2020(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true });

  for (const schema of Object.values(schemas)) {
    ajv.addSchema(schema as AnySchemaObject);
  }

  return ajv;
}

export function compileSchemaValidators(): SchemaValidatorSet {
  return standaloneValidators as SchemaValidatorSet;
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

  if (schemaName === "retrievalProjection" && isObject(value)) {
    errors.push(...collectRetrievalProjectionSemanticErrors(value));
  }

  if (schemaName === "mcpApi" && isObject(value)) {
    errors.push(...collectMcpApiSemanticErrors(value));
  }

  if (schemaName === "obsidianProjection" && isObject(value)) {
    errors.push(...collectObsidianProjectionSemanticErrors(value));
  }

  return {
    valid: errors.length === 0,
    errors,
  };
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

function normalizeAjvErrors(validate: SchemaValidateFunction): string[] {
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

function collectRetrievalProjectionSemanticErrors(message: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (Array.isArray(message.source_records)) {
    errors.push(...collectSourceRecordManifestErrors(message.source_records));
    if (
      typeof message.trust_zone_id === "string" &&
      message.source_records.some(
        (record) => isObject(record) && record.trust_zone_id !== message.trust_zone_id,
      )
    ) {
      errors.push("retrieval chunk trust_zone_id must match every source_records trust_zone_id");
    }
  }

  if (message.record_type === "projection_freshness") {
    errors.push(...collectProjectionFreshnessErrors(message));
  }

  if (message.record_type === "retrieval_result" && Array.isArray(message.results)) {
    const visibleTrustZones = isObject(message.filters_applied)
      ? asStringSet(message.filters_applied.visible_trust_zone_ids)
      : new Set<string>();

    for (const item of message.results) {
      if (!isObject(item)) {
        continue;
      }

      if (item.status === "visible" && item.canonical_rechecked !== true) {
        errors.push("visible retrieval results must be canonically rechecked");
      }

      if (item.status === "visible" && typeof item.text !== "string") {
        errors.push("visible retrieval results must include text");
      }

      if ((item.status === "redacted" || item.status === "excluded") && "text" in item) {
        errors.push("redacted and excluded retrieval results must not include text");
      }

      if (
        (item.status === "redacted" || item.status === "excluded") &&
        typeof item.reason !== "string"
      ) {
        errors.push("redacted and excluded retrieval results must include reason");
      }

      if (isObject(item.lineage) && Array.isArray(item.lineage.source_records)) {
        errors.push(...collectSourceRecordManifestErrors(item.lineage.source_records));
        for (const sourceRecord of item.lineage.source_records) {
          if (
            isObject(sourceRecord) &&
            typeof sourceRecord.trust_zone_id === "string" &&
            !visibleTrustZones.has(sourceRecord.trust_zone_id)
          ) {
            errors.push(
              `lineage source trust_zone_id ${sourceRecord.trust_zone_id} must be visible in filters_applied.visible_trust_zone_ids`,
            );
          }
        }
      }
    }
  }

  if (
    message.record_type === "embedding_job" &&
    message.state === "retryable_failed" &&
    typeof message.failure_kind !== "string"
  ) {
    errors.push("retryable embedding jobs must include failure_kind");
  }

  if (
    message.record_type === "embedding_job" &&
    message.failure_kind === "workers_ai_allocation_exhausted" &&
    typeof message.quota_reset_at !== "string"
  ) {
    errors.push("Workers AI allocation failures must include quota_reset_at");
  }

  return errors;
}

function collectMcpApiSemanticErrors(message: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (isObject(message.visibility)) {
    const visibleTrustZones = asStringSet(message.visibility.visible_trust_zone_ids);
    if (visibleTrustZones.size === 0) {
      errors.push("MCP inputs must declare at least one visible trust zone");
    }
  }

  if (message.tool === "memory_propose_claim") {
    if ("acceptance_decision_event_ids" in message) {
      if (
        !Array.isArray(message.acceptance_decision_event_ids) ||
        message.acceptance_decision_event_ids.length !== 0
      ) {
        errors.push("memory_propose_claim output must not include AcceptanceDecision ids");
      }
    }

    if (isObject(message.valid_time)) {
      errors.push(...collectIntervalValueErrors(message.valid_time, "valid_time"));
    }

    if (isObject(message.recorded_time)) {
      errors.push(...collectIntervalValueErrors(message.recorded_time, "recorded_time"));
    }

    if (message.lifecycle_status !== undefined && message.lifecycle_status !== "draft") {
      errors.push("memory_propose_claim output lifecycle_status must be draft");
    }
  }

  if (isObject(message.context_budget)) {
    const maxItems = message.context_budget.max_items;
    const maxCharacters = message.context_budget.max_characters;
    if (
      typeof maxItems === "number" &&
      typeof maxCharacters === "number" &&
      maxItems > maxCharacters
    ) {
      errors.push("context budget max_items must not exceed max_characters");
    }
  }

  if (isObject(message.budget)) {
    const used = isObject(message.budget.used) ? message.budget.used : undefined;
    const omitted = isObject(message.budget.omitted) ? message.budget.omitted : undefined;
    if (
      used !== undefined &&
      omitted !== undefined &&
      typeof message.budget.truncated === "boolean" &&
      typeof omitted.items === "number" &&
      typeof omitted.characters === "number"
    ) {
      const hasOmissions = omitted.items > 0 || omitted.characters > 0;
      if (hasOmissions !== message.budget.truncated) {
        errors.push("budget truncated must match omitted item or character counts");
      }
    }
  }

  if (message.tool === "memory_context_pack" && Array.isArray(message.accepted_facts)) {
    for (const fact of message.accepted_facts) {
      if (!isObject(fact)) {
        continue;
      }
      if (typeof fact.acceptance_decision_event_id !== "string") {
        errors.push("accepted facts require visible AcceptanceDecision lineage");
      }
      if (
        Array.isArray(fact.source_event_ids) &&
        typeof fact.claim_event_id === "string" &&
        !fact.source_event_ids.includes(fact.claim_event_id)
      ) {
        errors.push("accepted fact source_event_ids must include the claim event id");
      }
      if (
        Array.isArray(fact.source_event_ids) &&
        typeof fact.acceptance_decision_event_id === "string" &&
        !fact.source_event_ids.includes(fact.acceptance_decision_event_id)
      ) {
        errors.push("accepted fact source_event_ids must include the AcceptanceDecision event id");
      }
    }
  }

  return errors;
}

function collectObsidianProjectionSemanticErrors(message: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (Array.isArray(message.files)) {
    const paths = message.files
      .filter((file): file is Record<string, unknown> => isObject(file))
      .map((file) => String(file.path ?? ""));
    const sortedPaths = [...paths].sort();
    if (paths.some((path, index) => path !== sortedPaths[index])) {
      errors.push("obsidian manifest files must be sorted deterministically by path");
    }
    if (new Set(paths).size !== paths.length) {
      errors.push("obsidian manifest files must be deduplicated by path");
    }

    for (const file of message.files) {
      if (isObject(file)) {
        errors.push(...collectObsidianLineageErrors(file.category, file.source_lineage));
      }
    }
  }

  if (Array.isArray(message.source_lineage)) {
    errors.push(...collectObsidianLineageErrors(message.category, message.source_lineage));
  }

  if (
    isObject(message.front_matter) &&
    typeof message.category === "string" &&
    message.front_matter.category !== message.category
  ) {
    errors.push("obsidian note front_matter category must match note category");
  }

  return errors;
}

function collectObsidianLineageErrors(category: unknown, lineage: unknown): string[] {
  if (typeof category !== "string" || !Array.isArray(lineage)) {
    return [];
  }

  const relationships = lineage
    .filter((item): item is Record<string, unknown> => isObject(item))
    .map((item) => String(item.relationship ?? ""));

  const requires = (relationship: string, message: string) => {
    if (!relationships.includes(relationship)) {
      return [message];
    }
    return [];
  };

  switch (category) {
    case "accepted_fact":
      return requires("acceptance", "accepted_fact notes require acceptance lineage");
    case "proposed_claim":
      return requires("primary", "proposed_claim notes require draft Claim lineage");
    case "rejected_claim":
      return requires("rejection", "rejected_claim notes require rejection lineage");
    case "conflict":
      return requires("contradiction", "conflict notes require contradiction lineage");
    case "supersession":
      return requires("supersession", "supersession notes require supersession lineage");
    case "erasure":
      return requires("erasure", "erasure notes require erasure lineage");
    case "evidence_summary":
      return requires("support", "evidence_summary notes require visible evidence lineage");
    default:
      return [];
  }
}

function collectIntervalValueErrors(
  interval: Record<string, unknown>,
  label: "valid_time" | "recorded_time",
): string[] {
  if (
    typeof interval.start === "string" &&
    (typeof interval.end === "string" || interval.end === null) &&
    !isBitemporalIntervalValid(interval as BitemporalInterval)
  ) {
    return [`${label}.start must be before or equal to ${label}.end`];
  }

  return [];
}

function collectProjectionFreshnessErrors(message: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (
    typeof message.last_indexed_zone_sequence !== "number" ||
    typeof message.sync_cursor_after_sequence !== "number" ||
    typeof message.stale !== "boolean"
  ) {
    return errors;
  }

  if (message.last_indexed_zone_sequence > message.sync_cursor_after_sequence) {
    errors.push(
      "projection freshness last_indexed_zone_sequence must not exceed sync_cursor_after_sequence",
    );
  }

  if (message.last_indexed_zone_sequence < message.sync_cursor_after_sequence) {
    if (message.stale !== true || message.reason !== "behind_sync_cursor") {
      errors.push(
        "projection freshness behind sync cursor must be stale with reason behind_sync_cursor",
      );
    }
  }

  if (message.stale === true && typeof message.reason !== "string") {
    errors.push("stale projection freshness must include reason");
  }

  if (message.stale === false && typeof message.reason === "string") {
    errors.push("fresh projection freshness must not include reason");
  }

  return errors;
}

function collectSourceRecordManifestErrors(sourceRecords: unknown[]): string[] {
  const errors: string[] = [];
  const keys = sourceRecords.map((record) =>
    isObject(record) ? sourceRecordSortKey(record) : "invalid",
  );
  const sorted = [...keys].sort();

  if (keys.some((key, index) => key !== sorted[index])) {
    errors.push("source_records must be sorted deterministically");
  }

  if (new Set(keys).size !== keys.length) {
    errors.push("source_records must be deduplicated");
  }

  return errors;
}

function sourceRecordSortKey(record: Record<string, unknown>): string {
  return [
    String(record.trust_zone_id ?? ""),
    String(record.zone_sequence ?? "").padStart(16, "0"),
    String(record.source_record_kind ?? ""),
    String(record.source_record_id ?? ""),
    String(record.relationship_role ?? ""),
  ].join("\u0000");
}

function asStringSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) {
    return new Set();
  }

  return new Set(value.filter((item): item is string => typeof item === "string"));
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
