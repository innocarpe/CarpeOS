# Memory Capacity Architecture

Status: architecture model audited against current main. Shipped local
projections implement bounded active capacity; Product 3.2 B0 shipped in
`@innocarpe/carpeos@3.2.0` and is verified on current main and global activation.
No hosted deployment is claimed.

This note applies [ADR 0009](../adr/0009-memory-capacity-model.md): total
private knowledge, active working memory, procedural evidence, and product
projections are separate axes. A small context pack does not limit the local
canonical store or redefine authority.

## Layers and current status

| Layer | Boundary | Current-main status |
| --- | --- | --- |
| L1 store capacity | Local append-only canonical events and protected values | Implemented and tested local source of truth |
| L2 working memory | Local retrieval hits and bounded MCP context packs | Implemented and tested local projection |
| L3 procedural memory | Protected procedure-trace evidence and policy-gated summaries | Architecture boundary; no automatic authority |
| L4 product memory | Local retrieval, vector, graph, Obsidian, and OKF read models | Implemented and tested where source-backed; always rebuildable |

L1 is trust-zone isolated; protected plaintext remains outside canonical rows.
Erasure is ledgered and projections rebuild to apply it. L2 admits only
policy-visible results within deterministic item and character budgets. Retrieval
defaults to promoted/active material and rechecks canonical state before a
candidate is used as a fact.

Current source evidence is [retrieval](../../packages/retrieval/src/),
[context-pack tools](../../apps/carpeos-mcp-server/src/tools.ts), and
[graph projection](../../packages/retrieval/src/graph-projection.ts), with
synthetic tests adjacent to those packages.

## Selection and resolution

Active memory should prefer accepted facts with lineage, then conflicts,
supersessions, review gaps, observations, safe evidence metadata, and only
necessary procedure summaries. R0 identifiers, R1 embeddings, R2 short
statements, and R3 visible text/protected references are resolutions, not
authority levels. Escalation to R3 requires both budget and protected-value
policy.

Local deterministic graph/vector projections can expand or rank candidates but
cannot accept a claim. Context packs, exports, and generated notes remain
non-authoritative and may be removed or regenerated from L1 plus erasure
history.

## Planned and deferred capacity work

Hosted graph/vector services, online learning, adaptive ranking, and future
capacity-program features are planned or deferred; they are not implied by the
implemented and tested local projections or local sync transfer/import. Repository
implementation does not establish hosted or production deployment. Product 3.2
does not make reconciliation, automatic Claim drafting, or automatic
AcceptanceDecision creation part of memory admission.

Under [ADR 0015](../adr/0015-policy-version-reconciliation.md), B0 shipped in
`@innocarpe/carpeos@3.2.0` as a local, bounded, metadata-only, zero-write preview
and is verified on current main and global activation. The [Product 3.2 release and
activation receipt](../maintainers/product-3.2.0.md) records release, publication,
global installation, activation, and K0--K12 completion; none implies hosted
deployment. B1 apply, writer and receipt construction, Supersession construction,
and sync convergence are deferred. Schema v1, trust-zone isolation, append-only
history, fail-open hooks, and promoted-active-only defaults remain unchanged.
