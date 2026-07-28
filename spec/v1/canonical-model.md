# CarpeOS v1 Canonical Model

Status: planned normative design for the v1 runtime.

This document defines the CarpeOS v1 source-of-truth model. JSON Schemas under
`spec/v1/schema/` constrain structural wire shapes. This prose defines the
semantics that implementations must preserve. Exported conformance validation
MUST additionally enforce semantic invariants such as bitemporal ordering and
trust-zone consistency.

## Source of Truth

The source of truth for private knowledge is an append-only stream of
`CanonicalEvent` records inside a physical `TrustZone`.

Implementations MUST NOT treat Obsidian notes, vector indexes, graph indexes,
dashboards, context packs, or accepted-fact views as canonical knowledge. These
outputs are rebuildable projections.

Implementations MUST NOT mutate a `Claim` to encode acceptance, rejection, or
supersession. Accepted facts are derived at query time from immutable `Claim`,
`AcceptanceDecision`, and `Supersession` events.

## Canonical Events

Every canonical record is wrapped in a `CanonicalEvent`.

A `CanonicalEvent` MUST contain:

- `schema_version`;
- globally unique `event_id`;
- `event_type`;
- `subject_ref`;
- bitemporal `valid_time`;
- bitemporal `recorded_time`;
- `lifecycle_status`;
- `epistemic_authority`;
- physical `trust_zone`;
- provenance references;
- `idempotency_key`;
- `request_fingerprint`;
- event-specific `payload`.

The server SHOULD assign `zone_sequence` when it accepts an event into a trust
zone. `zone_sequence` MUST be monotonic within the `(trust_zone_id)` sequence.
Clients MUST NOT rely on local wall-clock time as an ordering authority when a
server-assigned sequence exists.

`ErasureLedger` records MAY also receive a server-assigned per-zone
`zone_sequence` so projection repair and replay can process erasure actions
deterministically with canonical events.

## Canonical Record Types

The v1 canonical event types are:

| Type | Semantics |
| --- | --- |
| `EvidenceArtifact` | A raw or externally referenced artifact. It may point to an `external_uri` or a `ProtectedValueRef`. |
| `Observation` | A bounded statement extracted from evidence. It is not an accepted fact. |
| `Claim` | An immutable statement with support references and an optional confidence. |
| `AcceptanceDecision` | An immutable decision that accepts, rejects, or marks one or more claims as needing review. |
| `Supersession` | An immutable record that supersedes an earlier event and may identify a replacement event. |

Derived concepts such as `Entity`, `Relation`, `OpenLoop`, and `SessionSummary`
MAY exist in projections or higher-level APIs. They are not v1 canonical core
records unless represented by one of the canonical event types above.

## Bitemporal Time

CarpeOS uses two independent time axes:

- `valid_time`: when a statement is true in the modeled domain;
- `recorded_time`: when CarpeOS recorded the event.

Both are intervals with `start` and `end`. A null `end` means the interval is
open-ended, not eternal.

Every query MUST resolve both time axes either through supplied filters or
normative defaults. If a query omits valid time, it means "any valid time visible
under the remaining filters." If it omits recorded time, it means "latest
recorded knowledge visible to the requester." Responses SHOULD disclose applied
time defaults. A query asking "what did CarpeOS know on date X?" is a
recorded-time query with an explicit recorded-time filter and the default valid
time. A query asking "what was true for Example Alpha during date X?" is a
valid-time query with an explicit valid-time filter and the default recorded
time. A query asking "what did CarpeOS know on date X about what was true on
date Y?" is bitemporal with both filters supplied.

## Lifecycle Status and Epistemic Authority

`lifecycle_status` and `epistemic_authority` are separate axes.

Stored `lifecycle_status` values are limited to `draft` and `active`.
Superseded and erased are derived record states computed from visible
`Supersession` and `ErasureLedger` records; they MUST NOT be stored as
`lifecycle_status`.

