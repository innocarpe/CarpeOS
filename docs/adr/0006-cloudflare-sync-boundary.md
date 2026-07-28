# ADR 0006: Cloudflare Sync Boundary

Status: Accepted for G005 sync implementation

## Context

CarpeOS needs a hosted sync boundary that can connect two personal Macs without
placing plaintext, real project data, device keys, trust-zone sync keys, or
credentials in the public repository or hosted control plane.

G004 already creates local canonical metadata, AES-256-GCM protected values, and
a durable local outbox. G005 adds the first remote service boundary using a
Cloudflare Worker, D1 for canonical sync metadata, and R2 for encrypted blob
storage.

Relevant Cloudflare contracts:

- D1 prepared statements expose `batch()`; Cloudflare documents that batched
  statements are SQL transactions and roll back if one statement fails:
  <https://developers.cloudflare.com/d1/worker-api/d1-database/#batch>
- R2 Workers bindings support object writes and object-level HTTP metadata:
  <https://developers.cloudflare.com/r2/api/workers/workers-api-reference/>
- Wrangler secrets keep Worker secrets outside source control:
  <https://developers.cloudflare.com/workers/wrangler/commands/#secret>
- Workers Vitest integration supports local Worker tests:
  <https://developers.cloudflare.com/workers/testing/vitest-integration/>

## Decision

The sync API has three boundaries:

1. `PUT /v1/sync/protected-values/:protected_value_id` uploads the original
   encrypted ciphertext body to R2 before canonical metadata acceptance.
2. `HEAD` and `GET /v1/sync/protected-values/:protected_value_id` expose
   encrypted object metadata and encrypted bytes only.
3. `POST /v1/sync/push` accepts exactly one canonical event or exactly one
   erasure record per G005 local outbox delivery.

D1 owns idempotency state, replay responses, request fingerprints, per-zone
sequence allocation, protected-value linkage metadata, and pull cursors. R2 owns
only encrypted protected-value ciphertext bytes. The Worker rejects canonical
metadata that references missing or digest/size-mismatched R2 objects.

Sequence assignment is server-only. A push transaction allocates
`zone_sequence`, writes canonical metadata, records replay state, and persists
the normalized response in one D1 acceptance boundary. Replay returns the stored
response without allocating another sequence. An idempotency conflict is rejected
before sequence allocation.

The remote service is not key escrow. A protected-value upload carries:

- original ciphertext digest and size;
- AES-256-GCM ciphertext nonce and authentication tag as base64url strings;
- a wrapped device-key envelope using AES-256-GCM;
- AAD binding `(trust_zone_id, protected_value_id, key_ref)`.

The wrapping key is an out-of-band trust-zone sync key. It is never sent to the
Worker, never stored in D1 or R2, and never committed to Git. Another Mac can
decrypt only after local enrollment with the same trust-zone sync key or an
equivalent local secret.

`protected_value_receipts` on push requests is optional and additive. Existing
G004-compatible requests without the field remain valid. When a client provides
receipts, the Worker verifies receipt trust zone, protected-value identity,
original ciphertext digest, and original ciphertext size against the event.

Pull responses keep the existing string `cursor` for compatibility and may also
include numeric `after_sequence` metadata for clients that want direct
zone-sequence resume state.

## Consequences

- D1 metadata cannot claim an encrypted blob exists unless R2 metadata verifies
  the object by deterministic protected-value identity, digest, and size.
- R2 uploads that succeed before a later D1 failure are orphan-detectable by
  deterministic object key and metadata status.
- Cross-Mac decryptability is real only when local trust-zone key enrollment has
  happened; Cloudflare stores no decrypting secret.
- G005 can be tested with synthetic keys, synthetic ciphertext, and local Worker
  tests without deploying production infrastructure.
- Future batch sync can extend the wire protocol, but G005 local outbox delivery
  is intentionally single-record to keep idempotency and sequence semantics
  deterministic.

## Non-Goals

G005 does not implement:

- Cloudflare production deployment;
- Workers AI, Vectorize, GraphRAG, or retrieval tools;
- key rotation, managed KMS, or hardware-backed enrollment;
- background orphan garbage collection;
- projection rebuilds after erasure.
