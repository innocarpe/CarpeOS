import {
  SCHEMA_VERSION,
  validateConformance,
  type CanonicalEvent,
  type ErasureLedgerRecord,
  type ProtectedValueMetadata,
  type ProtectedValueRef,
  type ProtectedValueUploadIntent,
  type ProtectedValueUploadReceipt,
  type SyncError,
  type SyncErrorItem,
  type SyncPullRequest,
  type SyncPullResult,
  type SyncPushRequest,
  type SyncPushResult,
} from "@carpeos/schema";

export type Env = {
  DB: D1Database;
  PROTECTED_VALUES: R2Bucket;
  CARPEOS_ENV?: string;
};

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const PROTECTED_METADATA_HEADER = "X-CarpeOS-Protected-Metadata";
const UPLOAD_INTENT_HEADER = "X-CarpeOS-Upload-Intent";
const CLIENT_ID_HEADER = "X-CarpeOS-Client-Id";
const TRUST_ZONE_HEADER = "X-CarpeOS-Trust-Zone-Id";
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const textEncoder = new TextEncoder();

type HttpStatus = 400 | 401 | 403 | 404 | 405 | 409 | 422 | 500;

type SyncRequestRow = {
  request_id: string;
  request_fingerprint: string;
  result_json: string;
};

type ProtectedUploadRow = {
  protected_value_id: string;
  trust_zone_id: string;
  object_key: string;
  original_ciphertext_digest_algorithm: string;
  original_ciphertext_digest_value: string;
  original_ciphertext_size_bytes: number;
  encryption_algorithm: "aes-256-gcm";
  encoding: "base64url";
  ciphertext_nonce: string;
  ciphertext_auth_tag: string;
  nonce_ref: string | null;
  tag_ref: string | null;
  vault_ref: string;
  key_ref: string;
  wrapped_device_key_json: string;
  upload_receipt_id: string;
  uploaded_at: string;
  status: "orphaned" | "linked";
};

type PullRow = {
  record_kind: "event" | "erasure";
  zone_sequence: number;
  record_id: string;
  recorded_sort: string;
  payload_json: string;
};

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      console.error(error);
      return jsonError(500, "internal_error", "Internal sync worker error");
    }
  },
};

export default worker;

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/v1/sync/push") {
    if (request.method !== "POST") {
      return methodNotAllowed();
    }
    return handlePush(request, env);
  }

  if (url.pathname === "/v1/sync/pull") {
    if (request.method !== "POST") {
      return methodNotAllowed();
    }
    return handlePull(request, env);
  }

  const protectedValueMatch = url.pathname.match(
    /^\/v1\/sync\/protected-values\/(pv_[a-z0-9][a-z0-9_-]{7,127})$/,
  );

  if (protectedValueMatch?.[1] !== undefined) {
    if (request.method === "PUT") {
      return handleProtectedValuePut(request, env, protectedValueMatch[1]);
    }

    if (request.method === "HEAD" || request.method === "GET") {
      return handleProtectedValueRead(request, env, protectedValueMatch[1]);
    }

    return methodNotAllowed();
  }

  return jsonError(404, "not_found", "Sync route not found");
}

async function handlePush(request: Request, env: Env): Promise<Response> {
  const body = await readJson<SyncPushRequest>(request);
  if (!body.ok) {
    return jsonError(400, "invalid_schema", body.error);
  }

  const requestBody = body.value;
  const schema = validateConformance("syncApi", requestBody);
  if (!schema.valid) {
    return jsonError(400, "invalid_schema", schema.errors.join("; "));
  }

  const auth = await authorize(request, env, requestBody.client_id, requestBody.trust_zone_id);
  if (!auth.ok) {
    return auth.response;
  }

  const semanticError = validateSingleRecordPush(requestBody);
  if (semanticError !== undefined) {
    return jsonError(422, semanticError.code, semanticError.message, semanticError.ref_id);
  }

  const existing = await getSyncRequest(
    env,
    requestBody.trust_zone_id,
    requestBody.idempotency_key,
  );
  if (existing !== null) {
    return replayOrConflict(existing, requestBody);
  }

  const event = requestBody.events[0];
  const erasure = requestBody.erasures[0];
  const protectedRef = event === undefined ? undefined : getProtectedValueRef(event);
  const receipt =
    protectedRef === undefined ? undefined : requestBody.protected_value_receipts?.[0];

  if (protectedRef !== undefined) {
    const receiptValidation = await validateProtectedReceipt(
      env,
      requestBody,
      protectedRef,
      receipt,
    );
    if (receiptValidation !== undefined) {
      return jsonError(
        422,
        receiptValidation.code,
        receiptValidation.message,
        receiptValidation.ref_id,
      );
    }
  }

  try {
    if (event !== undefined) {
      await acceptEvent(env, requestBody, event, protectedRef);
    } else if (erasure !== undefined) {
      await acceptErasure(env, requestBody, erasure);
    }
  } catch (error) {
    const reread = await getSyncRequest(
      env,
      requestBody.trust_zone_id,
      requestBody.idempotency_key,
    );
    if (reread !== null) {
      return replayOrConflict(reread, requestBody);
    }

    if (isD1ConstraintError(error)) {
      return jsonError(
        409,
        "idempotency_conflict",
        "Push conflicted with an existing canonical row",
      );
    }

    throw error;
  }

  const accepted = await getSyncRequest(
    env,
    requestBody.trust_zone_id,
    requestBody.idempotency_key,
  );
  if (accepted === null) {
    return jsonError(500, "internal_error", "Accepted push response was not persisted");
  }

  return jsonResponse(parseJson<SyncPushResult>(accepted.result_json), 200);
}

