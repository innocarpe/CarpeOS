# CarpeOS v1 Sync and Idempotency

Status: planned normative design for the v1 runtime.

This document defines replay, conflict, and sequence semantics for v1 sync.

## Idempotency

Every push request and every canonical event MUST carry an `idempotency_key` and
a `request_fingerprint`. A push request targets exactly one trust zone.
Multi-zone sync is represented as multiple single-zone pushes.

Idempotency identity is the pair `(trust_zone_id, idempotency_key)`. For the
same identity:

- same `idempotency_key` plus same `request_fingerprint` means replay;
- same `idempotency_key` plus different `request_fingerprint` means idempotency
  conflict;
- different `idempotency_key` plus same content MAY be accepted as a distinct
  event unless a higher-level dedupe policy rejects it.

Servers MUST return replay responses without appending duplicate events.
Servers MUST reject idempotency conflicts unless a future migration explicitly
defines a repair flow.

Every event or erasure record in a push batch MUST match the request
`trust_zone_id`. Servers MUST reject a batch that mixes records from another
trust zone before assigning sequences or partially accepting records.

G005 sync push requests are single-record requests for local outbox delivery.
Exactly one canonical event or exactly one erasure record is carried per push.
The optional `protected_value_receipts` field is additive: older G004-compatible
push requests without the field remain valid, and a Worker MAY resolve uploaded
blob state by `protected_value_id`. When receipts are supplied, each receipt MUST
match the event protected-value identity, trust zone, original ciphertext digest,
and original ciphertext size.

## Monotonic Per-Zone Sequence

The accepting server SHOULD assign `zone_sequence` to each accepted
`CanonicalEvent` and MAY assign `zone_sequence` to each accepted
`ErasureLedger` record for deterministic replay and projection repair.

`zone_sequence` MUST be:

- monotonic within one `trust_zone_id`;
- stable after assignment;
- unique within the assigned trust zone;
- usable as a pull cursor.

The accepting server owns sequence assignment. Clients MUST NOT assign new
server sequences. A Cloudflare D1 implementation MUST allocate sequences inside
the same transactional acceptance boundary that records idempotency state and
canonical metadata. Replays MUST return the persisted response without allocating
a new sequence. Conflicts MUST be rejected before sequence allocation.

`zone_sequence` is not a cross-zone global total order. Cross-zone queries MUST
use trust-zone-aware ordering and bitemporal filters.

## Pull Semantics

A client pull request SHOULD use:

- `trust_zone_id`;
- `after_sequence`, when the client has a server-assigned cursor;
- `recorded_after`, when the client needs a recorded-time fallback;
- `limit`.

If both `after_sequence` and `recorded_after` are supplied, the server SHOULD use
the stricter result set and document the behavior in the API response once the
runtime protocol is implemented.

Pull responses keep the existing string `cursor` for compatibility and MAY also
include numeric `after_sequence` metadata that identifies the last returned
server sequence.

## Protected-Value Transfer

Protected blobs are uploaded before canonical metadata is accepted.

`PUT /v1/sync/protected-values/:protected_value_id` stores the original encrypted
ciphertext bytes in blob storage. The upload metadata MUST include:

- `protected_value_id`;
- `trust_zone_id`;
- deterministic object key;
- AES-256-GCM ciphertext nonce and authentication tag as base64url strings;
- original ciphertext digest and size;
- wrapped device-key envelope.

The upload MUST NOT include plaintext provider content, raw device keys, or the
trust-zone sync key. The Worker stores encrypted blob bytes only.

`HEAD /v1/sync/protected-values/:protected_value_id` returns metadata required to
verify object presence, digest, size, and linkage without returning ciphertext.
`GET /v1/sync/protected-values/:protected_value_id` returns the encrypted
ciphertext bytes plus the same metadata. Missing or mismatched blobs MUST fail
closed with a protected-value error before D1 metadata acceptance.

The wrapped device-key envelope uses AES-256-GCM under an out-of-band
trust-zone sync key. The envelope stores only wrapped-key ciphertext, wrap nonce,
wrap authentication tag, digest, size, and AAD binding
`(trust_zone_id, protected_value_id, key_ref)`. The trust-zone sync key is never
sent to the Worker and never committed to Git.

If an R2 upload succeeds but D1 metadata acceptance fails, the object is
orphan-detectable by deterministic object key, receipt, and metadata status.
Replay handling MUST NOT overwrite an existing object with a different digest or
size.

## Failure Modes

| Failure mode | Required behavior |
| --- | --- |
| Replay | Return replay status and previous accepted identifiers. |
| Idempotency conflict | Reject the request and identify the conflicting key. |
| Invalid schema | Reject before assigning a sequence. |
| Unauthorized trust zone | Reject without disclosing private event content. |
| Batch record in another trust zone | Reject the batch before assigning a sequence. |
| Partial batch failure | Report accepted and rejected items explicitly only for records inside the request trust zone. |
| Sequence gap observed by client | Client should retry pull before treating data as lost. |

## Synthetic Example

```text
Request A:
  trust_zone_id = tz_local_example
  idempotency_key = idem_ExamplePush0001
  request_fingerprint = sha-256:aaaaaaaa...
  result = accepted

Request B:
  trust_zone_id = tz_local_example
  idempotency_key = idem_ExamplePush0001
  request_fingerprint = sha-256:aaaaaaaa...
  result = replay

Request C:
  trust_zone_id = tz_local_example
  idempotency_key = idem_ExamplePush0001
  request_fingerprint = sha-256:bbbbbbbb...
  result = idempotency_conflict
```
