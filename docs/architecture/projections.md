# Projections and Retrieval

Status: current-main audit. Local retrieval, deterministic local vector and
graph projections, local sync transfer/import, MCP context packs, Obsidian
projection, and OKF export are implemented and tested repository read models;
none implies hosted or production deployment. Product 3.2 B0 is pre-release.

Projections are derived from visible canonical events, erasure records,
configuration, and authorization policy. They are never canonical knowledge and
may be rebuilt or deleted without mutating the event store.

## Implemented and tested local projections

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

Hosted Workers AI, Vectorize, hosted graph services, hosted or production sync,
online learning, adaptive ranking, and any provider adapter not implemented in
current main are not deployed. Local sync transfer/import and projections are
implemented and tested in the repository, but are not evidence of a hosted or
production deployment. Graph traversal and vector ranking remain candidate
mechanisms; they cannot promote a Claim or bypass canonical recheck. No projection
automatically creates a Claim or AcceptanceDecision.

Product 3.2 B0 is implemented and tested on main, bounded, metadata-only, and
zero-write. It remains pre-release, unpublished, uninstalled, and undeployed; it
does not add a retrieval authority path or alter schema v1, trust zones,
append-only history, or promoted/active-only defaults. B1 apply, writer and
receipt construction, Supersession construction, and sync convergence are
deferred. This document does not evidence K0--K12, release, installation, or
publication completion. See [ADR 0015](../adr/0015-policy-version-reconciliation.md).

## Failure behavior

A stale or invalid projection is marked invalid or rebuilt. Erasure requires
deletion or rebuild of affected output. Invisible roots, missing visibility, and
protected-policy denial fail closed. A corrupt manifest preserves prior
managed-looking files until ownership is proven. These responses preserve the
canonical source-of-truth boundary.
