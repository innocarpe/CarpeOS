# ADR 0012: Knowledge adjudication (promote / hold / reject)

Status: Accepted for product 2.0 MVP design and implementation

## Context

CarpeOS 1.0 freezes a local pipeline: hooks → encrypted evidence → lifecycle-gated
Observation shell → search. That does **not** decide whether content is
brain-worthy. Without adjudication, meaning search becomes a dump ([product-2.0.0.md](../maintainers/product-2.0.0.md)).

## Decision

Insert an **adjudicator** between evidence and the meaning surface:

```
EvidenceArtifact (+ capture metadata)
  → Candidate
  → Adjudicator (rules MVP; optional LLM later, same interface)
  → disposition: promote | hold | reject
  → promote: active Observation (search default)
  → hold: draft Observation (review queue; search default off)
  → reject: no meaning unit; evidence may remain
```

### Rules

1. Host hooks stay **fail-open and fast** — no heavy judgment inside hooks.
2. Adjudication runs on extract / `carpeos adjudicate` (post-capture).
3. **Precision over recall**: prefer hold/reject over false promote.
4. Never auto-`AcceptanceDecision` (ADR 0002).
5. Idempotent: same `source_event_id` + `policy_version` → same disposition.
6. Secret-like material blocks promote (reuse capture privacy guards).

### Store

Table `knowledge_dispositions` records the initial disposition + reason codes +
scores. `knowledge_disposition_reviews` records one terminal operator decision
for a held source event and policy version. Both are append-only.

A held review never rewrites the draft Observation or initial disposition:

- `promote` records the review first, then appends a new active Observation with
  a distinct deterministic idempotency key;
- `reject` records review only and leaves the draft off default retrieval;
- replaying the same decision is idempotent; an opposite second decision for the
  same policy version fails.

Observations remain canonical events; disposition and review explain **why** they
exist or why evidence was not promoted. Held review never creates an
`AcceptanceDecision`.

### Retrieval

Default search/context-pack surfaces **promoted** meaning (`lifecycle_status:
active` Observations/Claims from promote path). Held (`draft`) is opt-in.
Evidence metadata stays secondary.

## Consequences

- 1.0 “always Observation on SessionEnd” becomes “maybe promote after adjudicate.”
- Operators need a local adjudicate step (CLI / future background worker).
- Tests must include **noise sessions** that must not flood meaning search.


## Policy-version re-adjudication

Disposition identity is **`(source_event_id, trust_zone_id, policy_version)`**.

- Same evidence + same `policy_version` → replay the stored disposition and any
  already-materialized Observation for that policy (idempotent).
- Same evidence + a **new** `policy_version` → append a new disposition row and,
  on promote/hold, append a new Observation with a policy-scoped idempotency key.
- Prior disposition rows and Observations are never rewritten or deleted.
- Held reviews remain unique per `(source_event_id, trust_zone_id, policy_version)`.
- Default retrieval still surfaces `lifecycle_status: active` only. When a new
  policy promotes meaning that an older policy held/rejected, both Observations
  may exist; operators should treat the newest policy’s active units as the
  intended product meaning and may leave older actives as historical until an
  explicit migration/cleanup story is approved.

CLI:

```sh
carpeos adjudicate --event-id "$EVENT_ID"                 # current policy
carpeos adjudicate --event-id "$EVENT_ID" --policy-version adj_v2
carpeos adjudicate history --event-id "$EVENT_ID"
```

## Related

- [product-2.0.0.md](../maintainers/product-2.0.0.md)
- [ADR 0011](0011-meaningful-unit-extraction-policy.md)
- [ADR 0002](0002-immutable-epistemic-model.md)
