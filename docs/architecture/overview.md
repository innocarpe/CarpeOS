# CarpeOS Architecture Overview

Status: current-main architecture audit. Product 3.2 runtime work is planned unless
its Product 3.2 gate is marked done.

CarpeOS keeps private knowledge in a local canonical store and derives
rebuildable, non-authoritative read models from it. The canonical boundary is not
a graph, vector index, MCP response, export, or provider payload.

## Current-main boundary

| Surface | Current-main status | Authority |
| --- | --- | --- |
| Local canonical event store | Shipped | Source of truth |
| Disposition and review history | Shipped; append-only local history | Source evidence, not a claim mutation |
| Retrieval and context-pack projections | Shipped locally; promoted/active-only defaults apply | Rebuildable projection |
| Deterministic local vector and graph projections | Shipped locally | Candidate and lineage projection |
| Provider-neutral local hook capture and fail-open hook behavior | Shipped for the documented adapters | Captured evidence only |
| Hosted graph/vector, remote sync, online learning, adaptive ranking, and unimplemented provider or MCP surfaces | Planned or deferred | Not shipped |
| Product 3.2 B0 reconciliation preview | Planned | Metadata-only, zero-write preview |
| Product 3.2 B1 apply and sync convergence | Deferred | Not part of 3.2 |

Source evidence: [local store](../../packages/local-store/src/store.ts),
[retrieval](../../packages/retrieval/src/query.ts),
[graph projection](../../packages/retrieval/src/graph-projection.ts),
[local embedding provider](../../packages/retrieval/src/embedding-provider.ts),
[MCP tools](../../apps/carpeos-mcp-server/src/tools.ts), and their synthetic
tests under the corresponding `test/` directories.

## System shape

```text
provider hook
  -> provider-neutral local capture adapter
  -> protected value + metadata-only EvidenceArtifact
  -> local append-only canonical and review/disposition history
  -> policy-checked query-time derivation
  -> rebuildable local retrieval, graph, vector, MCP, and export projections
```

The shipped path is local. A provider adapter normalizes input but does not make
provider output authoritative. Hooks may fail open so capture cannot interrupt
host work. Remote synchronization, hosted services, and adapter surfaces not
implemented and tested in current main remain planned.

## Canonical and derived layers

The schema-v1 canonical event types are `EvidenceArtifact`, `Observation`,
`Claim`, `AcceptanceDecision`, and `Supersession`. Events are append-only;
Claims are immutable; acceptance and supersession are represented by their own
events. Protected plaintext is outside canonical events. Trust zones are
physical isolation boundaries, and replay is idempotent within a zone.

Derived outputs may be deleted or rebuilt without changing canonical knowledge.
Retrieval rechecks candidates against visible canonical records and exposes
promoted/active knowledge by default. Graph and vector results never establish
acceptance on their own. See [projections](projections.md) and
[provider-neutral capture](provider-neutral-capture.md).

## Product 3.2 boundary

[ADR 0015](../adr/0015-policy-version-reconciliation.md) selects only B0:
a deterministic, bounded, metadata-only reconciliation preview that writes
nothing. It retains schema v1, trust zones, append-only history, fail-open
hooks, and promoted-active-only defaults. Automatic Claim or
AcceptanceDecision creation remains off.

B0 is not implemented merely because this architecture is documented. B1
safe-subset apply, Supersession construction, protected-value transfer, and sync
convergence are deferred. The authoritative gate status is
[Product 3.2.0](../maintainers/product-3.2.0.md); do not infer K2--K12,
release, installation, or publication completion from this document.

## Synthetic example

A synthetic provider hook can create protected evidence metadata in a local
trust zone. Later, an explicitly authorized review may append a disposition or
AcceptanceDecision. Retrieval, graph/vector candidates, context packs, and
exports may then reflect visible promoted/active records, while preserving
lineage and redaction metadata. None of those projections changes canonical
authority.