async function handlePull(request: Request, env: Env): Promise<Response> {
  const body = await readJson<SyncPullRequest>(request);
  if (!body.ok) {
    return jsonError(400, "invalid_schema", body.error);
  }

  const pull = body.value;
  const schema = validateConformance("syncApi", pull);
  if (!schema.valid) {
    return jsonError(400, "invalid_schema", schema.errors.join("; "));
  }

  const auth = await authorize(request, env, pull.client_id, pull.trust_zone_id);
  if (!auth.ok) {
    return auth.response;
  }

  const afterSequence = pull.after_sequence ?? 0;
  const recordedAfter = pull.recorded_after ?? "0000-01-01T00:00:00Z";
  const limit = pull.limit;
  const rows = await env.DB.prepare(
    `
      SELECT 'event' AS record_kind, zone_sequence, event_id AS record_id,
             recorded_time_start AS recorded_sort, event_json AS payload_json
        FROM canonical_events
       WHERE trust_zone_id = ?1
         AND zone_sequence > ?2
         AND recorded_time_start > ?3
      UNION ALL
      SELECT 'erasure' AS record_kind, zone_sequence, erasure_id AS record_id,
             requested_at AS recorded_sort, erasure_json AS payload_json
        FROM erasure_ledger
       WHERE trust_zone_id = ?1
         AND zone_sequence > ?2
         AND requested_at > ?3
      ORDER BY zone_sequence ASC, record_id ASC
      LIMIT ?4
    `,
  )
    .bind(pull.trust_zone_id, afterSequence, recordedAfter, limit + 1)
    .all<PullRow>();

  const pageRows = (rows.results ?? []).slice(0, limit);
  const events: CanonicalEvent[] = [];
  const erasures: ErasureLedgerRecord[] = [];

  for (const row of pageRows) {
    if (row.record_kind === "event") {
      events.push(parseJson<CanonicalEvent>(row.payload_json));
    } else {
      erasures.push(parseJson<ErasureLedgerRecord>(row.payload_json));
    }
  }

  const lastSequence = pageRows.at(-1)?.zone_sequence;
  const result: SyncPullResult = {
    schema_version: SCHEMA_VERSION,
    events,
    erasures,
    has_more: (rows.results ?? []).length > limit,
    ...(lastSequence === undefined
      ? {}
      : { cursor: `after_sequence:${lastSequence}`, after_sequence: lastSequence }),
  };

  return jsonResponse(result, 200);
}

async function handleProtectedValuePut(
  request: Request,
  env: Env,
  routeProtectedValueId: string,
): Promise<Response> {
  const clientId = request.headers.get(CLIENT_ID_HEADER);
  if (clientId === null) {
    return jsonError(401, "unauthorized", "Missing protected-value client header");
  }

  const intentHeader = request.headers.get(UPLOAD_INTENT_HEADER);
  if (intentHeader === null) {
    return jsonError(400, "invalid_schema", "Missing protected-value upload intent");
  }

  const intent = decodeBase64UrlJson<ProtectedValueUploadIntent>(intentHeader);
  if (!intent.ok) {
    return jsonError(400, "invalid_schema", intent.error);
  }

  const schema = validateConformance("syncApi", intent.value);
  if (!schema.valid) {
    return jsonError(400, "invalid_schema", schema.errors.join("; "));
  }

  if (intent.value.protected_value_id !== routeProtectedValueId) {
    return jsonError(
      422,
      "protected_value_digest_mismatch",
      "Route protected_value_id differs from upload intent",
    );
  }

  const auth = await authorize(request, env, clientId, intent.value.trust_zone_id);
  if (!auth.ok) {
    return auth.response;
  }

  const expectedObjectKey = deterministicObjectKey(intent.value);
  if (intent.value.object_key !== expectedObjectKey) {
    return jsonError(
      422,
      "protected_value_digest_mismatch",
      "Upload intent object_key is not deterministic",
    );
  }

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_BODY_BYTES) {
    return jsonError(
      422,
      "protected_value_digest_mismatch",
      "Protected value body size is outside accepted bounds",
    );
  }

  const digest = await sha256Hex(bytes);
  if (
    digest !== intent.value.original_ciphertext_digest.value.toLowerCase() ||
    bytes.byteLength !== intent.value.original_ciphertext_size_bytes
  ) {
    return jsonError(
      422,
      "protected_value_digest_mismatch",
      "Protected value body does not match intent digest or size",
    );
  }

  const existingObject = await env.PROTECTED_VALUES.head(intent.value.object_key);
  if (existingObject !== null) {
    const metadata = readObjectMetadata(existingObject);
    if (metadata === undefined) {
      return jsonError(
        409,
        "protected_value_digest_mismatch",
        "Existing protected value lacks CarpeOS metadata",
      );
    }
    if (!metadataMatchesIntent(metadata, intent.value)) {
      return jsonError(
        409,
        "protected_value_digest_mismatch",
        "Existing protected value differs from upload intent",
      );
    }
    const stored = await getProtectedUpload(
      env,
      intent.value.protected_value_id,
      intent.value.trust_zone_id,
    );
    if (stored !== null && !storedUploadMatchesIntent(stored, intent.value)) {
      return jsonError(
        409,
        "protected_value_digest_mismatch",
        "Existing protected value receipt differs from upload intent",
      );
    }

    const receipt = await upsertProtectedValueReceipt(env, intent.value, "already_exists");
    return jsonResponse(receipt, 200);
  }

  const metadata = metadataFromIntent(intent.value, [], "orphaned", nowIso());
  await env.PROTECTED_VALUES.put(intent.value.object_key, bytes, {
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata: { carpeos_metadata: encodeBase64UrlJson(metadata) },
  });

  const receipt = await upsertProtectedValueReceipt(
    env,
    intent.value,
    "uploaded",
    metadata.uploaded_at,
  );
  return jsonResponse(receipt, 200);
}

