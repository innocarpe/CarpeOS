# ADR 0003: Bitemporal Sequence and Idempotency

Status: Accepted for planned v1 design

## Context

Knowledge systems need to answer both "what was true then?" and "what did the
system know then?" Multi-device capture also creates duplicate delivery and
retry scenarios.

## Decision

CarpeOS will store both `valid_time` and `recorded_time` on canonical events.
Servers should assign a monotonic `zone_sequence` per trust zone to canonical
events, and may assign it to erasure ledger records for deterministic replay.
Sync will use `idempotency_key` and `request_fingerprint` to distinguish replay
from conflict. Idempotency identity is `(trust_zone_id, idempotency_key)`, and
each push batch targets one trust zone.

## Consequences

- Queries can be bitemporal.
- Per-zone pull cursors are deterministic.
- There is no cross-zone global total order.
- Duplicate delivery can be replayed safely.
- Same `(trust_zone_id, idempotency_key)` with different fingerprint is a
  conflict.
- Batch records must match the request trust zone before any sequence is
  assigned.
