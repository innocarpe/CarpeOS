import type { LeasedOutboxItem, LocalCaptureStore } from "@carpeos/local-store";
import type {
  CanonicalEvent,
  ProtectedValueMetadata,
  ProtectedValueUploadIntent,
  ProtectedValueUploadReceipt,
  SyncPullRequest,
  SyncPullResult,
  SyncPushRequest,
  SyncPushResult,
} from "@carpeos/schema";
import { validateConformance } from "@carpeos/schema";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type SyncTransportOptions = {
  baseUrl: string;
  bearerCredential: string;
  clientId: string;
  fetch: FetchLike;
};

export type ProtectedValueDownload = {
  metadata: ProtectedValueMetadata;
  ciphertext: Uint8Array;
};

export type PushOneOutboxResult =
  | {
      status: "acked";
      outbox_id: number;
      remote_status: "accepted" | "replay";
      result: SyncPushResult;
    }
  | {
      status: "retried";
      outbox_id: number;
      error: string;
    }
  | {
      status: "blocked";
      outbox_id: number;
      reason: string;
      result?: SyncPushResult;
    };

export type PullPageResult = {
  imported_events: number;
  imported_erasures: number;
  after_sequence: number;
  cursor: string | null;
  has_more: boolean;
};

export class SyncHttpError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(status: number, message: string, retryable: boolean) {
    super(message);
    this.name = "SyncHttpError";
    this.status = status;
    this.retryable = retryable;
  }
}

