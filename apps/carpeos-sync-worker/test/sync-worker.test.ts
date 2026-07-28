import { env, exports as workerExports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import migrationSql from "../migrations/0001_initial.sql?raw";
import localWorker from "../src/index.js";
import type {
  CanonicalEvent,
  ErasureLedgerRecord,
  ProtectedValueMetadata,
  ProtectedValueUploadIntent,
  ProtectedValueUploadReceipt,
  SyncPullResult,
  SyncPushRequest,
  SyncPushResult,
} from "@carpeos/schema";

type TestEnv = {
  DB: D1Database;
  PROTECTED_VALUES: R2Bucket;
};

const DB = (env as unknown as TestEnv).DB;
const R2 = (env as unknown as TestEnv).PROTECTED_VALUES;
const worker = (workerExports as { default?: typeof localWorker }).default ?? localWorker;
const SYNTHETIC_BEARER_CREDENTIAL = "synthetic_credential_0123456789abcdef_0123456789abcdef";
const CLIENT_ID = "client_test";
const TRUST_ZONE_ID = "tz_personal";
const OTHER_TRUST_ZONE_ID = "tz_other";
const NOW = "2026-07-29T00:00:00Z";

const MIGRATION_SQL = migrationSql;

describe("CarpeOS sync Worker", () => {
  beforeEach(async () => {
    await runSqlStatements(MIGRATION_SQL);
    await runSqlStatements(`
      DELETE FROM protected_value_links;
      DELETE FROM protected_value_uploads;
      DELETE FROM erasure_ledger;
      DELETE FROM canonical_events;
      DELETE FROM zone_counters;
      DELETE FROM sync_requests;
      DELETE FROM client_authorizations;
    `);

    const listed = await R2.list();
    await Promise.all(listed.objects.map((object) => R2.delete(object.key)));

    await seedAuthorization(CLIENT_ID, TRUST_ZONE_ID, SYNTHETIC_BEARER_CREDENTIAL);
    await seedAuthorization(CLIENT_ID, OTHER_TRUST_ZONE_ID, SYNTHETIC_BEARER_CREDENTIAL);
  });

  it("rejects missing auth before storage mutation", async () => {
    const push = buildPush({ event: buildExternalEvent("evt_missingauth0001", 1) });
    const response = await postJson("/v1/sync/push", push, {});

    expect(response.status).toBe(401);
    expect(await countRows("sync_requests")).toBe(0);
    expect(await countRows("canonical_events")).toBe(0);
  });

  it("uploads, reads, and idempotently reuses protected ciphertext without rewriting", async () => {
    const { intent, bytes } = await buildProtectedUpload("pv_upload0001");

    const uploaded = await uploadProtectedValue(intent, bytes);
    expect(uploaded.status).toBe(200);
    const uploadedReceipt = (await uploaded.json()) as ProtectedValueUploadReceipt;
    expect(uploadedReceipt.status).toBe("uploaded");

    const head = await protectedRead("HEAD", intent.protected_value_id, intent);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const headMetadata = decodeHeader<ProtectedValueMetadata>(head, "X-CarpeOS-Protected-Metadata");
    expect(headMetadata.original_ciphertext_digest.value).toBe(
      intent.original_ciphertext_digest.value,
    );
    expect(headMetadata.vault_ref).toBe(intent.vault_ref);
    expect(headMetadata.orphan_status).toBe("orphaned");

    const downloaded = await protectedRead("GET", intent.protected_value_id, intent);
    expect(downloaded.status).toBe(200);
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(bytes);

    const second = await uploadProtectedValue(intent, bytes);
    expect(second.status).toBe(200);
    expect(((await second.json()) as ProtectedValueUploadReceipt).status).toBe("already_exists");

    const mismatched = await uploadProtectedValue(intent, new Uint8Array([1, 2, 3]));
    expect(mismatched.status).toBe(422);
  });

  it("authorizes protected reads before scoped presence lookup", async () => {
    const { intent, bytes } = await buildProtectedUpload("pv_authfirst01");
    expect((await uploadProtectedValue(intent, bytes)).status).toBe(200);

    const missingAuth = await worker.fetch(
      new Request(`https://sync.test/v1/sync/protected-values/${intent.protected_value_id}`, {
        method: "HEAD",
        headers: { "X-CarpeOS-Trust-Zone-Id": intent.trust_zone_id },
      }),
      env as never,
    );
    expect(missingAuth.status).toBe(401);

    const wrongZone = await protectedRead("HEAD", intent.protected_value_id, {
      ...intent,
      trust_zone_id: OTHER_TRUST_ZONE_ID,
    });
    expect(wrongZone.status).toBe(404);
  });

  it("rejects existing R2 reuse when stored decrypt-critical fields diverge", async () => {
    const { intent, bytes } = await buildProtectedUpload("pv_fieldguard1");
    expect((await uploadProtectedValue(intent, bytes)).status).toBe(200);

    const changedKeyRef: ProtectedValueUploadIntent = {
      ...intent,
      key_ref: "key_changed",
      wrapped_device_key: {
        ...intent.wrapped_device_key,
        aad: { ...intent.wrapped_device_key.aad, key_ref: "key_changed" },
      },
    };
    const response = await uploadProtectedValue(changedKeyRef, bytes);
    expect(response.status).toBe(409);
  });

  it("caps JSON body size before parse", async () => {
    const response = await worker.fetch(
      new Request("https://sync.test/v1/sync/push", {
        method: "POST",
        headers: {
          ...authHeaders(),
          "Content-Type": "application/json",
          "Content-Length": String(17 * 1024 * 1024),
        },
        body: "{}",
      }),
      env as never,
    );
    expect(response.status).toBe(400);
    expect((await response.json()) as unknown).toMatchObject({
      error: { code: "invalid_schema" },
    });
  });

  it("recreates a missing D1 receipt from deterministic R2 metadata on HEAD", async () => {
    const { intent, bytes } = await buildProtectedUpload("pv_recreate001");
    expect((await uploadProtectedValue(intent, bytes)).status).toBe(200);

    await DB.prepare("DELETE FROM protected_value_uploads WHERE protected_value_id = ?1")
      .bind(intent.protected_value_id)
      .run();

    const recovered = await protectedRead("HEAD", intent.protected_value_id, intent);
    expect(recovered.status).toBe(200);
    const recoveredMetadata = decodeHeader<ProtectedValueMetadata>(
      recovered,
      "X-CarpeOS-Protected-Metadata",
    );
    expect(recoveredMetadata.vault_ref).toBe(intent.vault_ref);
    expect(await countRows("protected_value_uploads")).toBe(1);

    const receipt = receiptFromIntent(intent, "already_exists");
    const event = buildProtectedEvent("evt_recovered001", 1, intent);
    const accepted = await postJson(
      "/v1/sync/push",
      buildPush({
        event,
        receipt,
        idempotencyKey: "idem_recovered_00000000000001",
        requestId: "req_recovered_1",
      }),
    );
    expect(accepted.status).toBe(200);
    const linked = decodeHeader<ProtectedValueMetadata>(
      await protectedRead("HEAD", intent.protected_value_id, intent),
      "X-CarpeOS-Protected-Metadata",
    );
    expect(linked.vault_ref).toBe(intent.vault_ref);
    expect(linked.linked_event_ids).toEqual([event.event_id]);
  });

  it("accepts a protected event after blob upload, replays without mutation, and conflicts without R2 rewrite", async () => {
    const { intent, bytes } = await buildProtectedUpload("pv_event0001");
    const receipt = (await (
      await uploadProtectedValue(intent, bytes)
    ).json()) as ProtectedValueUploadReceipt;
    const event = buildProtectedEvent("evt_protected0001", 1, intent);
    const push = buildPush({ event, receipt, idempotencyKey: "idem_protected_0000000000000001" });

    const accepted = await postJson("/v1/sync/push", push);
    expect(accepted.status).toBe(200);
    const acceptedBody = (await accepted.json()) as SyncPushResult;
    expect(acceptedBody.status).toBe("accepted");
    expect(acceptedBody.zone_sequences?.[0]?.last_sequence).toBe(1);
    expect(await countRows("canonical_events")).toBe(1);

    const replay = await postJson("/v1/sync/push", { ...push, request_id: "req_replay" });
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as SyncPushResult).status).toBe("replay");
    expect(await countRows("canonical_events")).toBe(1);

    const conflict = await postJson("/v1/sync/push", {
      ...push,
      request_id: "req_conflict",
      request_fingerprint:
        "sha-256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    });
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as SyncPushResult).status).toBe("idempotency_conflict");
    expect(await countRows("canonical_events")).toBe(1);

    const metadata = decodeHeader<ProtectedValueMetadata>(
      await protectedRead("HEAD", intent.protected_value_id, intent),
      "X-CarpeOS-Protected-Metadata",
    );
    expect(metadata.orphan_status).toBe("linked");
    expect(metadata.linked_event_ids).toEqual([event.event_id]);
  });

  it("rejects mixed trust zones before sequence allocation", async () => {
    const event = buildExternalEvent("evt_mixedzone001", 1, OTHER_TRUST_ZONE_ID);
    const push = buildPush({ event, trustZoneId: TRUST_ZONE_ID });

    const response = await postJson("/v1/sync/push", push);
    expect(response.status).toBe(400);
    expect(await countRows("zone_counters")).toBe(0);
  });

  it("allocates unique monotonic same-zone sequences for concurrent pushes", async () => {
    const pushes = Array.from({ length: 6 }, (_, index) =>
      postJson(
        "/v1/sync/push",
        buildPush({
          event: buildExternalEvent(`evt_concurrent00${index + 1}`, index + 1),
          idempotencyKey: `idem_concurrent_${String(index + 1).padStart(16, "0")}`,
          requestId: `req_concurrent_${index + 1}`,
        }),
      ),
    );

    const responses = await Promise.all(pushes);
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200, 200]);

    const rows = await DB.prepare(
      "SELECT zone_sequence FROM canonical_events WHERE trust_zone_id = ?1 ORDER BY zone_sequence ASC",
    )
      .bind(TRUST_ZONE_ID)
      .all<{ zone_sequence: number }>();
    expect(rows.results?.map((row) => row.zone_sequence)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("paginates events and erasures through one zone sequence stream", async () => {
    await postJson(
      "/v1/sync/push",
      buildPush({
        event: buildExternalEvent("evt_page000001", 1),
        idempotencyKey: "idem_page_0000000000000001",
      }),
    );
    await postJson(
      "/v1/sync/push",
      buildPush({
        erasure: buildErasure("era_page000001"),
        idempotencyKey: "idem_page_0000000000000002",
        requestId: "req_page_2",
      }),
    );
    await postJson(
      "/v1/sync/push",
      buildPush({
        event: buildExternalEvent("evt_page000002", 3),
        idempotencyKey: "idem_page_0000000000000003",
      }),
    );

    const page1 = (await (
      await postJson("/v1/sync/pull", {
        schema_version: "v1",
        client_id: CLIENT_ID,
        trust_zone_id: TRUST_ZONE_ID,
        limit: 2,
      })
    ).json()) as SyncPullResult;
    expect(page1.has_more).toBe(true);
    expect(page1.after_sequence).toBe(2);
    expect(page1.events.map((event) => event.zone_sequence)).toEqual([1]);
    expect(page1.erasures.map((erasure) => erasure.zone_sequence)).toEqual([2]);

    const page2 = (await (
      await postJson("/v1/sync/pull", {
        schema_version: "v1",
        client_id: CLIENT_ID,
        trust_zone_id: TRUST_ZONE_ID,
        after_sequence: page1.after_sequence,
        limit: 2,
      })
    ).json()) as SyncPullResult;
    expect(page2.has_more).toBe(false);
    expect(page2.events.map((event) => event.zone_sequence)).toEqual([3]);

    const recordedAfter = (await (
      await postJson("/v1/sync/pull", {
        schema_version: "v1",
        client_id: CLIENT_ID,
        trust_zone_id: TRUST_ZONE_ID,
        recorded_after: "2026-07-29T00:02:00Z",
        limit: 10,
      })
    ).json()) as SyncPullResult;
    expect(recordedAfter.events.map((event) => event.event_id)).toEqual(["evt_page000002"]);
  });

  it("validates erasure method and target kind before acceptance", async () => {
    const invalidErasure = buildErasure("era_invalid001", "projection_delete", "event");
    const response = await postJson(
      "/v1/sync/push",
      buildPush({ erasure: invalidErasure, idempotencyKey: "idem_invalid_0000000000001" }),
    );

    expect(response.status).toBe(400);
    expect(await countRows("erasure_ledger")).toBe(0);
  });
});