async function handleProtectedValueRead(
  request: Request,
  env: Env,
  protectedValueId: string,
): Promise<Response> {
  const clientId = request.headers.get(CLIENT_ID_HEADER);
  if (clientId === null) {
    return jsonError(401, "unauthorized", "Missing protected-value client header");
  }

  const trustZoneId = explicitTrustZoneId(request);
  if (trustZoneId === undefined) {
    return jsonError(401, "unauthorized", "Missing protected-value trust-zone header");
  }

  const auth = await authorize(request, env, clientId, trustZoneId);
  if (!auth.ok) {
    return auth.response;
  }

  const stored = await getProtectedUpload(env, protectedValueId, trustZoneId);
  const objectKey = stored?.object_key ?? objectKeyFromHeaders(request, protectedValueId);
  if (objectKey === undefined) {
    return jsonError(
      404,
      "protected_value_missing",
      "Protected value receipt was not found",
      protectedValueId,
    );
  }

  const object =
    request.method === "HEAD"
      ? await env.PROTECTED_VALUES.head(objectKey)
      : await env.PROTECTED_VALUES.get(objectKey);
  if (object === null) {
    return jsonError(
      404,
      "protected_value_missing",
      "Protected value object was not found",
      protectedValueId,
    );
  }

  const objectMetadata = readObjectMetadata(object);
  if (objectMetadata === undefined || objectMetadata.protected_value_id !== protectedValueId) {
    return jsonError(
      422,
      "protected_value_digest_mismatch",
      "Protected value object metadata is invalid",
      protectedValueId,
    );
  }
  if (objectMetadata.trust_zone_id !== trustZoneId) {
    return jsonError(
      404,
      "protected_value_missing",
      "Protected value object was not found for this trust zone",
      protectedValueId,
    );
  }

  const metadata = stored === null ? objectMetadata : await metadataFromStoredUpload(env, stored);

  if (stored === null) {
    await upsertProtectedValueReceiptFromMetadata(env, objectMetadata, "already_exists");
  }

  const headers = new Headers();
  headers.set(PROTECTED_METADATA_HEADER, encodeBase64UrlJson(metadata));
  headers.set("Cache-Control", "no-store");

  if (request.method === "HEAD") {
    headers.set("Content-Length", String(metadata.original_ciphertext_size_bytes));
    return new Response(null, { status: 200, headers });
  }

  return new Response((object as R2ObjectBody).body, { status: 200, headers });
}

async function acceptEvent(
  env: Env,
  request: SyncPushRequest,
  event: CanonicalEvent,
  protectedRef: ProtectedValueRef | undefined,
): Promise<void> {
  const eventId = event.event_id;
  const resultJsonExpression = `
    json_object(
      'schema_version', 'v1',
      'request_id', ?2,
      'status', 'accepted',
      'accepted_event_ids', json_array(?7),
      'accepted_erasure_ids', json_array(),
      'zone_sequences', json_array(json_object('trust_zone_id', ?1, 'last_sequence', (SELECT last_sequence FROM zone_counters WHERE trust_zone_id = ?1))),
      'errors', json_array()
    )
  `;

  const sequencedEventJson = `
    json_set(?8, '$.zone_sequence', (SELECT last_sequence FROM zone_counters WHERE trust_zone_id = ?1))
  `;

  const statements = [
    env.DB.prepare(
      `
        INSERT INTO sync_requests (
          trust_zone_id, idempotency_key, request_id, client_id,
          request_fingerprint, status, result_json
        )
        VALUES (?1, ?3, ?2, ?4, ?5, 'pending', '{}')
      `,
    ).bind(
      request.trust_zone_id,
      request.request_id,
      request.idempotency_key,
      request.client_id,
      request.request_fingerprint,
    ),
    env.DB.prepare(
      `
        INSERT INTO zone_counters (trust_zone_id, last_sequence, updated_at)
        VALUES (?1, 1, ?6)
        ON CONFLICT(trust_zone_id)
        DO UPDATE SET last_sequence = last_sequence + 1, updated_at = ?6
      `,
    ).bind(
      request.trust_zone_id,
      request.request_id,
      request.idempotency_key,
      request.client_id,
      request.request_fingerprint,
      nowIso(),
    ),
    env.DB.prepare(
      `
        INSERT INTO canonical_events (
          trust_zone_id, zone_sequence, event_id, idempotency_key,
          request_fingerprint, recorded_time_start, event_json
        )
        VALUES (
          ?1,
          (SELECT last_sequence FROM zone_counters WHERE trust_zone_id = ?1),
          ?7,
          ?3,
          ?5,
          ?9,
          ${sequencedEventJson}
        )
      `,
    ).bind(
      request.trust_zone_id,
      request.request_id,
      request.idempotency_key,
      request.client_id,
      request.request_fingerprint,
      nowIso(),
      eventId,
      JSON.stringify(event),
      event.recorded_time.start,
    ),
  ];

  if (protectedRef !== undefined) {
    statements.push(
      env.DB.prepare(
        `
          UPDATE protected_value_uploads
             SET status = 'linked', linked_at = ?6
           WHERE protected_value_id = ?10
             AND trust_zone_id = ?1
             AND original_ciphertext_digest_value = ?11
             AND original_ciphertext_size_bytes = ?12
        `,
      ).bind(
        request.trust_zone_id,
        request.request_id,
        request.idempotency_key,
        request.client_id,
        request.request_fingerprint,
        nowIso(),
        eventId,
        JSON.stringify(event),
        event.recorded_time.start,
        protectedRef.protected_value_id,
        protectedRef.encrypted_blob.digest.value.toLowerCase(),
        protectedRef.encrypted_blob.size_bytes,
      ),
      env.DB.prepare(
        `
          INSERT INTO protected_value_links (protected_value_id, trust_zone_id, event_id, linked_at)
          VALUES (?10, ?1, ?7, ?6)
        `,
      ).bind(
        request.trust_zone_id,
        request.request_id,
        request.idempotency_key,
        request.client_id,
        request.request_fingerprint,
        nowIso(),
        eventId,
        JSON.stringify(event),
        event.recorded_time.start,
        protectedRef.protected_value_id,
      ),
    );
  }

  statements.push(
    env.DB.prepare(
      `
        UPDATE sync_requests
           SET status = 'accepted',
               accepted_event_ids_json = json_array(?7),
               accepted_erasure_ids_json = json_array(),
               result_json = ${resultJsonExpression},
               completed_at = ?6
         WHERE trust_zone_id = ?1
           AND idempotency_key = ?3
      `,
    ).bind(
      request.trust_zone_id,
      request.request_id,
      request.idempotency_key,
      request.client_id,
      request.request_fingerprint,
      nowIso(),
      eventId,
    ),
  );

  await env.DB.batch(statements);
}

