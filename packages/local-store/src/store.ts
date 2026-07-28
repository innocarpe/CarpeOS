import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  buildSyncPushRequest,
  type CaptureEnvelope,
  deriveIdempotencyKey,
  fingerprintEnvelope,
  hashHex,
  stableJson,
} from "@carpeos/capture";
import type {
  CanonicalEvent,
  ProtectedValueRef,
  SyncPushRequest,
  TrustZone,
} from "@carpeos/schema";
import { validateConformance } from "@carpeos/schema";
import { resolveProjectIdentity } from "./project-identity.js";

export type Clock = {
  now(): Date;
};

export type KeyProvider = {
  readOrCreateKey(): Uint8Array;
};

export type LocalStoreOptions = {
  runtimeDir: string;
  workspaceRoot: string;
  dbPath?: string;
  trustZoneId?: string;
  explicitProjectId?: string;
  keyProvider?: KeyProvider;
  clock?: Clock;
};

export type CaptureRequestOptions = {
  failAfter?: "capture_request" | "protected_value" | "canonical_event";
};

export type CaptureResult =
  | {
      status: "captured";
      event: CanonicalEvent<"EvidenceArtifact">;
      local_sequence: number;
      outbox_id: number;
      request_fingerprint: string;
      protected_value_id: string;
    }
  | {
      status: "replay";
      event: CanonicalEvent<"EvidenceArtifact">;
      local_sequence: number;
      outbox_id: number;
      request_fingerprint: string;
      protected_value_id: string;
    };

export type OutboxStatus = {
  pending: number;
  leased: number;
  delivered: number;
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

type ProtectedValueRow = {
  nonce: Uint8Array;
  tag: Uint8Array;
  ciphertext: Uint8Array;
  plaintext_digest: string;
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

const MIGRATION_ID = "001_local_capture_store";

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
  private readonly db: DatabaseSync;
  private readonly clock: Clock;
  private readonly keyBytes: Uint8Array;

  constructor(options: LocalStoreOptions) {
    if (options.trustZoneId !== undefined && !isTrustZoneId(options.trustZoneId)) {
      throw new Error(`invalid trust zone id: ${options.trustZoneId}`);
    }

    this.runtimeDir = options.runtimeDir;
    mkdirSync(this.runtimeDir, { recursive: true, mode: 0o700 });
    chmodSync(this.runtimeDir, 0o700);

    this.dbPath = options.dbPath ?? join(this.runtimeDir, "carpeos.sqlite");
    mkdirSync(dirname(this.dbPath), { recursive: true, mode: 0o700 });
    chmodSync(dirname(this.dbPath), 0o700);
    this.db = new DatabaseSync(this.dbPath, { timeout: 5_000 });
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");

    this.clock = options.clock ?? { now: () => new Date() };
    const identity = resolveProjectIdentity({
      runtimeDir: this.runtimeDir,
      workspaceRoot: options.workspaceRoot,
      explicitProjectId: options.explicitProjectId,
    });
    this.clientId = identity.device_client_id;
    this.projectId = identity.project_id;
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

  close(): void {
    this.db.close();
  }

  captureHook(envelope: CaptureEnvelope, options: CaptureRequestOptions = {}): CaptureResult {
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
            recorded_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          }),
          protectedValueId,
          normalizedEnvelope.captured_at,
          recordedAt,
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

  countRows(
    table: "capture_requests" | "canonical_events" | "protected_values" | "outbox",
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
    return row === undefined ? undefined : (JSON.parse(row.event_json) as CanonicalEvent);
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
      if (existing !== undefined) {
        return;
      }

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
    });
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
  const conformance = validateConformance("canonicalEvent", event);
  if (!conformance.valid) {
    throw new Error(`invalid canonical event: ${conformance.errors.join("; ")}`);
  }
  if (event.zone_sequence !== undefined) {
    throw new Error("local capture must not assign canonical zone_sequence");
  }
}

function normalizeTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`invalid timestamp: ${value}`);
  }
  return parsed.toISOString().replace(".000Z", "Z");
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
