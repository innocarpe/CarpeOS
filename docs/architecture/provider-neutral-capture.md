# Provider-Neutral Capture and MCP

Status: planned architecture for the v1 MVP.

CarpeOS should work across multiple AI agents. Provider adapters normalize hook
events into canonical events without making one provider the authority model.

## Capture Pipeline

```text
Codex / Grok / Claude / generic hook
  -> provider adapter
  -> capture envelope
  -> local outbox
  -> sync
  -> canonical event store
```

Adapters own provider-specific parsing. The canonical store owns durable
knowledge semantics.

## Adapter Responsibilities

Adapters SHOULD:

- preserve non-empty provider and session provenance;
- write raw content as `EvidenceArtifact`;
- extract bounded `Observation` records;
- propose immutable `Claim` records;
- leave acceptance to `AcceptanceDecision`;
- use `ProtectedValueRef` for sensitive payloads;
- attach idempotency key and request fingerprint;
- send each push batch to one trust zone only.

Adapters MUST NOT:

- mutate claims into accepted facts;
- make provider output authoritative by default;
- expose protected values to unauthorized MCP clients;
- store provider-specific assumptions in the canonical model.

## MCP Responsibilities

MCP tools expose bounded retrieval and capture operations to LLMs. They should
return:

- query-time accepted facts;
- visible lineage;
- conflicts and gaps;
- redacted protected-value markers;
- projection freshness metadata when available.

MCP tools MUST enforce trust-zone boundaries before returning content.
