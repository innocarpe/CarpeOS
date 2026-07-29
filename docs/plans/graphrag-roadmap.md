# GraphRAG Roadmap

Status: **planned**. Not implemented as a product feature in this repository.

This roadmap stages graph-augmented retrieval for CarpeOS without weakening
canonical authority, trust zones, or the memory capacity model (ADR 0009).

## Why GraphRAG here

Hybrid FTS + vector + structured filters already answer “find similar text.”
Long-horizon agent work also needs “what is related by decision lineage, project
entity, or conflict chain?” GraphRAG-style traversal can help **candidate
generation** and **explanation**, but it must not decide acceptance.

| GraphRAG can | GraphRAG must not |
| --- | --- |
| Expand related event ids for a pack | Promote a claim to accepted |
| Explain path from evidence → decision | Bypass trust-zone visibility |
| Rank multi-hop neighbors for a task | Store plaintext secrets in graph indexes |
| Feed expert-slot pack builders | Replace canonical recheck |

## Prerequisites already in tree

- Append-only `CanonicalEvent` ontology (evidence, observation, claim, decision,
  supersession)
- Hybrid retrieval with canonical recheck (ADR 0007)
- MCP `memory_related` / `memory_trace` (deterministic edge walk, not embedding graph)
- Expert-slot context packs (active capacity)
- OpenLoop / dashboard library (`@carpeos/product-projection`)
- Memory capacity axes (ADR 0009)

## Stage plan

### G-R0 — Graph vocabulary (docs + schema sketch)

**Goal:** Name graph node/edge kinds as **projections**, not core event types.

Candidate node kinds (derived):

- event / claim / observation / artifact / entity / open_loop / run

Candidate edge kinds (derived from existing fields):

- `supports`, `contradicts`, `supersedes`, `decides`, `derived_from`,
  `same_subject`, `same_run`

**Exit criteria**

- Spec section under `spec/v1/` or ADR for projection-only graph model
- Explicit non-goals: no sixth canonical `event_type` for “graph node”

### G-R1 — Deterministic lineage graph projection

**Goal:** Materialize a rebuildable adjacency list from local store snapshots.

Inputs: visible events + erasures + supersessions  
Outputs: `graph_nodes`, `graph_edges` tables or files with projection freshness  
Authority: `canonical_effect: none`

**Exit criteria**

- Rebuild is idempotent
- Erasure/supersession remove or hide edges
- Unit tests with synthetic Example Alpha fixtures

### G-R2 — Traversal API (local)

**Goal:** Bounded multi-hop walk with hard caps.

Suggested parameters:

- `root_id`, `max_depth` (default 2–4), `max_nodes`, `edge_kinds[]`
- trust-zone visibility required
- return path metadata for `memory_trace`-compatible explanations

Wire as:

- library API in retrieval or product-projection
- optional CLI: `carpeos graph walk ...` (later)
- optional MCP: extend `memory_related` or add `memory_graph_walk` only after
  tool-count / contract review

**Exit criteria**

- Deterministic order for identical inputs
- Fail closed on invisible roots
- Budget reporting (nodes/edges/characters)

### G-R3 — Graph-aware retrieval ranking

**Goal:** Use graph neighborhood as an extra **candidate source**, then recheck.

Pipeline:

```text
query → (FTS | vector | structured | graph expand) → diversify → recheck → pack
```

Graph score is a ranking signal only. Diversity router (M6) should treat
`chunk_kind` / subject / graph-community as separate buckets when needed.

**Exit criteria**

- No authority change in tests
- Ablation: graph-off mode still works
- Synthetic multi-hop fixture improves related recall without false accepted facts

### G-R4 — Entity / project community views

**Goal:** Derived `Entity` / community projections for human dashboards and
agent open loops.

- project / repo / subject communities
- conflict clusters
- open-loop attachment to graph neighborhoods

**Exit criteria**

- OpenLoop items can cite graph community ids (projection refs)
- Obsidian/dashboard categories remain closed enums or documented extensions

### G-R5 — Optional hosted graph index

**Goal:** Adapter boundary only (similar to Vectorize).

- Local graph remains default
- Hosted index optional, rebuildable, never canonical
- No production claim without operator evidence

**Exit criteria**

- Adapter interface + synthetic tests
- Explicit NOT DEPLOYED until private operator proof

## Non-goals (until revisited)

- Training or fine-tuning personal graphs into model weights
- Replacing bitemporal query semantics with pure graph time
- Auto-merging conflicted claims via graph centrality
- Public multi-tenant graph SaaS in this repo

## Suggested dependency order with capacity work

```text
G-R0 docs/schema
  → G-R1 lineage projection
  → G-R2 walk API ──→ G-R3 rank integration → expert-slot packs
  → G-R4 communities / open loops
  → G-R5 hosted adapter (optional)
```

Parallel-safe after G-R1: documentation, Obsidian graph export experiments,
and eval harness design.

## Evaluation sketch (later)

Use synthetic fixtures only in-repo:

| Metric | Intent |
| --- | --- |
| Multi-hop recall@k | Related decision found within depth d |
| False acceptance rate | Must stay 0 (graph must not invent acceptance) |
| Budget overflow rate | Walks respect max_nodes |
| Rebuild time | Projection cost vs full reindex |

## Related docs

- [Memory capacity architecture](../architecture/memory-capacity.md)
- [Capacity master plan](k3-memory-capacity-master-plan.md)
- [Retrieval projections spec](../../spec/v1/retrieval-projections.md)
- [ADR 0001 canonical store and projections](../adr/0001-canonical-store-and-projections.md)
- [ADR 0007 embedding hybrid retrieval](../adr/0007-embedding-hybrid-retrieval.md)
- [MCP context-pack smoke](../guides/mcp-context-pack-smoke.md)
