# Projections and Retrieval

Status: current-main audit. Local retrieval, deterministic local vector and
graph projections, MCP context packs, Obsidian projection, and OKF export are
shipped read models; hosted and Product 3.2 extensions are not.

Projections are derived from visible canonical events, erasure records,
configuration, and authorization policy. They are never canonical knowledge and
may be rebuilt or deleted without mutating the event store.

## Shipped local projections

| Projection | Current-main behavior |
| --- | --- |
| Retrieval | Local full-text, metadata, and vector candidate retrieval with canonical recheck |
| Vector | Local deterministic provider for stable offline behavior; no semantic-quality claim |
| Graph | Deterministic local nodes, edges, freshness, and bounded neighborhood traversal |
| MCP context packs | Local, deterministic, budgeted views over explicitly visible trust zones |
| Obsidian and OKF | Rebuildable, manifest-bounded outputs; OKF is export-only |

Implementation and synthetic test evidence: [retrieval source](../../packages/retrieval/src/),
[graph tests](../../packages/retrieval/test/graph-projection.test.ts),
[MCP tests](../../apps/carpeos-mcp-server/test/), and
[OKF projection](../../packages/okf-projection/src/).

## Retrieval authority and safety

A candidate hit is not a fact. Results are rechecked against visible canonical
records, acceptance decisions, supersession, erasure, lifecycle, protected-value
policy, time, and trust-zone visibility. Promoted/active-only behavior is the
default; held or draft material requires an explicit, policy-checked path.
Explicit visibility is required and unknown or omitted zones fail closed before
content resolution.

Chunks and public-facing metadata exclude protected plaintext, ciphertext, raw
provider payloads, credentials, absolute paths, private URLs, and production
logs. Context packs report deterministic item/character budget metadata. Graph
edges remain traceable to canonical records or deterministic derivation rules.

## Not shipped by these projections

Hosted Workers AI, Vectorize, hosted graph services, online learning, adaptive
ranking, and any provider adapter not implemented in current main are not
shipped. Graph traversal and vector ranking remain candidate mechanisms; they
cannot promote a Claim or bypass canonical recheck. No projection automatically
creates a Claim or AcceptanceDecision.

Product 3.2 B0 is planned, bounded, metadata-only, and zero-write. It does not
add a retrieval authority path or alter schema v1, trust zones, append-only
history, or promoted/active-only defaults. B1 apply and sync convergence are
deferred. See [ADR 0015](../adr/0015-policy-version-reconciliation.md) and
[Product 3.2.0](../maintainers/product-3.2.0.md).

## Failure behavior

A stale or invalid projection is marked invalid or rebuilt. Erasure requires
deletion or rebuild of affected output. Invisible roots, missing visibility, and
protected-policy denial fail closed. A corrupt manifest preserves prior
managed-looking files until ownership is proven. These responses preserve the
canonical source-of-truth boundary.
