# Product 3.0.0 — Definition of Done

Status: **implementation complete / freeze Defer**. Waiting on maintainer Approve before release.

Related:

- [Product 2.0.0 DoD](product-2.0.0.md) — knowledge adjudication (shipped)
- [Product 1.0.0 DoD](product-1.0.0.md) — capture pipeline freeze (shipped)
- [ADR 0013](../adr/0013-retrieval-first-projection.md) — retrieval-first projection layer
- [ADR 0010](../adr/0010-graph-projection-vocabulary.md) — graph node/edge vocabulary
- [ADR 0001](../adr/0001-canonical-store-and-projections.md) — canonical store and projections
- [GraphRAG roadmap](../plans/graphrag-roadmap.md) — staged plan this major executes
- Public package: `@innocarpe/carpeos` (currently `2.0.0`)

---

## What 3.0.0 means (SOURCE OF TRUTH)

**`3.0.0` means an agent session in any repository or worktree can ask CarpeOS a
question and receive a bounded, relevant, provenance-carrying knowledge
neighborhood — fast enough to use mid-task.**

1.0 proved the pipeline runs. 2.0 proved only judged content is stored. Neither
proved the knowledge can be **found**.

> If retrieval is weak, adjudication quality is invisible.
> A knowledge OS that cannot answer “what did we decide about this, here?” in one
> call is an encrypted archive with a search box.

### Version thesis progression

| | 1.0.0 | 2.0.0 | **3.0.0** |
| --- | --- | --- | --- |
| Question | Does the loop run? | Is this worth remembering? | **Can it be found and used?** |
| Core engine | capture + canonical store | adjudication (`adj_v1`) | **retrieval projection + graph** |
| Success signal | `smoke:product` | `smoke:knowledge`, `smoke:dogfood` | **multi-hop recall + latency budget** |
| Failure if skipped | no durable data | dump pollution | **unusable brain** |

---

## Why now — verified gaps on `main` at 2.0.0

Code-level findings, not opinions.

| # | Gap | Evidence |
| --- | --- | --- |
| 1 | Retrieval index materializes **no graph** | `packages/retrieval/src/local-index.ts` creates only `retrieval_chunks`, `projection_freshness`, `local_vectors`, and an FTS virtual table. No node or edge table exists. |
| 2 | Canonical ontology **collapses at index time** | Retrieval keeps a flat `chunk_kind` of `summary`, `claim`, `decision`, `evidence_excerpt`, `open_loop`. Provenance such as `supports`, `contradicts`, and `derived_from` stays inside event JSON and never becomes a queryable edge. |
| 3 | Retrieval has **no project dimension** | Query filters cover trust zone, lifecycle, epistemic authority, protected-value policy, conflict policy, and bitemporal windows. `project_id` exists in `packages/local-store/src/project-identity.ts` but never reaches a retrieval filter. |
| 4 | Worktree identity is **entirely lost** | `project_id` resolves from a git remote hash, so every worktree of one repository collapses to a single id. No worktree, branch, or checkout field is captured. |
| 5 | Identity derivation is **inconsistent** | Git repositories merge worktrees into one `project_id`; non-git directories split by workspace-root hash. Same concept, opposite rule. |
| 6 | Traversal is a **full scan plus in-memory walk** | `memory_trace` and `memory_related` load the visible snapshot, build a lookup map, and walk a queue over related event ids. There is no traversal index. |
| 7 | The vector leg is a **placeholder** | The only provider is `deterministic-local-dev`, which self-reports `semantic_quality: "synthetic-dev-only"`. Practical recall is FTS. |
| 8 | GraphRAG is **spec-only** | `docs/plans/graphrag-roadmap.md` is `Status: planned`. Only G-R0 (vocabulary) landed; G-R1 through G-R5 are unimplemented. |

**Structural summary:** the 2.0 major invested entirely in the write path. The
read path is still 1.0 shaped.

---

## Non-negotiable invariants

3.0 must not buy retrieval speed by weakening these.

1. The append-only `CanonicalEvent` stream stays the source of truth. Graph and
   vector stores are **rebuildable, non-authoritative projections** (ADR 0001).
2. Graph structure influences **candidate discovery and ranking only**. Every
   returned record still passes canonical recheck for trust zone, erasure,
   supersession, and acceptance lineage (ADR 0010).
