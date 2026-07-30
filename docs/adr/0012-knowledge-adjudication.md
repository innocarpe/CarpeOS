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

Table `knowledge_dispositions` records disposition + reason codes + scores.
Observations remain canonical events; disposition explains **why** they exist
or why evidence was not promoted.

### Retrieval

Default search/context-pack surfaces **promoted** meaning (`lifecycle_status:
active` Observations/Claims from promote path). Held (`draft`) is opt-in.
Evidence metadata stays secondary.

## Consequences

- 1.0 “always Observation on SessionEnd” becomes “maybe promote after adjudicate.”
- Operators need a local adjudicate step (CLI / future background worker).
- Tests must include **noise sessions** that must not flood meaning search.

## Related

- [product-2.0.0.md](../maintainers/product-2.0.0.md)
- [ADR 0011](0011-meaningful-unit-extraction-policy.md)
- [ADR 0002](0002-immutable-epistemic-model.md)
