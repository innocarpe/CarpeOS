import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  ADJUDICATION_POLICY_VERSION,
  type AdjudicationResult,
  adjudicateKnowledgeCandidate,
  agenticFeedHookPreferRankSql,
  agenticProseFromTranscriptJsonl,
  agenticProseFromTranscriptPath,
  buildSyncPushRequest,
  type CaptureEnvelope,
  deriveIdempotencyKey,
  extractionObservationIdempotencyKey,
  extractKnowledgeCandidateSpans,
  fingerprintEnvelope,
  fingerprintObject,
  hashHex,
  evaluateDeterministicFront,
  isAgenticFeedHookEligible,
  isIdempotencyKey,
  type KnowledgeDisposition,
  type MeaningfulUnitPolicyConfig,
  normalizeCaptureHookEventName,
  signalsFromTranscriptPath,
  stableJson,
} from "@carpeos/capture";
import type {
  CanonicalEvent,
  Claim,
  ErasureLedgerRecord,
  ProtectedValueMetadata,
  ProtectedValueRef,
  ProtectedValueUploadIntent,
  ProvenanceRef,
  SyncPushRequest,
  TrustZone,
  WrappedDeviceKeyEnvelope,
} from "@carpeos/schema";
import { validateConformance } from "@carpeos/schema";
import {
  buildPolicyReconciliationPlanV2,
  type GlobalTaintReasonCode,
  type PolicyReconciliationPlanV2,
  type ReconciliationCandidate,
} from "./policy-reconciliation.js";
import type { WorktreeIdentity } from "./project-identity.js";
import { resolveProjectIdentity, resolveWorktreeIdentity } from "./project-identity.js";

export type Clock = {
  now(): Date;
};

export type KeyProvider = {
  readOrCreateKey(): Uint8Array;
};

export type LocalStoreOptions = {
  runtimeDir: string;
  workspaceRoot: string;
  /** Injectable git runner for deterministic identity tests. */
  execGit?: (args: string[], cwd: string) => string;
  dbPath?: string;
  trustZoneId?: string;
  explicitProjectId?: string;
  keyProvider?: KeyProvider;
  clock?: Clock;
};

export type LocalStoreSqlStatement = {
  run(...params: SQLInputValue[]): unknown;
  get(...params: SQLInputValue[]): unknown;
  all(...params: SQLInputValue[]): unknown[];
};

export type LocalStoreSqlDatabase = {
  exec(sql: string): void;
  prepare(sql: string): LocalStoreSqlStatement;
};

export type CaptureRequestOptions = {
  failAfter?: "capture_request" | "protected_value" | "canonical_event";
  /**
   * When true, run meaningful-unit extraction after capture when the hook is
   * eligible. Product CLI/MCP pass true by default; low-level callers opt in.
   */
  extract?: boolean;
  /** Optional policy overrides for post-capture extraction. */
  extractionPolicy?: Partial<MeaningfulUnitPolicyConfig>;
  /**
   * When false, skip Product 6 agentic capture feed insert.
   * Default: insert when CARPEOS_AGENTIC is not off (no LLM in capture).
   */
  agentic_feed?: boolean;
};

export type ExtractionResult =
  | {
      status: "extracted" | "replay";
      event: CanonicalEvent<"Observation">;
      local_sequence: number;
      outbox_id: number;
      request_fingerprint: string;
      protected_value_id: string;
      source_event_id: string;
    }
  | {
      status: "skipped";
      reason: string;
      source_event_id?: string;
      hook_event_name?: string;
    }
  | {
      status: "failed";
      error: string;
      source_event_id?: string;
    };

export type CaptureResult =
  | {
      status: "captured";
      event: CanonicalEvent<"EvidenceArtifact">;
      local_sequence: number;
      outbox_id: number;
      request_fingerprint: string;
      protected_value_id: string;
      extraction?: ExtractionResult;
    }
  | {
      status: "replay";
      event: CanonicalEvent<"EvidenceArtifact">;
      local_sequence: number;
      outbox_id: number;
      request_fingerprint: string;
      protected_value_id: string;
      extraction?: ExtractionResult;
    };

export type ProposeObservationDraftInput = {
  statement: string;
  evidenceArtifactRefs: readonly string[];
  sourceEventId?: string;
  subjectRef?: string;
  validTime?: CanonicalEvent["valid_time"];
  observedAt?: string;
  confidence?: number;
  idempotencyKey?: string;
  provenance?: readonly ProvenanceRef[];
  /** promote → active; hold → draft. Default active. */
  lifecycleStatus?: "active" | "draft";
};

export type HeldDisposition = {
  source_event_id: string;
  artifact_id: string;
  reason_codes: string[];
  policy_version: string;
  created_at: string;
};

export type HeldDispositionListResult = {
  policy_version: string;
  count: number;
  held: HeldDisposition[];
};

export type HeldReviewDecision = "promote" | "reject";

export type HeldReviewResult =
  | {
      status: "reviewed" | "replay";
      review_id: string;
      source_event_id: string;
      decision: HeldReviewDecision;
      policy_version: string;
      count: 1;
      observation?: {
        event_id: string;
        observation_id: string;
        lifecycle_status: "active";
      };
    }
  | {
      status: "failed";
      source_event_id: string;
      policy_version?: string;
      count: 0;
      error: string;
    };

export type AdjudicateResult =
  | {
      status: "promoted" | "held";
      disposition: KnowledgeDisposition;
      reason_codes: string[];
      scores: AdjudicationResult["scores"];
      policy_version: string;
      extraction: ExtractionResult;
      source_event_id: string;
    }
  | {
      status: "rejected" | "replay";
      disposition: KnowledgeDisposition;
      reason_codes: string[];
      scores: AdjudicationResult["scores"];
      policy_version: string;
      source_event_id: string;
      extraction?: ExtractionResult;
    }
  | {
      status: "skipped" | "failed";
      reason?: string;
      error?: string;
      source_event_id?: string;
    };

type StoredDisposition = {
  source_event_id: string;
  artifact_id: string;
  disposition: KnowledgeDisposition;
  reason_codes: string[];
  scores: AdjudicationResult["scores"];
  policy_version: string;
  statement: string;
  created_at: string;
};

/** Public disposition history row (same shape as internal storage view). */
export type StoredDispositionPublic = StoredDisposition;

type StoredHeldReview = {
  review_id: string;
  source_event_id: string;
  decision: HeldReviewDecision;
  policy_version: string;
  created_at: string;
};

function safeSqliteInteger(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "bigint" && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }
  throw new Error(`invalid SQLite ${label}`);
}
/** Pull a bounded rule-scoring signal from supported payload fields. */

function envelopePayloadTranscriptPath(payload: unknown): unknown {
  if (payload === null || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  return record.transcript_path ?? record.transcriptPath;
}

function toCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
}
function signalFromUnknownPayload(payload: unknown): string | undefined {
  return signalFromPayload(payload, false);
}

/** Pull only explicit message/procedure text that may enter a knowledge statement. */
function candidateTextFromUnknownPayload(payload: unknown): string | undefined {
  return signalFromPayload(payload, true);
}

function signalFromPayload(payload: unknown, candidateOnly: boolean): string | undefined {
  if (payload === null || payload === undefined) return undefined;
  if (typeof payload === "string") {
    return candidateOnly ? undefined : boundedSignal(payload);
  }
  if (typeof payload !== "object") return undefined;

  const record = payload as Record<string, unknown>;
  // Host payloads mix snake_case and camelCase (Claude/Grok).
  const candidateKeys = [
    "decision",
    "preference",
    "constraint",
    "procedure",
    "summary",
    "message",
    "prompt",
    "user_message",
    "last_assistant_message",
  ] as const;
  const scoringKeys = [
    "transcript",
    "text",
    "content",
    "prompt",
    "input",
    "output",
    "last_prompt",
  ] as const;
  for (const key of candidateKeys) {
    const signal = boundedSignal(record[key]) ?? boundedSignal(record[toCamel(key)]);
    if (signal !== undefined) {
      const labelKey =
        key === "prompt" || key === "user_message" || key === "last_assistant_message"
          ? "message"
          : key === "decision" ||
              key === "preference" ||
              key === "constraint" ||
              key === "procedure" ||
              key === "summary" ||
              key === "message"
            ? key
            : "message";
      return candidateOnly ? labelCandidateField(labelKey, signal) : signal;
    }
  }
  if (!candidateOnly) {
    for (const key of scoringKeys) {
      const signal = boundedSignal(record[key]) ?? boundedSignal(record[toCamel(key)]);
      if (signal !== undefined) return signal;
    }
  }

  for (const key of ["steps", "procedure_steps"] as const) {
    const values = record[key];
    if (!Array.isArray(values)) continue;
    const parts: string[] = [];
    for (const value of values.slice(0, 3)) {
      const direct = boundedSignal(value);
      if (direct !== undefined) {
        parts.push(direct);
        continue;
      }
      if (value === null || typeof value !== "object") continue;
      const step = value as Record<string, unknown>;
      for (const field of ["instruction", "decision", "constraint", "summary", "text"] as const) {
        const signal = boundedSignal(step[field]);
        if (signal !== undefined) {
          parts.push(signal);
          break;
        }
      }
    }
    if (parts.length > 0) {
      const joined = parts.join(" ").slice(0, 1_200);
      return candidateOnly && !/^\s*(?:procedure|workflow|runbook|playbook|steps?)\b/i.test(joined)
        ? `Procedure: ${joined}`
        : joined;
    }
  }
  return undefined;
}

function labelCandidateField(
  field: "decision" | "preference" | "constraint" | "procedure" | "summary" | "message",
  signal: string,
): string {
  if (field === "summary" || field === "message") return signal;
  const label = `${field.charAt(0).toUpperCase()}${field.slice(1)}`;
  return signal.toLowerCase().startsWith(field) ? signal : `${label}: ${signal}`;
}

function boundedSignal(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 1_200) : undefined;
}

export type ProposeClaimDraftInput = {
  statement: string;
  claimType?: Claim["claim_type"];
  support: readonly ProvenanceRef[];
  confidence?: number;
  subjectRef?: string;
  validTime?: CanonicalEvent["valid_time"];
  visibleTrustZoneIds?: readonly string[];
  idempotencyKey?: string;
};

export type ProposeClaimDraftResult =
  | {
      status: "proposed";
      event: CanonicalEvent<"Claim">;
      local_sequence: number;
      outbox_id: number;
      request_fingerprint: string;
      protected_value_id: string;
      valid_time_defaulted: boolean;
    }
  | {
      status: "replay";
      event: CanonicalEvent<"Claim">;
      local_sequence: number;
      outbox_id: number;
      request_fingerprint: string;
      protected_value_id: string;
      valid_time_defaulted: boolean;
    };

/**
 * Human-only AcceptanceDecision writer (Product 6 complete path).
 * Fail-closed: requires humanConfirmed === true. Never call from agentic auto-runner.
 */
export type RecordHumanAcceptanceInput = {
  /** Claim payload claim_id values (not event ids). */
  claimRefs: readonly string[];
  decision: "accepted" | "rejected" | "needs_review";
  /** Human actor id (not agent/system/llm). */
  decidedBy: string;
  rationale?: string;
  subjectRef?: string;
  /** Must be true — hard fence against accidental automation. */
  humanConfirmed: true;
  idempotencyKey?: string;
};

export type RecordHumanAcceptanceResult =
  | {
      status: "recorded" | "replay";
      event: CanonicalEvent<"AcceptanceDecision">;
      local_sequence: number;
      outbox_id: number;
      request_fingerprint: string;
      protected_value_id: string;
    }
  | {
      status: "failed";
      error: string;
    };

export type AgenticFeedBackfillResult = {
  schema: "carpeos.agentic.feed-backfill/v1";
  scanned: number;
  enqueued: number;
  already_present: number;
  skipped: number;
  reason_codes: string[];
};

export type LocalCanonicalEventSnapshot = {
  source: "canonical" | "inbox";
  local_sequence: number | null;
  event_id: string;
  event_type: CanonicalEvent["event_type"];
  trust_zone_id: string;
  zone_sequence: number;
  protected_value_id: string | null;
  event: CanonicalEvent;
  imported_at?: string;
};

export type LocalErasureSnapshot = {
  source: "inbox";
  erasure_id: string;
  trust_zone_id: string;
  zone_sequence: number;
  erasure: ErasureLedgerRecord;
  imported_at: string;
};

export type LocalRetrievalInputSnapshot = {
  trust_zone_id: string;
  visible_trust_zone_ids: string[];
  events: LocalCanonicalEventSnapshot[];
  erasures: LocalErasureSnapshot[];
  sync_cursor: SyncCursor;
};

export type LocalSupportReference = {
  ref: ProvenanceRef;
  event_id: string;
  trust_zone_id: string;
  event_type: CanonicalEvent["event_type"];
};

export type LocalSupportValidationResult = {
  support: LocalSupportReference[];
};

export type OutboxStatus = {
  pending: number;
  leased: number;
  delivered: number;
};

export type OutboxErrorSummary = {
  outbox_id: number;
  event_id: string;
  state: "pending" | "leased";
  attempts: number;
  last_error: string | null;
  trust_zone_id: string | null;
};

export type LeasedOutboxItem = {
  outbox_id: number;
  event_id: string;
  protected_value_id: string;
  local_sequence: number;
  attempts: number;
  push_request: SyncPushRequest;
};

export type LeaseResult = {
  lease_id: string;
  leased_until: string;
  items: LeasedOutboxItem[];
};

type EventRow = {
  event_json: string;
  local_sequence: number;
  protected_value_id: string;
};

type EventSnapshotRow = {
  source: "canonical" | "inbox";
  local_sequence: number | null;
  event_id: string;
  event_type: CanonicalEvent["event_type"];
  trust_zone_id: string;
  zone_sequence: number | null;
  protected_value_id: string | null;
  event_json: string;
  imported_at?: string;
};

type ErasureSnapshotRow = {
  erasure_id: string;
  trust_zone_id: string;
  zone_sequence: number;
  erasure_json: string;
  imported_at: string;
};

type ProtectedValueRow = {
  vault_ref: string;
  key_ref: string;
  nonce_ref: string;
  tag_ref: string;
  nonce: Uint8Array;
  tag: Uint8Array;
  ciphertext: Uint8Array;
  plaintext_digest: string;
  size_bytes: number;
};

type OutboxStatusRow = {
  state: "pending" | "leased" | "delivered";
  count: number;
};

type LeasedOutboxRow = {
  outbox_id: number;
  event_id: string;
  protected_value_id: string;
  local_sequence: number;
  attempts: number;
  push_request_json: string;
};

type OutboxIdRow = {
  outbox_id: number;
};

/** Capture-store SQLite migrations applied on open (order is historical, not run order). */
export const LOCAL_STORE_MIGRATION_IDS = [
  "001_local_capture_store",
  "002_sync_transfer_imports",
  "003_knowledge_dispositions",
  "004_knowledge_disposition_reviews",
  "005_knowledge_dispositions_policy_key",
  "006_capture_worktree_identity",
  /** Post-capture agentic feed (no LLM; runner drains asynchronously). */
  "007_agentic_capture_feed",
  /** Feed mutual-exclusion leases for always-on / concurrent runners (ADR 0018 D5). */
  "008_agentic_capture_feed_lease",
] as const;

export type LocalStoreMigrationId = (typeof LOCAL_STORE_MIGRATION_IDS)[number];

const MIGRATION_ID: LocalStoreMigrationId = "001_local_capture_store";
const SYNC_MIGRATION_ID: LocalStoreMigrationId = "002_sync_transfer_imports";
const DISPOSITION_MIGRATION_ID: LocalStoreMigrationId = "003_knowledge_dispositions";
const DISPOSITION_REVIEW_MIGRATION_ID: LocalStoreMigrationId = "004_knowledge_disposition_reviews";
const WORKTREE_IDENTITY_MIGRATION_ID: LocalStoreMigrationId = "006_capture_worktree_identity";
const DISPOSITION_POLICY_KEY_MIGRATION_ID: LocalStoreMigrationId =
  "005_knowledge_dispositions_policy_key";
const AGENTIC_CAPTURE_FEED_MIGRATION_ID: LocalStoreMigrationId = "007_agentic_capture_feed";
const AGENTIC_CAPTURE_FEED_LEASE_MIGRATION_ID: LocalStoreMigrationId =
  "008_agentic_capture_feed_lease";

/** Durable post-capture feed row for Product 6 agentic runner (no LLM in capture). */
export type AgenticCaptureFeedRow = {
  source_event_id: string;
  artifact_id: string;
  trust_zone_id: string;
  hook_event_name: string;
  protected_value_id: string;
  state: "pending" | "leased" | "done" | "skipped";
  created_at: string;
  finished_at: string | null;
  skip_reason: string | null;
  lease_id?: string | null;
  lease_expires_at?: string | null;
};

export type ProtectedValueTransferExport = {
  protected_value_id: string;
  ciphertext: Uint8Array;
  intent: ProtectedValueUploadIntent;
};

export type ProtectedValueImportInput = {
  event: CanonicalEvent;
  metadata: ProtectedValueMetadata;
  ciphertext: Uint8Array;
  trustZoneSyncKey: Uint8Array;
};

export type ProtectedValueImportResult = {
  status: "imported" | "replay";
  event_id: string;
  protected_value_id: string;
};

export type GeneralEventImportResult = {
  status: "imported" | "replay";
  event_id: string;
};

export type SyncCursor = {
  trust_zone_id: string;
  after_sequence: number;
  cursor: string | null;
};

export type ImportedErasureResult = {
  status: "imported" | "replay";
  erasure_id: string;
};

export class IdempotencyConflictError extends Error {
  readonly existingFingerprint: string;
  readonly incomingFingerprint: string;
  readonly idempotencyKey: string;

  constructor(input: {
    idempotencyKey: string;
    existingFingerprint: string;
    incomingFingerprint: string;
  }) {
    super(
      `idempotency conflict for ${input.idempotencyKey}: ${input.existingFingerprint} != ${input.incomingFingerprint}`,
    );
    this.name = "IdempotencyConflictError";
    this.idempotencyKey = input.idempotencyKey;
    this.existingFingerprint = input.existingFingerprint;
    this.incomingFingerprint = input.incomingFingerprint;
  }
}

export class StaticKeyProvider implements KeyProvider {
  private readonly keyBytes: Uint8Array;

  constructor(keyBytes: Uint8Array) {
    if (keyBytes.byteLength !== 32) {
      throw new Error("AES-256-GCM key must be exactly 32 bytes");
    }
    this.keyBytes = new Uint8Array(keyBytes);
  }

  readOrCreateKey(): Uint8Array {
    return new Uint8Array(this.keyBytes);
  }
}

export class FileKeyProvider implements KeyProvider {
  private readonly keyPath: string;

  constructor(runtimeDir: string, keyFileName = "local-aes256.key") {
    this.keyPath = join(runtimeDir, keyFileName);
  }

