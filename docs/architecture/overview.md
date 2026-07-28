# CarpeOS Architecture Overview

Status: planned architecture for the v1 MVP.

CarpeOS is a public implementation for private knowledge systems. Its core
architecture is an append-only canonical event store with rebuildable,
non-authoritative projections.

## System Shape

```text
Provider lifecycle hooks
  -> capture adapters
  -> local append-only outbox
  -> private canonical event store
  -> query-time accepted-fact engine
  -> rebuildable projections
  -> MCP and human interfaces
```

The runtime is planned. This document defines the target architecture and
invariants, not completed implementation.

## Canonical Layer

The canonical layer stores immutable `CanonicalEvent` records. The only v1
canonical payload types are:

- `EvidenceArtifact`;
- `Observation`;
- `Claim`;
- `AcceptanceDecision`;
- `Supersession`.

Every canonical event carries bitemporal time, lifecycle status, epistemic
authority, trust-zone metadata, non-empty provenance, idempotency metadata, and
eventually a server-assigned per-zone sequence.

## Derived Layer

The derived layer computes:

- accepted facts;
- lineage graphs;
- open-loop views;
- session summaries;
- Obsidian notes;
- vector indexes;
- graph indexes;
- MCP context packs;
- dashboards.

Derived artifacts are projections. They may be cached, deleted, rebuilt, or
redacted without changing canonical knowledge.

## Invariants

1. Canonical events are append-only after acceptance.
2. Claims are immutable.
3. Acceptance is represented by `AcceptanceDecision`, not claim mutation.
4. Supersession is represented by `Supersession`, not destructive update.
5. Accepted facts are query-time derivations.
6. Valid time and recorded time are independent.
7. Every query resolves both time axes either from supplied filters or normative
   defaults: omitted valid time means any visible valid time, and omitted
   recorded time means latest recorded knowledge visible to the requester.
8. Stored lifecycle status is only `draft` or `active`; superseded and erased
   are derived from visible ledger events.
9. Epistemic authority is only `unverified`, `self_reported`, `observed`,
   `imported`, `derived`, or `verified`; acceptance outcomes live only in
   `AcceptanceDecision`.
10. Trust zones are physical isolation boundaries limited to `local_device`,
   `user_cloud`, and `managed_service`.
11. Public network reachability is external-reference metadata, not a trust-zone
    isolation class.
12. Protected plaintext is stored outside canonical events.
13. Erasure is recorded through `ErasureLedger` with method-compatible target
    references and applied to projections.
14. Idempotent replay does not append duplicate events.
15. Idempotency conflicts are rejected within `(trust_zone_id, idempotency_key)`.
16. Sync push batches are single-zone; batch records must match the request
    trust zone.
17. `zone_sequence` is monotonic only within a trust zone and may be assigned to
    erasure ledger records for deterministic replay.
18. Provider-specific details remain behind adapters.

## Failure Modes

| Area | Failure mode | Architectural response |
| --- | --- | --- |
| Capture | Duplicate hook delivery | Idempotency replay. |
| Capture | Provider transcript is incomplete | Store evidence with incomplete lineage or reject. |
| Sync | Same `(trust_zone_id, idempotency_key)`, different fingerprint | Reject as conflict. |
| Sync | Batch mixes trust zones | Reject before sequence assignment. |
| Query | Conflicting acceptance decisions | Return conflicted or review-required derived state. |
| Security | Protected value access denied | Return redacted lineage. |
| Projection | Projection is stale | Rebuild from canonical events and sequences. |
| Erasure | Plaintext remains in projection | Delete or rebuild projection output from erasure ledger. |

## Synthetic Flow

1. Example Alpha hook captures a synthetic work message.
2. The adapter creates an `EvidenceArtifact` with a protected-value reference.
3. Extraction creates an `Observation`.
4. A model proposes a `Claim`.
5. A later review emits an `AcceptanceDecision`.
6. A query derives the accepted fact from the visible claim and decision.
7. An Obsidian note and vector entry are generated as projections.