async function seedAuthorization(
  clientId: string,
  trustZoneId: string,
  bearerCredential: string,
): Promise<void> {
  await DB.prepare(
    `
      INSERT INTO client_authorizations (client_id, trust_zone_id, token_hash_sha256)
      VALUES (?1, ?2, ?3)
    `,
  )
    .bind(clientId, trustZoneId, await sha256Hex(bearerCredential))
    .run();
}

async function postJson(
  pathname: string,
  body: unknown,
  headers: Record<string, string> = authHeaders(),
): Promise<Response> {
  return worker.fetch(
    new Request(`https://sync.test${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    env as never,
  );
}

async function uploadProtectedValue(
  intent: ProtectedValueUploadIntent,
  bytes: Uint8Array,
): Promise<Response> {
  return worker.fetch(
    new Request(`https://sync.test/v1/sync/protected-values/${intent.protected_value_id}`, {
      method: "PUT",
      headers: {
        ...authHeaders(),
        "X-CarpeOS-Client-Id": CLIENT_ID,
        "X-CarpeOS-Upload-Intent": encodeBase64UrlJson(intent),
      },
      body: toArrayBuffer(bytes),
    }),
    env as never,
  );
}

async function protectedRead(
  method: "HEAD" | "GET",
  protectedValueId: string,
  intent: ProtectedValueUploadIntent,
): Promise<Response> {
  return worker.fetch(
    new Request(`https://sync.test/v1/sync/protected-values/${protectedValueId}`, {
      method,
      headers: {
        ...authHeaders(),
        "X-CarpeOS-Client-Id": CLIENT_ID,
        "X-CarpeOS-Trust-Zone-Id": intent.trust_zone_id,
        "X-CarpeOS-Protected-Digest": intent.original_ciphertext_digest.value,
      },
    }),
    env as never,
  );
}