  readOrCreateKey(): Uint8Array {
    const keyDir = dirname(this.keyPath);
    mkdirSync(keyDir, { recursive: true, mode: 0o700 });
    chmodSync(keyDir, 0o700);

    try {
      return readKeyFile(this.keyPath);
    } catch (error) {
      if (!isErrnoCode(error, "ENOENT")) {
        throw error;
      }
    }

    const material = randomBytes(32);
    try {
      writeFileSync(this.keyPath, `${material.toString("hex")}\n`, {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if (isErrnoCode(error, "EEXIST")) {
        return readKeyFile(this.keyPath);
      }
      throw error;
    }
    chmodSync(this.keyPath, 0o600);
    return material;
  }
}

export class LocalCaptureStore {
  readonly runtimeDir: string;
  readonly dbPath: string;
  readonly trustZone: TrustZone;
  readonly clientId: string;
  readonly projectId: string;
  readonly worktree: WorktreeIdentity;
  private readonly db: DatabaseSync;
  private readonly clock: Clock;
  private readonly keyBytes: Uint8Array;

  constructor(options: LocalStoreOptions, previewOpenMarker?: symbol) {
    if (options.trustZoneId !== undefined && !isTrustZoneId(options.trustZoneId)) {
      throw new Error(`invalid trust zone id: ${options.trustZoneId}`);
    }

    if (previewOpenMarker === LocalCaptureStore.previewOpenMarker) {
      this.runtimeDir = options.runtimeDir;
      this.dbPath = options.dbPath ?? join(this.runtimeDir, "carpeos.sqlite");
      if (options.trustZoneId === undefined || !existsSync(this.dbPath)) {
        throw new Error("initialized preview store is required");
      }
      this.db = new DatabaseSync(this.dbPath, { timeout: 5_000, readOnly: true });
      this.db.exec("PRAGMA query_only = ON");
      this.clock = options.clock ?? { now: () => new Date() };
      this.trustZone = {
        trust_zone_id: options.trustZoneId,
        isolation: "local_device",
        boundary_purpose: "single-user encrypted local capture store",
      };
      this.clientId = "";
      this.projectId = "";
      this.worktree = {
        worktree_id: "",
        worktree_name: "",
        is_linked_worktree: false,
        basis_kind: "workspace_root",
      };
      this.keyBytes = new Uint8Array(32);
      try {
        this.db.prepare("SELECT 1 FROM schema_migrations LIMIT 1").get();
        this.db.prepare("SELECT 1 FROM knowledge_dispositions LIMIT 1").get();
      } catch {
        this.db.close();
        throw new Error("initialized preview store is required");
      }
      return;
    }
    this.runtimeDir = options.runtimeDir;
    mkdirSync(this.runtimeDir, { recursive: true, mode: 0o700 });
    chmodSync(this.runtimeDir, 0o700);

    this.dbPath = options.dbPath ?? join(this.runtimeDir, "carpeos.sqlite");
    mkdirSync(dirname(this.dbPath), { recursive: true, mode: 0o700 });
    chmodSync(dirname(this.dbPath), 0o700);
    this.db = new DatabaseSync(this.dbPath, { timeout: 5_000 });
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec("PRAGMA journal_mode = WAL");

    this.clock = options.clock ?? { now: () => new Date() };
    const identity = resolveProjectIdentity({
      runtimeDir: this.runtimeDir,
      workspaceRoot: options.workspaceRoot,
      explicitProjectId: options.explicitProjectId,
      ...(options.execGit === undefined ? {} : { execGit: options.execGit }),
    });
    this.clientId = identity.device_client_id;
    this.projectId = identity.project_id;
    // Facet, not a partition: sibling worktrees of one repository share knowledge.
    this.worktree = resolveWorktreeIdentity({
      runtimeDir: this.runtimeDir,
      workspaceRoot: options.workspaceRoot,
      ...(options.execGit === undefined ? {} : { execGit: options.execGit }),
    });
    this.trustZone = {
      trust_zone_id: options.trustZoneId ?? defaultTrustZoneId(this.clientId),
      isolation: "local_device",
      boundary_purpose: "single-user encrypted local capture store",
    };
    this.keyBytes = (options.keyProvider ?? new FileKeyProvider(this.runtimeDir)).readOrCreateKey();
    if (this.keyBytes.byteLength !== 32) {
      throw new Error("AES-256-GCM key must be exactly 32 bytes");
    }

    this.migrate();
    this.upsertProject(identity.basis_kind);
  }

  private static readonly previewOpenMarker = Symbol("LocalCaptureStore.preview");
  static openExistingPreview(options: {
    runtimeDir: string;
    workspaceRoot: string;
    trustZoneId: string;
    dbPath?: string;
  }): LocalCaptureStore {
    return new LocalCaptureStore(options, LocalCaptureStore.previewOpenMarker);
  }
  close(): void {
    this.db.close();
  }

  private captureHookWrite(
    envelope: CaptureEnvelope,
    options: CaptureRequestOptions = {},
  ): CaptureResult {
    const capturedAt = normalizeTimestamp(envelope.captured_at);
    const recordedAt = this.clock.now().toISOString();
    const normalizedEnvelope: CaptureEnvelope = { ...envelope, captured_at: capturedAt };
    const plaintext = Buffer.from(stableJson(normalizedEnvelope), "utf8");
    const plaintextDigest = hashHex(plaintext);
    const idempotencyKey =
      normalizedEnvelope.idempotency_key ??
      deriveIdempotencyKey(normalizedEnvelope, this.trustZone.trust_zone_id);
    const requestFingerprint = fingerprintEnvelope(
      normalizedEnvelope,
      this.trustZone.trust_zone_id,
    );
    const protectedValueId = `pv_${hashHex(
      stableJson({
        trust_zone_id: this.trustZone.trust_zone_id,
        idempotency_key: idempotencyKey,
        request_fingerprint: requestFingerprint,
      }),
    ).slice(0, 24)}`;
    const encrypted = encrypt(plaintext, this.keyBytes);
    const ciphertextDigest = hashHex(encrypted.ciphertext);
    const protectedValueRef: ProtectedValueRef = {
      ref_type: "protected_value",
      protected_value_id: protectedValueId,
      vault_ref: "vault_local",
      key_ref: "key_local_active",
      encrypted_blob: {
        algorithm: "aes-256-gcm",
        nonce_ref: `nonce_${protectedValueId.slice(3)}`,
        tag_ref: `tag_${protectedValueId.slice(3)}`,
        digest: {
          algorithm: "sha-256",
          value: ciphertextDigest,
        },
        size_bytes: plaintext.byteLength,
      },
    };
    const built = buildSyncPushRequest({
      envelope: normalizedEnvelope,
      recordedAt,
      trustZone: this.trustZone,
      protectedValueRef,
      clientId: this.clientId,
    });

    assertValidCanonicalEvent(built.event);
    const eventJson = stableJson(built.event);
    const pushRequestJson = built.canonicalJson;
    const syncConformance = validateConformance("syncApi", JSON.parse(pushRequestJson));
    if (!syncConformance.valid) {
      throw new Error(`invalid sync push request: ${syncConformance.errors.join("; ")}`);
    }

    return this.withImmediateTransaction(() => {
      const existing = this.findEventByIdempotency(
        this.trustZone.trust_zone_id,
        built.event.idempotency_key,
      );
      if (existing !== undefined) {
        const event = JSON.parse(existing.event_json) as CanonicalEvent<"EvidenceArtifact">;
        if (event.request_fingerprint !== built.requestFingerprint) {
          throw new IdempotencyConflictError({
            idempotencyKey: built.event.idempotency_key,
            existingFingerprint: event.request_fingerprint,
            incomingFingerprint: built.requestFingerprint,
          });
        }
        return {
          status: "replay",
          event,
          local_sequence: Number(existing.local_sequence),
          outbox_id: this.findOutboxIdForEvent(event.event_id),
          request_fingerprint: built.requestFingerprint,
          protected_value_id: existing.protected_value_id,
        };
      }

      this.db
        .prepare(`
          INSERT INTO capture_requests (
            event_id, provider, hook_event_name, trust_zone_id, idempotency_key,
            request_fingerprint, envelope_metadata_json, protected_value_id, captured_at,
            recorded_at, project_id, worktree_id, worktree_name, git_branch,
            is_linked_worktree
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          built.event.event_id,
          normalizedEnvelope.provider,
          normalizedEnvelope.hook_event_name,
          this.trustZone.trust_zone_id,
          built.event.idempotency_key,
          built.requestFingerprint,
          stableJson({
            provider: normalizedEnvelope.provider,
            hook_event_name: normalizedEnvelope.hook_event_name,
            captured_at: normalizedEnvelope.captured_at,
            media_type: normalizedEnvelope.media_type,
            subject_ref: normalizedEnvelope.subject_ref,
            idempotency_key: normalizedEnvelope.idempotency_key,
            protected_value_id: protectedValueId,
            ...(normalizedEnvelope.procedure_trace === undefined
              ? {}
              : { procedure_trace: normalizedEnvelope.procedure_trace }),
          }),
          protectedValueId,
          normalizedEnvelope.captured_at,
          recordedAt,
          this.projectId,
          this.worktree.worktree_id,
          this.worktree.worktree_name,
          this.worktree.git_branch ?? null,
          this.worktree.is_linked_worktree ? 1 : 0,
        );
      maybeFail(options, "capture_request");

      this.db
        .prepare(`
          INSERT INTO protected_values (
            protected_value_id, vault_ref, key_ref, nonce_ref, tag_ref,
            nonce, tag, ciphertext, plaintext_digest, size_bytes, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          protectedValueId,
          protectedValueRef.vault_ref,
          protectedValueRef.key_ref,
          protectedValueRef.encrypted_blob.nonce_ref,
          protectedValueRef.encrypted_blob.tag_ref,
          encrypted.nonce,
          encrypted.tag,
          encrypted.ciphertext,
          plaintextDigest,
          protectedValueRef.encrypted_blob.size_bytes,
          recordedAt,
        );
      maybeFail(options, "protected_value");

      const eventInsert = this.db
        .prepare(`
          INSERT INTO canonical_events (
            event_id, event_type, trust_zone_id, idempotency_key, request_fingerprint,
            protected_value_id, event_json, recorded_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          built.event.event_id,
          built.event.event_type,
          this.trustZone.trust_zone_id,
          built.event.idempotency_key,
          built.requestFingerprint,
          protectedValueId,
          eventJson,
          recordedAt,
        );
      maybeFail(options, "canonical_event");

      const outboxInsert = this.db
        .prepare(`
          INSERT INTO outbox (
            event_id, state, attempts, available_at, push_request_json, created_at, updated_at
          )
          VALUES (?, 'pending', 0, ?, ?, ?, ?)
        `)
        .run(built.event.event_id, recordedAt, pushRequestJson, recordedAt, recordedAt);

      return {
        status: "captured",
        event: built.event,
        local_sequence: Number(eventInsert.lastInsertRowid),
        outbox_id: Number(outboxInsert.lastInsertRowid),
        request_fingerprint: built.requestFingerprint,
        protected_value_id: protectedValueId,
      };
    });
  }

  /**
   * Capture then optionally extract Observation (default on for product loop).
   * Extraction runs after the capture transaction so evidence always lands.
   * Agentic feed insert is also post-commit (never inside capture txn; fail-open).
   */
  captureHook(envelope: CaptureEnvelope, options: CaptureRequestOptions = {}): CaptureResult {
    const capture = this.captureHookWrite(envelope, options);
    // Post-capture agentic feed: no LLM, no network, no await. Outside txn for concurrency safety.
    // Only lifecycle hooks enter agentic feed (SessionEnd/Stop/PreCompact).
    // PostToolUse flood never queues for Flash (ADR 0018 product path).
    if (
      capture.status === "captured" &&
      options.agentic_feed !== false &&
      isAgenticFeedEnabled() &&
      isAgenticFeedHookEligible(envelope.hook_event_name)
    ) {
      try {
        const signal = extractSignalTextFromCapturePayload(envelope.payload);
        const front = evaluateDeterministicFront({
          hook_event_name: envelope.hook_event_name,
          signal_text: signal,
          require_lifecycle_hook: true,
        });
        const now = this.clock.now().toISOString();
        if (front.decision === "drop") {
          this.insertAgenticCaptureFeed({
            source_event_id: capture.event.event_id,
            artifact_id: capture.event.payload.artifact_id,
            trust_zone_id: this.trustZone.trust_zone_id,
            hook_event_name: envelope.hook_event_name,
            protected_value_id: capture.protected_value_id,
            created_at: now,
            state: "skipped",
            skip_reason: front.reason_codes.slice(0, 6).join(","),
            finished_at: now,
          });
        } else {
          this.insertAgenticCaptureFeed({
            source_event_id: capture.event.event_id,
            artifact_id: capture.event.payload.artifact_id,
            trust_zone_id: this.trustZone.trust_zone_id,
            hook_event_name: envelope.hook_event_name,
            protected_value_id: capture.protected_value_id,
            created_at: now,
          });
        }
      } catch {
        // ignore — capture remains authoritative
      }
    }
    if (options.extract !== true) {
      return capture;
    }
    try {
      const extraction = this.extractFromEvidenceArtifact({
        event: capture.event,
        envelope,
        ...(options.extractionPolicy === undefined
          ? {}
          : { policyOverrides: options.extractionPolicy }),
      });
      return { ...capture, extraction };
    } catch (error) {
      return {
        ...capture,
        extraction: {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
          source_event_id: capture.event.event_id,
        },
      };
    }
  }

  proposeClaimDraft(input: ProposeClaimDraftInput): ProposeClaimDraftResult {
    const recordedAt = this.clock.now().toISOString();
    const statement = input.statement.trim();
    if (statement.length === 0) {
      throw new Error("claim statement is required");
    }
    if (input.support.length === 0) {
      throw new Error("claim support is required");
    }
    if (input.confidence !== undefined && (input.confidence < 0 || input.confidence > 1)) {
      throw new Error("claim confidence must be between 0 and 1");
    }
    if (input.idempotencyKey !== undefined && !isIdempotencyKey(input.idempotencyKey)) {
      throw new Error("idempotency_key must match idem_[A-Za-z0-9_-]{16,128}");
    }
    const visibleTrustZoneIds = input.visibleTrustZoneIds ?? [this.trustZone.trust_zone_id];
    const support = this.validateSupportReferences({
      support: input.support,
      visibleTrustZoneIds,
    }).support.map((item) => item.ref);
    const validTime = input.validTime ?? { start: recordedAt, end: null };
    if (!isBitemporalInterval(validTime)) {
      throw new Error("valid_time.start must be before or equal to valid_time.end");
    }

    const normalizedInput = {
      statement,
      claim_type: input.claimType ?? "inference",
      support,
      confidence: input.confidence,
      subject_ref: input.subjectRef ?? this.projectId,
      trust_zone_id: this.trustZone.trust_zone_id,
      valid_time: validTime,
    };
    const requestFingerprint = fingerprintObject({
      tool: "propose_claim",
      ...normalizedInput,
    });
    const idempotencyKey =
      input.idempotencyKey ?? `idem_${hashHex(stableJson(normalizedInput)).slice(0, 32)}`;
    const eventDigest = hashHex(
      stableJson({
        trust_zone_id: this.trustZone.trust_zone_id,
        idempotency_key: idempotencyKey,
        request_fingerprint: requestFingerprint,
      }),
    );
    const protectedValueId = `pv_${eventDigest.slice(0, 24)}`;
    const protectedPayload = Buffer.from(
      stableJson({
        tool: "propose_claim",
        proposed_at: recordedAt,
        statement,
        claim_type: normalizedInput.claim_type,
        support: normalizedInput.support,
        confidence: normalizedInput.confidence,
        valid_time: validTime,
      }),
      "utf8",
    );
    const encrypted = encrypt(protectedPayload, this.keyBytes);
    const event: CanonicalEvent<"Claim"> = {
      schema_version: "v1",
      event_id: `evt_${eventDigest.slice(0, 32)}`,
      event_type: "Claim",
      subject_ref: normalizeIdentifier(normalizedInput.subject_ref),
      valid_time: validTime,
      recorded_time: { start: recordedAt, end: null },
      lifecycle_status: "draft",
      epistemic_authority: "self_reported",
      trust_zone: this.trustZone,
      provenance: normalizedInput.support,
      idempotency_key: idempotencyKey,
      request_fingerprint: requestFingerprint,
      payload: {
        claim_id: `claim_${eventDigest.slice(32, 56)}`,
        statement,
        claim_type: normalizedInput.claim_type,
        support: normalizedInput.support,
        ...(normalizedInput.confidence === undefined
          ? {}
          : { confidence: normalizedInput.confidence }),
      },
    };
    assertCanonicalEventConformance(event);
    const eventJson = stableJson(event);
    const syncRequest: SyncPushRequest = {
      schema_version: "v1",
      request_id: `req_${hashHex(stableJson({ event_id: event.event_id, client_id: this.clientId })).slice(0, 32)}`,
      client_id: this.clientId,
      trust_zone_id: this.trustZone.trust_zone_id,
      idempotency_key: idempotencyKey,
      request_fingerprint: requestFingerprint,
      events: [event],
      erasures: [],
    };
    const syncConformance = validateConformance("syncApi", syncRequest);
    if (!syncConformance.valid) {
      throw new Error(`invalid sync push request: ${syncConformance.errors.join("; ")}`);
    }

    return this.withImmediateTransaction(() => {
      const existing = this.findEventByIdempotency(this.trustZone.trust_zone_id, idempotencyKey);
      if (existing !== undefined) {
        const existingEvent = JSON.parse(existing.event_json) as CanonicalEvent<"Claim">;
        if (existingEvent.request_fingerprint !== requestFingerprint) {
          throw new IdempotencyConflictError({
            idempotencyKey,
            existingFingerprint: existingEvent.request_fingerprint,
            incomingFingerprint: requestFingerprint,
          });
        }
        return {
          status: "replay",
          event: existingEvent,
          local_sequence: Number(existing.local_sequence),
          outbox_id: this.findOutboxIdForEvent(existingEvent.event_id),
          request_fingerprint: requestFingerprint,
          protected_value_id: existing.protected_value_id,
          valid_time_defaulted: input.validTime === undefined,
        };
      }

      this.db
        .prepare(`
          INSERT INTO protected_values (
            protected_value_id, vault_ref, key_ref, nonce_ref, tag_ref,
            nonce, tag, ciphertext, plaintext_digest, size_bytes, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          protectedValueId,
          "vault_local",
          "key_local_active",
          `nonce_${protectedValueId.slice(3)}`,
          `tag_${protectedValueId.slice(3)}`,
          encrypted.nonce,
          encrypted.tag,
          encrypted.ciphertext,
          hashHex(protectedPayload),
          protectedPayload.byteLength,
          recordedAt,
        );

      const eventInsert = this.db
        .prepare(`
          INSERT INTO canonical_events (
            event_id, event_type, trust_zone_id, idempotency_key, request_fingerprint,
            protected_value_id, event_json, recorded_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          event.event_id,
          event.event_type,
          this.trustZone.trust_zone_id,
          idempotencyKey,
          requestFingerprint,
          protectedValueId,
          eventJson,
          recordedAt,
        );

      const outboxInsert = this.db
        .prepare(`
          INSERT INTO outbox (
            event_id, state, attempts, available_at, push_request_json, created_at, updated_at
          )
          VALUES (?, 'pending', 0, ?, ?, ?, ?)
        `)
        .run(event.event_id, recordedAt, stableJson(syncRequest), recordedAt, recordedAt);

      return {
        status: "proposed",
        event,
        local_sequence: Number(eventInsert.lastInsertRowid),
        outbox_id: Number(outboxInsert.lastInsertRowid),
        request_fingerprint: requestFingerprint,
        protected_value_id: protectedValueId,
        valid_time_defaulted: input.validTime === undefined,
      };
    });
  }

  /**
   * Human correction: supersede a wrongly promoted unit (ADR 0018 D4b).
   * Removes it from default search via append-only Supersession (no rewrite).
   */
  recordHumanSupersession(input: {
    supersedesEventId: string;
    reason: string;
    decidedBy: string;
    humanConfirmed: true;
    replacementEventId?: string;
    idempotencyKey?: string;
  }):
    | {
        status: "recorded" | "replay";
        event: CanonicalEvent<"Supersession">;
        event_id: string;
      }
    | { status: "failed"; error: string } {
    if (input.humanConfirmed !== true) {
      return { status: "failed", error: "humanConfirmed must be true" };
    }
    const decidedBy = input.decidedBy.trim();
    if (
      decidedBy.length < 2 ||
      /^(agent|system|llm|flash|auto|runner|bot)([._-]|$)/i.test(decidedBy)
    ) {
      return { status: "failed", error: "decidedBy must be a human actor id" };
    }
    const prior = this.listCanonicalEventSnapshots({
      visibleTrustZoneIds: [this.trustZone.trust_zone_id],
    }).find((s) => s.event_id === input.supersedesEventId);
    if (prior === undefined) {
      return { status: "failed", error: `event not found: ${input.supersedesEventId}` };
    }
    if (prior.event.event_type !== "Observation" && prior.event.event_type !== "Claim") {
      return { status: "failed", error: "only Observation or Claim can be superseded here" };
    }
    const reason = input.reason.trim();
    if (reason.length < 4) {
      return { status: "failed", error: "reason is required" };
    }
    const recordedAt = this.clock.now().toISOString();
    const normalized = {
      supersedes_event_id: input.supersedesEventId,
      replacement_event_id: input.replacementEventId ?? null,
      reason,
      decided_by: decidedBy,
      human_confirmed: true as const,
      trust_zone_id: this.trustZone.trust_zone_id,
    };
    const requestFingerprint = fingerprintObject({
      tool: "human_supersession",
      ...normalized,
    });
    const idempotencyKey =
      input.idempotencyKey ?? `idem_${hashHex(stableJson(normalized)).slice(0, 32)}`;
    if (!isIdempotencyKey(idempotencyKey)) {
      return { status: "failed", error: "invalid idempotency key" };
    }
    const eventDigest = hashHex(
      stableJson({
        trust_zone_id: this.trustZone.trust_zone_id,
        idempotency_key: idempotencyKey,
        request_fingerprint: requestFingerprint,
      }),
    );
    const protectedValueId = `pv_${eventDigest.slice(0, 24)}`;
    const protectedPayload = Buffer.from(
      stableJson({ tool: "human_supersession", at: recordedAt, ...normalized }),
      "utf8",
    );
    const encrypted = encrypt(protectedPayload, this.keyBytes);
    const event: CanonicalEvent<"Supersession"> = {
      schema_version: "v1",
      event_id: `evt_${eventDigest.slice(0, 32)}`,
      event_type: "Supersession",
      subject_ref: prior.event.subject_ref,
      valid_time: { start: recordedAt, end: null },
      recorded_time: { start: recordedAt, end: null },
      lifecycle_status: "active",
      epistemic_authority: "verified",
      trust_zone: this.trustZone,
      provenance: [
        {
          ref_type: "event",
          ref_id: input.supersedesEventId,
          relationship: "supersedes",
        },
      ],
      idempotency_key: idempotencyKey,
      request_fingerprint: requestFingerprint,
      payload: {
        supersession_id: `sup_${eventDigest.slice(32, 56)}`,
        supersedes_event_id: input.supersedesEventId,
        reason: `${reason} [by:${decidedBy}]`,
        ...(input.replacementEventId !== undefined
          ? { replacement_event_id: input.replacementEventId }
          : {}),
      },
    };
    try {
      assertCanonicalEventConformance(event);
    } catch (error) {
      return {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
    try {
      return this.withImmediateTransaction(() => {
        const existing = this.findEventByIdempotency(this.trustZone.trust_zone_id, idempotencyKey);
        if (existing !== undefined) {
          const existingEvent = JSON.parse(existing.event_json) as CanonicalEvent<"Supersession">;
          return {
            status: "replay" as const,
            event: existingEvent,
            event_id: existingEvent.event_id,
          };
        }
        this.db
          .prepare(`
            INSERT INTO protected_values (
              protected_value_id, vault_ref, key_ref, nonce_ref, tag_ref,
              nonce, tag, ciphertext, plaintext_digest, size_bytes, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            protectedValueId,
            "vault_local",
            "key_local_active",
            `nonce_${protectedValueId.slice(3)}`,
            `tag_${protectedValueId.slice(3)}`,
            encrypted.nonce,
            encrypted.tag,
            encrypted.ciphertext,
            hashHex(protectedPayload),
            protectedPayload.byteLength,
            recordedAt,
          );
        this.db
          .prepare(`
            INSERT INTO canonical_events (
              event_id, event_type, trust_zone_id, idempotency_key, request_fingerprint,
              protected_value_id, event_json, recorded_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            event.event_id,
            event.event_type,
            this.trustZone.trust_zone_id,
            idempotencyKey,
            requestFingerprint,
            protectedValueId,
            stableJson(event),
            recordedAt,
          );
        this.db
          .prepare(`
            INSERT INTO outbox (
              event_id, state, attempts, available_at, push_request_json, created_at, updated_at
            ) VALUES (?, 'pending', 0, ?, ?, ?, ?)
          `)
          .run(
            event.event_id,
            recordedAt,
            stableJson({ schema_version: "v1", events: [event] }),
            recordedAt,
            recordedAt,
          );
        return { status: "recorded" as const, event, event_id: event.event_id };
      });
    } catch (error) {
      return {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Human-only AcceptanceDecision append (never used by agentic auto path).
   * Requires humanConfirmed: true and a non-machine decidedBy actor.
   */
  recordHumanAcceptanceDecision(input: RecordHumanAcceptanceInput): RecordHumanAcceptanceResult {
    if (input.humanConfirmed !== true) {
      return { status: "failed", error: "humanConfirmed must be true (fail-closed)" };
    }
    const decidedBy = input.decidedBy.trim();
    if (decidedBy.length < 2) {
      return { status: "failed", error: "decidedBy (human actor) is required" };
    }
    if (/^(agent|system|llm|flash|auto|runner|bot)([._-]|$)/i.test(decidedBy)) {
      return {
        status: "failed",
        error: "decidedBy must be a human actor id (machine ids rejected)",
      };
    }
    if (input.claimRefs.length === 0) {
      return { status: "failed", error: "claimRefs is required" };
    }
    if (
      input.decision !== "accepted" &&
      input.decision !== "rejected" &&
      input.decision !== "needs_review"
    ) {
      return { status: "failed", error: `invalid decision: ${String(input.decision)}` };
    }

    // Resolve claim_ids against draft/active Claims in this trust zone.
    const claimIds = [...new Set(input.claimRefs.map((c) => c.trim()).filter(Boolean))];
    const foundClaims = this.listCanonicalEventSnapshots({
      visibleTrustZoneIds: [this.trustZone.trust_zone_id],
      eventTypes: ["Claim"],
    }).filter((snap) => {
      if (snap.event.event_type !== "Claim") return false;
      return claimIds.includes(snap.event.payload.claim_id);
    });
    if (foundClaims.length !== claimIds.length) {
      const found = new Set(
        foundClaims
          .map((s) => (s.event.event_type === "Claim" ? s.event.payload.claim_id : ""))
          .filter(Boolean),
      );
      const missing = claimIds.filter((id) => !found.has(id));
      return {
        status: "failed",
        error: `claim_refs not found in trust zone: ${missing.join(",")}`,
      };
    }

    const recordedAt = this.clock.now().toISOString();
    const normalizedInput = {
      claim_refs: [...claimIds].sort(),
      decision: input.decision,
      decided_by: decidedBy,
      rationale: input.rationale?.trim() || null,
      subject_ref: input.subjectRef ?? this.projectId,
      trust_zone_id: this.trustZone.trust_zone_id,
      human_confirmed: true as const,
    };
    const requestFingerprint = fingerprintObject({
      tool: "human_acceptance_decision",
      ...normalizedInput,
    });
    const idempotencyKey =
      input.idempotencyKey ?? `idem_${hashHex(stableJson(normalizedInput)).slice(0, 32)}`;
    if (!isIdempotencyKey(idempotencyKey)) {
      return { status: "failed", error: "idempotency_key must match idem_[A-Za-z0-9_-]{16,128}" };
    }
    const eventDigest = hashHex(
      stableJson({
        trust_zone_id: this.trustZone.trust_zone_id,
        idempotency_key: idempotencyKey,
        request_fingerprint: requestFingerprint,
      }),
    );
    const protectedValueId = `pv_${eventDigest.slice(0, 24)}`;
    const protectedPayload = Buffer.from(
      stableJson({
        tool: "human_acceptance_decision",
        decided_at: recordedAt,
        ...normalizedInput,
      }),
      "utf8",
    );
    const encrypted = encrypt(protectedPayload, this.keyBytes);
    const event: CanonicalEvent<"AcceptanceDecision"> = {
      schema_version: "v1",
      event_id: `evt_${eventDigest.slice(0, 32)}`,
      event_type: "AcceptanceDecision",
      subject_ref: normalizeIdentifier(normalizedInput.subject_ref),
      valid_time: { start: recordedAt, end: null },
      recorded_time: { start: recordedAt, end: null },
      lifecycle_status: "active",
      epistemic_authority: "verified",
      trust_zone: this.trustZone,
      provenance: foundClaims.map((snap) => ({
        ref_type: "event" as const,
        ref_id: snap.event_id,
        relationship: "supports" as const,
      })),
      idempotency_key: idempotencyKey,
      request_fingerprint: requestFingerprint,
      payload: {
        decision_id: `decision_${eventDigest.slice(32, 56)}`,
        claim_refs: normalizedInput.claim_refs,
        decision: input.decision,
        decided_by: decidedBy,
        decided_at: recordedAt,
        ...(input.rationale !== undefined && input.rationale.trim().length > 0
          ? { rationale: input.rationale.trim() }
          : {}),
      },
    };
    try {
      assertCanonicalEventConformance(event);
    } catch (error) {
      return {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const eventJson = stableJson(event);
    const syncRequest: SyncPushRequest = {
      schema_version: "v1",
      request_id: `req_${hashHex(stableJson({ event_id: event.event_id, client_id: this.clientId })).slice(0, 32)}`,
      client_id: this.clientId,
      trust_zone_id: this.trustZone.trust_zone_id,
      idempotency_key: idempotencyKey,
      request_fingerprint: requestFingerprint,
      events: [event],
      erasures: [],
    };
    const syncConformance = validateConformance("syncApi", syncRequest);
    if (!syncConformance.valid) {
      return {
        status: "failed",
        error: `invalid sync push request: ${syncConformance.errors.join("; ")}`,
      };
    }

    try {
      return this.withImmediateTransaction(() => {
        const existing = this.findEventByIdempotency(this.trustZone.trust_zone_id, idempotencyKey);
        if (existing !== undefined) {
          const existingEvent = JSON.parse(
            existing.event_json,
          ) as CanonicalEvent<"AcceptanceDecision">;
          if (existingEvent.request_fingerprint !== requestFingerprint) {
            throw new IdempotencyConflictError({
              idempotencyKey,
              existingFingerprint: existingEvent.request_fingerprint,
              incomingFingerprint: requestFingerprint,
            });
          }
          return {
            status: "replay" as const,
            event: existingEvent,
            local_sequence: Number(existing.local_sequence),
            outbox_id: this.findOutboxIdForEvent(existingEvent.event_id),
            request_fingerprint: requestFingerprint,
            protected_value_id: existing.protected_value_id,
          };
        }

        this.db
          .prepare(`
            INSERT INTO protected_values (
              protected_value_id, vault_ref, key_ref, nonce_ref, tag_ref,
              nonce, tag, ciphertext, plaintext_digest, size_bytes, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            protectedValueId,
            "vault_local",
            "key_local_active",
            `nonce_${protectedValueId.slice(3)}`,
            `tag_${protectedValueId.slice(3)}`,
            encrypted.nonce,
            encrypted.tag,
            encrypted.ciphertext,
            hashHex(protectedPayload),
            protectedPayload.byteLength,
            recordedAt,
          );

        const eventInsert = this.db
          .prepare(`
            INSERT INTO canonical_events (
              event_id, event_type, trust_zone_id, idempotency_key, request_fingerprint,
              protected_value_id, event_json, recorded_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            event.event_id,
            event.event_type,
            this.trustZone.trust_zone_id,
            idempotencyKey,
            requestFingerprint,
            protectedValueId,
            eventJson,
            recordedAt,
          );

        const outboxInsert = this.db
          .prepare(`
            INSERT INTO outbox (
              event_id, state, attempts, available_at, push_request_json, created_at, updated_at
            )
            VALUES (?, 'pending', 0, ?, ?, ?, ?)
          `)
          .run(event.event_id, recordedAt, stableJson(syncRequest), recordedAt, recordedAt);

        return {
          status: "recorded" as const,
          event,
          local_sequence: Number(eventInsert.lastInsertRowid),
          outbox_id: Number(outboxInsert.lastInsertRowid),
          request_fingerprint: requestFingerprint,
          protected_value_id: protectedValueId,
        };
      });
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        return { status: "failed", error: error.message };
      }
      return {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Backfill agentic capture feed from historical EvidenceArtifact events.
   * Fail-open per row. No LLM. Product 6 complete path (E0 residual history).
   */
  backfillAgenticCaptureFeed(
    input: {
      limit?: number;
      /** Only SessionEnd/Stop/PreCompact by default (admit-eligible hooks). */
      hookEventNames?: readonly string[];
    } = {},
  ): AgenticFeedBackfillResult {
    const limit = input.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("backfill limit must be a positive integer");
    }
    const allowedHooks = new Set(
      (input.hookEventNames ?? ["SessionEnd", "Stop", "PreCompact"]).map((h) => h.trim()),
    );
    const evidence = this.listCanonicalEventSnapshots({
      visibleTrustZoneIds: [this.trustZone.trust_zone_id],
      eventTypes: ["EvidenceArtifact"],
    });

    let scanned = 0;
    let enqueued = 0;
    let already_present = 0;
    let skipped = 0;
    const reason_codes: string[] = [];

    for (const snap of evidence) {
      if (enqueued >= limit) break;
      if (snap.event.event_type !== "EvidenceArtifact") continue;
      scanned += 1;
      // Hook name may live in capture_requests metadata; fall back to SessionEnd.
      let hook = "SessionEnd";
      try {
        const row = this.db
          .prepare(`SELECT hook_event_name FROM capture_requests WHERE event_id = ? LIMIT 1`)
          .get(snap.event_id) as { hook_event_name: string } | undefined;
        if (row?.hook_event_name) hook = row.hook_event_name;
      } catch {
        // table may lack column in older DBs
      }
      // Prefer explicit allowlist when provided; otherwise lifecycle eligibility only.
      const hookOk =
        input.hookEventNames !== undefined
          ? allowedHooks.has(hook) || allowedHooks.has(hook.trim())
          : isAgenticFeedHookEligible(hook);
      if (!hookOk) {
        skipped += 1;
        continue;
      }
      const existing = this.db
        .prepare(`SELECT source_event_id FROM agentic_capture_feed WHERE source_event_id = ?`)
        .get(snap.event_id) as { source_event_id: string } | undefined;
      if (existing !== undefined) {
        already_present += 1;
        continue;
      }
      try {
        const signal = this.readCaptureSignalText(snap.event_id);
        const front = evaluateDeterministicFront({
          hook_event_name: hook,
          signal_text: signal,
          require_lifecycle_hook: true,
        });
        const now = this.clock.now().toISOString();
        if (front.decision === "drop") {
          this.insertAgenticCaptureFeed({
            source_event_id: snap.event_id,
            artifact_id: snap.event.payload.artifact_id,
            trust_zone_id: this.trustZone.trust_zone_id,
            hook_event_name: hook,
            protected_value_id: snap.protected_value_id ?? `pv_missing_${snap.event_id.slice(0, 16)}`,
            created_at: now,
            state: "skipped",
            skip_reason: front.reason_codes.slice(0, 6).join(","),
            finished_at: now,
          });
          skipped += 1;
        } else {
          this.insertAgenticCaptureFeed({
            source_event_id: snap.event_id,
            artifact_id: snap.event.payload.artifact_id,
            trust_zone_id: this.trustZone.trust_zone_id,
            hook_event_name: hook,
            protected_value_id: snap.protected_value_id ?? `pv_missing_${snap.event_id.slice(0, 16)}`,
            created_at: now,
          });
          enqueued += 1;
        }
      } catch {
        skipped += 1;
      }
      if (enqueued >= limit) break;
    }

    if (enqueued > 0) reason_codes.push("feed_backfill_enqueued");
    if (already_present > 0) reason_codes.push("feed_rows_already_present");
    if (scanned === 0) reason_codes.push("no_evidence_scanned");

    return {
      schema: "carpeos.agentic.feed-backfill/v1",
      scanned,
      enqueued,
      already_present,
      skipped,
      reason_codes,
    };
  }

  /**
   * Append an Observation derived from evidence (idempotent, append-only).
   */
  proposeObservationDraft(input: ProposeObservationDraftInput): ExtractionResult {
    const recordedAt = this.clock.now().toISOString();
    const statement = input.statement.trim();
    if (statement.length === 0) {
      throw new Error("observation statement is required");
    }
    if (input.evidenceArtifactRefs.length === 0) {
      throw new Error("evidence_artifact_refs is required");
    }
    if (input.confidence !== undefined && (input.confidence < 0 || input.confidence > 1)) {
      throw new Error("observation confidence must be between 0 and 1");
    }
    if (input.idempotencyKey !== undefined && !isIdempotencyKey(input.idempotencyKey)) {
      throw new Error("idempotency_key must match idem_[A-Za-z0-9_-]{16,128}");
    }

    // Ensure artifacts exist in this trust zone (or as known artifact_id on events).
    for (const artifactId of input.evidenceArtifactRefs) {
      if (!this.artifactExistsInZone(artifactId, this.trustZone.trust_zone_id)) {
        throw new Error(`evidence artifact not found in trust zone: ${artifactId}`);
      }
    }

    const observedAt = input.observedAt ?? recordedAt;
    const validTime = input.validTime ?? { start: observedAt, end: null };
    if (!isBitemporalInterval(validTime)) {
      throw new Error("valid_time.start must be before or equal to valid_time.end");
    }
    const lifecycleStatus = input.lifecycleStatus ?? "active";

    const provenance: ProvenanceRef[] =
      input.provenance !== undefined
        ? [...input.provenance]
        : input.sourceEventId !== undefined
          ? [
              {
                ref_type: "event",
                ref_id: input.sourceEventId,
                relationship: "derived_from",
              },
              ...input.evidenceArtifactRefs.map(
                (artifactId): ProvenanceRef => ({
                  ref_type: "artifact",
                  ref_id: artifactId,
                  relationship: "derived_from",
                }),
              ),
            ]
          : input.evidenceArtifactRefs.map(
              (artifactId): ProvenanceRef => ({
                ref_type: "artifact",
                ref_id: artifactId,
                relationship: "derived_from",
              }),
            );

    const normalizedInput = {
      statement,
      evidence_artifact_refs: [...input.evidenceArtifactRefs],
      source_event_id: input.sourceEventId,
      confidence: input.confidence,
      subject_ref: input.subjectRef ?? this.projectId,
      trust_zone_id: this.trustZone.trust_zone_id,
      valid_time: validTime,
      observed_at: observedAt,
    };
    const requestFingerprint = fingerprintObject({
      tool: "extract_observation",
      ...normalizedInput,
    });
    const idempotencyKey =
      input.idempotencyKey ??
      (input.sourceEventId !== undefined
        ? extractionObservationIdempotencyKey(input.sourceEventId)
        : `idem_${hashHex(stableJson(normalizedInput)).slice(0, 32)}`);
    const eventDigest = hashHex(
      stableJson({
        trust_zone_id: this.trustZone.trust_zone_id,
        idempotency_key: idempotencyKey,
        request_fingerprint: requestFingerprint,
      }),
    );
    const protectedValueId = `pv_${eventDigest.slice(0, 24)}`;
    const protectedPayload = Buffer.from(
      stableJson({
        tool: "extract_observation",
        extracted_at: recordedAt,
        statement,
        evidence_artifact_refs: normalizedInput.evidence_artifact_refs,
        source_event_id: normalizedInput.source_event_id,
      }),
      "utf8",
    );
    const encrypted = encrypt(protectedPayload, this.keyBytes);
    const event: CanonicalEvent<"Observation"> = {
      schema_version: "v1",
      event_id: `evt_${eventDigest.slice(0, 32)}`,
      event_type: "Observation",
      subject_ref: normalizeIdentifier(normalizedInput.subject_ref),
      valid_time: validTime,
      recorded_time: { start: recordedAt, end: null },
      lifecycle_status: lifecycleStatus,
      epistemic_authority: "observed",
      trust_zone: this.trustZone,
      provenance,
      idempotency_key: idempotencyKey,
      request_fingerprint: requestFingerprint,
      payload: {
        observation_id: `obs_${eventDigest.slice(32, 56)}`,
        observed_at: observedAt,
        statement,
        evidence_artifact_refs: [...normalizedInput.evidence_artifact_refs],
        ...(normalizedInput.confidence === undefined
          ? {}
          : { confidence: normalizedInput.confidence }),
      },
    };
    assertCanonicalEventConformance(event);
    const eventJson = stableJson(event);
    const syncRequest: SyncPushRequest = {
      schema_version: "v1",
      request_id: `req_${hashHex(stableJson({ event_id: event.event_id, client_id: this.clientId })).slice(0, 32)}`,
      client_id: this.clientId,
      trust_zone_id: this.trustZone.trust_zone_id,
      idempotency_key: idempotencyKey,
      request_fingerprint: requestFingerprint,
      events: [event],
      erasures: [],
    };
    const syncConformance = validateConformance("syncApi", syncRequest);
    if (!syncConformance.valid) {
      throw new Error(`invalid sync push request: ${syncConformance.errors.join("; ")}`);
    }

    return this.withImmediateTransaction(() => {
      const existing = this.findEventByIdempotency(this.trustZone.trust_zone_id, idempotencyKey);
      if (existing !== undefined) {
        const existingEvent = JSON.parse(existing.event_json) as CanonicalEvent<"Observation">;
        if (existingEvent.request_fingerprint !== requestFingerprint) {
          throw new IdempotencyConflictError({
            idempotencyKey,
            existingFingerprint: existingEvent.request_fingerprint,
            incomingFingerprint: requestFingerprint,
          });
        }
        return {
          status: "replay",
          event: existingEvent,
          local_sequence: Number(existing.local_sequence),
          outbox_id: this.findOutboxIdForEvent(existingEvent.event_id),
          request_fingerprint: requestFingerprint,
          protected_value_id: existing.protected_value_id,
          source_event_id: input.sourceEventId ?? existingEvent.event_id,
        };
      }

      this.db
        .prepare(`
          INSERT INTO protected_values (
            protected_value_id, vault_ref, key_ref, nonce_ref, tag_ref,
            nonce, tag, ciphertext, plaintext_digest, size_bytes, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          protectedValueId,
          "vault_local",
          "key_local_active",
          `nonce_${protectedValueId.slice(3)}`,
          `tag_${protectedValueId.slice(3)}`,
          encrypted.nonce,
          encrypted.tag,
          encrypted.ciphertext,
          hashHex(protectedPayload),
          protectedPayload.byteLength,
          recordedAt,
        );

      const eventInsert = this.db
        .prepare(`
          INSERT INTO canonical_events (
            event_id, event_type, trust_zone_id, idempotency_key, request_fingerprint,
            protected_value_id, event_json, recorded_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          event.event_id,
          event.event_type,
          this.trustZone.trust_zone_id,
          idempotencyKey,
          requestFingerprint,
          protectedValueId,
          eventJson,
          recordedAt,
        );

      const outboxInsert = this.db
        .prepare(`
          INSERT INTO outbox (
            event_id, state, attempts, available_at, push_request_json, created_at, updated_at
          )
          VALUES (?, 'pending', 0, ?, ?, ?, ?)
        `)
        .run(event.event_id, recordedAt, stableJson(syncRequest), recordedAt, recordedAt);

      return {
        status: "extracted",
        event,
        local_sequence: Number(eventInsert.lastInsertRowid),
        outbox_id: Number(outboxInsert.lastInsertRowid),
        request_fingerprint: requestFingerprint,
        protected_value_id: protectedValueId,
        source_event_id: input.sourceEventId ?? event.event_id,
      };
    });
  }

  /**
   * Adjudicate evidence and optionally promote/hold an Observation.
   * Reject: record disposition only (no meaning unit).
   */
  adjudicateEvidenceArtifact(input: {
    event: CanonicalEvent<"EvidenceArtifact">;
    envelope?: CaptureEnvelope;
    policyOverrides?: Partial<MeaningfulUnitPolicyConfig>;
    signalText?: string;
    /**
     * Policy identity for disposition history. Defaults to the current adjudicator
     * policy. A new value appends a new disposition row for the same evidence.
     */
    policyVersion?: string;
  }): AdjudicateResult {
    const evidence = input.event;
    if (evidence.event_type !== "EvidenceArtifact") {
      return {
        status: "skipped",
        reason: "not an EvidenceArtifact",
        source_event_id: evidence.event_id,
      };
    }
    const metaFromEnvelope = input.envelope;
    const metaFromRequest = this.getCaptureRequestMeta(evidence.event_id);
    const provider = metaFromEnvelope?.provider ?? metaFromRequest?.provider ?? "unknown";
    const hookEventName = normalizeCaptureHookEventName(
      metaFromEnvelope?.hook_event_name ?? metaFromRequest?.hook_event_name ?? "",
    );
    if (!hookEventName) {
      return {
        status: "skipped",
        reason: "missing hook_event_name",
        source_event_id: evidence.event_id,
      };
    }

    const extractedSignals = this.tryExtractSignals(evidence, metaFromEnvelope);
    const signalText = input.signalText ?? extractedSignals.scoring ?? "";
    // CLI/API signalText is scoring-only; statements require captured explicit candidate fields.
    const candidateText = input.signalText === undefined ? extractedSignals.candidate : undefined;

    const evidenceRefs = [
      { ref_type: "source_event" as const, ref_id: evidence.event_id },
      { ref_type: "artifact" as const, ref_id: evidence.payload.artifact_id },
    ];
    const adjudication = adjudicateKnowledgeCandidate(
      {
        provider,
        hook_event_name: hookEventName,
        kind: evidence.payload.kind,
        media_type: evidence.payload.media_type,
        subject_ref: evidence.subject_ref,
        artifact_id: evidence.payload.artifact_id,
        source_event_id: evidence.event_id,
        signal_text: signalText,
        spans: extractKnowledgeCandidateSpans(candidateText, evidenceRefs),
        evidence_refs: evidenceRefs,
      },
      input.policyOverrides,
    );

    const policyVersion = normalizePolicyVersion(
      input.policyVersion ?? adjudication.policy_version,
    );
    const recordedAt = this.clock.now().toISOString();
    const existingDisp = this.getDisposition(evidence.event_id, policyVersion);
    if (existingDisp !== undefined) {
      if (existingDisp.disposition === "reject") {
        return {
          status: "replay",
          disposition: "reject",
          reason_codes: existingDisp.reason_codes,
          scores: existingDisp.scores,
          policy_version: existingDisp.policy_version,
          source_event_id: evidence.event_id,
        };
      }
      const lifecycleStatus = existingDisp.disposition === "promote" ? "active" : "draft";
      const extraction = this.proposeObservationDraft({
        statement: existingDisp.statement,
        evidenceArtifactRefs: [evidence.payload.artifact_id],
        sourceEventId: evidence.event_id,
        subjectRef: evidence.subject_ref,
        validTime: evidence.valid_time,
        observedAt: evidence.valid_time.start,
        idempotencyKey: observationIdempotencyForPolicy(
          evidence.event_id,
          existingDisp.policy_version,
        ),
        lifecycleStatus,
      });
      return {
        status: "replay",
        disposition: existingDisp.disposition,
        reason_codes: existingDisp.reason_codes,
        scores: existingDisp.scores,
        policy_version: existingDisp.policy_version,
        extraction,
        source_event_id: evidence.event_id,
      };
    }

    this.insertDisposition({
      sourceEventId: evidence.event_id,
      artifactId: evidence.payload.artifact_id,
      trustZoneId: this.trustZone.trust_zone_id,
      disposition: adjudication.disposition,
      reasonCodes: adjudication.reason_codes,
      scores: adjudication.scores,
      policyVersion,
      statement: adjudication.statement,
      createdAt: recordedAt,
    });

    if (adjudication.disposition === "reject") {
      return {
        status: "rejected",
        disposition: "reject",
        reason_codes: adjudication.reason_codes,
        scores: adjudication.scores,
        policy_version: policyVersion,
        source_event_id: evidence.event_id,
      };
    }

    const extraction = this.proposeObservationDraft({
      statement: adjudication.statement,
      evidenceArtifactRefs: [evidence.payload.artifact_id],
      sourceEventId: evidence.event_id,
      subjectRef: evidence.subject_ref,
      validTime: evidence.valid_time,
      observedAt: evidence.valid_time.start,
      idempotencyKey: observationIdempotencyForPolicy(evidence.event_id, policyVersion),
      lifecycleStatus: adjudication.lifecycle_status,
    });

    return {
      status: adjudication.disposition === "promote" ? "promoted" : "held",
      disposition: adjudication.disposition,
      reason_codes: adjudication.reason_codes,
      scores: adjudication.scores,
      policy_version: policyVersion,
      extraction,
      source_event_id: evidence.event_id,
    };
  }

  /**
   * Extract path now runs adjudication (product 2.0). Reject → skipped extraction.
   */
  extractFromEvidenceArtifact(input: {
    event: CanonicalEvent<"EvidenceArtifact">;
    envelope?: CaptureEnvelope;
    policyOverrides?: Partial<MeaningfulUnitPolicyConfig>;
  }): ExtractionResult {
    const adjudicated = this.adjudicateEvidenceArtifact(input);
    if (adjudicated.status === "failed") {
      return {
        status: "failed",
        error: adjudicated.error ?? "adjudication failed",
        ...(adjudicated.source_event_id === undefined
          ? {}
          : { source_event_id: adjudicated.source_event_id }),
      };
    }
    if (adjudicated.status === "skipped") {
      return {
        status: "skipped",
        reason: adjudicated.reason ?? "adjudication skipped",
        ...(adjudicated.source_event_id === undefined
          ? {}
          : { source_event_id: adjudicated.source_event_id }),
      };
    }
    if (adjudicated.status === "rejected") {
      return {
        status: "skipped",
        reason: `adjudication_reject:${adjudicated.reason_codes.join(",")}`,
        source_event_id: adjudicated.source_event_id,
      };
    }
    if (adjudicated.status === "replay") {
      if (adjudicated.extraction !== undefined) {
        return adjudicated.extraction;
      }
      return {
        status: "skipped",
        reason: `adjudication_reject:${adjudicated.reason_codes.join(",")}`,
        source_event_id: adjudicated.source_event_id,
      };
    }
    if (adjudicated.status === "promoted" || adjudicated.status === "held") {
      return adjudicated.extraction;
    }
    return {
      status: "skipped",
      reason: "adjudication_unhandled",
      source_event_id: input.event.event_id,
    };
  }

  /**
   * Adjudicate by evidence event id (CLI / backfill).
   */
  adjudicateFromEventId(
    eventId: string,
    options: {
      policyOverrides?: Partial<MeaningfulUnitPolicyConfig>;
      signalText?: string;
      policyVersion?: string;
    } = {},
  ): AdjudicateResult {
    const row = this.db
      .prepare(
        `
          SELECT event_json
          FROM canonical_events
          WHERE event_id = ? AND trust_zone_id = ?
        `,
      )
      .get(eventId, this.trustZone.trust_zone_id) as { event_json: string } | undefined;
    if (row === undefined) {
      return {
        status: "failed",
        error: `event not found in trust zone: ${eventId}`,
        source_event_id: eventId,
      };
    }
    const event = JSON.parse(row.event_json) as CanonicalEvent;
    if (event.event_type !== "EvidenceArtifact") {
      return {
        status: "skipped",
        reason: `event type is ${event.event_type}, expected EvidenceArtifact`,
        source_event_id: eventId,
      };
    }
    return this.adjudicateEvidenceArtifact({
      event: event as CanonicalEvent<"EvidenceArtifact">,
      ...(options.policyOverrides === undefined
        ? {}
        : { policyOverrides: options.policyOverrides }),
      ...(options.signalText === undefined ? {} : { signalText: options.signalText }),
      ...(options.policyVersion === undefined ? {} : { policyVersion: options.policyVersion }),
    });
  }

  previewPolicyReconciliation(input: {
    from_policy: string;
    to_policy: string;
    trust_zone_id: string;
    limit: number;
  }): PolicyReconciliationPlanV2 {
    if (input.trust_zone_id !== this.trustZone.trust_zone_id) {
      throw new Error("trust zone does not match the opened store");
    }
    this.db.exec("BEGIN");
    try {
      const totalCandidateCount = safeSqliteInteger(
        (
          this.db
            .prepare(
              `SELECT COUNT(*) AS n FROM knowledge_dispositions
               WHERE trust_zone_id = ? AND policy_version = ?`,
            )
            .get(input.trust_zone_id, input.from_policy) as { n: unknown }
        ).n,
        "total_candidate_count",
      );
      // The preview contract emits only the deterministic bounded candidate prefix.
      const candidatePrefix = this.db
        .prepare(
          `SELECT source_event_id, artifact_id, policy_version FROM knowledge_dispositions
           WHERE trust_zone_id = ? AND policy_version = ?
           ORDER BY source_event_id COLLATE BINARY ASC, policy_version COLLATE BINARY ASC
           LIMIT ?`,
        )
        .all(input.trust_zone_id, input.from_policy, input.limit) as Array<{
        source_event_id: string;
        artifact_id: string;
        policy_version: string;
      }>;
      const scanLimit = 201;
      const canonicalSupersessions = this.db
        .prepare(
          `SELECT event_id, trust_zone_id, event_json FROM canonical_events
           WHERE event_type = 'Supersession'
           ORDER BY event_id COLLATE BINARY ASC LIMIT ?`,
        )
        .all(scanLimit) as Array<{ event_id: string; trust_zone_id: string; event_json: string }>;
      const inboxRows = this.db
        .prepare(
          "SELECT event_id, trust_zone_id, event_json FROM sync_inbox_events ORDER BY event_id COLLATE BINARY ASC LIMIT ?",
        )
        .all(scanLimit) as Array<{ event_id: string; trust_zone_id: string; event_json: string }>;
      const inboxEvidence = new Map<string, CanonicalEvent | undefined>();
      for (const row of inboxRows) {
        try {
          const event = JSON.parse(row.event_json) as CanonicalEvent;
          if (
            !validateConformance("canonicalEvent", event).valid ||
            event.event_id !== row.event_id ||
            event.trust_zone.trust_zone_id !== row.trust_zone_id
          ) {
            inboxEvidence.set(row.event_id, undefined);
            continue;
          }
          inboxEvidence.set(row.event_id, event);
        } catch {
          inboxEvidence.set(row.event_id, undefined);
        }
      }
      const inboxEventIds = new Set(inboxRows.map((row) => row.event_id));
      const localSupersessions = new Map<string, CanonicalEvent<"Supersession">>();
      const importedSupersessions = new Map<string, CanonicalEvent<"Supersession">>();
      let unprovedSupersessionConformance =
        canonicalSupersessions.length === scanLimit || inboxRows.length === scanLimit;
      const loadSupersessions = (
        rows: Array<{ event_id: string; trust_zone_id: string; event_json: string }>,
        destination: Map<string, CanonicalEvent<"Supersession">>,
        requireSupersession: boolean,
      ) => {
        for (const row of rows) {
          if (destination.has(row.event_id)) continue;
          try {
            const event = JSON.parse(row.event_json) as CanonicalEvent;
            const conformance = validateConformance("canonicalEvent", event);
            if (
              !conformance.valid ||
              event.event_id !== row.event_id ||
              event.trust_zone.trust_zone_id !== row.trust_zone_id ||
              (requireSupersession && event.event_type !== "Supersession")
            ) {
              unprovedSupersessionConformance = true;
              continue;
            }
            if (event.event_type === "Supersession") {
              destination.set(event.event_id, event);
            }
          } catch {
            unprovedSupersessionConformance = true;
          }
        }
      };
      loadSupersessions(canonicalSupersessions, localSupersessions, true);
      for (const row of inboxRows) {
        const event = inboxEvidence.get(row.event_id);
        if (event === undefined) {
          unprovedSupersessionConformance = true;
          continue;
        }
        if (event.event_type === "Supersession") {
          importedSupersessions.set(event.event_id, event);
        }
      }
      // An inbox copy remains imported evidence even when a canonical row shares
      // its event id; local overlap must not upgrade origin authority.
      const knownSupersessionRelations = [
        ...new Map(
          [...localSupersessions.values(), ...importedSupersessions.values()]
            .flatMap((event) =>
              event.payload.replacement_event_id === undefined
                ? []
                : [
                    [
                      `${event.payload.supersedes_event_id}\u0000${event.payload.replacement_event_id}`,
                      [
                        event.payload.supersedes_event_id,
                        event.payload.replacement_event_id,
                      ] as const,
                    ] as const,
                  ],
            )
            .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
        ).values(),
      ];
      let reconciliationCandidates: ReconciliationCandidate[] = candidatePrefix.map((candidate) => {
        const importedSource = inboxEventIds.has(candidate.source_event_id);
        const sourceRow = this.db
          .prepare(
            "SELECT event_id, event_json FROM canonical_events WHERE event_id = ? AND trust_zone_id = ?",
          )
          .get(candidate.source_event_id, input.trust_zone_id) as
          | { event_id: string; event_json: string }
          | undefined;
        if (sourceRow === undefined) {
          return {
            ...candidate,
            unsafe_reason_code: importedSource ? "imported_unsafe" : "missing_unsafe",
          };
        }
        if (importedSource) {
          return { ...candidate, unsafe_reason_code: "imported_unsafe" };
        }
        let source: CanonicalEvent;
        try {
          source = JSON.parse(sourceRow.event_json) as CanonicalEvent;
        } catch {
          return {
            ...candidate,
            unsafe_reason_code: "lineage_unsafe",
            conformance_proved: false,
          };
        }
        if (
          !validateConformance("canonicalEvent", source).valid ||
          sourceRow.event_id !== candidate.source_event_id ||
          source.event_id !== candidate.source_event_id ||
          source.event_type !== "EvidenceArtifact" ||
          source.trust_zone.trust_zone_id !== input.trust_zone_id ||
          source.payload.artifact_id !== candidate.artifact_id
        ) {
          return {
            ...candidate,
            unsafe_reason_code: "lineage_unsafe",
            conformance_proved: false,
          };
        }
        let observationConformanceUnproved = false;
        const observationKeys = [
          observationIdempotencyForPolicy(candidate.source_event_id, input.from_policy),
          observationIdempotencyForPolicy(candidate.source_event_id, input.to_policy),
          heldReviewObservationIdempotencyKey(
            candidate.source_event_id,
            input.trust_zone_id,
            input.from_policy,
          ),
          heldReviewObservationIdempotencyKey(
            candidate.source_event_id,
            input.trust_zone_id,
            input.to_policy,
          ),
        ];
        const observationCount = safeSqliteInteger(
          (
            this.db
              .prepare(
                `SELECT COUNT(*) AS n FROM canonical_events
                 WHERE trust_zone_id = ? AND event_type = 'Observation'
                   AND idempotency_key IN (?, ?, ?, ?)`,
              )
              .get(input.trust_zone_id, ...observationKeys) as { n: unknown }
          ).n,
          "matching observation count",
        );
        const observationLimit = 9;
        const observations = this.db
          .prepare(
            `SELECT event_id, event_json FROM canonical_events
             WHERE trust_zone_id = ? AND event_type = 'Observation'
               AND idempotency_key IN (?, ?, ?, ?)
             ORDER BY event_id COLLATE BINARY ASC LIMIT ?`,
          )
          .all(input.trust_zone_id, ...observationKeys, observationLimit) as Array<{
          event_id: string;
          event_json: string;
        }>;
        if (observationCount >= observationLimit) observationConformanceUnproved = true;
        const policyDispositionCount = safeSqliteInteger(
          (
            this.db
              .prepare(
                `SELECT COUNT(*) AS n FROM knowledge_dispositions
                 WHERE source_event_id = ? AND trust_zone_id = ? AND policy_version IN (?, ?)`,
              )
              .get(
                candidate.source_event_id,
                input.trust_zone_id,
                input.from_policy,
                input.to_policy,
              ) as { n: unknown }
          ).n,
          "matching disposition count",
        );
        const policyDispositions = this.db
          .prepare(
            `SELECT policy_version, disposition FROM knowledge_dispositions
             WHERE source_event_id = ? AND trust_zone_id = ? AND policy_version IN (?, ?)
             ORDER BY policy_version COLLATE BINARY ASC LIMIT ?`,
          )
          .all(
            candidate.source_event_id,
            input.trust_zone_id,
            input.from_policy,
            input.to_policy,
            3,
          ) as Array<{ policy_version: string; disposition: KnowledgeDisposition }>;
        const heldReviewCount = safeSqliteInteger(
          (
            this.db
              .prepare(
                `SELECT COUNT(*) AS n FROM knowledge_disposition_reviews
                 WHERE source_event_id = ? AND trust_zone_id = ? AND policy_version IN (?, ?)`,
              )
              .get(
                candidate.source_event_id,
                input.trust_zone_id,
                input.from_policy,
                input.to_policy,
              ) as { n: unknown }
          ).n,
          "matching review count",
        );
        const heldReviews = this.db
          .prepare(
            `SELECT policy_version, review_decision FROM knowledge_disposition_reviews
             WHERE source_event_id = ? AND trust_zone_id = ? AND policy_version IN (?, ?)
             ORDER BY policy_version COLLATE BINARY ASC, review_id COLLATE BINARY ASC LIMIT ?`,
          )
          .all(
            candidate.source_event_id,
            input.trust_zone_id,
            input.from_policy,
            input.to_policy,
            3,
          ) as Array<{ policy_version: string; review_decision: HeldReviewDecision }>;
        if (policyDispositionCount >= 3 || heldReviewCount >= 3)
          observationConformanceUnproved = true;
        const materializationAuthority = (
          policyVersion: string,
        ): "ordinary" | "held" | undefined => {
          const dispositions = policyDispositions.filter(
            (row) => row.policy_version === policyVersion,
          );
          const reviews = heldReviews.filter((row) => row.policy_version === policyVersion);
          if (dispositions.length !== 1) return undefined;
          if (dispositions[0]?.disposition === "promote")
            return reviews.length === 0 ? "ordinary" : undefined;
          if (dispositions[0]?.disposition === "hold")
            return reviews.length === 1 && reviews[0]?.review_decision === "promote"
              ? "held"
              : undefined;
          return undefined;
        };
        const relevantObservations = (
          policyVersion: string,
        ): Array<{ event: CanonicalEvent<"Observation">; key: "ordinary" | "held" }> =>
          observations.flatMap((row) => {
            try {
              const event = JSON.parse(row.event_json) as CanonicalEvent;
              if (
                !validateConformance("canonicalEvent", event).valid ||
                event.event_id !== row.event_id ||
                event.event_type !== "Observation" ||
                event.trust_zone.trust_zone_id !== input.trust_zone_id
              ) {
                observationConformanceUnproved = true;
                return [];
              }
              const ordinaryKey = observationIdempotencyForPolicy(
                candidate.source_event_id,
                policyVersion,
              );
              const heldKey = heldReviewObservationIdempotencyKey(
                candidate.source_event_id,
                input.trust_zone_id,
                policyVersion,
              );
              const key =
                event.idempotency_key === ordinaryKey
                  ? "ordinary"
                  : event.idempotency_key === heldKey
                    ? "held"
                    : undefined;
              const relevant =
                key !== undefined &&
                event.lifecycle_status === "active" &&
                event.payload.evidence_artifact_refs.includes(candidate.artifact_id) &&
                event.provenance.some(
                  (ref) =>
                    ref.ref_type === "event" &&
                    ref.ref_id === candidate.source_event_id &&
                    ref.relationship === "derived_from",
                );
              return relevant ? [{ event, key }] : [];
            } catch {
              observationConformanceUnproved = true;
              return [];
            }
          });
        const observedOld = relevantObservations(input.from_policy);
        const observedReplacements = relevantObservations(input.to_policy);
        const selectAuthorized = (
          policyVersion: string,
          observed: Array<{ event: CanonicalEvent<"Observation">; key: "ordinary" | "held" }>,
        ): CanonicalEvent<"Observation">[] => {
          const authority = materializationAuthority(policyVersion);
          return authority === undefined
            ? []
            : observed
                .filter((observation) => observation.key === authority)
                .map(({ event }) => event);
        };
        const oldTargets = selectAuthorized(input.from_policy, observedOld);
        const replacements = selectAuthorized(input.to_policy, observedReplacements);
        const observedMaterializations = [...observedOld, ...observedReplacements];
        const targetSubjectRef = observedOld[0]?.event.subject_ref;
        const replacementSubjectRef = observedReplacements[0]?.event.subject_ref;
        const candidateGraphFacts = {
          subject_ref: source.subject_ref,
          ...(targetSubjectRef === undefined ? {} : { target_subject_ref: targetSubjectRef }),
          ...(replacementSubjectRef === undefined
            ? {}
            : { replacement_subject_ref: replacementSubjectRef }),
          lineage_event_ids: [
            ...new Set(
              observedMaterializations.flatMap(({ event }) => [
                event.event_id,
                ...event.provenance
                  .filter((ref) => ref.ref_type === "event")
                  .map((ref) => ref.ref_id),
              ]),
            ),
          ].sort(),
          supersession_relations: knownSupersessionRelations,
        };
        if (observationConformanceUnproved) {
          return {
            ...candidate,
            ...candidateGraphFacts,
            unsafe_reason_code: "lineage_unsafe",
            conformance_proved: false,
          };
        }
        const subjectMismatch = observedMaterializations.some(
          ({ event }) => event.subject_ref !== source.subject_ref,
        );
        if (subjectMismatch) {
          return {
            ...candidate,
            ...candidateGraphFacts,
            unsafe_reason_code: "lineage_unsafe",
          };
        }
        const wrongKeyMaterialization = (
          policyVersion: string,
          observed: Array<{ event: CanonicalEvent<"Observation">; key: "ordinary" | "held" }>,
        ) =>
          observed.some(
            (observation) => observation.key !== materializationAuthority(policyVersion),
          );
        if (
          wrongKeyMaterialization(input.from_policy, observedOld) ||
          wrongKeyMaterialization(input.to_policy, observedReplacements)
        ) {
          return {
            ...candidate,
            ...candidateGraphFacts,
            unsafe_reason_code: "ambiguous_unsafe",
          };
        }
        const importedOldTarget = oldTargets.find((event) => inboxEventIds.has(event.event_id));
        const importedReplacement = replacements.find((event) => inboxEventIds.has(event.event_id));
        if (importedOldTarget !== undefined || importedReplacement !== undefined) {
          return {
            ...candidate,
            ...candidateGraphFacts,
            ...(importedOldTarget === undefined
              ? {}
              : { target_event_id: importedOldTarget.event_id }),
            ...(importedReplacement === undefined
              ? {}
              : { replacement_event_id: importedReplacement.event_id }),
            unsafe_reason_code: "imported_unsafe",
          };
        }
        const toDisposition = policyDispositions
          .filter((row) => row.policy_version === input.to_policy)
          .map((row) => ({ disposition: row.disposition }));
        if (toDisposition.length !== 1) {
          return {
            ...candidate,
            ...candidateGraphFacts,
            unsafe_reason_code: toDisposition.length === 0 ? "missing_unsafe" : "ambiguous_unsafe",
          };
        }
        const toReviews = heldReviews.filter((row) => row.policy_version === input.to_policy);
        const effectiveToDisposition =
          toDisposition[0]?.disposition === "promote" && toReviews.length === 0
            ? "promote"
            : toDisposition[0]?.disposition === "reject" && toReviews.length === 0
              ? "reject"
              : materializationAuthority(input.to_policy) === "held"
                ? "promote"
                : undefined;
        if (effectiveToDisposition === undefined) {
          return {
            ...candidate,
            ...candidateGraphFacts,
            unsafe_reason_code: toReviews.length === 0 ? "missing_unsafe" : "ambiguous_unsafe",
          };
        }
        if (oldTargets.length !== 1) {
          return {
            ...candidate,
            ...candidateGraphFacts,
            unsafe_reason_code: oldTargets.length === 0 ? "missing_unsafe" : "ambiguous_unsafe",
          };
        }
        const oldTarget = oldTargets[0];
        if (oldTarget === undefined) {
          return {
            ...candidate,
            ...candidateGraphFacts,
            unsafe_reason_code: "missing_unsafe",
          };
        }
        if (effectiveToDisposition === "reject") {
          const targetEventId = oldTarget.event_id;
          if (targetEventId === undefined) {
            return {
              ...candidate,
              ...candidateGraphFacts,
              unsafe_reason_code: "missing_unsafe",
            };
          }
          const allRelations = [
            ...localSupersessions.values(),
            ...importedSupersessions.values(),
          ].filter((event) => event.payload.supersedes_event_id === targetEventId);
          const localMatches = allRelations.filter(
            (event) =>
              localSupersessions.has(event.event_id) &&
              event.payload.replacement_event_id === undefined,
          );
          const importedMatches = allRelations.filter(
            (event) =>
              importedSupersessions.has(event.event_id) &&
              event.payload.replacement_event_id === undefined,
          );
          if (
            allRelations.some((event) => event.trust_zone.trust_zone_id !== input.trust_zone_id)
          ) {
            return {
              ...candidate,
              ...candidateGraphFacts,
              target_event_id: targetEventId,
              unsafe_reason_code: "zone_unsafe",
            };
          }
          if (allRelations.some((event) => event.payload.replacement_event_id !== undefined)) {
            return {
              ...candidate,
              ...candidateGraphFacts,
              target_event_id: targetEventId,
              unsafe_reason_code: "conflicting_intent_unsafe",
            };
          }
          if (importedMatches.length > 0)
            return {
              ...candidate,
              ...candidateGraphFacts,
              target_event_id: targetEventId,
              unsafe_reason_code: "imported_unsafe",
            };
          if (localMatches.length === 1)
            return {
              ...candidate,
              ...candidateGraphFacts,
              target_event_id: targetEventId,
              classification: "already_applied",
            };
          if (localMatches.length > 1)
            return {
              ...candidate,
              ...candidateGraphFacts,
              target_event_id: targetEventId,
              unsafe_reason_code: "ambiguous_unsafe",
            };
          return {
            ...candidate,
            ...candidateGraphFacts,
            target_event_id: targetEventId,
            classification: "invalidate",
          };
        }
        if (effectiveToDisposition !== "promote") {
          return {
            ...candidate,
            ...candidateGraphFacts,
            unsafe_reason_code: "ambiguous_unsafe",
          };
        }
        if (replacements.length !== 1) {
          return {
            ...candidate,
            ...candidateGraphFacts,
            target_event_id: oldTarget.event_id,
            unsafe_reason_code: replacements.length === 0 ? "missing_unsafe" : "ambiguous_unsafe",
          };
        }
        const replacement = replacements[0];
        if (replacement === undefined) {
          return {
            ...candidate,
            ...candidateGraphFacts,
            unsafe_reason_code: "missing_unsafe",
          };
        }
        const targetEventId = oldTarget.event_id;
        const replacementEventId = replacement.event_id;
        if (targetEventId === undefined || replacementEventId === undefined) {
          return { ...candidate, ...candidateGraphFacts, unsafe_reason_code: "missing_unsafe" };
        }
        const allSupersessions = [
          ...localSupersessions.values(),
          ...importedSupersessions.values(),
        ];
        const relationEdges = allSupersessions.flatMap((event) =>
          event.payload.replacement_event_id === undefined
            ? []
            : [[event.payload.supersedes_event_id, event.payload.replacement_event_id] as const],
        );
        const reaches = (start: string, goal: string): boolean => {
          const visited = new Set<string>();
          const pending = [start];
          while (pending.length > 0) {
            const current = pending.pop() as string;
            if (current === goal) return true;
            if (visited.has(current)) continue;
            visited.add(current);
            for (const [from, to] of relationEdges) if (from === current) pending.push(to);
          }
          return false;
        };
        const matching = allSupersessions.filter(
          (event) =>
            event.payload.supersedes_event_id === targetEventId &&
            (event.payload.replacement_event_id ?? null) === replacementEventId,
        );
        const targetRelations = allSupersessions.filter(
          (event) => event.payload.supersedes_event_id === targetEventId,
        );
        if (
          targetRelations.some((event) => event.trust_zone.trust_zone_id !== input.trust_zone_id)
        ) {
          return {
            ...candidate,
            ...candidateGraphFacts,
            target_event_id: targetEventId,
            replacement_event_id: replacementEventId,
            unsafe_reason_code: "zone_unsafe",
          };
        }
        if (matching.some((event) => importedSupersessions.has(event.event_id))) {
          return {
            ...candidate,
            ...candidateGraphFacts,
            target_event_id: targetEventId,
            replacement_event_id: replacementEventId,
            unsafe_reason_code: "imported_unsafe",
          };
        }
        if (targetEventId === replacementEventId || reaches(replacementEventId, targetEventId)) {
          return {
            ...candidate,
            ...candidateGraphFacts,
            target_event_id: targetEventId,
            replacement_event_id: replacementEventId,
            unsafe_reason_code: "cycle_unsafe",
          };
        }
        if (targetRelations.some((event) => !matching.includes(event))) {
          return {
            ...candidate,
            ...candidateGraphFacts,
            target_event_id: targetEventId,
            replacement_event_id: replacementEventId,
            unsafe_reason_code: "conflicting_intent_unsafe",
          };
        }
        if (matching.length > 1) {
          return {
            ...candidate,
            ...candidateGraphFacts,
            target_event_id: targetEventId,
            replacement_event_id: replacementEventId,
            unsafe_reason_code: "ambiguous_unsafe",
          };
        }
        if (matching.length === 1) {
          return {
            ...candidate,
            ...candidateGraphFacts,
            target_event_id: targetEventId,
            replacement_event_id: replacementEventId,
            classification: "already_applied",
          };
        }
        return {
          ...candidate,
          ...candidateGraphFacts,
          target_event_id: targetEventId,
          replacement_event_id: replacementEventId,
          classification: "replace",
        };
      });
      reconciliationCandidates = reconciliationCandidates.map((candidate) => ({
        ...candidate,
        supersession_relations: candidate.supersession_relations ?? knownSupersessionRelations,
      }));
      if (unprovedSupersessionConformance) {
        reconciliationCandidates = reconciliationCandidates.map((candidate) => ({
          ...candidate,
          conformance_proved: false,
        }));
      }
      const highWater = {
        canonical_local_sequence_max: safeSqliteInteger(
          (
            this.db
              .prepare("SELECT COALESCE(MAX(local_sequence), 0) AS n FROM canonical_events")
              .get() as { n: unknown }
          ).n,
          "canonical_local_sequence_max",
        ),
        disposition_row_count: safeSqliteInteger(
          (
            this.db.prepare("SELECT COUNT(*) AS n FROM knowledge_dispositions").get() as {
              n: unknown;
            }
          ).n,
          "disposition_row_count",
        ),
        review_row_count: safeSqliteInteger(
          (
            this.db.prepare("SELECT COUNT(*) AS n FROM knowledge_disposition_reviews").get() as {
              n: unknown;
            }
          ).n,
          "review_row_count",
        ),
        outbox_id_max: safeSqliteInteger(
          (
            this.db.prepare("SELECT COALESCE(MAX(outbox_id), 0) AS n FROM outbox").get() as {
              n: unknown;
            }
          ).n,
          "outbox_id_max",
        ),
        supersession_event_count: safeSqliteInteger(
          new Set([...localSupersessions.keys(), ...importedSupersessions.keys()]).size,
          "supersession_event_count",
        ),
      };
      const globalTaints = new Set<GlobalTaintReasonCode>(
        unprovedSupersessionConformance ? ["unproved_conformance_global_taint"] : [],
      );
      const plan = buildPolicyReconciliationPlanV2({
        ...input,
        total_candidate_count: totalCandidateCount,
        high_water: highWater,
        // Only explicit local canonical provenance and policy-specific
        // materializations are eligible; every absent or ambiguous fact is unsafe.
        candidates: reconciliationCandidates,
        global_taint_reason_codes: [...globalTaints],
      });
      this.db.exec("COMMIT");
      return plan;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  /**
   * Record a knowledge disposition under an explicit policy_version (append-only).
   * Used by Product 6 agentic_v1 hold/promote materialize and policy experiments.
   * Never creates AcceptanceDecision. Idempotent on (source_event_id, policy_version).
   */
  recordKnowledgeDisposition(input: {
    sourceEventId: string;
    artifactId: string;
    disposition: KnowledgeDisposition;
    reasonCodes: readonly string[];
    statement: string;
    policyVersion: string;
    scores?: AdjudicationResult["scores"];
  }): { status: "written" | "replay"; disposition: StoredDispositionPublic } {
    const sourceEventId = input.sourceEventId.trim();
    const artifactId = input.artifactId.trim();
    const policyVersion = normalizePolicyVersion(input.policyVersion);
    const statement = input.statement.trim();
    if (sourceEventId.length === 0) {
      throw new Error("source event id is required");
    }
    if (artifactId.length === 0) {
      throw new Error("artifact id is required");
    }
    if (statement.length === 0) {
      throw new Error("statement is required");
    }
    if (!this.artifactExistsInZone(artifactId, this.trustZone.trust_zone_id)) {
      throw new Error(`evidence artifact not found in trust zone: ${artifactId}`);
    }
    const existing = this.getDisposition(sourceEventId, policyVersion);
    if (existing !== undefined) {
      return {
        status: "replay",
        disposition: {
          source_event_id: existing.source_event_id,
          artifact_id: existing.artifact_id,
          disposition: existing.disposition,
          reason_codes: existing.reason_codes,
          scores: existing.scores,
          policy_version: existing.policy_version,
          statement: existing.statement,
          created_at: existing.created_at,
        },
      };
    }
    const scores = input.scores ?? { value: 0, durability: 0, risk: 0, noise: 0 };
    const createdAt = this.clock.now().toISOString();
    this.insertDisposition({
      sourceEventId,
      artifactId,
      trustZoneId: this.trustZone.trust_zone_id,
      disposition: input.disposition,
      reasonCodes: input.reasonCodes,
      scores,
      policyVersion,
      statement,
      createdAt,
    });
    return {
      status: "written",
      disposition: {
        source_event_id: sourceEventId,
        artifact_id: artifactId,
        disposition: input.disposition,
        reason_codes: [...input.reasonCodes],
        scores,
        policy_version: policyVersion,
        statement,
        created_at: createdAt,
      },
    };
  }

  listDispositionHistory(sourceEventId: string): StoredDispositionPublic[] {
    const normalized = sourceEventId.trim();
    if (normalized.length === 0) {
      throw new Error("source event id is required");
    }
    const rows = this.db
      .prepare(
        `
          SELECT source_event_id, artifact_id, disposition, reason_codes_json, scores_json,
                 policy_version, statement, created_at
          FROM knowledge_dispositions
          WHERE source_event_id = ? AND trust_zone_id = ?
          ORDER BY created_at ASC, policy_version ASC
        `,
      )
      .all(normalized, this.trustZone.trust_zone_id) as Array<{
      source_event_id: string;
      artifact_id: string;
      disposition: KnowledgeDisposition;
      reason_codes_json: string;
      scores_json: string;
      policy_version: string;
      statement: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      source_event_id: row.source_event_id,
      artifact_id: row.artifact_id,
      disposition: row.disposition,
      reason_codes: JSON.parse(row.reason_codes_json) as string[],
      scores: JSON.parse(row.scores_json) as AdjudicationResult["scores"],
      policy_version: row.policy_version,
      statement: row.statement,
      created_at: row.created_at,
    }));
  }

  listDispositionCounts(): {
    promote: number;
    hold: number;
    reject: number;
    policy_version: string;
  } {
    const rows = this.db
      .prepare(
        `
          SELECT disposition, COUNT(*) AS n
          FROM knowledge_dispositions
          WHERE trust_zone_id = ? AND policy_version = ?
          GROUP BY disposition
        `,
      )
      .all(this.trustZone.trust_zone_id, ADJUDICATION_POLICY_VERSION) as Array<{
      disposition: string;
      n: number;
    }>;
    const counts = { promote: 0, hold: 0, reject: 0 };
    for (const row of rows) {
      if (
        row.disposition === "promote" ||
        row.disposition === "hold" ||
        row.disposition === "reject"
      ) {
        counts[row.disposition] = Number(row.n);
      }
    }
    return { ...counts, policy_version: ADJUDICATION_POLICY_VERSION };
  }

  listHeldDispositions(policyVersion: string, limit = 50): HeldDispositionListResult {
    const normalizedPolicyVersion = normalizePolicyVersion(policyVersion);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new Error("held disposition limit must be an integer between 1 and 200");
    }
    const rows = this.db
      .prepare(
        `
          SELECT d.source_event_id, d.artifact_id, d.reason_codes_json,
                 d.policy_version, d.created_at
          FROM knowledge_dispositions d
          LEFT JOIN knowledge_disposition_reviews r
            ON r.source_event_id = d.source_event_id
           AND r.trust_zone_id = d.trust_zone_id
           AND r.policy_version = d.policy_version
          WHERE d.trust_zone_id = ?
            AND d.policy_version = ?
            AND d.disposition = 'hold'
            AND r.review_id IS NULL
          ORDER BY d.created_at ASC, d.source_event_id ASC
          LIMIT ?
        `,
      )
      .all(this.trustZone.trust_zone_id, normalizedPolicyVersion, limit) as Array<{
      source_event_id: string;
      artifact_id: string;
      reason_codes_json: string;
      policy_version: string;
      created_at: string;
    }>;
    const held = rows.map((row) => ({
      source_event_id: row.source_event_id,
      artifact_id: row.artifact_id,
      reason_codes: JSON.parse(row.reason_codes_json) as string[],
      policy_version: row.policy_version,
      created_at: row.created_at,
    }));
    return {
      policy_version: normalizedPolicyVersion,
      count: held.length,
      held,
    };
  }

  reviewHeldDisposition(
    sourceEventId: string,
    decision: HeldReviewDecision,
    policyVersion: string,
  ): HeldReviewResult {
    const normalizedEventId = sourceEventId.trim();
    let normalizedPolicyVersion: string;
    try {
      normalizedPolicyVersion = normalizePolicyVersion(policyVersion);
    } catch (error) {
      return {
        status: "failed",
        source_event_id: normalizedEventId,
        count: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (normalizedEventId.length === 0) {
      return {
        status: "failed",
        source_event_id: sourceEventId,
        policy_version: normalizedPolicyVersion,
        count: 0,
        error: "source event id is required",
      };
    }
    if (decision !== "promote" && decision !== "reject") {
      return {
        status: "failed",
        source_event_id: normalizedEventId,
        policy_version: normalizedPolicyVersion,
        count: 0,
        error: `invalid held review decision: ${String(decision)}`,
      };
    }
    const disposition = this.getDisposition(normalizedEventId, normalizedPolicyVersion);
    if (disposition === undefined) {
      return {
        status: "failed",
        source_event_id: normalizedEventId,
        policy_version: normalizedPolicyVersion,
        count: 0,
        error: `held disposition not found for policy version: ${normalizedPolicyVersion}`,
      };
    }
    if (disposition.disposition !== "hold") {
      return {
        status: "failed",
        source_event_id: normalizedEventId,
        policy_version: normalizedPolicyVersion,
        count: 0,
        error: `disposition is ${disposition.disposition}, expected hold`,
      };
    }

    let review = this.getHeldReview(normalizedEventId, normalizedPolicyVersion);
    let status: "reviewed" | "replay" = "replay";
    if (review === undefined) {
      const reviewId = heldReviewId(
        normalizedEventId,
        this.trustZone.trust_zone_id,
        normalizedPolicyVersion,
        decision,
      );
      try {
        this.withImmediateTransaction(() => {
          this.db
            .prepare(
              `
                INSERT INTO knowledge_disposition_reviews (
                  review_id, source_event_id, trust_zone_id, policy_version,
                  review_decision, created_at
                ) VALUES (?, ?, ?, ?, ?, ?)
              `,
            )
            .run(
              reviewId,
              normalizedEventId,
              this.trustZone.trust_zone_id,
              normalizedPolicyVersion,
              decision,
              this.clock.now().toISOString(),
            );
        });
        review = this.getHeldReview(normalizedEventId, normalizedPolicyVersion);
        status = "reviewed";
      } catch (error) {
        review = this.getHeldReview(normalizedEventId, normalizedPolicyVersion);
        if (review === undefined) throw error;
      }
    }
    if (review === undefined) {
      return {
        status: "failed",
        source_event_id: normalizedEventId,
        policy_version: normalizedPolicyVersion,
        count: 0,
        error: "held review audit could not be recorded",
      };
    }
    if (review.decision !== decision) {
      return {
        status: "failed",
        source_event_id: normalizedEventId,
        policy_version: normalizedPolicyVersion,
        count: 0,
        error: `held disposition already reviewed as ${review.decision}`,
      };
    }
    if (decision === "reject") {
      return {
        status,
        review_id: review.review_id,
        source_event_id: normalizedEventId,
        decision,
        policy_version: normalizedPolicyVersion,
        count: 1,
      };
    }

    try {
      const extraction = this.materializeHeldPromotion(disposition);
      if (extraction.status !== "extracted" && extraction.status !== "replay") {
        throw new Error(`held promotion materialization failed: ${extraction.status}`);
      }
      if (extraction.event.lifecycle_status !== "active") {
        throw new Error(
          `held promotion materialized unexpected lifecycle: ${extraction.event.lifecycle_status}`,
        );
      }
      return {
        status,
        review_id: review.review_id,
        source_event_id: normalizedEventId,
        decision,
        policy_version: normalizedPolicyVersion,
        count: 1,
        observation: {
          event_id: extraction.event.event_id,
          observation_id: extraction.event.payload.observation_id,
          lifecycle_status: extraction.event.lifecycle_status,
        },
      };
    } catch (error) {
      return {
        status: "failed",
        source_event_id: normalizedEventId,
        policy_version: normalizedPolicyVersion,
        count: 0,
        error: `held review audit ${review.review_id} recorded; retry promote-held: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  /**
   * Explicit extract by evidence event id (CLI backfill).
   */
  extractFromEventId(
    eventId: string,
    options: { policyOverrides?: Partial<MeaningfulUnitPolicyConfig> } = {},
  ): ExtractionResult {
    const row = this.db
      .prepare(
        `
          SELECT event_json
          FROM canonical_events
          WHERE event_id = ? AND trust_zone_id = ?
        `,
      )
      .get(eventId, this.trustZone.trust_zone_id) as { event_json: string } | undefined;
    if (row === undefined) {
      return {
        status: "failed",
        error: `event not found in trust zone: ${eventId}`,
        source_event_id: eventId,
      };
    }
    const event = JSON.parse(row.event_json) as CanonicalEvent;
    if (event.event_type !== "EvidenceArtifact") {
      return {
        status: "skipped",
        reason: `event type is ${event.event_type}, expected EvidenceArtifact`,
        source_event_id: eventId,
      };
    }
    return this.extractFromEvidenceArtifact({
      event: event as CanonicalEvent<"EvidenceArtifact">,
      ...(options.policyOverrides === undefined
        ? {}
        : { policyOverrides: options.policyOverrides }),
    });
  }

  private getCaptureRequestMeta(
    eventId: string,
  ): { provider: string; hook_event_name: string } | undefined {
    const row = this.db
      .prepare(
        `
          SELECT provider, hook_event_name
          FROM capture_requests
          WHERE event_id = ?
        `,
      )
      .get(eventId) as { provider: string; hook_event_name: string } | undefined;
    return row;
  }

  /**
   * Recover rule-scoring and statement-safe signals in one bounded decrypt pass.
   * Transcript/text fields may score but never enter candidate statements directly.
   */
  private tryExtractSignals(
    evidence: CanonicalEvent<"EvidenceArtifact">,
    envelope?: CaptureEnvelope,
  ): { scoring?: string; candidate?: string } {
    const envelopeScoring = signalFromUnknownPayload(envelope?.payload);
    const envelopeCandidate = candidateTextFromUnknownPayload(envelope?.payload);
    // Host hooks (especially Claude) often only attach transcript_path. Prefer
    // explicit inline fields when present, then recover prose from the local
    // transcript tail so statements are not metadata-only shells.
    const envelopeTranscript = signalsFromTranscriptPath(
      envelopePayloadTranscriptPath(envelope?.payload),
    );
    if (
      envelopeScoring !== undefined ||
      envelopeCandidate !== undefined ||
      envelopeTranscript.scoring !== undefined ||
      envelopeTranscript.candidate !== undefined
    ) {
      return {
        ...(envelopeScoring === undefined && envelopeTranscript.scoring === undefined
          ? {}
          : { scoring: envelopeScoring ?? envelopeTranscript.scoring }),
        ...(envelopeCandidate === undefined && envelopeTranscript.candidate === undefined
          ? {}
          : { candidate: envelopeCandidate ?? envelopeTranscript.candidate }),
      };
    }
    const contentRef = evidence.payload?.content_ref;
    const pvId =
      contentRef !== undefined &&
      contentRef.ref_type === "protected_value" &&
      typeof contentRef.protected_value_id === "string"
        ? contentRef.protected_value_id
        : undefined;
    if (pvId === undefined) return {};

    try {
      const plaintext = this.decryptProtectedValue(pvId);
      const parsed = JSON.parse(Buffer.from(plaintext).toString("utf8")) as unknown;
      if (parsed === null || typeof parsed !== "object") return {};
      const record = parsed as Record<string, unknown>;
      const nested =
        record.payload !== null && typeof record.payload === "object"
          ? (record.payload as Record<string, unknown>)
          : undefined;
      const scoring = signalFromUnknownPayload(record.payload) ?? signalFromUnknownPayload(record);
      const candidate =
        candidateTextFromUnknownPayload(record.payload) ?? candidateTextFromUnknownPayload(record);
      const transcript = signalsFromTranscriptPath(
        nested?.transcript_path ??
          nested?.transcriptPath ??
          record.transcript_path ??
          record.transcriptPath,
      );
      return {
        ...(scoring === undefined && transcript.scoring === undefined
          ? {}
          : { scoring: scoring ?? transcript.scoring }),
        ...(candidate === undefined && transcript.candidate === undefined
          ? {}
          : { candidate: candidate ?? transcript.candidate }),
      };
    } catch {
      return {};
    }
  }

  private getDisposition(
    sourceEventId: string,
    policyVersion: string = ADJUDICATION_POLICY_VERSION,
  ): StoredDisposition | undefined {
    const row = this.db
      .prepare(
        `
          SELECT source_event_id, artifact_id, disposition, reason_codes_json, scores_json,
                 policy_version, statement, created_at
          FROM knowledge_dispositions
          WHERE source_event_id = ? AND trust_zone_id = ? AND policy_version = ?
        `,
      )
      .get(sourceEventId, this.trustZone.trust_zone_id, policyVersion) as
      | {
          source_event_id: string;
          artifact_id: string;
          disposition: KnowledgeDisposition;
          reason_codes_json: string;
          scores_json: string;
          policy_version: string;
          statement: string;
          created_at: string;
        }
      | undefined;
    if (row === undefined) {
      return undefined;
    }
    return {
      source_event_id: row.source_event_id,
      artifact_id: row.artifact_id,
      disposition: row.disposition,
      reason_codes: JSON.parse(row.reason_codes_json) as string[],
      scores: JSON.parse(row.scores_json) as AdjudicationResult["scores"],
      policy_version: row.policy_version,
      statement: row.statement,
      created_at: row.created_at,
    };
  }

  private getHeldReview(
    sourceEventId: string,
    policyVersion: string,
  ): StoredHeldReview | undefined {
    return this.db
      .prepare(
        `
          SELECT review_id, source_event_id, review_decision AS decision,
                 policy_version, created_at
          FROM knowledge_disposition_reviews
          WHERE source_event_id = ? AND trust_zone_id = ? AND policy_version = ?
        `,
      )
      .get(sourceEventId, this.trustZone.trust_zone_id, policyVersion) as
      | StoredHeldReview
      | undefined;
  }

  private materializeHeldPromotion(disposition: StoredDisposition): ExtractionResult {
    const source = this.getEvent(disposition.source_event_id);
    if (source === undefined || source.event_type !== "EvidenceArtifact") {
      throw new Error(`held source evidence not found: ${disposition.source_event_id}`);
    }
    return this.proposeObservationDraft({
      statement: disposition.statement,
      evidenceArtifactRefs: [disposition.artifact_id],
      sourceEventId: disposition.source_event_id,
      subjectRef: source.subject_ref,
      validTime: source.valid_time,
      observedAt: source.valid_time.start,
      idempotencyKey: heldReviewObservationIdempotencyKey(
        disposition.source_event_id,
        this.trustZone.trust_zone_id,
        disposition.policy_version,
      ),
      lifecycleStatus: "active",
    });
  }

  private insertDisposition(input: {
    sourceEventId: string;
    artifactId: string;
    trustZoneId: string;
    disposition: KnowledgeDisposition;
    reasonCodes: readonly string[];
    scores: AdjudicationResult["scores"];
    policyVersion: string;
    statement: string;
    createdAt: string;
  }): void {
    this.db
      .prepare(
        `
          INSERT INTO knowledge_dispositions (
            source_event_id, artifact_id, trust_zone_id, disposition,
            reason_codes_json, scores_json, policy_version, statement, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.sourceEventId,
        input.artifactId,
        input.trustZoneId,
        input.disposition,
        JSON.stringify([...input.reasonCodes]),
        JSON.stringify(input.scores),
        input.policyVersion,
        input.statement,
        input.createdAt,
      );
  }

  private artifactExistsInZone(artifactId: string, trustZoneId: string): boolean {
    const rows = this.db
      .prepare(
        `
          SELECT event_json
          FROM canonical_events
          WHERE trust_zone_id = ? AND event_type = 'EvidenceArtifact'
        `,
      )
      .all(trustZoneId) as { event_json: string }[];
    for (const row of rows) {
      try {
        const event = JSON.parse(row.event_json) as CanonicalEvent<"EvidenceArtifact">;
        if (event.payload?.artifact_id === artifactId) {
          return true;
        }
      } catch {
        // ignore malformed
      }
    }
    return false;
  }

  outboxStatus(): OutboxStatus {
    const status: OutboxStatus = {
      pending: 0,
      leased: 0,
      delivered: 0,
    };
    const rows = this.db
      .prepare("SELECT state, count(*) AS count FROM outbox GROUP BY state ORDER BY state")
      .all() as OutboxStatusRow[];
    for (const row of rows) {
      status[row.state] = Number(row.count);
    }
    return status;
  }

  /**
   * Recent pending/leased outbox rows that have a last_error (operator diagnosis).
   * Caps to a small bound so status stays readable.
   */
  listOutboxErrors(limit = 10): OutboxErrorSummary[] {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("listOutboxErrors limit must be a positive integer");
    }
    const rows = this.db
      .prepare(
        `
          SELECT outbox_id, event_id, state, attempts, last_error, push_request_json
          FROM outbox
          WHERE state IN ('pending', 'leased')
            AND last_error IS NOT NULL
            AND length(last_error) > 0
          ORDER BY outbox_id
          LIMIT ?
        `,
      )
      .all(limit) as Array<{
      outbox_id: number | bigint;
      event_id: string;
      state: "pending" | "leased";
      attempts: number | bigint;
      last_error: string | null;
      push_request_json: string;
    }>;

    return rows.map((row) => {
      let trustZoneId: string | null = null;
      try {
        const parsed = JSON.parse(row.push_request_json) as { trust_zone_id?: unknown };
        if (typeof parsed.trust_zone_id === "string") {
          trustZoneId = parsed.trust_zone_id;
        }
      } catch {
        // ignore corrupt push_request_json
      }
      return {
        outbox_id: Number(row.outbox_id),
        event_id: row.event_id,
        state: row.state,
        attempts: Number(row.attempts),
        last_error: row.last_error,
        trust_zone_id: trustZoneId,
      };
    });
  }

  /**
   * Distinct trust_zone_id values on pending/leased outbox push requests.
   * Used by the CLI to warn when the active store zone does not match outbox work.
   */
  listOutboxTrustZones(
    states: readonly ("pending" | "leased")[] = ["pending", "leased"],
  ): string[] {
    if (states.length === 0) {
      return [];
    }
    const placeholders = states.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `
          SELECT push_request_json
          FROM outbox
          WHERE state IN (${placeholders})
          ORDER BY outbox_id
        `,
      )
      .all(...states) as Array<{ push_request_json: string }>;

    const zones = new Set<string>();
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.push_request_json) as { trust_zone_id?: unknown };
        if (typeof parsed.trust_zone_id === "string" && parsed.trust_zone_id.length > 0) {
          zones.add(parsed.trust_zone_id);
        }
      } catch {
        // Corrupt outbox rows are surfaced by push failure; status stays best-effort.
      }
    }
    return [...zones].sort((left, right) => left.localeCompare(right));
  }

  leaseOutbox(limit: number, leaseMs: number, now = this.clock.now()): LeaseResult {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("lease limit must be a positive integer");
    }
    if (!Number.isInteger(leaseMs) || leaseMs < 1) {
      throw new Error("leaseMs must be a positive integer");
    }

    const leaseId = `lease_${hashHex(randomUUID()).slice(0, 24)}`;
    const leasedUntil = new Date(now.getTime() + leaseMs).toISOString();
    const nowText = now.toISOString();

    return this.withImmediateTransaction(() => {
      const candidates = this.db
        .prepare(`
          SELECT outbox_id
          FROM outbox
          WHERE
            ((state = 'pending' AND available_at <= ?)
              OR (state = 'leased' AND lease_expires_at <= ?))
          ORDER BY outbox_id
          LIMIT ?
        `)
        .all(nowText, nowText, limit) as OutboxIdRow[];

      for (const candidate of candidates) {
        this.db
          .prepare(`
            UPDATE outbox
            SET state = 'leased',
                lease_id=?,
                lease_expires_at = ?,
                attempts = attempts + 1,
                updated_at = ?
            WHERE outbox_id = ?
          `)
          .run(leaseId, leasedUntil, nowText, candidate.outbox_id);
      }

      const rows = this.db
        .prepare(`
          SELECT
            o.outbox_id,
            o.event_id,
            e.protected_value_id,
            e.local_sequence,
            o.attempts,
            o.push_request_json
          FROM outbox o
          JOIN canonical_events e ON e.event_id = o.event_id
          WHERE o.lease_id=?
          ORDER BY o.outbox_id
        `)
        .all(leaseId) as LeasedOutboxRow[];

      return {
        lease_id: leaseId,
        leased_until: leasedUntil,
        items: rows.map((row) => ({
          outbox_id: Number(row.outbox_id),
          event_id: row.event_id,
          protected_value_id: row.protected_value_id,
          local_sequence: Number(row.local_sequence),
          attempts: Number(row.attempts),
          push_request: JSON.parse(row.push_request_json) as SyncPushRequest,
        })),
      };
    });
  }

  ackOutbox(outboxId: number, leaseId: string, now = this.clock.now()): boolean {
    const nowText = now.toISOString();
    const result = this.db
      .prepare(`
        UPDATE outbox
        SET state = 'delivered',
            delivered_at = ?,
            updated_at = ?,
            lease_id=NULL,
            lease_expires_at = NULL,
            last_error = NULL
        WHERE outbox_id = ? AND lease_id=? AND state = 'leased'
      `)
      .run(nowText, nowText, outboxId, leaseId);
    return result.changes === 1;
  }

  retryOutbox(
    outboxId: number,
    leaseId: string,
    delayMs: number,
    error: string,
    now = this.clock.now(),
  ): boolean {
    if (!Number.isInteger(delayMs) || delayMs < 0) {
      throw new Error("delayMs must be a non-negative integer");
    }

    const availableAt = new Date(now.getTime() + delayMs).toISOString();
    const result = this.db
      .prepare(`
        UPDATE outbox
        SET state = 'pending',
            available_at = ?,
            last_error = ?,
            updated_at = ?,
            lease_id=NULL,
            lease_expires_at = NULL
        WHERE outbox_id = ? AND lease_id=? AND state = 'leased'
      `)
      .run(availableAt, error.slice(0, 500), now.toISOString(), outboxId, leaseId);
    return result.changes === 1;
  }

  decryptProtectedValue(protectedValueId: string): Uint8Array {
    const row = this.db
      .prepare(`
        SELECT nonce, tag, ciphertext, plaintext_digest
        FROM protected_values
        WHERE protected_value_id = ?
      `)
      .get(protectedValueId) as ProtectedValueRow | undefined;
    if (row === undefined) {
      throw new Error(`protected value not found: ${protectedValueId}`);
    }

    const plaintext = decrypt(
      toBuffer(row.ciphertext),
      this.keyBytes,
      toBuffer(row.nonce),
      toBuffer(row.tag),
    );
    const digest = hashHex(plaintext);
    if (digest !== row.plaintext_digest) {
      throw new Error(`protected value digest mismatch: ${protectedValueId}`);
    }
    return plaintext;
  }

  exportProtectedValueForSync(input: {
    protectedValueId: string;
    trustZoneSyncKey: Uint8Array;
    wrapKeyRef?: string;
  }): ProtectedValueTransferExport {
    const syncKey = assertAes256Key(input.trustZoneSyncKey, "trust-zone sync key");
    const row = this.db
      .prepare(`
        SELECT
          vault_ref,
          key_ref,
          nonce_ref,
          tag_ref,
          nonce,
          tag,
          ciphertext,
          plaintext_digest,
          size_bytes
        FROM protected_values
        WHERE protected_value_id = ?
      `)
      .get(input.protectedValueId) as ProtectedValueRow | undefined;
    if (row === undefined) {
      throw new Error(`protected value not found: ${input.protectedValueId}`);
    }

    const ciphertext = toBuffer(row.ciphertext);
    const ciphertextDigest = hashHex(ciphertext);
    const keyRef = row.key_ref;
    const wrappedDeviceKey = wrapDeviceKey({
      deviceKey: this.keyBytes,
      trustZoneSyncKey: syncKey,
      trustZoneId: this.trustZone.trust_zone_id,
      protectedValueId: input.protectedValueId,
      keyRef,
      wrapKeyRef: input.wrapKeyRef ?? `sync_key_${hashHex(syncKey).slice(0, 16)}`,
    });
    const objectKey = protectedValueObjectKey(
      this.trustZone.trust_zone_id,
      input.protectedValueId,
      ciphertextDigest,
    );
    const intent: ProtectedValueUploadIntent = {
      schema_version: "v1",
      intent_type: "protected_value_upload",
      protected_value_id: input.protectedValueId,
      trust_zone_id: this.trustZone.trust_zone_id,
      vault_ref: row.vault_ref,
      key_ref: keyRef,
      object_key: objectKey,
      encryption_algorithm: "aes-256-gcm",
      encoding: "base64url",
      ciphertext_nonce: base64urlEncode(row.nonce),
      ciphertext_auth_tag: base64urlEncode(row.tag),
      original_ciphertext_digest: {
        algorithm: "sha-256",
        value: ciphertextDigest,
      },
      original_ciphertext_size_bytes: ciphertext.byteLength,
      nonce_ref: row.nonce_ref,
      tag_ref: row.tag_ref,
      wrapped_device_key: wrappedDeviceKey,
    };
    assertValidSyncApi(intent, "protected value upload intent");

    return {
      protected_value_id: input.protectedValueId,
      ciphertext: new Uint8Array(ciphertext),
      intent,
    };
  }

  importPulledProtectedValue(input: ProtectedValueImportInput): ProtectedValueImportResult {
    const syncKey = assertAes256Key(input.trustZoneSyncKey, "trust-zone sync key");
    assertCanonicalEventConformance(input.event);
    assertValidSyncApi(input.metadata, "protected value metadata");
    this.assertLocalTrustZone(input.event.trust_zone.trust_zone_id, input.event.event_id);
    if (input.metadata.trust_zone_id !== input.event.trust_zone.trust_zone_id) {
      throw new Error("protected value metadata trust zone does not match event");
    }
    const protectedRef = getEventProtectedValueRef(input.event);
    if (protectedRef === undefined) {
      throw new Error(`event ${input.event.event_id} does not reference a protected value`);
    }
    if (protectedRef.protected_value_id !== input.metadata.protected_value_id) {
      throw new Error("protected value metadata id does not match event");
    }
    if (
      protectedRef.encrypted_blob.digest.algorithm !==
        input.metadata.original_ciphertext_digest.algorithm ||
      protectedRef.encrypted_blob.digest.value !== input.metadata.original_ciphertext_digest.value
    ) {
      throw new Error("protected value metadata digest does not match event");
    }
    if (protectedRef.encrypted_blob.size_bytes !== input.metadata.original_ciphertext_size_bytes) {
      throw new Error("protected value metadata size does not match event");
    }

    const ciphertext = toBuffer(input.ciphertext);
    const ciphertextDigest = hashHex(ciphertext);
    if (ciphertextDigest !== input.metadata.original_ciphertext_digest.value) {
      throw new Error("protected value ciphertext digest mismatch");
    }
    if (ciphertext.byteLength !== input.metadata.original_ciphertext_size_bytes) {
      throw new Error("protected value ciphertext size mismatch");
    }

    const sourceDeviceKey = unwrapDeviceKey({
      envelope: input.metadata.wrapped_device_key,
      trustZoneSyncKey: syncKey,
      trustZoneId: input.metadata.trust_zone_id,
      protectedValueId: input.metadata.protected_value_id,
      keyRef: input.metadata.key_ref,
    });
    const plaintext = decrypt(
      ciphertext,
      sourceDeviceKey,
      base64urlDecode(input.metadata.ciphertext_nonce),
      base64urlDecode(input.metadata.ciphertext_auth_tag),
    );
    const encrypted = encrypt(plaintext, this.keyBytes);
    const plaintextDigest = hashHex(plaintext);
    const importedAt = this.clock.now().toISOString();
    const eventJson = stableJson(input.event);
    const metadataJson = stableJson(input.metadata);

    return this.withImmediateTransaction(() => {
      const existingEvent = this.getEvent(input.event.event_id);
      if (existingEvent !== undefined) {
        assertPullReplayCompatible(existingEvent, input.event, "event", input.event.event_id);
        this.recordProtectedValueImport({
          eventId: input.event.event_id,
          protectedValueId: input.metadata.protected_value_id,
          trustZoneId: input.metadata.trust_zone_id,
          zoneSequence: input.event.zone_sequence,
          sourceCiphertextDigest: ciphertextDigest,
          sourceCiphertextSizeBytes: ciphertext.byteLength,
          sourceMetadataJson: metadataJson,
          importedAt,
        });
        return {
          status: "replay",
          event_id: input.event.event_id,
          protected_value_id: input.metadata.protected_value_id,
        };
      }

      this.db
        .prepare(`
          INSERT INTO protected_values (
            protected_value_id, vault_ref, key_ref, nonce_ref, tag_ref,
            nonce, tag, ciphertext, plaintext_digest, size_bytes, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(protected_value_id) DO NOTHING
        `)
        .run(
          input.metadata.protected_value_id,
          protectedRef.vault_ref,
          protectedRef.key_ref,
          protectedRef.encrypted_blob.nonce_ref,
          protectedRef.encrypted_blob.tag_ref,
          encrypted.nonce,
          encrypted.tag,
          encrypted.ciphertext,
          plaintextDigest,
          plaintext.byteLength,
          importedAt,
        );

      this.db
        .prepare(`
          INSERT INTO canonical_events (
            event_id, event_type, trust_zone_id, idempotency_key, request_fingerprint,
            protected_value_id, event_json, recorded_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          input.event.event_id,
          input.event.event_type,
          input.event.trust_zone.trust_zone_id,
          input.event.idempotency_key,
          input.event.request_fingerprint,
          input.metadata.protected_value_id,
          eventJson,
          input.event.recorded_time.start,
        );

      this.db
        .prepare(`
          INSERT INTO sync_inbox_events (
            event_id, trust_zone_id, zone_sequence, protected_value_id, event_json, imported_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(event_id) DO NOTHING
        `)
        .run(
          input.event.event_id,
          input.event.trust_zone.trust_zone_id,
          input.event.zone_sequence ?? 0,
          input.metadata.protected_value_id,
          eventJson,
          importedAt,
        );
      this.recordProtectedValueImport({
        eventId: input.event.event_id,
        protectedValueId: input.metadata.protected_value_id,
        trustZoneId: input.metadata.trust_zone_id,
        zoneSequence: input.event.zone_sequence,
        sourceCiphertextDigest: ciphertextDigest,
        sourceCiphertextSizeBytes: ciphertext.byteLength,
        sourceMetadataJson: metadataJson,
        importedAt,
      });

      return {
        status: "imported",
        event_id: input.event.event_id,
        protected_value_id: input.metadata.protected_value_id,
      };
    });
  }

  importPulledEvent(event: CanonicalEvent, now = this.clock.now()): GeneralEventImportResult {
    assertCanonicalEventConformance(event);
    this.assertLocalTrustZone(event.trust_zone.trust_zone_id, event.event_id);
    const eventJson = stableJson(event);
    const importedAt = now.toISOString();

    return this.withImmediateTransaction(() => {
      const existing = this.getEvent(event.event_id);
      if (existing !== undefined) {
        assertPullReplayCompatible(existing, event, "event", event.event_id);
        return { status: "replay", event_id: event.event_id };
      }

      this.db
        .prepare(`
          INSERT INTO sync_inbox_events (
            event_id, trust_zone_id, zone_sequence, protected_value_id, event_json, imported_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(
          event.event_id,
          event.trust_zone.trust_zone_id,
          event.zone_sequence ?? 0,
          "",
          eventJson,
          importedAt,
        );
      return { status: "imported", event_id: event.event_id };
    });
  }

  getSyncCursor(trustZoneId = this.trustZone.trust_zone_id): SyncCursor {
    const row = this.db
      .prepare(`
        SELECT trust_zone_id, after_sequence, cursor
        FROM sync_cursors
        WHERE trust_zone_id = ?
      `)
      .get(trustZoneId) as SyncCursor | undefined;
    return row === undefined
      ? { trust_zone_id: trustZoneId, after_sequence: 0, cursor: null }
      : {
          trust_zone_id: row.trust_zone_id,
          after_sequence: Number(row.after_sequence),
          cursor: row.cursor,
        };
  }

  persistSyncCursor(input: {
    trustZoneId?: string;
    afterSequence: number;
    cursor?: string;
    now?: Date;
  }): void {
    if (!Number.isInteger(input.afterSequence) || input.afterSequence < 0) {
      throw new Error("afterSequence must be a non-negative integer");
    }
    const trustZoneId = input.trustZoneId ?? this.trustZone.trust_zone_id;
    const updatedAt = (input.now ?? this.clock.now()).toISOString();
    this.db
      .prepare(`
        INSERT INTO sync_cursors (trust_zone_id, after_sequence, cursor, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(trust_zone_id) DO UPDATE SET
          after_sequence=excluded.after_sequence,
          cursor=excluded.cursor,
          updated_at=excluded.updated_at
      `)
      .run(trustZoneId, input.afterSequence, input.cursor ?? null, updatedAt);
  }

  importPulledErasure(erasure: ErasureLedgerRecord, now = this.clock.now()): ImportedErasureResult {
    assertValidErasure(erasure);
    this.assertLocalTrustZone(erasure.trust_zone.trust_zone_id, erasure.erasure_id);
    const erasureJson = stableJson(erasure);
    return this.withImmediateTransaction(() => {
      const existing = this.db
        .prepare("SELECT erasure_json FROM sync_inbox_erasures WHERE erasure_id = ?")
        .get(erasure.erasure_id) as { erasure_json: string } | undefined;
      if (existing !== undefined) {
        assertSameJson(existing.erasure_json, erasureJson, "erasure", erasure.erasure_id);
        return { status: "replay", erasure_id: erasure.erasure_id };
      }

      this.db
        .prepare(`
          INSERT INTO sync_inbox_erasures (
            erasure_id, trust_zone_id, zone_sequence, erasure_json, imported_at
          )
          VALUES (?, ?, ?, ?, ?)
        `)
        .run(
          erasure.erasure_id,
          erasure.trust_zone.trust_zone_id,
          erasure.zone_sequence ?? 0,
          erasureJson,
          now.toISOString(),
        );
      return { status: "imported", erasure_id: erasure.erasure_id };
    });
  }

  countRows(
    table:
      | "capture_requests"
      | "canonical_events"
      | "protected_values"
      | "outbox"
      | "protected_value_imports"
      | "sync_inbox_events"
      | "sync_inbox_erasures"
      | "sync_cursors"
      | "knowledge_dispositions"
      | "knowledge_disposition_reviews",
  ): number {
    const row = this.db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as {
      count: number;
    };
    return Number(row.count);
  }

  getEvent(eventId: string): CanonicalEvent | undefined {
    const row = this.db
      .prepare("SELECT event_json FROM canonical_events WHERE event_id = ?")
      .get(eventId) as { event_json: string } | undefined;
    if (row !== undefined) {
      return JSON.parse(row.event_json) as CanonicalEvent;
    }
    const inboxRow = this.db
      .prepare("SELECT event_json FROM sync_inbox_events WHERE event_id = ?")
      .get(eventId) as { event_json: string } | undefined;
    return inboxRow === undefined ? undefined : (JSON.parse(inboxRow.event_json) as CanonicalEvent);
  }

  getAuthorizedCanonicalEvent(input: {
    eventId: string;
    visibleTrustZoneIds?: readonly string[];
  }): LocalCanonicalEventSnapshot | undefined {
    const visibleTrustZoneIds = input.visibleTrustZoneIds ?? [this.trustZone.trust_zone_id];
    assertVisibleTrustZones(visibleTrustZoneIds);
    const snapshot = this.listCanonicalEventSnapshots({ visibleTrustZoneIds }).find(
      (event) => event.event_id === input.eventId,
    );
    return snapshot;
  }

  listCanonicalEventSnapshots(
    input: {
      visibleTrustZoneIds?: readonly string[];
      eventTypes?: readonly CanonicalEvent["event_type"][];
      includeInbox?: boolean;
    } = {},
  ): LocalCanonicalEventSnapshot[] {
    const visibleTrustZoneIds = input.visibleTrustZoneIds ?? [this.trustZone.trust_zone_id];
    assertVisibleTrustZones(visibleTrustZoneIds);
    const visible = new Set(visibleTrustZoneIds);
    const eventTypes = input.eventTypes === undefined ? undefined : new Set(input.eventTypes);
    const rows = this.db
      .prepare(`
        SELECT
          'canonical' AS source,
          local_sequence,
          event_id,
          event_type,
          trust_zone_id,
          0 AS zone_sequence,
          protected_value_id,
          event_json,
          NULL AS imported_at
        FROM canonical_events
        UNION ALL
        SELECT
          'inbox' AS source,
          NULL AS local_sequence,
          event_id,
          json_extract(event_json, '$.event_type') AS event_type,
          trust_zone_id,
          zone_sequence,
          protected_value_id,
          event_json,
          imported_at
        FROM sync_inbox_events
      `)
      .all() as EventSnapshotRow[];

    return rows
      .filter((row) => visible.has(row.trust_zone_id))
      .filter((row) => input.includeInbox !== false || row.source === "canonical")
      .filter((row) => eventTypes === undefined || eventTypes.has(row.event_type))
      .map(snapshotEventRow)
      .sort(compareEventSnapshots);
  }

  listErasureSnapshots(
    input: { visibleTrustZoneIds?: readonly string[] } = {},
  ): LocalErasureSnapshot[] {
    const visibleTrustZoneIds = input.visibleTrustZoneIds ?? [this.trustZone.trust_zone_id];
    assertVisibleTrustZones(visibleTrustZoneIds);
    const visible = new Set(visibleTrustZoneIds);
    const rows = this.db
      .prepare(`
        SELECT erasure_id, trust_zone_id, zone_sequence, erasure_json, imported_at
        FROM sync_inbox_erasures
      `)
      .all() as ErasureSnapshotRow[];

    return rows
      .filter((row) => visible.has(row.trust_zone_id))
      .map((row) => ({
        source: "inbox" as const,
        erasure_id: row.erasure_id,
        trust_zone_id: row.trust_zone_id,
        zone_sequence: Number(row.zone_sequence),
        erasure: JSON.parse(row.erasure_json) as ErasureLedgerRecord,
        imported_at: row.imported_at,
      }))
      .sort(
        (left, right) =>
          [
            left.trust_zone_id.localeCompare(right.trust_zone_id),
            left.zone_sequence - right.zone_sequence,
            left.erasure_id.localeCompare(right.erasure_id),
          ].find((value) => value !== 0) ?? 0,
      );
  }

  getRetrievalInputSnapshot(
    input: { visibleTrustZoneIds?: readonly string[] } = {},
  ): LocalRetrievalInputSnapshot {
    const visibleTrustZoneIds = input.visibleTrustZoneIds ?? [this.trustZone.trust_zone_id];
    assertVisibleTrustZones(visibleTrustZoneIds);
    return {
      trust_zone_id: this.trustZone.trust_zone_id,
      visible_trust_zone_ids: [...visibleTrustZoneIds].sort(),
      events: this.listCanonicalEventSnapshots({ visibleTrustZoneIds }),
      erasures: this.listErasureSnapshots({ visibleTrustZoneIds }),
      sync_cursor: this.getSyncCursor(this.trustZone.trust_zone_id),
    };
  }

  getObsidianProjectionInputSnapshot(
    input: { visibleTrustZoneIds?: readonly string[] } = {},
  ): LocalRetrievalInputSnapshot {
    return this.getRetrievalInputSnapshot(input);
  }

  validateSupportReferences(input: {
    support: readonly ProvenanceRef[];
    visibleTrustZoneIds?: readonly string[];
  }): LocalSupportValidationResult {
    if (input.support.length === 0) {
      throw new Error("claim support is required");
    }
    const visibleTrustZoneIds = input.visibleTrustZoneIds ?? [this.trustZone.trust_zone_id];
    assertVisibleTrustZones(visibleTrustZoneIds);
    const visible = new Set(visibleTrustZoneIds);
    if (!visible.has(this.trustZone.trust_zone_id)) {
      throw new Error("local trust zone must be visible to propose a claim");
    }

    const events = this.listCanonicalEventSnapshots({ visibleTrustZoneIds });
    const byRef = new Map<string, LocalCanonicalEventSnapshot>();
    for (const event of events) {
      byRef.set(event.event_id, event);
      if (event.event.event_type === "EvidenceArtifact") {
        byRef.set((event.event as CanonicalEvent<"EvidenceArtifact">).payload.artifact_id, event);
      } else if (event.event.event_type === "Observation") {
        byRef.set((event.event as CanonicalEvent<"Observation">).payload.observation_id, event);
      } else if (event.event.event_type === "Claim") {
        byRef.set((event.event as CanonicalEvent<"Claim">).payload.claim_id, event);
      }
    }

    return {
      support: input.support.map((ref) => {
        const event = byRef.get(ref.ref_id);
        if (event === undefined) {
          throw new Error(`support reference not found or unauthorized: ${ref.ref_id}`);
        }
        if (event.trust_zone_id !== this.trustZone.trust_zone_id) {
          throw new Error(`support reference ${ref.ref_id} belongs to a different trust zone`);
        }
        if (!visible.has(event.trust_zone_id)) {
          throw new Error(`support reference not authorized: ${ref.ref_id}`);
        }
        return {
          ref,
          event_id: event.event_id,
          trust_zone_id: event.trust_zone_id,
          event_type: event.event_type,
        };
      }),
    };
  }

  withRetrievalDatabase<T>(callback: (db: LocalStoreSqlDatabase) => T): T {
    let active = true;
    const assertActive = () => {
      if (!active) {
        throw new Error("retrieval SQL session is no longer active");
      }
    };
    const session: LocalStoreSqlDatabase = {
      exec: (sql) => {
        assertActive();
        this.db.exec(sql);
      },
      prepare: (sql) => {
        assertActive();
        const statement = this.db.prepare(sql);
        return {
          run: (...params) => {
            assertActive();
            return statement.run(...params);
          },
          get: (...params) => {
            assertActive();
            return statement.get(...params);
          },
          all: (...params) => {
            assertActive();
            return statement.all(...params);
          },
        };
      },
    };

    try {
      const result = callback(session);
      if (isThenable(result)) {
        throw new Error("retrieval SQL callback must be synchronous");
      }
      return result;
    } finally {
      active = false;
    }
  }

  private assertLocalTrustZone(trustZoneId: string, refId: string): void {
    if (trustZoneId !== this.trustZone.trust_zone_id) {
      throw new Error(`remote record ${refId} belongs to a different trust zone`);
    }
  }

  private migrate(): void {
    this.withImmediateTransaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          migration_id TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
      `);

      const existing = this.db
        .prepare("SELECT migration_id FROM schema_migrations WHERE migration_id = ?")
        .get(MIGRATION_ID);
      if (existing === undefined) {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS projects (
          project_id TEXT PRIMARY KEY,
          basis_kind TEXT NOT NULL CHECK (basis_kind IN ('explicit', 'git_remote_hash', 'device_local_root_hash')),
          device_client_id TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS capture_requests (
          event_id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          hook_event_name TEXT NOT NULL,
          trust_zone_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          request_fingerprint TEXT NOT NULL,
          envelope_metadata_json TEXT NOT NULL,
          protected_value_id TEXT NOT NULL,
          captured_at TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          UNIQUE (trust_zone_id, idempotency_key)
        );

        CREATE TABLE IF NOT EXISTS protected_values (
          protected_value_id TEXT PRIMARY KEY,
          vault_ref TEXT NOT NULL,
          key_ref TEXT NOT NULL,
          nonce_ref TEXT NOT NULL,
          tag_ref TEXT NOT NULL,
          nonce BLOB NOT NULL,
          tag BLOB NOT NULL,
          ciphertext BLOB NOT NULL,
          plaintext_digest TEXT NOT NULL,
          size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS canonical_events (
          local_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id TEXT NOT NULL UNIQUE,
          event_type TEXT NOT NULL,
          trust_zone_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          request_fingerprint TEXT NOT NULL,
          protected_value_id TEXT NOT NULL REFERENCES protected_values(protected_value_id),
          event_json TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          UNIQUE (trust_zone_id, idempotency_key)
        );

        CREATE TABLE IF NOT EXISTS outbox (
          outbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id TEXT NOT NULL UNIQUE REFERENCES canonical_events(event_id),
          state TEXT NOT NULL CHECK (state IN ('pending', 'leased', 'delivered')),
          attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
          available_at TEXT NOT NULL,
          lease_id TEXT,
          lease_expires_at TEXT,
          last_error TEXT,
          delivered_at TEXT,
          push_request_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TRIGGER IF NOT EXISTS canonical_events_no_update
        BEFORE UPDATE ON canonical_events
        BEGIN
          SELECT RAISE(ABORT, 'canonical_events are append-only');
        END;

        CREATE TRIGGER IF NOT EXISTS canonical_events_no_delete
        BEFORE DELETE ON canonical_events
        BEGIN
          SELECT RAISE(ABORT, 'canonical_events are append-only');
        END;

        CREATE TRIGGER IF NOT EXISTS capture_requests_no_update
        BEFORE UPDATE ON capture_requests
        BEGIN
          SELECT RAISE(ABORT, 'capture_requests are append-only');
        END;

        CREATE TRIGGER IF NOT EXISTS capture_requests_no_delete
        BEFORE DELETE ON capture_requests
        BEGIN
          SELECT RAISE(ABORT, 'capture_requests are append-only');
        END;
        `);

        this.db
          .prepare("INSERT INTO schema_migrations (migration_id, applied_at) VALUES (?, ?)")
          .run(MIGRATION_ID, this.clock.now().toISOString());
      }

      const syncExisting = this.db
        .prepare("SELECT migration_id FROM schema_migrations WHERE migration_id = ?")
        .get(SYNC_MIGRATION_ID);
      if (syncExisting === undefined) {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS protected_value_imports (
            import_id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id TEXT NOT NULL,
            protected_value_id TEXT NOT NULL,
            trust_zone_id TEXT NOT NULL,
            zone_sequence INTEGER NOT NULL DEFAULT 0,
            source_ciphertext_digest TEXT NOT NULL,
            source_ciphertext_size_bytes INTEGER NOT NULL CHECK (source_ciphertext_size_bytes > 0),
            source_metadata_json TEXT NOT NULL,
            imported_at TEXT NOT NULL,
            UNIQUE(event_id, protected_value_id)
          );

          CREATE TABLE IF NOT EXISTS sync_inbox_events (
            event_id TEXT PRIMARY KEY,
            trust_zone_id TEXT NOT NULL,
            zone_sequence INTEGER NOT NULL DEFAULT 0,
            protected_value_id TEXT NOT NULL,
            event_json TEXT NOT NULL,
            imported_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS sync_inbox_erasures (
            erasure_id TEXT PRIMARY KEY,
            trust_zone_id TEXT NOT NULL,
            zone_sequence INTEGER NOT NULL DEFAULT 0,
            erasure_json TEXT NOT NULL,
            imported_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS sync_cursors (
            trust_zone_id TEXT PRIMARY KEY,
            after_sequence INTEGER NOT NULL CHECK (after_sequence >= 0),
            cursor TEXT,
            updated_at TEXT NOT NULL
          );
        `);
        this.db
          .prepare("INSERT INTO schema_migrations (migration_id, applied_at) VALUES (?, ?)")
          .run(SYNC_MIGRATION_ID, this.clock.now().toISOString());
      }

      const dispositionExisting = this.db
        .prepare("SELECT migration_id FROM schema_migrations WHERE migration_id = ?")
        .get(DISPOSITION_MIGRATION_ID);
      if (dispositionExisting === undefined) {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS knowledge_dispositions (
            source_event_id TEXT PRIMARY KEY,
            artifact_id TEXT NOT NULL,
            trust_zone_id TEXT NOT NULL,
            disposition TEXT NOT NULL CHECK (disposition IN ('promote', 'hold', 'reject')),
            reason_codes_json TEXT NOT NULL,
            scores_json TEXT NOT NULL,
            policy_version TEXT NOT NULL,
            statement TEXT NOT NULL,
            created_at TEXT NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_knowledge_dispositions_zone_disp
            ON knowledge_dispositions (trust_zone_id, disposition);
        `);
        this.db
          .prepare("INSERT INTO schema_migrations (migration_id, applied_at) VALUES (?, ?)")
          .run(DISPOSITION_MIGRATION_ID, this.clock.now().toISOString());
      }

      const dispositionReviewExisting = this.db
        .prepare("SELECT migration_id FROM schema_migrations WHERE migration_id = ?")
        .get(DISPOSITION_REVIEW_MIGRATION_ID);
      if (dispositionReviewExisting === undefined) {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS knowledge_disposition_reviews (
            review_id TEXT PRIMARY KEY,
            source_event_id TEXT NOT NULL REFERENCES canonical_events(event_id),
            trust_zone_id TEXT NOT NULL,
            policy_version TEXT NOT NULL,
            review_decision TEXT NOT NULL CHECK (review_decision IN ('promote', 'reject')),
            created_at TEXT NOT NULL,
            UNIQUE (source_event_id, trust_zone_id, policy_version)
          );

          CREATE INDEX IF NOT EXISTS idx_knowledge_disposition_reviews_zone_decision
            ON knowledge_disposition_reviews (
              trust_zone_id, policy_version, review_decision, created_at
            );

          CREATE TRIGGER IF NOT EXISTS knowledge_dispositions_no_update
          BEFORE UPDATE ON knowledge_dispositions
          BEGIN
            SELECT RAISE(ABORT, 'knowledge dispositions are append-only');
          END;

          CREATE TRIGGER IF NOT EXISTS knowledge_dispositions_no_delete
          BEFORE DELETE ON knowledge_dispositions
          BEGIN
            SELECT RAISE(ABORT, 'knowledge dispositions are append-only');
          END;

          CREATE TRIGGER IF NOT EXISTS knowledge_disposition_reviews_no_update
          BEFORE UPDATE ON knowledge_disposition_reviews
          BEGIN
            SELECT RAISE(ABORT, 'knowledge disposition reviews are append-only');
          END;

          CREATE TRIGGER IF NOT EXISTS knowledge_disposition_reviews_no_delete
          BEFORE DELETE ON knowledge_disposition_reviews
          BEGIN
            SELECT RAISE(ABORT, 'knowledge disposition reviews are append-only');
          END;
        `);
        this.db
          .prepare("INSERT INTO schema_migrations (migration_id, applied_at) VALUES (?, ?)")
          .run(DISPOSITION_REVIEW_MIGRATION_ID, this.clock.now().toISOString());
      }

      const dispositionPolicyKeyExisting = this.db
        .prepare("SELECT migration_id FROM schema_migrations WHERE migration_id = ?")
        .get(DISPOSITION_POLICY_KEY_MIGRATION_ID);
      if (dispositionPolicyKeyExisting === undefined) {
        this.db.exec(`
          CREATE TABLE knowledge_dispositions_policy_key (
            source_event_id TEXT NOT NULL,
            artifact_id TEXT NOT NULL,
            trust_zone_id TEXT NOT NULL,
            disposition TEXT NOT NULL CHECK (disposition IN ('promote', 'hold', 'reject')),
            reason_codes_json TEXT NOT NULL,
            scores_json TEXT NOT NULL,
            policy_version TEXT NOT NULL,
            statement TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (source_event_id, trust_zone_id, policy_version)
          );

          INSERT INTO knowledge_dispositions_policy_key (
            source_event_id, artifact_id, trust_zone_id, disposition,
            reason_codes_json, scores_json, policy_version, statement, created_at
          )
          SELECT
            source_event_id, artifact_id, trust_zone_id, disposition,
            reason_codes_json, scores_json, policy_version, statement, created_at
          FROM knowledge_dispositions;

          DROP TABLE knowledge_dispositions;
          ALTER TABLE knowledge_dispositions_policy_key RENAME TO knowledge_dispositions;

          CREATE INDEX IF NOT EXISTS idx_knowledge_dispositions_zone_disp
            ON knowledge_dispositions (trust_zone_id, disposition);
          CREATE INDEX IF NOT EXISTS idx_knowledge_dispositions_zone_policy
            ON knowledge_dispositions (trust_zone_id, policy_version, created_at);

          CREATE TRIGGER IF NOT EXISTS knowledge_dispositions_no_update
          BEFORE UPDATE ON knowledge_dispositions
          BEGIN
            SELECT RAISE(ABORT, 'knowledge dispositions are append-only');
          END;

          CREATE TRIGGER IF NOT EXISTS knowledge_dispositions_no_delete
          BEFORE DELETE ON knowledge_dispositions
          BEGIN
            SELECT RAISE(ABORT, 'knowledge dispositions are append-only');
          END;
        `);
        this.db
          .prepare("INSERT INTO schema_migrations (migration_id, applied_at) VALUES (?, ?)")
          .run(DISPOSITION_POLICY_KEY_MIGRATION_ID, this.clock.now().toISOString());
      }

      const worktreeIdentityExisting = this.db
        .prepare("SELECT migration_id FROM schema_migrations WHERE migration_id = ?")
        .get(WORKTREE_IDENTITY_MIGRATION_ID);
      if (worktreeIdentityExisting === undefined) {
        // Additive columns only; capture_requests stays append-only.
        // Absolute workspace paths are never stored here (ADR 0013 privacy shape).
        for (const column of [
          "project_id TEXT",
          "worktree_id TEXT",
          "worktree_name TEXT",
          "git_branch TEXT",
          "is_linked_worktree INTEGER",
        ]) {
          this.db.exec(`ALTER TABLE capture_requests ADD COLUMN ${column}`);
        }
        this.db.exec(`
          CREATE INDEX IF NOT EXISTS idx_capture_requests_project
            ON capture_requests (project_id, captured_at);
          CREATE INDEX IF NOT EXISTS idx_capture_requests_worktree
            ON capture_requests (worktree_id, captured_at);
        `);
        this.db
          .prepare("INSERT INTO schema_migrations (migration_id, applied_at) VALUES (?, ?)")
          .run(WORKTREE_IDENTITY_MIGRATION_ID, this.clock.now().toISOString());
      }

      const agenticFeedExisting = this.db
        .prepare("SELECT migration_id FROM schema_migrations WHERE migration_id = ?")
        .get(AGENTIC_CAPTURE_FEED_MIGRATION_ID);
      if (agenticFeedExisting === undefined) {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS agentic_capture_feed (
            source_event_id TEXT PRIMARY KEY,
            artifact_id TEXT NOT NULL,
            trust_zone_id TEXT NOT NULL,
            hook_event_name TEXT NOT NULL,
            protected_value_id TEXT NOT NULL,
            state TEXT NOT NULL CHECK (state IN ('pending', 'done', 'skipped')),
            created_at TEXT NOT NULL,
            finished_at TEXT,
            skip_reason TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_agentic_capture_feed_zone_state
            ON agentic_capture_feed (trust_zone_id, state, created_at);
        `);
        this.db
          .prepare("INSERT INTO schema_migrations (migration_id, applied_at) VALUES (?, ?)")
          .run(AGENTIC_CAPTURE_FEED_MIGRATION_ID, this.clock.now().toISOString());
      }

      const feedLeaseExisting = this.db
        .prepare("SELECT migration_id FROM schema_migrations WHERE migration_id = ?")
        .get(AGENTIC_CAPTURE_FEED_LEASE_MIGRATION_ID);
      if (feedLeaseExisting === undefined) {
        // SQLite CHECK changes require rebuild for leased state + lease columns.
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS agentic_capture_feed_lease_mig (
            source_event_id TEXT PRIMARY KEY,
            artifact_id TEXT NOT NULL,
            trust_zone_id TEXT NOT NULL,
            hook_event_name TEXT NOT NULL,
            protected_value_id TEXT NOT NULL,
            state TEXT NOT NULL CHECK (state IN ('pending', 'leased', 'done', 'skipped')),
            created_at TEXT NOT NULL,
            finished_at TEXT,
            skip_reason TEXT,
            lease_id TEXT,
            lease_expires_at TEXT
          );
          INSERT OR IGNORE INTO agentic_capture_feed_lease_mig (
            source_event_id, artifact_id, trust_zone_id, hook_event_name,
            protected_value_id, state, created_at, finished_at, skip_reason,
            lease_id, lease_expires_at
          )
          SELECT source_event_id, artifact_id, trust_zone_id, hook_event_name,
                 protected_value_id, state, created_at, finished_at, skip_reason,
                 NULL, NULL
          FROM agentic_capture_feed;
          DROP TABLE agentic_capture_feed;
          ALTER TABLE agentic_capture_feed_lease_mig RENAME TO agentic_capture_feed;
          CREATE INDEX IF NOT EXISTS idx_agentic_capture_feed_zone_state
            ON agentic_capture_feed (trust_zone_id, state, created_at);
        `);
        this.db
          .prepare("INSERT INTO schema_migrations (migration_id, applied_at) VALUES (?, ?)")
          .run(AGENTIC_CAPTURE_FEED_LEASE_MIGRATION_ID, this.clock.now().toISOString());
      }
    });
  }

  /**
   * List agentic capture-feed rows for the active trust zone.
   * No LLM. Used by Product 6 runner only.
   */
  listAgenticCaptureFeed(
    input: { limit?: number; state?: AgenticCaptureFeedRow["state"] } = {},
  ): AgenticCaptureFeedRow[] {
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("listAgenticCaptureFeed limit must be a positive integer");
    }
    const state = input.state ?? "pending";
    const rows = this.db
      .prepare(
        `
          SELECT source_event_id, artifact_id, trust_zone_id, hook_event_name,
                 protected_value_id, state, created_at, finished_at, skip_reason,
                 lease_id, lease_expires_at
          FROM agentic_capture_feed
          WHERE trust_zone_id = ? AND state = ?
          ORDER BY created_at ASC, source_event_id ASC
          LIMIT ?
        `,
      )
      .all(this.trustZone.trust_zone_id, state, limit) as Array<{
      source_event_id: string;
      artifact_id: string;
      trust_zone_id: string;
      hook_event_name: string;
      protected_value_id: string;
      state: AgenticCaptureFeedRow["state"];
      created_at: string;
      finished_at: string | null;
      skip_reason: string | null;
      lease_id: string | null;
      lease_expires_at: string | null;
    }>;
    return rows.map((r) => this.mapAgenticCaptureFeedRow(r));
  }

  /**
   * Atomically claim pending (or expired leased) feed rows for exclusive processing.
   * ADR 0018 D5 mutual exclusion for always-on / concurrent runners.
   */
  claimAgenticCaptureFeed(
    input: {
      limit?: number;
      leaseMs?: number;
      now?: Date;
      /**
       * Prefer lifecycle hooks (SessionEnd → Stop → PreCompact) before other
       * residual rows. Default true for product dogfood / Flash path.
       */
      prefer_lifecycle?: boolean;
    } = {},
  ): AgenticCaptureFeedRow[] {
    const limit = input.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("claimAgenticCaptureFeed limit must be a positive integer");
    }
    const leaseMs = input.leaseMs ?? 120_000;
    if (!Number.isInteger(leaseMs) || leaseMs < 1) {
      throw new Error("claimAgenticCaptureFeed leaseMs must be a positive integer");
    }
    const now = input.now ?? this.clock.now();
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
    const leaseId = `lease_${hashHex(`${nowIso}:${Math.random()}`).slice(0, 24)}`;
    const preferLifecycle = input.prefer_lifecycle !== false;
    const orderBy = preferLifecycle
      ? `${agenticFeedHookPreferRankSql("hook_event_name")}, created_at ASC, source_event_id ASC`
      : `created_at ASC, source_event_id ASC`;

    return this.withImmediateTransaction(() => {
      const candidates = this.db
        .prepare(
          `
            SELECT source_event_id
            FROM agentic_capture_feed
            WHERE trust_zone_id = ?
              AND (
                state = 'pending'
                OR (state = 'leased' AND (lease_expires_at IS NULL OR lease_expires_at <= ?))
              )
            ORDER BY ${orderBy}
            LIMIT ?
          `,
        )
        .all(this.trustZone.trust_zone_id, nowIso, limit) as Array<{ source_event_id: string }>;

      const claimed: AgenticCaptureFeedRow[] = [];
      const update = this.db.prepare(
        `
          UPDATE agentic_capture_feed
          SET state = 'leased', lease_id = ?, lease_expires_at = ?, finished_at = NULL, skip_reason = NULL
          WHERE source_event_id = ? AND trust_zone_id = ?
            AND (
              state = 'pending'
              OR (state = 'leased' AND (lease_expires_at IS NULL OR lease_expires_at <= ?))
            )
        `,
      );
      const select = this.db.prepare(
        `
          SELECT source_event_id, artifact_id, trust_zone_id, hook_event_name,
                 protected_value_id, state, created_at, finished_at, skip_reason,
                 lease_id, lease_expires_at
          FROM agentic_capture_feed
          WHERE source_event_id = ? AND trust_zone_id = ?
        `,
      );
      for (const c of candidates) {
        const result = update.run(
          leaseId,
          leaseExpiresAt,
          c.source_event_id,
          this.trustZone.trust_zone_id,
          nowIso,
        ) as { changes?: number };
        if (Number(result.changes ?? 0) === 0) continue;
        const row = select.get(c.source_event_id, this.trustZone.trust_zone_id) as
          | {
              source_event_id: string;
              artifact_id: string;
              trust_zone_id: string;
              hook_event_name: string;
              protected_value_id: string;
              state: AgenticCaptureFeedRow["state"];
              created_at: string;
              finished_at: string | null;
              skip_reason: string | null;
              lease_id: string | null;
              lease_expires_at: string | null;
            }
          | undefined;
        if (row !== undefined) claimed.push(this.mapAgenticCaptureFeedRow(row));
      }
      return claimed;
    });
  }

  /**
   * Bulk-skip residual feed rows that are not lifecycle-eligible (PostToolUse flood, etc.).
   * Clears legacy queues so flush can spend Flash on SessionEnd. No LLM.
   */
  skipIneligibleAgenticFeed(input: { limit?: number; now?: Date } = {}): {
    scanned: number;
    skipped: number;
  } {
    const limit = input.limit ?? 5_000;
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("skipIneligibleAgenticFeed limit must be a positive integer");
    }
    const nowIso = (input.now ?? this.clock.now()).toISOString();
    const pending = this.db
      .prepare(
        `
          SELECT source_event_id, hook_event_name
          FROM agentic_capture_feed
          WHERE trust_zone_id = ? AND state IN ('pending', 'leased')
          ORDER BY created_at ASC
          LIMIT ?
        `,
      )
      .all(this.trustZone.trust_zone_id, limit) as Array<{
      source_event_id: string;
      hook_event_name: string;
    }>;
    let skipped = 0;
    const finish = this.db.prepare(
      `
        UPDATE agentic_capture_feed
        SET state = 'skipped', finished_at = ?, skip_reason = ?, lease_id = NULL, lease_expires_at = NULL
        WHERE source_event_id = ? AND trust_zone_id = ? AND state IN ('pending', 'leased')
      `,
    );
    for (const row of pending) {
      if (isAgenticFeedHookEligible(row.hook_event_name)) continue;
      const result = finish.run(
        nowIso,
        "hook_not_lifecycle_eligible",
        row.source_event_id,
        this.trustZone.trust_zone_id,
      ) as { changes?: number };
      if (Number(result.changes ?? 0) > 0) skipped += 1;
    }
    return { scanned: pending.length, skipped };
  }

  /** Mark feed row terminal (done or skipped). Accepts pending or leased. Idempotent. */
  finishAgenticCaptureFeed(input: {
    source_event_id: string;
    state: "done" | "skipped";
    skip_reason?: string | null;
  }): boolean {
    const now = this.clock.now().toISOString();
    const result = this.db
      .prepare(
        `
          UPDATE agentic_capture_feed
          SET state = ?, finished_at = ?, skip_reason = ?, lease_id = NULL, lease_expires_at = NULL
          WHERE source_event_id = ? AND trust_zone_id = ?
            AND state IN ('pending', 'leased')
        `,
      )
      .run(
        input.state,
        now,
        input.skip_reason ?? null,
        input.source_event_id,
        this.trustZone.trust_zone_id,
      ) as { changes?: number };
    return Number(result.changes ?? 0) > 0;
  }

  /**
   * Q7′ / QD9: release a leased feed row back to pending for retry (transient Flash fail).
   * Does not mark done/skipped — row remains claimable.
   */
  requeueAgenticCaptureFeed(input: {
    source_event_id: string;
    skip_reason?: string | null;
  }): boolean {
    const result = this.db
      .prepare(
        `
          UPDATE agentic_capture_feed
          SET state = 'pending', finished_at = NULL, skip_reason = ?,
              lease_id = NULL, lease_expires_at = NULL
          WHERE source_event_id = ? AND trust_zone_id = ?
            AND state = 'leased'
        `,
      )
      .run(
        input.skip_reason ?? "flash_transient_retry",
        input.source_event_id,
        this.trustZone.trust_zone_id,
      ) as { changes?: number };
    return Number(result.changes ?? 0) > 0;
  }

  private mapAgenticCaptureFeedRow(r: {
    source_event_id: string;
    artifact_id: string;
    trust_zone_id: string;
    hook_event_name: string;
    protected_value_id: string;
    state: AgenticCaptureFeedRow["state"];
    created_at: string;
    finished_at: string | null;
    skip_reason: string | null;
    lease_id?: string | null;
    lease_expires_at?: string | null;
  }): AgenticCaptureFeedRow {
    return {
      source_event_id: r.source_event_id,
      artifact_id: r.artifact_id,
      trust_zone_id: r.trust_zone_id,
      hook_event_name: r.hook_event_name,
      protected_value_id: r.protected_value_id,
      state: r.state,
      created_at: r.created_at,
      finished_at: r.finished_at,
      skip_reason: r.skip_reason,
      lease_id: r.lease_id ?? null,
      lease_expires_at: r.lease_expires_at ?? null,
    };
  }

  /**
   * Best-effort plaintext signal for agentic packing from a protected capture envelope.
   * Local-only decrypt; never network. Returns empty string on failure.
   */
  readCaptureSignalText(sourceEventId: string): string {
    try {
      const row = this.db
        .prepare(
          `
            SELECT protected_value_id FROM canonical_events
            WHERE event_id = ? AND trust_zone_id = ? AND event_type = 'EvidenceArtifact'
          `,
        )
        .get(sourceEventId, this.trustZone.trust_zone_id) as
        | { protected_value_id: string }
        | undefined;
      if (row === undefined) return "";
      const plain = this.decryptProtectedValue(row.protected_value_id);
      const text = Buffer.from(plain).toString("utf8");
      const env = JSON.parse(text) as { payload?: unknown; hook_event_name?: string };
      return extractSignalTextFromCapturePayload(env.payload);
    } catch {
      return "";
    }
  }

  private insertAgenticCaptureFeed(input: {
    source_event_id: string;
    artifact_id: string;
    trust_zone_id: string;
    hook_event_name: string;
    protected_value_id: string;
    created_at: string;
    /** Default pending. Front-end drop uses skipped + skip_reason (DF2). */
    state?: "pending" | "skipped";
    skip_reason?: string;
    finished_at?: string;
  }): void {
    // Defensive for concurrent first-open races: ensure table exists (lease-capable schema).
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agentic_capture_feed (
        source_event_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        trust_zone_id TEXT NOT NULL,
        hook_event_name TEXT NOT NULL,
        protected_value_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'leased', 'done', 'skipped')),
        created_at TEXT NOT NULL,
        finished_at TEXT,
        skip_reason TEXT,
        lease_id TEXT,
        lease_expires_at TEXT
      );
    `);
    const state = input.state ?? "pending";
    const finishedAt = state === "skipped" ? (input.finished_at ?? input.created_at) : null;
    const skipReason = state === "skipped" ? (input.skip_reason ?? "front_drop") : null;
    this.db
      .prepare(
        `
          INSERT OR IGNORE INTO agentic_capture_feed (
            source_event_id, artifact_id, trust_zone_id, hook_event_name,
            protected_value_id, state, created_at, finished_at, skip_reason,
            lease_id, lease_expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
        `,
      )
      .run(
        input.source_event_id,
        input.artifact_id,
        input.trust_zone_id,
        input.hook_event_name,
        input.protected_value_id,
        state,
        input.created_at,
        finishedAt,
        skipReason,
      );
  }

  private upsertProject(basisKind: string): void {
    this.db
      .prepare(`
        INSERT INTO projects (project_id, basis_kind, device_client_id)
        VALUES (?, ?, ?)
        ON CONFLICT(project_id) DO NOTHING
      `)
      .run(this.projectId, basisKind, this.clientId);
  }

  private findEventByIdempotency(
    trustZoneId: string,
    idempotencyKey: string,
  ): EventRow | undefined {
    return this.db
      .prepare(`
        SELECT local_sequence, event_json, protected_value_id
        FROM canonical_events
        WHERE trust_zone_id = ? AND idempotency_key = ?
      `)
      .get(trustZoneId, idempotencyKey) as EventRow | undefined;
  }

  private findOutboxIdForEvent(eventId: string): number {
    const row = this.db.prepare("SELECT outbox_id FROM outbox WHERE event_id = ?").get(eventId) as
      | OutboxIdRow
      | undefined;
    if (row === undefined) {
      throw new Error(`outbox row not found for event ${eventId}`);
    }
    return Number(row.outbox_id);
  }

  private recordProtectedValueImport(input: {
    eventId: string;
    protectedValueId: string;
    trustZoneId: string;
    zoneSequence: number | undefined;
    sourceCiphertextDigest: string;
    sourceCiphertextSizeBytes: number;
    sourceMetadataJson: string;
    importedAt: string;
  }): void {
    this.db
      .prepare(`
        INSERT INTO protected_value_imports (
          event_id,
          protected_value_id,
          trust_zone_id,
          zone_sequence,
          source_ciphertext_digest,
          source_ciphertext_size_bytes,
          source_metadata_json,
          imported_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_id, protected_value_id) DO NOTHING
      `)
      .run(
        input.eventId,
        input.protectedValueId,
        input.trustZoneId,
        input.zoneSequence ?? 0,
        input.sourceCiphertextDigest,
        input.sourceCiphertextSizeBytes,
        input.sourceMetadataJson,
        input.importedAt,
      );
  }

  private withImmediateTransaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

function normalizePolicyVersion(policyVersion: string): string {
  const normalized = policyVersion.trim();
  if (normalized.length === 0) {
    throw new Error("policy version is required");
  }
  if (normalized.length > 64 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalized)) {
    throw new Error("policy version must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}");
  }
  return normalized;
}

/**
 * adj_v1 and adj_v2 shipped with the historical extract key. Later policies
 * keep their own materialization identities so historical lineage cannot be
 * inferred from unrelated keys.
 */
function observationIdempotencyForPolicy(sourceEventId: string, policyVersion: string): string {
  if (policyVersion === "adj_v1" || policyVersion === "adj_v2") {
    return extractionObservationIdempotencyKey(sourceEventId);
  }
  return `idem_${hashHex(
    stableJson({
      kind: "adjudicated_observation",
      source_event_id: sourceEventId,
      policy_version: policyVersion,
    }),
  ).slice(0, 32)}`;
}

function heldReviewId(
  sourceEventId: string,
  trustZoneId: string,
  policyVersion: string,
  decision: HeldReviewDecision,
): string {
  return `kdr_${hashHex(
    stableJson({
      source_event_id: sourceEventId,
      trust_zone_id: trustZoneId,
      policy_version: policyVersion,
      decision,
    }),
  ).slice(0, 32)}`;
}

function heldReviewObservationIdempotencyKey(
  sourceEventId: string,
  trustZoneId: string,
  policyVersion: string,
): string {
  return `idem_${hashHex(
    stableJson({
      kind: "held_review_promote",
      source_event_id: sourceEventId,
      trust_zone_id: trustZoneId,
      policy_version: policyVersion,
    }),
  ).slice(0, 32)}`;
}

export function runtimeDirFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env.CARPEOS_HOME ?? join(env.HOME ?? process.cwd(), ".carpeos");
}

export function defaultTrustZoneId(clientId: string): string {
  const suffix = clientId.startsWith("client_")
    ? clientId.slice("client_".length)
    : hashHex(clientId).slice(0, 24);
  return `tz_local_${suffix.slice(0, 24)}`;
}

export function isTrustZoneId(value: string): boolean {
  return /^tz_[a-z0-9][a-z0-9_-]{2,63}$/.test(value);
}

export function assertPrivateKeyFileModes(runtimeDir: string): void {
  const runtimeMode = statSync(runtimeDir).mode & 0o777;
  if (runtimeMode !== 0o700) {
    throw new Error(`runtime dir must be 0700, got ${runtimeMode.toString(8)}`);
  }

  const keyMode = statSync(join(runtimeDir, "local-aes256.key")).mode & 0o777;
  if (keyMode !== 0o600) {
    throw new Error(`key file must be 0600, got ${keyMode.toString(8)}`);
  }
}

function maybeFail(
  options: CaptureRequestOptions,
  point: NonNullable<CaptureRequestOptions["failAfter"]>,
): void {
  if (options.failAfter === point) {
    throw new Error(`simulated transaction failure after ${point}`);
  }
}

function assertValidCanonicalEvent(event: CanonicalEvent): void {
  assertCanonicalEventConformance(event);
  if (event.zone_sequence !== undefined) {
    throw new Error("local capture must not assign canonical zone_sequence");
  }
}

function assertCanonicalEventConformance(event: CanonicalEvent): void {
  const conformance = validateConformance("canonicalEvent", event);
  if (!conformance.valid) {
    throw new Error(`invalid canonical event: ${conformance.errors.join("; ")}`);
  }
}

function assertValidSyncApi(value: unknown, label: string): void {
  const conformance = validateConformance("syncApi", value);
  if (!conformance.valid) {
    throw new Error(`invalid ${label}: ${conformance.errors.join("; ")}`);
  }
}

function assertValidErasure(erasure: ErasureLedgerRecord): void {
  const conformance = validateConformance("erasureLedger", erasure);
  if (!conformance.valid) {
    throw new Error(`invalid erasure ledger record: ${conformance.errors.join("; ")}`);
  }
}

function assertVisibleTrustZones(visibleTrustZoneIds: readonly string[]): void {
  if (visibleTrustZoneIds.length === 0) {
    throw new Error("visible trust zones are required");
  }
  for (const trustZoneId of visibleTrustZoneIds) {
    if (!isTrustZoneId(trustZoneId)) {
      throw new Error(`invalid visible trust zone id: ${trustZoneId}`);
    }
  }
}

function snapshotEventRow(row: EventSnapshotRow): LocalCanonicalEventSnapshot {
  return {
    source: row.source,
    local_sequence: row.local_sequence === null ? null : Number(row.local_sequence),
    event_id: row.event_id,
    event_type: row.event_type,
    trust_zone_id: row.trust_zone_id,
    zone_sequence: Number(row.zone_sequence ?? 0),
    protected_value_id: row.protected_value_id,
    event: JSON.parse(row.event_json) as CanonicalEvent,
    ...(row.imported_at === undefined ? {} : { imported_at: row.imported_at }),
  };
}

function compareEventSnapshots(
  left: LocalCanonicalEventSnapshot,
  right: LocalCanonicalEventSnapshot,
): number {
  return (
    left.trust_zone_id.localeCompare(right.trust_zone_id) ||
    left.zone_sequence - right.zone_sequence ||
    (left.local_sequence ?? Number.MAX_SAFE_INTEGER) -
      (right.local_sequence ?? Number.MAX_SAFE_INTEGER) ||
    left.event_id.localeCompare(right.event_id)
  );
}

function isBitemporalInterval(interval: CanonicalEvent["valid_time"]): boolean {
  const start = Date.parse(interval.start);
  const end = interval.end === null ? start : Date.parse(interval.end);
  return (
    !Number.isNaN(start) &&
    !Number.isNaN(end) &&
    timestampMatches(start, interval.start) &&
    (interval.end === null || timestampMatches(end, interval.end)) &&
    start <= end
  );
}

function timestampMatches(epochMs: number, value: string): boolean {
  const normalized = new Date(epochMs).toISOString();
  return normalized === value || normalized.replace(".000Z", "Z") === value;
}

function getEventProtectedValueRef(event: CanonicalEvent): ProtectedValueRef | undefined {
  return event.event_type === "EvidenceArtifact" &&
    event.payload.content_ref.ref_type === "protected_value"
    ? event.payload.content_ref
    : undefined;
}

function protectedValueObjectKey(
  trustZoneId: string,
  protectedValueId: string,
  ciphertextDigest: string,
): string {
  return `protected-values/${trustZoneId}/${protectedValueId}/${ciphertextDigest}`;
}

function wrapDeviceKey(input: {
  deviceKey: Uint8Array;
  trustZoneSyncKey: Uint8Array;
  trustZoneId: string;
  protectedValueId: string;
  keyRef: string;
  wrapKeyRef: string;
}): WrappedDeviceKeyEnvelope {
  const aad = protectedValueWrapAad(input.trustZoneId, input.protectedValueId, input.keyRef);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", input.trustZoneSyncKey, nonce);
  cipher.setAAD(aad);
  const wrappedKeyCiphertext = Buffer.concat([cipher.update(input.deviceKey), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    schema_version: "v1",
    envelope_version: "wrapped-device-key/v1",
    wrapping_algorithm: "aes-256-gcm",
    encoding: "base64url",
    wrap_key_ref: input.wrapKeyRef,
    wrapped_key_ref: `wrapped_${hashHex(
      stableJson({
        trust_zone_id: input.trustZoneId,
        protected_value_id: input.protectedValueId,
        key_ref: input.keyRef,
        wrapped_key_digest: hashHex(wrappedKeyCiphertext),
      }),
    ).slice(0, 24)}`,
    wrap_nonce: base64urlEncode(nonce),
    wrap_auth_tag: base64urlEncode(tag),
    wrapped_key_ciphertext: base64urlEncode(wrappedKeyCiphertext),
    wrapped_key_digest: {
      algorithm: "sha-256",
      value: hashHex(wrappedKeyCiphertext),
    },
    wrapped_key_size_bytes: wrappedKeyCiphertext.byteLength,
    aad: {
      trust_zone_id: input.trustZoneId,
      protected_value_id: input.protectedValueId,
      key_ref: input.keyRef,
    },
  };
}

function unwrapDeviceKey(input: {
  envelope: WrappedDeviceKeyEnvelope;
  trustZoneSyncKey: Uint8Array;
  trustZoneId: string;
  protectedValueId: string;
  keyRef: string;
}): Uint8Array {
  if (input.envelope.aad.trust_zone_id !== input.trustZoneId) {
    throw new Error("wrapped device-key AAD trust zone mismatch");
  }
  if (input.envelope.aad.protected_value_id !== input.protectedValueId) {
    throw new Error("wrapped device-key AAD protected value mismatch");
  }
  if (input.envelope.aad.key_ref !== input.keyRef) {
    throw new Error("wrapped device-key AAD key ref mismatch");
  }

  const ciphertext = base64urlDecode(input.envelope.wrapped_key_ciphertext);
  if (hashHex(ciphertext) !== input.envelope.wrapped_key_digest.value) {
    throw new Error("wrapped device-key digest mismatch");
  }
  if (ciphertext.byteLength !== input.envelope.wrapped_key_size_bytes) {
    throw new Error("wrapped device-key size mismatch");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    input.trustZoneSyncKey,
    base64urlDecode(input.envelope.wrap_nonce),
  );
  decipher.setAAD(protectedValueWrapAad(input.trustZoneId, input.protectedValueId, input.keyRef));
  decipher.setAuthTag(base64urlDecode(input.envelope.wrap_auth_tag));
  const key = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return assertAes256Key(key, "unwrapped device key");
}

function protectedValueWrapAad(
  trustZoneId: string,
  protectedValueId: string,
  keyRef: string,
): Buffer {
  return Buffer.from(
    stableJson({
      key_ref: keyRef,
      protected_value_id: protectedValueId,
      trust_zone_id: trustZoneId,
    }),
    "utf8",
  );
}

function assertAes256Key(value: Uint8Array, label: string): Uint8Array {
  if (value.byteLength !== 32) {
    throw new Error(`${label} must be exactly 32 bytes`);
  }
  return new Uint8Array(value);
}

function base64urlEncode(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function base64urlDecode(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("invalid base64url value");
  }
  return Buffer.from(value, "base64url");
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

  return `subject_${hashHex(value).slice(0, 16)}`;
}

function encrypt(
  plaintext: Uint8Array,
  keyBytes: Uint8Array,
): {
  nonce: Uint8Array;
  tag: Uint8Array;
  ciphertext: Uint8Array;
} {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    nonce,
    tag,
    ciphertext,
  };
}

function decrypt(
  ciphertext: Uint8Array,
  keyBytes: Uint8Array,
  nonce: Uint8Array,
  tag: Uint8Array,
): Uint8Array {
  const decipher = createDecipheriv("aes-256-gcm", keyBytes, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function toBuffer(value: Uint8Array): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

function assertSameCanonicalJson(
  existing: CanonicalEvent,
  incoming: CanonicalEvent,
  kind: string,
  id: string,
): void {
  assertSameJson(stableJson(existing), stableJson(incoming), kind, id);
}

/**
 * Same-origin pull: a device that already captured an event locally will see it
 * again after push+pull with only remote `zone_sequence` assigned. Treat that as
 * idempotent replay. Any other field divergence still fails closed.
 */
function assertPullReplayCompatible(
  existing: CanonicalEvent,
  incoming: CanonicalEvent,
  kind: string,
  id: string,
): void {
  if (existing.zone_sequence !== undefined) {
    assertSameCanonicalJson(existing, incoming, kind, id);
    return;
  }

  const existingWithoutSequence = stripZoneSequence(existing);
  const incomingWithoutSequence = stripZoneSequence(incoming);
  assertSameJson(
    stableJson(existingWithoutSequence),
    stableJson(incomingWithoutSequence),
    kind,
    id,
  );
}

function stripZoneSequence(event: CanonicalEvent): CanonicalEvent {
  if (event.zone_sequence === undefined) {
    return event;
  }
  const { zone_sequence: _zoneSequence, ...rest } = event;
  return rest as CanonicalEvent;
}

function assertSameJson(
  existingJson: string,
  incomingJson: string,
  kind: string,
  id: string,
): void {
  if (existingJson !== incomingJson) {
    throw new Error(`remote ${kind} replay diverges for ${id}`);
  }
}

function readKeyFile(keyPath: string): Uint8Array {
  chmodSync(keyPath, 0o600);
  const encoded = readFileSync(keyPath, "utf8").trim();
  if (!/^[a-f0-9]{64}$/i.test(encoded)) {
    throw new Error(`invalid local key material at ${keyPath}`);
  }

  const material = Buffer.from(encoded, "hex");
  if (material.byteLength !== 32) {
    throw new Error(`invalid local key length at ${keyPath}`);
  }
  return material;
}

function isErrnoCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function isThenable(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/** Env kill switch for post-capture agentic feed (default on). */
export function isAgenticFeedEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.CARPEOS_AGENTIC ?? "").trim().toLowerCase();
  return v !== "0" && v !== "off" && v !== "false" && v !== "disabled";
}

/**
 * Pull human-readable signal text from a capture envelope payload (local only).
 * Quality ultragoal Q3′ / QD5 agentic mode:
 * - Prefer prose fields (transcript/summary/message/text/content/body).
 * - Resolve transcript_path / transcriptPath via agentic extraction (no durability
 *   lexicon, no future-intent filter) when inline prose is missing.
 * - NEVER JSON.stringify the full envelope as the agentic body (H0).
 * - No prose → empty string (admit → empty_signal before Flash).
 */
/** Inline prose keys used by Claude/Codex/Cursor/Grok/Gajae-style hook envelopes. */
const AGENTIC_INLINE_PROSE_KEYS = [
  "transcript",
  "transcript_text",
  "text",
  "message",
  "content",
  "body",
  "summary",
  "prompt",
  "user_message",
  "assistant_message",
  "final_message",
  "response",
  "output_text",
  "last_assistant_message",
  "completion",
  "result",
] as const;

const AGENTIC_NEST_KEYS = ["payload", "event", "data", "message", "result", "session"] as const;

export function extractSignalTextFromCapturePayload(payload: unknown): string {
  if (payload === null || payload === undefined) return "";
  if (typeof payload === "string") return payload.trim();
  if (typeof payload !== "object" || Array.isArray(payload)) return "";
  return digAgenticProse(payload as Record<string, unknown>, 0);
}

/**
 * denser host adapters: walk a few nested objects for prose / transcript_path
 * without JSON.stringify of the full envelope (H0 fence).
 */
function digAgenticProse(obj: Record<string, unknown>, depth: number): string {
  if (depth > 3) return "";

  for (const key of AGENTIC_INLINE_PROSE_KEYS) {
    const v = obj[key];
    if (typeof v === "string" && v.trim().length > 0) {
      const trimmed = v.trim();
      if (
        trimmed.includes("\n") &&
        trimmed.includes("{") &&
        /"type"\s*:|"role"\s*:/.test(trimmed)
      ) {
        const fromJsonl = agenticProseFromTranscriptJsonl(trimmed);
        if (fromJsonl.length > 0) return fromJsonl;
      }
      // Nested "message" may be metadata-ish; still accept non-empty prose.
      return trimmed;
    }
    // Cursor/Codex sometimes nest { message: { content: "..." } } or content arrays.
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const nested = digAgenticProse(v as Record<string, unknown>, depth + 1);
      if (nested.length > 0) return nested;
    }
    if (Array.isArray(v)) {
      const parts: string[] = [];
      for (const item of v) {
        if (typeof item === "string" && item.trim().length > 0) parts.push(item.trim());
        else if (item !== null && typeof item === "object") {
          const row = item as Record<string, unknown>;
          if (typeof row.text === "string" && row.text.trim().length > 0) {
            parts.push(row.text.trim());
          } else if (typeof row.content === "string" && row.content.trim().length > 0) {
            parts.push(row.content.trim());
          }
        }
      }
      if (parts.length > 0) return parts.join("\n").slice(0, 48_000);
    }
  }

  for (const pathKey of ["transcript_path", "transcriptPath"] as const) {
    const path = obj[pathKey];
    if (typeof path === "string" && path.trim().length > 0) {
      const fromPath = agenticProseFromTranscriptPath(path.trim());
      if (fromPath.length > 0) return fromPath;
    }
  }

  for (const nest of AGENTIC_NEST_KEYS) {
    const child = obj[nest];
    if (child !== null && typeof child === "object" && !Array.isArray(child)) {
      const nested = digAgenticProse(child as Record<string, unknown>, depth + 1);
      if (nested.length > 0) return nested;
    }
  }

  // No prose resolved — empty (do not stringify envelope metadata as body).
  return "";
}
