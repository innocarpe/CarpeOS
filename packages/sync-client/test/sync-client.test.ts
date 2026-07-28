import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalCaptureStore, StaticKeyProvider } from "@carpeos/local-store";
import type {
  ProtectedValueMetadata,
  ProtectedValueUploadIntent,
  ProtectedValueUploadReceipt,
  SyncPullRequest,
  SyncPushRequest,
  SyncPushResult,
} from "@carpeos/schema";
import { afterEach, describe, expect, it } from "vitest";
import {
  decodeHeaderJson,
  encodeHeaderJson,
  OutboxSyncCoordinator,
  type FetchLike,
  SyncHttpTransport,
} from "../src/index.js";

const sourceKey = new Uint8Array(32).fill(3);
const targetKey = new Uint8Array(32).fill(4);
const syncKey = new Uint8Array(32).fill(5);
const trustZoneId = "tz_sync_client_zone";
const now = new Date("2026-01-01T00:00:00Z");
const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("SyncHttpTransport", () => {
  it("uses the protected-value upload intent header and raw ciphertext body", async () => {
    const { store, captured } = makeCapturedStore();
    const transfer = store.exportProtectedValueForSync({
      protectedValueId: captured.protected_value_id,
      trustZoneSyncKey: syncKey,
    });
    let seenIntent: ProtectedValueUploadIntent | undefined;
    let seenBody = new Uint8Array();
    const transport = new SyncHttpTransport({
      baseUrl: "https://sync.example.test/",
      bearerCredential: "synthetic_credential",
      clientId: "client_synthetic",
      fetch: async (input, init) => {
        expect(String(input)).toBe(
          `https://sync.example.test/v1/sync/protected-values/${captured.protected_value_id}`,
        );
        if (init === undefined) {
          throw new Error("expected fetch init");
        }
        const headers = init.headers as Record<string, string>;
        expect(init.method).toBe("PUT");
        expect(headers.Authorization).toBe("Bearer synthetic_credential");
        expect(headers["X-CarpeOS-Client-Id"]).toBe("client_synthetic");
        seenIntent = decodeHeaderJson<ProtectedValueUploadIntent>(
          headers["X-CarpeOS-Upload-Intent"] ?? "",
        );
        seenBody = new Uint8Array(await new Response(init.body).arrayBuffer());
        return jsonResponse(receiptFromIntent(transfer.intent, "uploaded"));
      },
    });

    const receipt = await transport.putProtectedValue(transfer.intent, transfer.ciphertext);

    expect(seenIntent).toEqual(transfer.intent);
    expect(seenBody).toEqual(transfer.ciphertext);
    expect(receipt.status).toBe("uploaded");
  });

  it("reads metadata from HEAD and raw ciphertext plus metadata from GET", async () => {
    const { store, captured } = makeCapturedStore();
    const transfer = store.exportProtectedValueForSync({
      protectedValueId: captured.protected_value_id,
      trustZoneSyncKey: syncKey,
    });
    const metadata = metadataFromIntent(transfer.intent, captured.event.event_id);
    const transport = new SyncHttpTransport({
      baseUrl: "https://sync.example.test",
      bearerCredential: "synthetic_credential",
      clientId: "client_synthetic",
      fetch: async (_input, init) => {
        const headers = init?.headers as Record<string, string>;
        expect(headers["X-CarpeOS-Client-Id"]).toBe("client_synthetic");
        expect(headers["X-CarpeOS-Trust-Zone-Id"]).toBe(trustZoneId);
        expect(headers["X-CarpeOS-Protected-Digest"]).toBe(
          transfer.intent.original_ciphertext_digest.value,
        );
        if (init?.method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: { "X-CarpeOS-Protected-Metadata": encodeHeaderJson(metadata) },
          });
        }
        return new Response(transfer.ciphertext, {
          status: 200,
          headers: { "X-CarpeOS-Protected-Metadata": encodeHeaderJson(metadata) },
        });
      },
    });

    expect(await transport.headProtectedValue(transfer.intent)).toEqual(metadata);
    const download = await transport.getProtectedValue({
      protectedValueId: captured.protected_value_id,
      trustZoneId,
      ciphertextDigest: transfer.intent.original_ciphertext_digest.value,
    });
    expect(download.metadata).toEqual(metadata);
    expect(download.ciphertext).toEqual(transfer.ciphertext);
  });
});