3. No automatic `AcceptanceDecision`. Centrality, recency, and hop distance never
   imply acceptance (ADR 0002, ADR 0012).
4. Default retrieval surfaces promoted/active meaning only. Held and draft stay
   opt-in (`--include-held`, `include_held`).
5. Precision over recall. A wider net that reintroduces dump behavior is a
   regression even when recall improves.
6. Host hooks stay fail-open and fast. Projection work never runs inside a hook.
7. Absolute local filesystem paths never enter canonical statements, retrieval
   chunk text, graph node labels, or sync payloads.
8. Rebuild determinism: dropping every projection and rebuilding from canonical
   events must reproduce equivalent retrieval behavior.

---

## Architecture (target)

### Dual-write at ingest

The 2.0 mistake was treating the projection layer as a later roadmap item. 3.0
writes both paths within the same ingest boundary.

```text
provider hook (fail-open, fast)
  -> capture envelope (+ project / worktree / branch identity)
  -> EvidenceArtifact  --------------------------+
  -> adjudication (adj_v1)                       |  canonical (authority)
  -> promote | hold | reject                     |
       |                                         |
       +-- promote/hold -> Observation ----------+
       |
       +-- projection write (rebuildable, non-authoritative)
             +-- retrieval_chunks + FTS
             +-- vectors (pluggable provider)
             +-- graph_nodes + graph_edges          <- new in 3.0
```

### Read path

```text
query (+ current project / worktree context)
  -> seed candidates
       +-- FTS
       +-- vector similarity
       +-- facet filter (project partition, worktree facet)
  -> bounded k-hop expansion over graph_edges (indexed, budgeted)
  -> rank: seed score + hop decay + recency + lifecycle + same-worktree boost
  -> canonical recheck (trust zone, erasure, supersession, acceptance)
  -> context pack / MCP response with provenance
```

---

## Identity model — partition vs facet

This distinction is load-bearing. Reversing it breaks the cross-repository thesis.

| Dimension | Meaning | Role | Cardinality |
| --- | --- | --- | --- |
| `project_id` | knowledge boundary (repository identity) | **partition** | one per repository |
| `worktree_id` | where the work happened (checkout) | **facet** | many per project |
| `worktree_name` | human recall label | facet | many per project |
| `git_branch` | working context | facet | changes over time |

**Knowledge partitions by project, never by worktree.** A decision recorded in
one worktree must be retrievable from a sibling worktree of the same project.
Partitioning by worktree would defeat the single-source-of-truth goal.

Worktree as a facet delivers what partitioning falsely promises:

- knowledge survives worktree deletion, because it is stored under the project;
- “what was I doing in that experiment checkout?” becomes a filter;
- results from the current worktree can be boosted without hiding the rest;
- provenance can show where and on which branch a decision was made.

### Derivation

Git already provides everything required:

```sh
git rev-parse --show-toplevel     # worktree root; basename becomes worktree_name
git rev-parse --abbrev-ref HEAD   # git_branch
git rev-parse --git-dir           # linked worktrees differ from the common dir
git rev-parse --git-common-dir    # main repository git dir
```

A linked worktree is identified when the git dir differs from the common dir.

### Privacy shape

The repository's own public-boundary check rejects absolute home paths, so
identity fields split by exposure:

| Field | Value | Exposure |
| --- | --- | --- |
| `worktree_id` | hash of device client id plus absolute worktree root | safe, stable |
| `worktree_name` | basename only | safe recall key |
| `git_branch` | branch name | safe |
| `workspace_root` | absolute path | **local only**; never in chunks, statements, graph labels, or sync |

Both a stable id and a human label are required: directory names get renamed and
reused, ids must not.

### Consistency fix

Non-git workspaces currently split by path while git worktrees merge. 3.0
normalizes the rule: **project identity prefers repository identity; the
workspace path only contributes to the worktree facet.**

---

## Ontology to materialized graph

Node and edge kinds derive from existing canonical fields. 3.0 adds **no new core
`CanonicalEvent` event type**, preserving the ADR 0010 constraint.

### Nodes

| Node kind | Source | Stage |
| --- | --- | --- |
| `project` | project identity | R1 |
| `worktree` | capture identity | R1 |
| `meaning_unit` | Observation / Claim | R4 |
| `evidence` | EvidenceArtifact | R4 |
| `subject` | resolved topic | R5 |
| `decision_thread` | clustered related decisions | R5 |

