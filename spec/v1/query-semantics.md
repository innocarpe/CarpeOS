# CarpeOS v1 Query Semantics

Status: G007 local query semantics for retrieval, MCP, and projections.

This document defines how implementations derive facts, lineage, and projection
inputs from canonical events.

## Query Inputs

A query SHOULD declare:

- subject scope;
- visible trust zones;
- valid-time interval;
- recorded-time interval;
- lifecycle-status filter;
- epistemic-authority filter;
- provenance depth;
- protected-value access policy;
- conflict policy.

Every query MUST resolve both time axes either through supplied filters or
normative defaults. If a query omits valid time, it means "any valid time visible
under the remaining filters." If it omits recorded time, it means "latest
recorded knowledge visible to the requester." APIs SHOULD make these defaults
explicit in responses.

## Accepted Fact Derivation

Accepted facts MUST be computed from visible immutable records:

```text
visible Claims
  + visible AcceptanceDecisions
  + visible Supersessions
  + visible ErasureLedger records
  - records whose erased state is derived from those ledgers
  - inaccessible records
  = derived accepted-fact view
```

The accepted-fact view is a projection. It MUST be rebuildable from canonical
events and MUST NOT be edited directly.

For G007 MCP context packs and Obsidian accepted-fact notes, a fact is accepted
only when a visible `Claim` has visible `AcceptanceDecision` lineage with
`decision: "accepted"`. Implementations MUST apply trust-zone authorization,
protected-value policy, lifecycle, epistemic authority, valid-time,
recorded-time, conflict, supersession, and erasure checks before a claim is
eligible.

The following states MUST NOT be collapsed into accepted facts:

- draft claims;
- rejected claims;
- claims with both visible accepted and rejected decisions;
- superseded claims;
- erased claims or records targeted by visible erasure ledger entries;
- hidden claims or hidden acceptance decisions;
- claims whose required protected support is denied by policy.

These records SHOULD remain available as draft, rejected, conflicted,
superseded, erased, hidden, or redacted lineage when the requester is authorized
to see that metadata.

## Supersession

`Supersession` changes derived query results without editing the superseded
event. A superseded event remains part of provenance and audit history.

If a `Supersession` has a `replacement_event_id`, queries SHOULD include the
replacement in lineage when the requester can see it. If the replacement is not
visible because of trust-zone or protected-value policy, the query SHOULD return
a redacted lineage marker.

## Conflict Handling

Conflict cases include:

- two visible acceptance decisions for incompatible claims;
- a visible acceptance and rejection for the same claim;
- a replacement event that is missing;
- a supersession chain with a cycle;
- a query that can see a claim but not the protected evidence needed to justify
  it.

Implementations MUST surface these states. They MUST NOT flatten them into a
single authoritative answer without an explicit conflict policy.

## Failure Modes

| Failure mode | Required behavior |
| --- | --- |
| Missing evidence | Return the claim with incomplete lineage, or exclude it if the query requires complete evidence. |
| Protected value denied | Return redacted lineage, not plaintext. |
| Supersession cycle | Mark the lineage invalid and stop traversal at the cycle. |
| Conflicting decisions | Return `conflicted` or review-required derived state. |
| Unknown trust zone | Reject the query or omit that zone with an explicit warning. |
| Projection lag | Report projection staleness using recorded sequence metadata when available. |

## Projection Query Semantics

Projection builders MUST read from canonical events and `ErasureLedger` records.
They MUST respect trust-zone visibility and protected-value access policy.

Projection builders MUST be deterministic for the same canonical input,
configuration, and permission set.

G007 interface packages MUST use typed local-store snapshot/query APIs rather
than direct SQL against canonical tables. The local store owns canonical event
lookup, erasure lookup, retrieval input snapshots, support-reference validation,
and draft claim writes. MCP and Obsidian code may consume those typed shapes,
but they MUST NOT bypass the local-store boundary to broaden visibility or drift
policy-adjacent filters.

Obsidian, vector, graph, dashboard, accepted-fact, and MCP context-pack outputs
are projections. Editing or caching those outputs has no canonical effect unless
a separate capture flow records a new canonical event.

## Bitemporal Draft Claims

`memory_propose_claim` writes a draft `Claim`, not an accepted fact. Its
caller-provided `valid_time` is distinct from `recorded_time`.

- `valid_time` can be historical, current, or future when schema validation and
  trust-zone policy allow it.
- `recorded_time` is assigned by the local-store clock at write time.
- omitted `valid_time` defaults to the write clock instant with `end: null`.
- no MCP draft-claim write creates an `AcceptanceDecision`.

Acceptance remains a separate canonical decision flow.

## Synthetic Example

Fictional sequence:

1. `evt_claim_001` records a `Claim` that Example Alpha uses a synthetic queue
   with non-empty support references.
2. `evt_decision_001` records an `AcceptanceDecision` accepting that claim for
   local design notes.
3. `evt_claim_002` records a narrower replacement claim.
4. `evt_super_001` records a `Supersession` from `evt_claim_001` to
   `evt_claim_002`.

A query for current accepted facts SHOULD return the narrower claim. A lineage
query SHOULD still show the original claim, the acceptance decision, and the
supersession path.