`epistemic_authority` describes the authority level of the event content, such
as `unverified`, `self_reported`, `observed`, `imported`, `derived`, or
`verified`. Acceptance outcomes such as `accepted`, `rejected`, and
`needs_review` exist only inside `AcceptanceDecision`; they MUST NOT be stored
as `epistemic_authority`.

Implementations MUST NOT collapse these axes into one mutable status field. A
record can be lifecycle-active while epistemically unverified. A record can also
derive a superseded or erased state while still being needed for lineage.

## Provenance Lineage

Every event MUST carry a non-empty provenance list. Provenance references
explain how the event relates to earlier events, artifacts, claims,
observations, or external sources.

Provenance relationships include:

- `derived_from`;
- `supports`;
- `contradicts`;
- `quotes`;
- `supersedes`;
- `redacts`.

Query results SHOULD expose enough lineage to answer "why should this be
believed?" without returning sensitive evidence content unless the requester is
authorized for the relevant trust zone and protected value.

`Observation` payloads MUST include non-empty evidence artifact references.
`Claim` payloads MUST include non-empty support references. Synthetic bootstrap
or root events still require provenance; when no prior CarpeOS event exists,
they MUST use external provenance that identifies the source outside the
canonical stream.

## Protected Values

Large or sensitive evidence SHOULD NOT be embedded directly in canonical events.
Use `ProtectedValueRef` to reference an encrypted blob.

A `ProtectedValueRef` identifies:

- a vault reference;
- a key reference;
- encrypted blob metadata;
- encryption algorithm;
- nonce reference;
- tag reference;
- digest;
- blob size.

The normative key model is:

- a DEK encrypts one blob or bounded blob set;
- a `KeyProvider` protects or unwraps the DEK;
- canonical events store references and verification metadata, not plaintext
  secrets;
- `ErasureLedger` records tombstone, crypto-shred, or projection-delete actions
  with method-compatible target references.

`KeyProvider` is a planned runtime abstraction. The v1 schemas may represent it
through `key_ref` until a dedicated provider schema is introduced.

## Query-Time Accepted Facts

An accepted fact is a derived query result, not a stored mutation.

To derive accepted facts, an implementation MUST:

1. Select relevant `Claim` events by subject, valid time, recorded time, trust
   zone, and provenance constraints.
2. Select `AcceptanceDecision` events that refer to those claims and are visible
   to the requester.
3. Apply `Supersession` events visible to the requester.
4. Exclude records whose erased state is derived from visible `ErasureLedger`
   records, and exclude unavailable protected values unless the query asks for
   redacted lineage.
5. Resolve conflicts according to deterministic query semantics.

If two visible non-superseded decisions disagree, the derived fact state MUST be
reported as conflicted or review-required. The system MUST NOT silently choose
the newest record unless the query contract explicitly defines that policy.

## Synthetic Example

This example is fictional and contains no real project data.

```json
{
  "schema_version": "v1",
  "event_id": "evt_exampleclaim001",
  "event_type": "Claim",
  "subject_ref": "project:example_alpha",
  "valid_time": {
    "start": "2026-01-01T00:00:00Z",
    "end": null
  },
  "recorded_time": {
    "start": "2026-01-02T09:00:00Z",
    "end": null
  },
  "lifecycle_status": "active",
  "epistemic_authority": "derived",
  "trust_zone": {
    "trust_zone_id": "tz_local_example",
    "isolation": "local_device",
    "boundary_purpose": "Synthetic local test data"
  },
  "provenance": [
    {
      "ref_type": "artifact",
      "ref_id": "art_example0001",
      "relationship": "derived_from"
    }
  ],
  "idempotency_key": "idem_ExampleAlphaClaim0001",
  "request_fingerprint": "sha-256:0000000000000000000000000000000000000000000000000000000000000000",
  "payload": {
    "claim_id": "claim:example_alpha:build_passed",
    "statement": "Example Alpha passed its synthetic build check.",
    "claim_type": "factual",
    "support": [
      {
        "ref_type": "artifact",
        "ref_id": "art_example0001",
        "relationship": "supports"
      }
    ],
    "confidence": 0.9
  }
}
```