### Edges

| Edge kind | From to To | Source | Stage |
| --- | --- | --- | --- |
| `belongs_to` | meaning_unit to project | capture identity | R4 |
| `observed_in` | meaning_unit to worktree | capture identity | R4 |
| `derived_from` | meaning_unit to evidence | provenance | R4 |
| `supports` | meaning_unit to meaning_unit | claim support | R4 |
| `contradicts` | meaning_unit to meaning_unit | claim support | R4 |
| `supersedes` | meaning_unit to meaning_unit | Supersession | R4 |
| `accepted_by` | claim to acceptance decision | AcceptanceDecision | R4 |
| `about` | meaning_unit to subject | entity resolution | R5 |
| `in_thread` | meaning_unit to decision_thread | entity resolution | R5 |

Edges are materialized at ingest and fully rebuildable. Erasure and supersession
must remove or hide edges during rebuild.

---

## Storage decisions

| Layer | 3.0 default | Optional adapter later |
| --- | --- | --- |
| Canonical | local SQLite, append-only | — |
| Graph | `graph_nodes` and `graph_edges` in local SQLite with covering indexes and bounded traversal | hosted graph engine |
| Vector | local vector index alongside chunks | hosted vector index |
| Embeddings | pluggable provider interface with a local default | hosted embedding API |

**Why the default stays local.** At personal scale — one operator, tens of
repositories, on the order of 10^4 to 10^6 events, two to three hop questions —
an indexed edge table answers neighborhood queries within budget while preserving
local-first operation and rebuild determinism.

**When a dedicated graph engine earns its place.** Variable-length path queries,
community detection over decision clusters, high-degree traversal, or graph
algorithms becoming product features. At that point it enters as a rebuildable
read accelerator behind an adapter boundary — never as canonical storage, never
as the write target for erasure or acceptance.

The present bottleneck is that **no nodes or edges are produced at all**. Changing
engines before producing them would not improve retrieval.

---

## Product gates (living) — 3.0

Status values: `done`, `partial`, `todo`, `blocked`. A gate moves to **done** only
with linked implementation and verification evidence.

| # | Criterion | Status |
| --- | --- | --- |
| R0 | Spec: this document plus ADR 0013 | **done** — PR #111 |
| R1 | Capture identity carries project, worktree id and name, branch, and linked-worktree flag; derivation consistent; absolute paths stay local | **done** — PR #112 |
| R2 | Retrieval chunks and queries carry project partition and worktree facet; same-worktree ranking boost; CLI and MCP filters | **done** — PR #113 |
| R3 | Pluggable embedding provider with a non-placeholder default; vector index wired; provider identity recorded in projection metadata | **done** — PR #114 |
| R4 | `graph_nodes` and `graph_edges` materialized at ingest, rebuildable, erasure and supersession aware | **done** — PR #115 |
| R5 | Entity resolution produces `subject` and `decision_thread` nodes with deterministic, testable rules | **done** — PR #116 |
| R6 | Bounded k-hop traversal over the edge index with depth and node budgets and reported omissions | **done** — PR #117 |
| R7 | MCP neighborhood retrieval surface plus context-pack integration, provenance-carrying | **done** — PR #118 |
| R8 | Graph-aware ranking integrated with hybrid seeds; precision guardrails intact | **done** — PR #119 |
| R9 | Retrieval eval harness: multi-hop recall, cross-repository and cross-worktree scenarios, latency budget, zero false acceptance, rebuild determinism | **done** — PR #120 |
| R10 | Freeze decision for 3.0 contracts (Defer until Approve) | **done (Defer)** — freeze packet below |
| R11 | SemVer **3.0.0** release only after explicit maintainer Approve | **blocked** |

### Definition of “fast enough” (R9)

Budgets target a personal-scale local store on developer hardware, measured on
synthetic fixtures in CI plus one operator spot check:

| Operation | Target |
| --- | --- |
| Seeded neighborhood query (depth at most 2, at most 64 nodes) | interactive; must not require a full-snapshot load |
| Context pack assembly | within the existing budget contract |
| Full projection rebuild | bounded, reported, idempotent |

Numeric thresholds are set in R9 against measured baselines rather than guessed
here.

---

## Story order and PR split — `carpeos-product-300`

Sequential and coherent: each PR lands one contract. Later stories assume earlier
ones merged.