async function runSqlStatements(sql: string): Promise<void> {
  for (const statement of sql
    .split(";")
    .map((item) => item.trim().replaceAll(/\s+/g, " "))
    .filter((item) => item.length > 0)) {
    await DB.exec(`${statement};`);
  }
}

function authHeaders(bearerCredential = SYNTHETIC_BEARER_CREDENTIAL): Record<string, string> {
  return { Authorization: `Bearer ${bearerCredential}` };
}

function buildPush(input: {
  event?: CanonicalEvent;
  erasure?: ErasureLedgerRecord;
  receipt?: ProtectedValueUploadReceipt;
  requestId?: string;
  idempotencyKey?: string;
  trustZoneId?: string;
}): SyncPushRequest {
  const record = input.event ?? input.erasure;
  const id = input.event?.event_id ?? input.erasure?.erasure_id ?? "record_missing";
  const idempotencyKey =
    input.idempotencyKey ?? `idem_${id.replace(/[^A-Za-z0-9_-]/g, "_")}_000000000000`;
  const base: Omit<SyncPushRequest, "events" | "erasures"> = {
    schema_version: "v1",
    request_id: input.requestId ?? `req_${id.replace(/[^a-z0-9_:-]/g, "_")}`,
    client_id: CLIENT_ID,
    trust_zone_id: input.trustZoneId ?? record?.trust_zone.trust_zone_id ?? TRUST_ZONE_ID,
    idempotency_key: idempotencyKey,
    request_fingerprint: fingerprint(idempotencyKey, id),
    ...(input.receipt === undefined ? {} : { protected_value_receipts: [input.receipt] }),
  };
  if (input.event !== undefined) {
    return { ...base, events: [input.event], erasures: [] };
  }
  if (input.erasure !== undefined) {
    return { ...base, events: [], erasures: [input.erasure] };
  }
  throw new Error("buildPush requires one event or erasure");
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
    uploaded_at: "2026-07-29T00:00:00Z",
    status,
    upload_receipt_id: `rcpt_${intent.protected_value_id.slice(3)}_${intent.original_ciphertext_digest.value.slice(0, 16)}`,
  };
}

