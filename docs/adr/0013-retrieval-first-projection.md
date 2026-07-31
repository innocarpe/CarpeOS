# ADR 0013: Retrieval-first projection layer

Status: Accepted for product 3.0 design

Date: 2026-07-31

## Context

CarpeOS 1.0 froze a local capture pipeline. CarpeOS 2.0 added knowledge
adjudication so only judged content reaches the meaning surface. Both majors
improved the **write** path.

The product thesis, however, is a cross-repository single source of truth that
agent sessions query mid-task. That thesis is dominated by the **read** path,
and the read path never advanced past its 1.0 shape:

- the retrieval projection materializes chunks, an FTS table, and vectors, but
  **no nodes and no edges**;
- canonical provenance (`supports`, `contradicts`, `derived_from`,
  supersession, acceptance lineage) stays inside event JSON and is not queryable
  as structure;
- retrieval filters know trust zone, lifecycle, authority, and time, but **not
  project**, so a cross-repository operator cannot scope or prioritize by
  repository;
- worktree and branch identity are never captured, so “where was this decided”
  is unanswerable and worktree-scoped recall is impossible;
- `memory_trace` and `memory_related` load a snapshot and walk it in memory
  rather than traversing an index;
- the only embedding provider is a deterministic development stub that
  self-reports synthetic semantic quality.

A knowledge graph vocabulary already exists (ADR 0010) and a staged roadmap
exists (`docs/plans/graphrag-roadmap.md`), but only the vocabulary stage landed.

Risk if this continues: adjudication precision becomes unobservable, and the
product remains an encrypted archive with a search box.

## Decision

Treat the retrieval projection as a **first-class engine written at ingest**,
not as a downstream convenience rebuilt someday.

1. **Dual-write at ingest.** Every accepted capture writes the canonical event
   (authority) and the retrieval projection (speed) within the same ingest
   boundary. The projection remains rebuildable and non-authoritative, so
   ADR 0001 is preserved.

2. **Materialize graph structure.** Add `graph_nodes` and `graph_edges`
   projection tables with covering indexes. Node and edge kinds derive from
   existing canonical fields; no new core `CanonicalEvent` event type is
   introduced, preserving ADR 0010.

3. **Partition by project, facet by worktree.** `project_id` is the knowledge
   partition. `worktree_id`, `worktree_name`, and `git_branch` are facets used
   for filtering, ranking boosts, and provenance display. Worktree must never
   partition knowledge, because sibling worktrees of one repository must share
   one brain.

4. **Keep absolute paths local.** Worktree identity is stored as a hash plus a
   basename label. Absolute workspace paths never enter canonical statements,
   chunk text, graph labels, or sync payloads.

5. **Bounded traversal over an index.** Neighborhood queries traverse the edge
   index with explicit depth and node budgets and report omissions, replacing
   full-snapshot in-memory walks for that path.

6. **Graph informs candidates, canonical decides truth.** Graph expansion and
   graph-derived scores affect discovery and ranking only. Every returned record
   still passes canonical recheck for trust zone, erasure, supersession, and
   acceptance lineage. Structure never implies acceptance, preserving ADR 0002
   and ADR 0012.

7. **Pluggable embeddings with a real default.** The embedding provider becomes
   an interface with a non-placeholder local default. Provider identity and
   version are recorded in projection metadata so stale vectors are detectable.

8. **Local-first storage by default.** The graph and vector indexes live in the
   local store. A hosted graph or vector engine may later attach behind an
   adapter boundary as a rebuildable read accelerator, never as canonical
   storage and never as the write target for erasure or acceptance.

## Consequences

Positive:

- Cross-repository and cross-worktree retrieval becomes expressible, which is
  the actual product thesis.
- Multi-hop questions (“what else relates to this decision?”) stop depending on
  snapshot scans.
- Adjudication precision becomes observable through retrieval evaluation.
- Provenance improves: results can state project, worktree, and branch.

Tradeoffs:

- Ingest does more work per capture; projection writes must stay off the
  fail-open hook path.
- Two additional projection tables increase rebuild cost and migration surface.
- Entity resolution is derived and imperfect until its own stage lands.
- Retrieval queries remain more expensive than raw vector lookup because
  canonical recheck still runs on every candidate.

## Alternatives considered

**Adopt a dedicated graph database as the knowledge store.** Rejected as a
canonical store: it would place erasure, supersession, and acceptance semantics
in a rebuildable index and break ADR 0001. Deferred as an optional accelerator:
the current blocker is that no nodes or edges are produced at all, so changing
engines first would not improve retrieval.

**Partition knowledge by worktree.** Rejected. It would hide decisions made in
sibling checkouts of the same repository and defeat the single-source-of-truth
goal.

**Continue deferring graph work to a roadmap.** Rejected. Two majors have shipped
with the read path unchanged; the roadmap-only posture is what produced the gap.

## Related

- [product-3.0.0.md](../maintainers/product-3.0.0.md)
- [ADR 0001 canonical store and projections](0001-canonical-store-and-projections.md)
- [ADR 0007 embedding hybrid retrieval](0007-embedding-hybrid-retrieval.md)
- [ADR 0010 graph projection vocabulary](0010-graph-projection-vocabulary.md)
- [ADR 0012 knowledge adjudication](0012-knowledge-adjudication.md)
- [GraphRAG roadmap](../plans/graphrag-roadmap.md)