| Story | PR title | Gate | Depends on |
| --- | --- | --- | --- |
| G001 | `docs: add product 3.0 spec and retrieval-first ADR` | R0 | — |
| G002 | `feat(capture): record project and worktree identity` | R1 | G001 |
| G003 | `feat(retrieval): add project partition and worktree facet` | R2 | G002 |
| G004 | `feat(retrieval): add pluggable embedding provider` | R3 | G001 |
| G005 | `feat(retrieval): materialize graph nodes and edges` | R4 | G002 |
| G006 | `feat(retrieval): resolve subject and decision-thread entities` | R5 | G005 |
| G007 | `feat(retrieval): add bounded neighborhood traversal` | R6 | G005 |
| G008 | `feat(mcp): expose memory neighborhood retrieval` | R7 | G007 |
| G009 | `feat(retrieval): integrate graph-aware ranking` | R8 | G007, G004 |
| G010 | `test(eval): add multi-hop retrieval evaluation harness` | R9 | G009 |
| G011 | `docs: record product 3.0 freeze decision` | R10 | G001–G010 |
| G012 | `chore(release): @innocarpe/carpeos v3.0.0` | R11 | Approve |

Optional and explicitly off the critical path:

| Story | PR title | Note |
| --- | --- | --- |
| G013 | `feat(retrieval): add hosted graph index adapter` | Only after G005–G007 are stable; rebuildable, never canonical |

### Why this order

- G002 precedes G003 and G005 because identity fields must exist before anything
  indexes or links them; adding them later forces a second capture migration.
- G004 is parallel-safe after G001 — embedding quality is independent of graph
  work and unblocks semantic recall early.
- G005 precedes G006 because edges must exist before entities are worth resolving.
- G007 precedes G008 so the MCP surface wraps a tested traversal contract.
- G010 follows G009 so evaluation measures the integrated path, not a fragment.

---

## Migration and compatibility

- **Schema:** new local-store migrations for identity columns and graph tables.
  Existing homes upgrade on open with no silent wipe.
- **Backfill:** projection rebuild reconstructs graph and facets from existing
  canonical events. Events captured before R1 have no worktree facet; retrieval
  must treat a missing facet as unknown rather than excluding the record.
- **Public surface:** a new optional MCP tool and new optional CLI flags. Existing
  `memory search` and `memory context-pack` behavior stays valid.
- **Package major:** 3.0.0 is a product-meaning major because the default
  retrieval contract gains dimensions and a new authority-preserving read path.
  It does not retag or unpublish `1.0.0` or `2.0.0`.

---

## Explicit non-goals for 3.0.0

| Non-goal | Why out |
| --- | --- |
| A hosted graph engine as canonical storage | Violates ADR 0001; projections stay rebuildable |
| Multi-tenant graph or retrieval service in this repository | Out of product scope |
| Replacing bitemporal query semantics with graph time | Time axes stay canonical |
| Auto-merging conflicting claims via centrality | Acceptance is never derived from structure |
| Adjudicated automatic Claim drafting | Still deferred from the 2.0 decision |
| Training or fine-tuning a personal graph into model weights | Out of scope |
| Widening adjudication recall to flatter retrieval metrics | Precision-first stands |

---

## Evaluation sketch (R9)

Synthetic, public-safe fixtures only.

| Scenario | Assertion |
| --- | --- |
| Cross-worktree recall | A decision recorded in worktree A of project P is retrievable from worktree B of project P |
| Cross-project isolation | Project Q knowledge does not leak into a project-P-scoped query |
| Worktree facet recall | Filtering by a worktree facet returns that checkout's work, including after the directory is gone |
| Multi-hop recall | A related decision within the depth budget appears in the neighborhood result |
| False acceptance | Accepted-fact count derived from graph structure alone remains zero |
| Budget honesty | Traversal reports nodes used and omitted and never exceeds caps |
| Rebuild determinism | Dropping and rebuilding projections yields equivalent results |
| Boundary safety | No absolute local path appears in any projected artifact |

---

## Release policy

3.0.0 follows the same gate as prior majors:

1. R0 through R9 green with linked evidence.
2. R10 freeze packet written with residual risk stated honestly.
3. Decision remains **Defer** until a maintainer records explicit **Approve**.
4. Only then R11: cut the release, tag `v3.0.0`, publish.