describe("OutboxSyncCoordinator", () => {
  it("uploads before push and acks accepted outbox rows", async () => {
    const { store, captured } = makeCapturedStore();
    const calls: string[] = [];
    const transport = makeTransport(async (_input: string | URL | Request, init?: RequestInit) => {
      calls.push(init?.method ?? "GET");
      if (init?.method === "HEAD") {
        return new Response(null, { status: 404 });
      }
      if (init?.method === "PUT") {
        const intent = decodeHeaderJson<ProtectedValueUploadIntent>(
          (init.headers as Record<string, string>)["X-CarpeOS-Upload-Intent"] ?? "",
        );
        return jsonResponse(receiptFromIntent(intent, "uploaded"));
      }
      const request = JSON.parse(String(init?.body)) as SyncPushRequest;
      expect(request.protected_value_receipts).toHaveLength(1);
      const result: SyncPushResult = {
        schema_version: "v1",
        request_id: request.request_id,
        status: "accepted",
        accepted_event_ids: [captured.event.event_id],
        accepted_erasure_ids: [],
        errors: [],
      };
      return jsonResponse(result);
    });
    const coordinator = new OutboxSyncCoordinator({ store, transport, trustZoneSyncKey: syncKey });

    const result = await coordinator.pushOne(now);

    expect(result?.status).toBe("acked");
    expect(calls).toEqual(["HEAD", "PUT", "POST"]);
    expect(store.outboxStatus()).toEqual({ pending: 0, leased: 0, delivered: 1 });
  });

  it("recovers an upload receipt from matching HEAD metadata without PUT", async () => {
    const { store, captured } = makeCapturedStore();
    const transfer = store.exportProtectedValueForSync({
      protectedValueId: captured.protected_value_id,
      trustZoneSyncKey: syncKey,
    });
    const metadata = metadataFromIntent(transfer.intent, captured.event.event_id);
    const calls: string[] = [];
    const transport = makeTransport(async (_input: string | URL | Request, init?: RequestInit) => {
      calls.push(init?.method ?? "GET");
      if (init?.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { "X-CarpeOS-Protected-Metadata": encodeHeaderJson(metadata) },
        });
      }
      const request = JSON.parse(String(init?.body)) as SyncPushRequest;
      expect(request.protected_value_receipts?.[0]?.status).toBe("already_exists");
      return jsonResponse({
        schema_version: "v1",
        request_id: request.request_id,
        status: "replay",
        accepted_event_ids: [captured.event.event_id],
        accepted_erasure_ids: [],
        replay_of: request.idempotency_key,
        errors: [{ code: "replay", message: "synthetic replay" }],
      } satisfies SyncPushResult);
    });

    const coordinator = new OutboxSyncCoordinator({ store, transport, trustZoneSyncKey: syncKey });
    const result = await coordinator.pushOne(now);

    expect(result?.status).toBe("acked");
    expect(calls).toEqual(["HEAD", "POST"]);
    expect(store.outboxStatus()).toEqual({ pending: 0, leased: 0, delivered: 1 });
  });

  it("does not ack partial_error, auth failures, or idempotency conflicts", async () => {
    await expectPushOutcome("partial_error", 200, "retried");
    await expectPushOutcome("accepted", 401, "blocked");
    await expectPushOutcome("idempotency_conflict", 409, "blocked");
  });

  it("pulls a page, imports protected values idempotently, and advances cursor after apply", async () => {
    const source = makeCapturedStore();
    const transfer = source.store.exportProtectedValueForSync({
      protectedValueId: source.captured.protected_value_id,
      trustZoneSyncKey: syncKey,
    });
    const remoteEvent = { ...source.captured.event, zone_sequence: 5 };
    const metadata = metadataFromIntent(transfer.intent, source.captured.event.event_id);
    const target = new LocalCaptureStore({
      runtimeDir: tempDir(),
      workspaceRoot: tempDir(),
      trustZoneId,
      keyProvider: new StaticKeyProvider(targetKey),
      clock: { now: () => now },
    });
    const calls: string[] = [];
    const transport = makeTransport(async (_input: string | URL | Request, init?: RequestInit) => {
      calls.push(init?.method ?? "GET");
      if (init?.method === "POST") {
        const request = JSON.parse(String(init.body)) as SyncPullRequest;
        expect(request.after_sequence).toBeUndefined();
        return jsonResponse({
          schema_version: "v1",
          events: [remoteEvent],
          erasures: [],
          cursor: "cursor_5",
          after_sequence: 5,
          has_more: false,
        });
      }
      return new Response(transfer.ciphertext, {
        status: 200,
        headers: { "X-CarpeOS-Protected-Metadata": encodeHeaderJson(metadata) },
      });
    });
    const coordinator = new OutboxSyncCoordinator({
      store: target,
      transport,
      trustZoneSyncKey: syncKey,
      pullLimit: 1,
    });

    const result = await coordinator.pullPage(now);

    expect(result).toEqual({
      imported_events: 1,
      imported_erasures: 0,
      after_sequence: 5,
      cursor: "cursor_5",
      has_more: false,
    });
    expect(calls).toEqual(["POST", "GET"]);
    expect(target.getSyncCursor()).toEqual({
      trust_zone_id: trustZoneId,
      after_sequence: 5,
      cursor: "cursor_5",
    });
    expect(
      Buffer.from(target.decryptProtectedValue(source.captured.protected_value_id)).toString(
        "utf8",
      ),
    ).toContain("synthetic capture");
  });

  it("imports non-protected events before advancing the pull cursor", async () => {
    const target = new LocalCaptureStore({
      runtimeDir: tempDir(),
      workspaceRoot: tempDir(),
      trustZoneId,
      keyProvider: new StaticKeyProvider(targetKey),
      clock: { now: () => now },
    });
    const event = {
      ...makeCapturedStore().captured.event,
      event_id: "evt_external_pull001",
      zone_sequence: 9,
      trust_zone: { trust_zone_id: trustZoneId, isolation: "user_cloud" as const },
      payload: {
        artifact_id: "art_external_pull001",
        kind: "message" as const,
        media_type: "text/plain",
        content_ref: {
          ref_type: "external_uri" as const,
          uri: "https://example.invalid/external-pull",
          digest: {
            algorithm: "sha-256" as const,
            value: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          },
          visibility: "public" as const,
          reachability: "online" as const,
        },
      },
    };
    const transport = makeTransport(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      return jsonResponse({
        schema_version: "v1",
        events: [event],
        erasures: [],
        after_sequence: 9,
        cursor: "cursor_9",
        has_more: false,
      });
    });
    const coordinator = new OutboxSyncCoordinator({
      store: target,
      transport,
      trustZoneSyncKey: syncKey,
      pullLimit: 1,
    });

    const result = await coordinator.pullPage(now);

    expect(result.imported_events).toBe(1);
    expect(target.getEvent("evt_external_pull001")).toEqual(event);
    expect(target.getSyncCursor().after_sequence).toBe(9);
  });
});