export class SyncHttpTransport {
  private readonly baseUrl: string;
  private readonly bearerCredential: string;
  private readonly clientId: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: SyncTransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.bearerCredential = options.bearerCredential;
    this.clientId = options.clientId;
    this.fetchImpl = options.fetch;
  }

  async putProtectedValue(
    intent: ProtectedValueUploadIntent,
    ciphertext: Uint8Array,
  ): Promise<ProtectedValueUploadReceipt> {
    const response = await this.fetchImpl(
      this.url(`/v1/sync/protected-values/${intent.protected_value_id}`),
      {
        method: "PUT",
        headers: {
          ...this.authHeaders(),
          "Content-Type": "application/octet-stream",
          "X-CarpeOS-Client-Id": this.clientId,
          "X-CarpeOS-Upload-Intent": encodeHeaderJson(intent),
        },
        body: Buffer.from(ciphertext),
      },
    );
    const receipt = await this.readJson(response);
    assertSyncApi(receipt, "protected value upload receipt");
    return receipt as ProtectedValueUploadReceipt;
  }

  async headProtectedValue(
    intent: ProtectedValueUploadIntent,
  ): Promise<ProtectedValueMetadata | undefined> {
    const response = await this.fetchImpl(
      this.url(`/v1/sync/protected-values/${intent.protected_value_id}`),
      {
        method: "HEAD",
        headers: this.protectedReadHeaders(
          intent.trust_zone_id,
          intent.original_ciphertext_digest.value,
        ),
      },
    );
    if (response.status === 404) {
      return undefined;
    }
    this.assertOk(response, "protected value HEAD failed");
    return readMetadataHeader(response);
  }

  async getProtectedValue(input: {
    protectedValueId: string;
    trustZoneId: string;
    ciphertextDigest: string;
  }): Promise<ProtectedValueDownload> {
    const response = await this.fetchImpl(
      this.url(`/v1/sync/protected-values/${input.protectedValueId}`),
      {
        method: "GET",
        headers: this.protectedReadHeaders(input.trustZoneId, input.ciphertextDigest),
      },
    );
    this.assertOk(response, "protected value GET failed");
    const metadata = readMetadataHeader(response);
    const ciphertext = new Uint8Array(await response.arrayBuffer());
    return { metadata, ciphertext };
  }

  async push(request: SyncPushRequest): Promise<SyncPushResult> {
    const response = await this.fetchImpl(this.url("/v1/sync/push"), {
      method: "POST",
      headers: {
        ...this.authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
    const body = await this.readJson(response);
    assertSyncApi(body, "sync push result");
    return body as SyncPushResult;
  }

  async pull(request: SyncPullRequest): Promise<SyncPullResult> {
    const response = await this.fetchImpl(this.url("/v1/sync/pull"), {
      method: "POST",
      headers: {
        ...this.authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
    const body = await this.readJson(response);
    assertSyncApi(body, "sync pull result");
    return body as SyncPullResult;
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.bearerCredential}`,
    };
  }

  private protectedReadHeaders(
    trustZoneId: string,
    ciphertextDigest: string,
  ): Record<string, string> {
    return {
      ...this.authHeaders(),
      "X-CarpeOS-Client-Id": this.clientId,
      "X-CarpeOS-Trust-Zone-Id": trustZoneId,
      "X-CarpeOS-Protected-Digest": ciphertextDigest,
    };
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private async readJson(response: Response): Promise<unknown> {
    this.assertOk(response, "sync request failed");
    return response.json();
  }

  private assertOk(response: Response, fallback: string): void {
    if (response.ok) {
      return;
    }
    throw new SyncHttpError(response.status, fallback, isRetryableStatus(response.status));
  }
}

export class OutboxSyncCoordinator {
  private readonly store: LocalCaptureStore;
  private readonly transport: SyncHttpTransport;
  private readonly trustZoneSyncKey: Uint8Array;
  private readonly retryDelayMs: number;
  private readonly leaseMs: number;
  private readonly pullLimit: number;

  constructor(input: {
    store: LocalCaptureStore;
    transport: SyncHttpTransport;
    trustZoneSyncKey: Uint8Array;
    retryDelayMs?: number;
    leaseMs?: number;
    pullLimit?: number;
  }) {
    this.store = input.store;
    this.transport = input.transport;
    this.trustZoneSyncKey = assertAes256Key(input.trustZoneSyncKey, "trust-zone sync key");
    this.retryDelayMs = input.retryDelayMs ?? 1_000;
    this.leaseMs = input.leaseMs ?? 30_000;
    this.pullLimit = input.pullLimit ?? 100;
  }

  async pushOne(now = new Date()): Promise<PushOneOutboxResult | undefined> {
    const lease = this.store.leaseOutbox(1, this.leaseMs, now);
    const item = lease.items[0];
    if (item === undefined) {
      return undefined;
    }

    const outboxTrustZoneId = item.push_request.trust_zone_id;
    const storeTrustZoneId = this.store.trustZone.trust_zone_id;
    if (outboxTrustZoneId !== storeTrustZoneId) {
      return this.block(
        item,
        lease.lease_id,
        `outbox trust zone mismatches store; re-run with --trust-zone ${outboxTrustZoneId}`,
        now,
      );
    }

    try {
      const transfer = this.store.exportProtectedValueForSync({
        protectedValueId: item.protected_value_id,
        trustZoneSyncKey: this.trustZoneSyncKey,
      });
      const receipt = await this.ensureProtectedValueUploaded(transfer.intent, transfer.ciphertext);
      const pushRequest: SyncPushRequest = {
        ...item.push_request,
        protected_value_receipts: [receipt],
      };
      const result = await this.transport.push(pushRequest);
      if (result.status === "accepted" || result.status === "replay") {
        this.store.ackOutbox(item.outbox_id, lease.lease_id, now);
        return {
          status: "acked",
          outbox_id: item.outbox_id,
          remote_status: result.status,
          result,
        };
      }
      if (result.status === "partial_error") {
        return this.retry(item, lease.lease_id, "remote partial_error", now);
      }
      return this.block(item, lease.lease_id, "remote idempotency_conflict", now, result);
    } catch (error) {
      if (error instanceof SyncHttpError && !error.retryable) {
        return this.block(item, lease.lease_id, sanitizeError(error), now);
      }
      return this.retry(item, lease.lease_id, sanitizeError(error), now);
    }
  }

  async pullPage(now = new Date()): Promise<PullPageResult> {
    const cursor = this.store.getSyncCursor();
    const request: SyncPullRequest = {
      schema_version: "v1",
      client_id: this.store.clientId,
      trust_zone_id: this.store.trustZone.trust_zone_id,
      limit: this.pullLimit,
      ...(cursor.after_sequence < 1 ? {} : { after_sequence: cursor.after_sequence }),
    };
    assertSyncApi(request, "sync pull request");
    const result = await this.transport.pull(request);
    let importedEvents = 0;
    for (const event of result.events) {
      const protectedRef = getEventProtectedValueRef(event);
      if (protectedRef === undefined) {
        if (this.store.importPulledEvent(event, now).status === "imported") {
          importedEvents += 1;
        }
        continue;
      }
      const download = await this.transport.getProtectedValue({
        protectedValueId: protectedRef.protected_value_id,
        trustZoneId: event.trust_zone.trust_zone_id,
        ciphertextDigest: protectedRef.encrypted_blob.digest.value,
      });
      const importResult = this.store.importPulledProtectedValue({
        event,
        metadata: download.metadata,
        ciphertext: download.ciphertext,
        trustZoneSyncKey: this.trustZoneSyncKey,
      });
      if (importResult.status === "imported") {
        importedEvents += 1;
      }
    }
    let importedErasures = 0;
    for (const erasure of result.erasures) {
      if (this.store.importPulledErasure(erasure, now).status === "imported") {
        importedErasures += 1;
      }
    }
    const afterSequence =
      result.after_sequence ??
      maxPulledSequence([...result.events, ...result.erasures], cursor.after_sequence);
    this.store.persistSyncCursor({
      afterSequence,
      now,
      ...(result.cursor === undefined ? {} : { cursor: result.cursor }),
    });
    return {
      imported_events: importedEvents,
      imported_erasures: importedErasures,
      after_sequence: afterSequence,
      cursor: result.cursor ?? null,
      has_more: result.has_more,
    };
  }

  private async ensureProtectedValueUploaded(
    intent: ProtectedValueUploadIntent,
    ciphertext: Uint8Array,
  ): Promise<ProtectedValueUploadReceipt> {
    const existing = await this.transport.headProtectedValue(intent);
    if (
      existing !== undefined &&
      existing.original_ciphertext_digest.algorithm ===
        intent.original_ciphertext_digest.algorithm &&
      existing.original_ciphertext_digest.value === intent.original_ciphertext_digest.value &&
      existing.original_ciphertext_size_bytes === intent.original_ciphertext_size_bytes
    ) {
      return {
        schema_version: "v1",
        receipt_type: "protected_value_upload",
        protected_value_id: existing.protected_value_id,
        trust_zone_id: existing.trust_zone_id,
        object_key: existing.object_key,
        original_ciphertext_digest: existing.original_ciphertext_digest,
        original_ciphertext_size_bytes: existing.original_ciphertext_size_bytes,
        uploaded_at: existing.uploaded_at,
        status: "already_exists",
        upload_receipt_id: `receipt_${existing.protected_value_id.slice(3)}_recovered`,
      };
    }
    return this.transport.putProtectedValue(intent, ciphertext);
  }

  private retry(
    item: LeasedOutboxItem,
    leaseId: string,
    error: string,
    now: Date,
  ): PushOneOutboxResult {
    this.store.retryOutbox(item.outbox_id, leaseId, this.retryDelayMs, error, now);
    return {
      status: "retried",
      outbox_id: item.outbox_id,
      error,
    };
  }

  private block(
    item: LeasedOutboxItem,
    leaseId: string,
    reason: string,
    now: Date,
    result?: SyncPushResult,
  ): PushOneOutboxResult {
    // Return the lease so the item is not stuck leased after a non-retryable block.
    // available_at = now (delay 0) so a corrected --trust-zone can pick it up immediately.
    this.store.retryOutbox(item.outbox_id, leaseId, 0, reason, now);
    return {
      status: "blocked",
      outbox_id: item.outbox_id,
      reason,
      ...(result === undefined ? {} : { result }),
    };
  }
}

export function encodeHeaderJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeHeaderJson<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}

function readMetadataHeader(response: Response): ProtectedValueMetadata {
  const raw = response.headers.get("X-CarpeOS-Protected-Metadata");
  if (raw === null) {
    throw new Error("missing X-CarpeOS-Protected-Metadata header");
  }
  const metadata = decodeHeaderJson<ProtectedValueMetadata>(raw);
  assertSyncApi(metadata, "protected value metadata");
  return metadata;
}

function assertSyncApi(value: unknown, label: string): void {
  const conformance = validateConformance("syncApi", value);
  if (!conformance.valid) {
    throw new Error(`invalid ${label}: ${conformance.errors.join("; ")}`);
  }
}

function getEventProtectedValueRef(
  event: CanonicalEvent,
):
  | Extract<
      CanonicalEvent<"EvidenceArtifact">["payload"]["content_ref"],
      { ref_type: "protected_value" }
    >
  | undefined {
  return event.event_type === "EvidenceArtifact" &&
    event.payload.content_ref.ref_type === "protected_value"
    ? event.payload.content_ref
    : undefined;
}

function maxPulledSequence(
  records: Array<CanonicalEvent | { zone_sequence?: number }>,
  fallback: number,
): number {
  return records.reduce((max, record) => Math.max(max, record.zone_sequence ?? 0), fallback);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/[^\w .:/-]+/g, " ").slice(0, 500);
  }
  return "sync request failed";
}

function assertAes256Key(value: Uint8Array, label: string): Uint8Array {
  if (value.byteLength !== 32) {
    throw new Error(`${label} must be exactly 32 bytes`);
  }
  return new Uint8Array(value);
}
