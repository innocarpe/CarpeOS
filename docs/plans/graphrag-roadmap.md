# GraphRAG Roadmap

Status: current-main audit. Deterministic local graph projection and bounded
local traversal are shipped; GraphRAG ranking expansion and hosted operation are
planned or deferred.

Graph capability is a rebuildable candidate and explanation projection over
canonical records. It never changes acceptance, trust-zone visibility, or
schema-v1 event authority.

## Shipped baseline

Current main contains a local graph projection with deterministic nodes, edges,
freshness, rebuild behavior, and bounded neighborhood walking:
[implementation](../../packages/retrieval/src/graph-projection.ts) and
[synthetic tests](../../packages/retrieval/test/graph-projection.test.ts).
The local MCP server exposes only its implemented, tested graph-related tools;
see [tool implementation](../../apps/carpeos-mcp-server/src/tools.ts) and
[tool tests](../../apps/carpeos-mcp-server/test/mcp-app.test.ts).

The baseline is local and projection-only. It consumes visible canonical events,
erasure, supersession, configuration, and authorization policy. It preserves
traceability from edges to canonical records or deterministic derivation rules.
It is not a hosted graph service, a general provider adapter, or a claim
adjudicator.

## Roadmap

| Stage | Scope | Status |
| --- | --- | --- |
| G-R0 | Projection vocabulary and schema boundary | Shipped |
| G-R1 | Deterministic local lineage graph, rebuild, freshness | Shipped |
| G-R2 | Bounded local traversal through implemented graph tools | Shipped only for the documented local tool surface |
| G-R3 | Graph-aware retrieval ranking and evaluation | Planned |
| G-R4 | Entity/community product views beyond implemented local projection | Planned |
| G-R5 | Hosted graph adapter/index | Deferred; not deployed |

G-R3 may add graph candidates only behind canonical recheck, deterministic
offline evaluation, explicit visibility, and a graph-off path. It must not
adapt ranking online, infer acceptance, expose protected bodies, or convert
scores, graph centrality, or feedback into authority.

G-R4 must keep categories explicit and projections rebuildable. G-R5 requires a
provider-neutral adapter and synthetic tests before it can be described as
implemented; no hosted graph/vector deployment is claimed here.

## Product 3.2 boundary

Product 3.2 has no GraphRAG runtime extension. Its selected B0 work shipped in `@innocarpe/carpeos@3.2.0` and is verified on current main and global activation: a bounded, deterministic, metadata-only reconciliation preview with zero writes. No hosted deployment is claimed. It preserves schema v1, append-only canonical/review history, trust-zone boundaries, fail-open hooks, and promoted-active-only retrieval. B1 apply, Supersession construction, and sync convergence remain absent and deferred.

Automatic Claim or AcceptanceDecision creation, online learning, adaptive ranking, fuzzy cleanup, and hosted graph/vector operation remain outside the released B0 scope. K10 approval and K11--K12 release, publication, global installation, and activation are historical/current completion evidence in the [Product 3.2 release and activation receipt](../maintainers/product-3.2.0.md); that receipt does not establish hosted deployment or a GraphRAG extension. The normative B0 contract is [ADR 0015](../adr/0015-policy-version-reconciliation.md).

## Non-negotiable constraints

- Graph/vector output is a candidate or explanation, never canonical authority.
- Acceptance requires visible canonical lineage and an explicit
  `AcceptanceDecision`; automatic creation is off.
- Omitted or invalid trust-zone visibility fails closed.
- Public docs, fixtures, reports, and receipts use synthetic, metadata-only
  terminology and contain no protected plaintext or private runtime data.