async function expectPushOutcome(
  pushStatus: SyncPushResult["status"],
  httpStatus: number,
  expectedStatus: "retried" | "blocked",
): Promise<void> {
  const { store, captured } = makeCapturedStore();
  const transport = makeTransport(async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "HEAD") {
      return new Response(null, { status: 404 });
    }
    if (init?.method === "PUT") {
      const intent = decodeHeaderJson<ProtectedValueUploadIntent>(
        (init.headers as Record<string, string>)["X-CarpeOS-Upload-Intent"] ?? "",
      );
      return jsonResponse(receiptFromIntent(intent, "uploaded"));
    }
    if (httpStatus !== 200) {
      return jsonResponse(
        { schema_version: "v1", error: { code: "unauthorized", message: "no" } },
        httpStatus,
      );
    }
    const request = JSON.parse(String(init?.body)) as SyncPushRequest;
    return jsonResponse({
      schema_version: "v1",
      request_id: request.request_id,
      status: pushStatus,
      accepted_event_ids: pushStatus === "idempotency_conflict" ? [] : [captured.event.event_id],
      accepted_erasure_ids: [],
      ...(pushStatus === "idempotency_conflict" ? { conflict_with: request.idempotency_key } : {}),
      errors:
        pushStatus === "partial_error"
          ? [{ code: "internal_error", message: "synthetic partial" }]
          : pushStatus === "idempotency_conflict"
            ? [{ code: "idempotency_conflict", message: "synthetic conflict" }]
            : [],
    });
  });
  const coordinator = new OutboxSyncCoordinator({ store, transport, trustZoneSyncKey: syncKey });

  const result = await coordinator.pushOne(now);

  expect(result?.status).toBe(expectedStatus);
  expect(store.outboxStatus().delivered).toBe(0);
}

