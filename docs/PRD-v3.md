# PRD v3 — CarpeOS 3.0

Status: **Implementation complete on `main` / freeze Defer** — package release
`@innocarpe/carpeos@3.0.0` blocked until maintainer **Approve**  
DoD SSOT: [maintainers/product-3.0.0.md](maintainers/product-3.0.0.md)  
ADR: [0013-retrieval-first-projection.md](adr/0013-retrieval-first-projection.md)  
Series: [PRD-v1](PRD-v1.md) · [PRD-v2](PRD-v2.md)

This document is the **product requirements snapshot for major version 3**.
It captures the thesis, problem, scope, and success criteria for the 3.0 major.
Living gates, freeze evidence, and residual risk live in the DoD linked above.
When a new major starts, add `PRD-vN.md` rather than rewriting this file.

---

## Version thesis

> **Can it be found and used?**

CarpeOS 3.0 makes the product usable as a cross-repository SSOT “electronic
brain”: an agent session in any repository or worktree can retrieve a **bounded,
relevant, provenance-carrying knowledge neighborhood** fast enough to use
mid-task.

| | 1.0 | 2.0 | **3.0** |
| --- | --- | --- | --- |
| Question | Does the loop run? | Is this worth remembering? | **Can it be found and used?** |
| Core engine | capture + store | adjudication (`adj_v1`) | **retrieval projection + graph** |
| Success signal | `smoke:product` | `smoke:knowledge` / dogfood | **multi-hop recall + latency budget** |
| Failure if skipped | no data | dump pollution | **unusable brain** |

If retrieval is weak, adjudication quality is invisible. A knowledge OS that
cannot answer “what did we decide about this, here?” in one call is an encrypted
archive with a search box.

---

## Problem (verified on 2.0 `main` before this major)

Code-level gaps that motivated 3.0:

1. Retrieval index had **no graph** (chunks/FTS/vectors only).
2. Canonical ontology **collapsed** at index time to flat `chunk_kind`.
3. Retrieval had **no project dimension** despite `project_id` existing in store.
4. **Worktree identity was lost** (all checkouts of one remote → one project_id).
5. Traversal (`memory_trace` / `memory_related`) was **full snapshot + in-memory BFS**.
6. Vector leg was **synthetic-dev-only** placeholder hashing.
7. GraphRAG roadmap was **spec-only** past vocabulary (G-R0).

2.0 invested almost entirely in the **write** path. 3.0 is the **read** path major.

---

## Goals

1. **Retrieval-first dual-write:** canonical authority + rebuildable projections
   (chunks, vectors, graph) in the same ingest/rebuild boundary.
2. **Identity model:** `project_id` **partitions** knowledge; `worktree_*` /
   `git_branch` are **facets** (filter, boost, provenance) — never partitions.
3. **Pluggable embeddings** with a non-placeholder offline default
   (`local-lexical-hash`).
4. **Materialized graph** (`graph_nodes` / `graph_edges`), erasure-aware, rebuildable.
5. **Entity resolution** for `subject` and `decision_thread` (deterministic rules).
6. **Bounded neighborhood walk** over the edge index (depth/node budgets, omissions).
7. **MCP `memory_neighborhood`** (+ search/ranking integration).
8. **Graph-aware ranking** (seed expansion + hop decay) without implying acceptance.
9. **Offline eval harness** for multi-hop, cross-project, cross-worktree, false-acceptance=0.
10. **Freeze + Approve** before publishing `3.0.0`.

---

## Non-goals (3.0)

| Non-goal | Why out |
| --- | --- |
| Hosted graph (e.g. Neo4j) as **canonical** store | Violates ADR 0001; optional adapter only later |
| Partitioning knowledge by worktree | Breaks SSOT across sibling checkouts |
| Auto `AcceptanceDecision` from centrality/hops | ADR 0002 / 0012 |
| Adjudicated automatic Claim drafting | Still deferred from 2.0 |
| Widening adjudication recall to flatter search metrics | Precision-first stands |
| Neural SOTA / hosted embedding requirement for default path | Offline default required |
| Untagging 1.0.0 or 2.0.0 | Hard non-action |

---

## Users and primary jobs

| User | Job to be done |
| --- | --- |
| Operator across many repos/worktrees | Recover “what did we decide?” and “what happened in that checkout?” |
| Agent at session start | `memory_search` → `memory_neighborhood` → `memory_context_pack` |
| Maintainer | Ship a retrieval major only after eval + freeze Approve |

---

## Product requirements

### Functional