function buildExternalEvent(
  eventId: string,
  minute: number,
  trustZoneId = TRUST_ZONE_ID,
): CanonicalEvent {
  return {
    schema_version: "v1",
    event_id: eventId,
    event_type: "EvidenceArtifact",
    subject_ref: "subject_test",
    valid_time: { start: NOW, end: null },
    recorded_time: { start: `2026-07-29T00:${String(minute).padStart(2, "0")}:00Z`, end: null },
    lifecycle_status: "active",
    epistemic_authority: "observed",
    trust_zone: { trust_zone_id: trustZoneId, isolation: "user_cloud" },
    provenance: [{ ref_type: "external", ref_id: "external_test", relationship: "derived_from" }],
    idempotency_key: `idem_event_${eventId.slice(4)}0000000000`,
    request_fingerprint: fingerprint("event", eventId),
    payload: {
      artifact_id: `art_${eventId.slice(4)}0000`,
      kind: "message",
      media_type: "text/plain",
      content_ref: {
        ref_type: "external_uri",
        uri: `https://example.invalid/${eventId}`,
        digest: {
          algorithm: "sha-256",
          value: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
        visibility: "public",
        reachability: "online",
      },
    },
  };
}

function buildProtectedEvent(
  eventId: string,
  minute: number,
  intent: ProtectedValueUploadIntent,
): CanonicalEvent<"EvidenceArtifact"> {
  const base = buildExternalEvent(
    eventId,
    minute,
    intent.trust_zone_id,
  ) as CanonicalEvent<"EvidenceArtifact">;
  return {
    ...base,
    payload: {
      artifact_id: `art_${eventId.slice(4)}0000`,
      kind: "document",
      media_type: "application/octet-stream",
      content_ref: {
        ref_type: "protected_value",
        protected_value_id: intent.protected_value_id,
        vault_ref: intent.vault_ref,
        key_ref: intent.key_ref,
        encrypted_blob: {
          algorithm: "aes-256-gcm",
          nonce_ref: intent.nonce_ref ?? "nonce_ref",
          tag_ref: intent.tag_ref ?? "tag_ref",
          digest: intent.original_ciphertext_digest,
          size_bytes: intent.original_ciphertext_size_bytes,
        },
      },
    },
  } satisfies CanonicalEvent<"EvidenceArtifact">;
}

function buildErasure(
  erasureId: string,
  method: ErasureLedgerRecord["method"] = "tombstone",
  targetKind: ErasureLedgerRecord["target_ref"]["target_kind"] = "event",
): ErasureLedgerRecord {
  return {
    schema_version: "v1",
    erasure_id: erasureId,
    target_ref: {
      target_kind: targetKind,
      target_id: targetKind === "event" ? "evt_page000001" : "projection_test",
      reason: "synthetic cleanup",
    } as ErasureLedgerRecord["target_ref"],
    requested_at: "2026-07-29T00:02:00Z",
    completed_at: null,
    method,
    actor_ref: "actor_test",
    trust_zone: { trust_zone_id: TRUST_ZONE_ID, isolation: "user_cloud" },
    evidence_refs: [{ ref_type: "external", ref_id: "external_erasure", relationship: "supports" }],
  } as ErasureLedgerRecord;
}

async function buildProtectedUpload(protectedValueId: string): Promise<{
  intent: ProtectedValueUploadIntent;
  bytes: Uint8Array;
}> {
  const bytes = new TextEncoder().encode(`synthetic ciphertext for ${protectedValueId}`);
  const digest = await sha256Hex(bytes);
  const intent: ProtectedValueUploadIntent = {
    schema_version: "v1",
    intent_type: "protected_value_upload",
    protected_value_id: protectedValueId,
    trust_zone_id: TRUST_ZONE_ID,
    vault_ref: "vault_test",
    key_ref: "key_test",
    object_key: `protected-values/${TRUST_ZONE_ID}/${protectedValueId}/${digest}`,
    encryption_algorithm: "aes-256-gcm",
    encoding: "base64url",
    ciphertext_nonce: "bm9uY2VfdGVzdA",
    ciphertext_auth_tag: "dGFnX3Rlc3Q",
    original_ciphertext_digest: { algorithm: "sha-256", value: digest },
    original_ciphertext_size_bytes: bytes.byteLength,
    nonce_ref: "nonce_test",
    tag_ref: "tag_test",
    wrapped_device_key: {
      schema_version: "v1",
      envelope_version: "wrapped-device-key/v1",
      wrapping_algorithm: "aes-256-gcm",
      encoding: "base64url",
      wrap_key_ref: "wrap_key_test",
      wrapped_key_ref: "wrapped_key_test",
      wrap_nonce: "d3JhcF9ub25jZQ",
      wrap_auth_tag: "d3JhcF90YWc",
      wrapped_key_ciphertext: "d3JhcHBlZF9rZXk",
      wrapped_key_digest: {
        algorithm: "sha-256",
        value: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      wrapped_key_size_bytes: 24,
      aad: {
        trust_zone_id: TRUST_ZONE_ID,
        protected_value_id: protectedValueId,
        key_ref: "key_test",
      },
    },
  };
  return { intent, bytes };
}

async function countRows(tableName: string): Promise<number> {
  const row = await DB.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).first<{
    count: number;
  }>();
  return row?.count ?? 0;
}

async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fingerprint(seed: string, suffix: string): `sha-256:${string}` {
  const padded = `${seed}_${suffix}`.padEnd(64, "0").slice(0, 64);
  return `sha-256:${padded.replaceAll(/[^A-Fa-f0-9]/g, "a")}`;
}

function encodeBase64UrlJson(value: unknown): string {
  return btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeHeader<T>(response: Response, header: string): T {
  const value = response.headers.get(header);
  if (value === null) {
    throw new Error(`Missing ${header} response header`);
  }
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return JSON.parse(atob(padded)) as T;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