function makeCapturedStore(): {
  store: LocalCaptureStore;
  captured: ReturnType<LocalCaptureStore["captureHook"]>;
} {
  const runtimeDir = tempDir();
  const store = new LocalCaptureStore({
    runtimeDir,
    workspaceRoot: runtimeDir,
    trustZoneId,
    keyProvider: new StaticKeyProvider(sourceKey),
    clock: { now: () => now },
  });
  const captured = store.captureHook({
    provider: "codex",
    hook_event_name: "SessionEnd",
    captured_at: "2026-01-01T00:00:00Z",
    workspace_root: "/synthetic/workspace",
    session_id: "session_synthetic",
    source_event_id: "source_synthetic",
    media_type: "application/json",
    subject_ref: "subject_synthetic",
    payload: { transcript: "synthetic capture" },
  });
  return { store, captured };
}

function makeTransport(fetch: FetchLike): SyncHttpTransport {
  return new SyncHttpTransport({
    baseUrl: "https://sync.example.test",
    bearerCredential: "synthetic_credential",
    clientId: "client_synthetic",
    fetch,
  });
}

function receiptFromIntent(
  intent: ProtectedValueUploadIntent,
  status: "uploaded" | "already_exists",
): ProtectedValueUploadReceipt {
  return {
    schema_version: "v1",
    receipt_type: "protected_value_upload",
    protected_value_id: intent.protected_value_id,
    trust_zone_id: intent.trust_zone_id,
    object_key: intent.object_key,
    original_ciphertext_digest: intent.original_ciphertext_digest,
    original_ciphertext_size_bytes: intent.original_ciphertext_size_bytes,
    uploaded_at: now.toISOString().replace(".000Z", "Z"),
    status,
    upload_receipt_id: `receipt_${intent.protected_value_id.slice(3)}`,
  };
}

function metadataFromIntent(
  intent: ProtectedValueUploadIntent,
  eventId: string,
): ProtectedValueMetadata {
  return {
    schema_version: "v1",
    metadata_type: "protected_value",
    protected_value_id: intent.protected_value_id,
    trust_zone_id: intent.trust_zone_id,
    object_key: intent.object_key,
    vault_ref: intent.vault_ref,
    encryption_algorithm: intent.encryption_algorithm,
    encoding: intent.encoding,
    ciphertext_nonce: intent.ciphertext_nonce,
    ciphertext_auth_tag: intent.ciphertext_auth_tag,
    original_ciphertext_digest: intent.original_ciphertext_digest,
    original_ciphertext_size_bytes: intent.original_ciphertext_size_bytes,
    key_ref: intent.key_ref,
    wrapped_device_key: intent.wrapped_device_key,
    linked_event_ids: [eventId],
    orphan_status: "linked",
    uploaded_at: now.toISOString().replace(".000Z", "Z"),
    ...(intent.nonce_ref === undefined ? {} : { nonce_ref: intent.nonce_ref }),
    ...(intent.tag_ref === undefined ? {} : { tag_ref: intent.tag_ref }),
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "carpeos-sync-client-"));
  createdDirs.push(dir);
  return dir;
}