| ID | Requirement | Priority |
| --- | --- | --- |
| F1 | Capture records project + worktree id/name + branch (+ linked flag); absolute paths local-only | P0 |
| F2 | Retrieval chunks/queries support `project_ids` / `worktree_ids`; unknown origin not excluded | P0 |
| F3 | Same-worktree ranking boost without hiding sibling checkouts | P0 |
| F4 | EmbeddingProvider interface; default non-synthetic offline provider | P0 |
| F5 | Rebuildable `graph_nodes` / `graph_edges` from canonical events | P0 |
| F6 | Subject + decision_thread nodes with `about` / `in_thread` edges | P0 |
| F7 | `walkGraphNeighborhood` with budgets and omission reporting | P0 |
| F8 | MCP tool `memory_neighborhood` with graph provenance payload | P0 |
| F9 | Hybrid search expands seeds via graph; hop-decayed score; no acceptance from structure | P0 |
| F10 | Eval harness covers multi-hop, isolation, false-acceptance, rebuild, path safety | P0 |

### Non-functional

| ID | Requirement | Priority |
| --- | --- | --- |
| N1 | Canonical event stream remains SSOT; graph/vector rebuildable only | P0 |
| N2 | Default retrieval remains promoted/active only | P0 |
| N3 | Hooks stay fail-open; projection work off the hook hot path | P0 |
| N4 | Public-boundary: no absolute home paths in projections/sync | P0 |
| N5 | Interactive neighborhood target: depth ≤ 2, ≤ 64 nodes, no full-snapshot load | P0 |
| N6 | Freeze Defer until Approve; then SemVer 3.0.0 release | P0 |

---

## Architecture snapshot (3.0)

### Write / rebuild

```text
capture (+ project / worktree identity)
  → EvidenceArtifact → adjudication (2.0, unchanged semantics)
  → canonical events (authority)
  → projections (rebuildable):
        retrieval_chunks + FTS
        vectors (pluggable provider)
        graph_nodes + graph_edges
```

### Read (session start)

```text
memory_search (FTS + lexical embed + facets + graph seed expand)
  → memory_neighborhood (indexed k-hop, budgets)
  → memory_context_pack (budgeted working set)
```

### Identity

| Dimension | Role |
| --- | --- |
| `project_id` | **partition** — knowledge boundary (usually git remote) |
| `worktree_id` / `worktree_name` / `git_branch` | **facet** — filter, boost, provenance |

---

## Agent session UX requirements

At session start, agents SHOULD prefer:

1. **`memory_search`** — topic + optional `project_ids` / `boost_worktree_id`
2. **`memory_neighborhood`** — seed from a top hit’s record/event id
3. **`memory_context_pack`** — task-shaped working set

`memory_related` / `memory_trace` remain for lineage/audit; they are not the
primary neighborhood path (snapshot BFS vs indexed walk).

---

## Success criteria

1. R0–R9 gates green with merged PR evidence on `main` (see DoD freeze table).
2. Offline eval harness green in CI (multi-hop, cross-project isolation,
   false-acceptance 0, rebuild determinism, no path leaks).
3. MCP inventory includes `memory_neighborhood`; default search still promoted-only.
4. Freeze packet recorded; decision **Defer** until maintainer **Approve**.
5. Only after Approve: tag `v3.0.0`, publish `@innocarpe/carpeos@3.0.0`, leave
   1.0.0 and 2.0.0 intact.

---

## Implementation evidence (at freeze Defer)

| Gate | Story evidence (merged) |
| --- | --- |
| R0 Spec + ADR 0013 | PR #111 |
| R1 Capture identity | PR #112 |
| R2 Retrieval facets | PR #113 |
| R3 Embedding provider | PR #114 |
| R4 Graph materialization | PR #115 |
| R5 Entity resolution | PR #116 |
| R6 Neighborhood walk | PR #117 |
| R7 MCP neighborhood | PR #118 |
| R8 Graph-aware ranking | PR #119 |
| R9 Eval harness | PR #120 |
| R10 Freeze Defer | PR #121 |
| R11 Release 3.0.0 | **blocked on Approve** |

---

## Residual risk (honest)

1. Entity resolution is deterministic (`subject_ref` + components), not NLP coreference.
2. Default embeddings are offline lexical, not hosted neural SOTA.
3. Graph hop features in ranking are intentionally simple; calibratable later.
4. Hosted graph adapter (Neo4j etc.) is optional and unbuilt.
5. Claim auto-draft / auto-accept remain out of scope.

---

## Related

- [Product 3.0.0 DoD](maintainers/product-3.0.0.md)
- [ADR 0013 retrieval-first projection](adr/0013-retrieval-first-projection.md)
- [ADR 0010 graph vocabulary](adr/0010-graph-projection-vocabulary.md)
- [GraphRAG roadmap](plans/graphrag-roadmap.md)
- [PRD v1](PRD-v1.md) · [PRD v2](PRD-v2.md)
