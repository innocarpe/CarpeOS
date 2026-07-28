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

## Monotonic Per-Zone Sequence

The accepting server SHOULD assign `zone_sequence` to each accepted
`CanonicalEvent` and MAY assign `zone_sequence` to each accepted
`ErasureLedger` record for deterministic replay and projection repair.

`zone_sequence` MUST be:

- monotonic within one `trust_zone_id`;
- stable after assignment;
- unique within the assigned trust zone;
- usable as a pull cursor.

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