Do not tag, publish, or describe 3.0 as complete before that sequence.

---

## Relationship to shipped code

**Reuse unchanged:** capture adapters, outbox, canonical store, protected values,
trust zones, adjudication (`adj_v1`), held review, doctor, precision smokes.

**Extend:** capture identity fields, retrieval chunk schema and query filters,
embedding provider boundary, MCP retrieval surface.

**Add:** graph node and edge projection, entity resolution, bounded traversal,
retrieval evaluation harness.

**Do not touch:** epistemic model event types, acceptance semantics, or
adjudication thresholds without separate precision evidence.

---

## G011 Freeze decision (2026-07-31) — **Defer**

One-read freeze packet for `@innocarpe/carpeos` **3.0.0**. Decision remains
**Defer** until a maintainer records explicit **Approve** in chat. Packaging and
tagging are blocked while Defer stands.

### Green gates (evidence on `main`)

| Gate | PR | Evidence |
| --- | --- | --- |
| R0 Spec + ADR 0013 | [#111](https://github.com/innocarpe/CarpeOS/pull/111) | product-3.0.0.md + ADR 0013 |
| R1 Capture identity | [#112](https://github.com/innocarpe/CarpeOS/pull/112) | worktree facet + migration 006 |
| R2 Retrieval facets | [#113](https://github.com/innocarpe/CarpeOS/pull/113) | project/worktree filters + boost |
| R3 Embedding provider | [#114](https://github.com/innocarpe/CarpeOS/pull/114) | local-lexical-hash default |
| R4 Graph materialization | [#115](https://github.com/innocarpe/CarpeOS/pull/115) | graph_nodes / graph_edges |
| R5 Entity resolution | [#116](https://github.com/innocarpe/CarpeOS/pull/116) | subject + decision_thread |
| R6 Neighborhood walk | [#117](https://github.com/innocarpe/CarpeOS/pull/117) | walkGraphNeighborhood |
| R7 MCP neighborhood | [#118](https://github.com/innocarpe/CarpeOS/pull/118) | memory_neighborhood tool |
| R8 Graph-aware ranking | [#119](https://github.com/innocarpe/CarpeOS/pull/119) | hop-decay boost + seed expansion |
| R9 Eval harness | [#120](https://github.com/innocarpe/CarpeOS/pull/120) | offline multi-hop / isolation suite |

### Validation commands (public-safe)

Run on a clean checkout of `main` after the merges above:

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm smoke:product
pnpm smoke:knowledge
pnpm smoke:dogfood
pnpm public-boundary
```

Retrieval package tests include the R9 harness
(`packages/retrieval/test/retrieval-eval.harness.test.ts`).

### Residual risk (still true after implementation)

1. **Entity resolution is deterministic, not smart.** Subjects come from
   `subject_ref`; decision threads are subject-scoped connected components. No
   NLP coreference, no fuzzy entity merge.
2. **Local-lexical embeddings are offline and useful, not neural SOTA.** They
   beat whole-text synthetic hashes; they are not a hosted model.
3. **Graph hop distance in ranking is approximate** (seed = 0, neighborhood member ≤ 1
   in the current expansion path). Deeper calibrated hop features can improve
   later without a contract break.
4. **Neighborhood MCP maps non-event nodes as projection refs.** Operators still
   recheck canonical event records for authority.
5. **No production latency benchmark farm.** Budgets are enforced and tested;
   wall-clock targets remain operator-spot-check territory.
6. **Hosted graph / Neo4j adapter is still optional and unbuilt** (G013).

### Deferred work (not blockers for documenting Defer)

- G013 hosted graph index adapter
- Richer hop-distance features and eval thresholds as numeric SLOs
- Claim-form / auto-claim still deferred from 2.0
- Context-pack expert-slot wiring that prefers neighborhood packs by default

### Hard non-actions (still)

- Do **not** tag or publish `3.0.0` while this decision is Defer.
- Do **not** retag or unpublish `1.0.0` / `2.0.0`.
- Do **not** make graph/vector stores canonical.
- Do **not** auto-create `AcceptanceDecision` from graph structure.
- Do **not** partition knowledge by worktree.

### Unlock condition

Maintainer chat message containing an explicit **Approve** for product 3.0
freeze. Only then may G012 (`chore(release): @innocarpe/carpeos v3.0.0`) start.