async function acceptErasure(
  env: Env,
  request: SyncPushRequest,
  erasure: ErasureLedgerRecord,
): Promise<void> {
  const erasureId = erasure.erasure_id;
  const resultJsonExpression = `
    json_object(
      'schema_version', 'v1',
      'request_id', ?2,
      'status', 'accepted',
      'accepted_event_ids', json_array(),
      'accepted_erasure_ids', json_array(?7),
      'zone_sequences', json_array(json_object('trust_zone_id', ?1, 'last_sequence', (SELECT last_sequence FROM zone_counters WHERE trust_zone_id = ?1))),
      'errors', json_array()
    )
  `;
  const sequencedErasureJson = `
    json_set(?8, '$.zone_sequence', (SELECT last_sequence FROM zone_counters WHERE trust_zone_id = ?1))
  `;

  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO sync_requests (
          trust_zone_id, idempotency_key, request_id, client_id,
          request_fingerprint, status, result_json
        )
        VALUES (?1, ?3, ?2, ?4, ?5, 'pending', '{}')
      `,
    ).bind(
      request.trust_zone_id,
      request.request_id,
      request.idempotency_key,
      request.client_id,
      request.request_fingerprint,
    ),
    env.DB.prepare(
      `
        INSERT INTO zone_counters (trust_zone_id, last_sequence, updated_at)
        VALUES (?1, 1, ?6)
        ON CONFLICT(trust_zone_id)
        DO UPDATE SET last_sequence = last_sequence + 1, updated_at = ?6
      `,
    ).bind(
      request.trust_zone_id,
      request.request_id,
      request.idempotency_key,
      request.client_id,
      request.request_fingerprint,
      nowIso(),
    ),
    env.DB.prepare(
      `
        INSERT INTO erasure_ledger (
          trust_zone_id, zone_sequence, erasure_id, idempotency_key,
          requested_at, erasure_json
        )
        VALUES (
          ?1,
          (SELECT last_sequence FROM zone_counters WHERE trust_zone_id = ?1),
          ?7,
          ?3,
          ?9,
          ${sequencedErasureJson}
        )
      `,
    ).bind(
      request.trust_zone_id,
      request.request_id,
      request.idempotency_key,
      request.client_id,
      request.request_fingerprint,
      nowIso(),
      erasureId,
      JSON.stringify(erasure),
      erasure.requested_at,
    ),
    env.DB.prepare(
      `
        UPDATE sync_requests
           SET status = 'accepted',
               accepted_event_ids_json = json_array(),
               accepted_erasure_ids_json = json_array(?7),
               result_json = ${resultJsonExpression},
               completed_at = ?6
         WHERE trust_zone_id = ?1
           AND idempotency_key = ?3
      `,
    ).bind(
      request.trust_zone_id,
      request.request_id,
      request.idempotency_key,
      request.client_id,
      request.request_fingerprint,
      nowIso(),
      erasureId,
    ),
  ]);
}

async function validateProtectedReceipt(
  env: Env,
  request: SyncPushRequest,
  protectedRef: ProtectedValueRef,
  receipt: ProtectedValueUploadReceipt | undefined,
): Promise<SyncErrorItem | undefined> {
  if (receipt === undefined) {
    return {
      code: "protected_value_missing",
      message: "Protected event has no upload receipt",
      ref_id: protectedRef.protected_value_id,
    };
  }

  if (
    receipt.trust_zone_id !== request.trust_zone_id ||
    receipt.protected_value_id !== protectedRef.protected_value_id ||
    receipt.original_ciphertext_digest.value.toLowerCase() !==
      protectedRef.encrypted_blob.digest.value.toLowerCase() ||
    receipt.original_ciphertext_size_bytes !== protectedRef.encrypted_blob.size_bytes
  ) {
    return {
      code: "protected_value_digest_mismatch",
      message: "Protected value receipt does not match event protected reference",
      ref_id: protectedRef.protected_value_id,
    };
  }

  const stored = await getProtectedUpload(
    env,
    protectedRef.protected_value_id,
    request.trust_zone_id,
  );
  if (stored === null || stored.trust_zone_id !== request.trust_zone_id) {
    return {
      code: "protected_value_missing",
      message: "Protected value upload receipt is missing",
      ref_id: protectedRef.protected_value_id,
    };
  }

  if (
    stored.original_ciphertext_digest_value !==
      protectedRef.encrypted_blob.digest.value.toLowerCase() ||
    stored.original_ciphertext_size_bytes !== protectedRef.encrypted_blob.size_bytes ||
    stored.vault_ref !== protectedRef.vault_ref ||
    stored.key_ref !== protectedRef.key_ref ||
    stored.nonce_ref !== (protectedRef.encrypted_blob.nonce_ref ?? null) ||
    stored.tag_ref !== (protectedRef.encrypted_blob.tag_ref ?? null)
  ) {
    return {
      code: "protected_value_digest_mismatch",
      message: "Stored protected value receipt does not match event protected reference",
      ref_id: protectedRef.protected_value_id,
    };
  }

  const object = await env.PROTECTED_VALUES.head(stored.object_key);
  if (object === null) {
    return {
      code: "protected_value_missing",
      message: "Protected value object is missing",
      ref_id: protectedRef.protected_value_id,
    };
  }
  const metadata = readObjectMetadata(object);
  if (metadata === undefined || !metadataMatchesStoredUpload(metadata, stored)) {
    return {
      code: "protected_value_digest_mismatch",
      message: "Protected value object metadata does not match stored receipt",
      ref_id: protectedRef.protected_value_id,
    };
  }

  return undefined;
}

function replayOrConflict(existing: SyncRequestRow, request: SyncPushRequest): Response {
  if (existing.request_fingerprint === request.request_fingerprint) {
    const accepted = parseJson<SyncPushResult>(existing.result_json);
    const replay: SyncPushResult = {
      ...accepted,
      request_id: request.request_id,
      status: "replay",
      replay_of: request.idempotency_key,
      errors: [{ code: "replay", message: "Idempotent replay returned persisted result" }],
    };
    return jsonResponse(replay, 200);
  }

  const conflict: SyncPushResult = {
    schema_version: SCHEMA_VERSION,
    request_id: request.request_id,
    status: "idempotency_conflict",
    accepted_event_ids: [],
    accepted_erasure_ids: [],
    conflict_with: request.idempotency_key,
    errors: [
      {
        code: "idempotency_conflict",
        message: "Idempotency key already exists with a different request fingerprint",
      },
    ],
  };
  return jsonResponse(conflict, 409);
}

async function authorize(
  request: Request,
  env: Env,
  clientId: string,
  trustZoneId: string,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const authorization = request.headers.get("Authorization");
  if (authorization === null || !authorization.startsWith("Bearer ")) {
    return { ok: false, response: jsonError(401, "unauthorized", "Missing bearer token") };
  }

  const bearerCredential = authorization.slice("Bearer ".length);
  if (bearerCredential.length < 32) {
    return { ok: false, response: jsonError(401, "unauthorized", "Bearer token is too short") };
  }

  const tokenHash = await sha256Hex(bearerCredential);
  const rows = await env.DB.prepare(
    `
      SELECT token_hash_sha256
        FROM client_authorizations
       WHERE client_id = ?1
         AND trust_zone_id = ?2
         AND revoked_at IS NULL
    `,
  )
    .bind(clientId, trustZoneId)
    .all<{ token_hash_sha256: string }>();

  let matched = false;
  for (const row of rows.results ?? []) {
    matched = constantTimeEqualHex(tokenHash, row.token_hash_sha256) || matched;
  }

  if (!matched) {
    const anyZone = await env.DB.prepare(
      `
        SELECT trust_zone_id
          FROM client_authorizations
         WHERE client_id = ?1
           AND token_hash_sha256 = ?2
           AND revoked_at IS NULL
         LIMIT 1
      `,
    )
      .bind(clientId, tokenHash)
      .first<{ trust_zone_id: string }>();

    return {
      ok: false,
      response:
        anyZone === null
          ? jsonError(401, "unauthorized", "Bearer token is invalid")
          : jsonError(403, "unauthorized", "Bearer token is not authorized for this trust zone"),
    };
  }

  return { ok: true };
}

function validateSingleRecordPush(request: SyncPushRequest): SyncErrorItem | undefined {
  const count = request.events.length + request.erasures.length;
  if (count !== 1) {
    return {
      code: "invalid_schema",
      message: "Push requests must contain exactly one event or exactly one erasure",
    };
  }

  const event = request.events[0];
  if (event !== undefined) {
    if (event.trust_zone.trust_zone_id !== request.trust_zone_id) {
      return {
        code: "unauthorized",
        message: "Event trust zone differs from push trust zone",
        ref_id: event.event_id,
      };
    }
    return undefined;
  }

  const erasure = request.erasures[0];
  if (erasure !== undefined && erasure.trust_zone.trust_zone_id !== request.trust_zone_id) {
    return {
      code: "unauthorized",
      message: "Erasure trust zone differs from push trust zone",
      ref_id: erasure.erasure_id,
    };
  }

  return undefined;
}

async function getSyncRequest(
  env: Env,
  trustZoneId: string,
  idempotencyKey: string,
): Promise<SyncRequestRow | null> {
  return env.DB.prepare(
    `
      SELECT request_id, request_fingerprint, result_json
        FROM sync_requests
       WHERE trust_zone_id = ?1
         AND idempotency_key = ?2
       LIMIT 1
    `,
  )
    .bind(trustZoneId, idempotencyKey)
    .first<SyncRequestRow>();
}

async function getProtectedUpload(
  env: Env,
  protectedValueId: string,
  trustZoneId?: string,
): Promise<ProtectedUploadRow | null> {
  return env.DB.prepare(
    `
      SELECT *
        FROM protected_value_uploads
       WHERE protected_value_id = ?1
         AND (?2 IS NULL OR trust_zone_id = ?2)
       LIMIT 1
    `,
  )
    .bind(protectedValueId, trustZoneId ?? null)
    .first<ProtectedUploadRow>();
}

async function upsertProtectedValueReceipt(
  env: Env,
  intent: ProtectedValueUploadIntent,
  status: "uploaded" | "already_exists",
  uploadedAt = nowIso(),
): Promise<ProtectedValueUploadReceipt> {
  const receipt = receiptFromIntent(intent, status, uploadedAt);
  await env.DB.prepare(
    `
      INSERT INTO protected_value_uploads (
        protected_value_id, trust_zone_id, object_key,
        original_ciphertext_digest_algorithm, original_ciphertext_digest_value,
        original_ciphertext_size_bytes, encryption_algorithm, encoding,
        ciphertext_nonce, ciphertext_auth_tag, nonce_ref, tag_ref,
        vault_ref, key_ref, wrapped_device_key_json,
        upload_receipt_id, uploaded_at, status
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, 'orphaned')
      ON CONFLICT(protected_value_id)
      DO UPDATE SET
        upload_receipt_id = excluded.upload_receipt_id,
        uploaded_at = protected_value_uploads.uploaded_at
    `,
  )
    .bind(
      intent.protected_value_id,
      intent.trust_zone_id,
      intent.object_key,
      intent.original_ciphertext_digest.algorithm,
      intent.original_ciphertext_digest.value.toLowerCase(),
      intent.original_ciphertext_size_bytes,
      intent.encryption_algorithm,
      intent.encoding,
      intent.ciphertext_nonce,
      intent.ciphertext_auth_tag,
      intent.nonce_ref ?? null,
      intent.tag_ref ?? null,
      intent.vault_ref,
      intent.key_ref,
      JSON.stringify(intent.wrapped_device_key),
      receipt.upload_receipt_id,
      receipt.uploaded_at,
    )
    .run();
  return receipt;
}

async function upsertProtectedValueReceiptFromMetadata(
  env: Env,
  metadata: ProtectedValueMetadata,
  status: "uploaded" | "already_exists",
): Promise<ProtectedValueUploadReceipt> {
  const intent: ProtectedValueUploadIntent = {
    schema_version: SCHEMA_VERSION,
    intent_type: "protected_value_upload",
    protected_value_id: metadata.protected_value_id,
    trust_zone_id: metadata.trust_zone_id,
    vault_ref: metadata.vault_ref,
    key_ref: metadata.key_ref,
    object_key: metadata.object_key,
    encryption_algorithm: metadata.encryption_algorithm,
    encoding: metadata.encoding,
    ciphertext_nonce: metadata.ciphertext_nonce,
    ciphertext_auth_tag: metadata.ciphertext_auth_tag,
    original_ciphertext_digest: metadata.original_ciphertext_digest,
    original_ciphertext_size_bytes: metadata.original_ciphertext_size_bytes,
    ...(metadata.nonce_ref === undefined ? {} : { nonce_ref: metadata.nonce_ref }),
    ...(metadata.tag_ref === undefined ? {} : { tag_ref: metadata.tag_ref }),
    wrapped_device_key: metadata.wrapped_device_key,
  };
  return upsertProtectedValueReceipt(env, intent, status, metadata.uploaded_at);
}

function receiptFromIntent(
  intent: ProtectedValueUploadIntent,
  status: "uploaded" | "already_exists",
  uploadedAt: string,
): ProtectedValueUploadReceipt {
  return {
    schema_version: SCHEMA_VERSION,
    receipt_type: "protected_value_upload",
    protected_value_id: intent.protected_value_id,
    trust_zone_id: intent.trust_zone_id,
    object_key: intent.object_key,
    original_ciphertext_digest: {
      algorithm: intent.original_ciphertext_digest.algorithm,
      value: intent.original_ciphertext_digest.value.toLowerCase(),
    },
    original_ciphertext_size_bytes: intent.original_ciphertext_size_bytes,
    uploaded_at: uploadedAt,
    status,
    upload_receipt_id: `rcpt_${intent.protected_value_id.slice(3)}_${intent.original_ciphertext_digest.value.slice(0, 16).toLowerCase()}`,
  };
}

function metadataFromIntent(
  intent: ProtectedValueUploadIntent,
  linkedEventIds: string[],
  orphanStatus: "linked" | "orphaned",
  uploadedAt: string,
): ProtectedValueMetadata {
  return {
    schema_version: SCHEMA_VERSION,
    metadata_type: "protected_value",
    protected_value_id: intent.protected_value_id,
    trust_zone_id: intent.trust_zone_id,
    object_key: intent.object_key,
    vault_ref: intent.vault_ref,
    encryption_algorithm: intent.encryption_algorithm,
    encoding: intent.encoding,
    ciphertext_nonce: intent.ciphertext_nonce,
    ciphertext_auth_tag: intent.ciphertext_auth_tag,
    original_ciphertext_digest: {
      algorithm: intent.original_ciphertext_digest.algorithm,
      value: intent.original_ciphertext_digest.value.toLowerCase(),
    },
    original_ciphertext_size_bytes: intent.original_ciphertext_size_bytes,
    ...(intent.nonce_ref === undefined ? {} : { nonce_ref: intent.nonce_ref }),
    ...(intent.tag_ref === undefined ? {} : { tag_ref: intent.tag_ref }),
    key_ref: intent.key_ref,
    wrapped_device_key: intent.wrapped_device_key,
    linked_event_ids: linkedEventIds,
    orphan_status: orphanStatus,
    uploaded_at: uploadedAt,
  };
}

function readObjectMetadata(object: R2Object | R2ObjectBody): ProtectedValueMetadata | undefined {
  const encoded = object.customMetadata?.carpeos_metadata;
  if (encoded === undefined) {
    return undefined;
  }

  const decoded = decodeBase64UrlJson<ProtectedValueMetadata>(encoded);
  return decoded.ok ? decoded.value : undefined;
}

async function metadataFromStoredUpload(
  env: Env,
  stored: ProtectedUploadRow,
): Promise<ProtectedValueMetadata> {
  const links = await env.DB.prepare(
    `
      SELECT event_id
        FROM protected_value_links
       WHERE protected_value_id = ?1
       ORDER BY event_id ASC
    `,
  )
    .bind(stored.protected_value_id)
    .all<{ event_id: string }>();

  return {
    schema_version: SCHEMA_VERSION,
    metadata_type: "protected_value",
    protected_value_id: stored.protected_value_id,
    trust_zone_id: stored.trust_zone_id,
    object_key: stored.object_key,
    vault_ref: stored.vault_ref,
    encryption_algorithm: stored.encryption_algorithm,
    encoding: stored.encoding,
    ciphertext_nonce: stored.ciphertext_nonce,
    ciphertext_auth_tag: stored.ciphertext_auth_tag,
    original_ciphertext_digest: {
      algorithm: "sha-256",
      value: stored.original_ciphertext_digest_value,
    },
    original_ciphertext_size_bytes: stored.original_ciphertext_size_bytes,
    ...(stored.nonce_ref === null ? {} : { nonce_ref: stored.nonce_ref }),
    ...(stored.tag_ref === null ? {} : { tag_ref: stored.tag_ref }),
    key_ref: stored.key_ref,
    wrapped_device_key: parseJson<ProtectedValueMetadata["wrapped_device_key"]>(
      stored.wrapped_device_key_json,
    ),
    linked_event_ids: (links.results ?? []).map((link) => link.event_id),
    orphan_status: stored.status === "linked" ? "linked" : "orphaned",
    uploaded_at: stored.uploaded_at,
  };
}

function metadataMatchesIntent(
  metadata: ProtectedValueMetadata,
  intent: ProtectedValueUploadIntent,
): boolean {
  return (
    metadata.protected_value_id === intent.protected_value_id &&
    metadata.trust_zone_id === intent.trust_zone_id &&
    metadata.object_key === intent.object_key &&
    metadata.vault_ref === intent.vault_ref &&
    metadata.encryption_algorithm === intent.encryption_algorithm &&
    metadata.encoding === intent.encoding &&
    metadata.ciphertext_nonce === intent.ciphertext_nonce &&
    metadata.ciphertext_auth_tag === intent.ciphertext_auth_tag &&
    metadata.nonce_ref === intent.nonce_ref &&
    metadata.tag_ref === intent.tag_ref &&
    metadata.key_ref === intent.key_ref &&
    JSON.stringify(metadata.wrapped_device_key) === JSON.stringify(intent.wrapped_device_key) &&
    metadata.original_ciphertext_digest.value.toLowerCase() ===
      intent.original_ciphertext_digest.value.toLowerCase() &&
    metadata.original_ciphertext_size_bytes === intent.original_ciphertext_size_bytes
  );
}

function metadataMatchesStoredUpload(
  metadata: ProtectedValueMetadata,
  stored: ProtectedUploadRow,
): boolean {
  return (
    metadata.protected_value_id === stored.protected_value_id &&
    metadata.trust_zone_id === stored.trust_zone_id &&
    metadata.object_key === stored.object_key &&
    metadata.vault_ref === stored.vault_ref &&
    metadata.encryption_algorithm === stored.encryption_algorithm &&
    metadata.encoding === stored.encoding &&
    metadata.ciphertext_nonce === stored.ciphertext_nonce &&
    metadata.ciphertext_auth_tag === stored.ciphertext_auth_tag &&
    (metadata.nonce_ref ?? null) === stored.nonce_ref &&
    (metadata.tag_ref ?? null) === stored.tag_ref &&
    metadata.key_ref === stored.key_ref &&
    JSON.stringify(metadata.wrapped_device_key) === stored.wrapped_device_key_json &&
    metadata.original_ciphertext_digest.value.toLowerCase() ===
      stored.original_ciphertext_digest_value &&
    metadata.original_ciphertext_size_bytes === stored.original_ciphertext_size_bytes
  );
}

function storedUploadMatchesIntent(
  stored: ProtectedUploadRow,
  intent: ProtectedValueUploadIntent,
): boolean {
  return (
    stored.protected_value_id === intent.protected_value_id &&
    stored.trust_zone_id === intent.trust_zone_id &&
    stored.object_key === intent.object_key &&
    stored.encryption_algorithm === intent.encryption_algorithm &&
    stored.encoding === intent.encoding &&
    stored.ciphertext_nonce === intent.ciphertext_nonce &&
    stored.ciphertext_auth_tag === intent.ciphertext_auth_tag &&
    stored.nonce_ref === (intent.nonce_ref ?? null) &&
    stored.tag_ref === (intent.tag_ref ?? null) &&
    stored.vault_ref === intent.vault_ref &&
    stored.key_ref === intent.key_ref &&
    stored.wrapped_device_key_json === JSON.stringify(intent.wrapped_device_key) &&
    stored.original_ciphertext_digest_value ===
      intent.original_ciphertext_digest.value.toLowerCase() &&
    stored.original_ciphertext_size_bytes === intent.original_ciphertext_size_bytes
  );
}

function deterministicObjectKey(intent: ProtectedValueUploadIntent): string {
  return `protected-values/${intent.trust_zone_id}/${intent.protected_value_id}/${intent.original_ciphertext_digest.value.toLowerCase()}`;
}

function objectKeyFromHeaders(request: Request, protectedValueId: string): string | undefined {
  const trustZoneId = explicitTrustZoneId(request);
  const digest = request.headers.get("X-CarpeOS-Protected-Digest");
  if (trustZoneId === undefined || digest === null) {
    return undefined;
  }
  return `protected-values/${trustZoneId}/${protectedValueId}/${digest.toLowerCase()}`;
}

function explicitTrustZoneId(request: Request): string | undefined {
  const header = request.headers.get(TRUST_ZONE_HEADER);
  if (header !== null && header.trim().length > 0) {
    return header.trim();
  }
  const query = new URL(request.url).searchParams.get("trust_zone_id");
  return query === null || query.trim().length === 0 ? undefined : query.trim();
}

function getProtectedValueRef(event: CanonicalEvent): ProtectedValueRef | undefined {
  if (event.event_type === "EvidenceArtifact") {
    const payload = event.payload as CanonicalEvent<"EvidenceArtifact">["payload"];
    if (
      payload.content_ref.ref_type === "protected_value" &&
      payload.content_ref.encrypted_blob.algorithm === "aes-256-gcm"
    ) {
      return payload.content_ref;
    }
  }

  return undefined;
}

async function readJson<T>(
  request: Request,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  if (!request.headers.get("Content-Type")?.includes("application/json")) {
    return { ok: false, error: "Content-Type must be application/json" };
  }
  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null && Number(contentLength) > MAX_BODY_BYTES) {
    return { ok: false, error: "Request body is too large" };
  }

  try {
    const text = await request.text();
    if (textEncoder.encode(text).byteLength > MAX_BODY_BYTES) {
      return { ok: false, error: "Request body is too large" };
    }
    return { ok: true, value: JSON.parse(text) as T };
  } catch {
    return { ok: false, error: "Request body must be valid JSON" };
  }
}

function jsonResponse(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": JSON_CONTENT_TYPE,
      "Cache-Control": "no-store",
    },
  });
}

function jsonError(
  status: HttpStatus,
  code: SyncErrorItem["code"],
  message: string,
  refId?: string,
): Response {
  const body: SyncError = {
    schema_version: SCHEMA_VERSION,
    error: {
      code,
      message,
      ...(refId === undefined ? {} : { ref_id: refId }),
    },
  };
  return jsonResponse(body, status);
}

function methodNotAllowed(): Response {
  return new Response(null, { status: 405 });
}

async function sha256Hex(value: string | ArrayBuffer): Promise<string> {
  const data = typeof value === "string" ? textEncoder.encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqualHex(left: string, right: string): boolean {
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  const maxLength = Math.max(normalizedLeft.length, normalizedRight.length);
  let diff = normalizedLeft.length ^ normalizedRight.length;

  for (let index = 0; index < maxLength; index += 1) {
    const leftCode = normalizedLeft.charCodeAt(index) || 0;
    const rightCode = normalizedRight.charCodeAt(index) || 0;
    diff |= leftCode ^ rightCode;
  }

  return diff === 0;
}

function encodeBase64UrlJson(value: unknown): string {
  return btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64UrlJson<T>(
  value: string,
): { ok: true; value: T } | { ok: false; error: string } {
  try {
    const padded = value
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    return { ok: true, value: JSON.parse(atob(padded)) as T };
  } catch {
    return { ok: false, error: "Header must contain base64url JSON" };
  }
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isD1ConstraintError(error: unknown): boolean {
  return error instanceof Error && /constraint|unique/i.test(error.message);
}
