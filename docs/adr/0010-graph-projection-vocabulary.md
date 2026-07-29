# ADR 0010: Graph Projection Vocabulary (GraphRAG G-R0)

Status: accepted

Date: 2026-07-29

## Context

CarpeOS already supports hybrid retrieval and deterministic `memory_related` /
`memory_trace` walks over canonical edges. A fuller GraphRAG path needs shared
vocabulary for graph **nodes** and **edges** before materializing indexes.

Risk: teams invent a sixth core `event_type` or treat graph centrality as
acceptance. That would break ADR 0001–0009 invariants.

## Decision

1. Graph structures are **rebuildable projections** only (`canonical_effect:
   none`). They are never the knowledge source of truth.
2. v1 does **not** add a new core `CanonicalEvent.event_type` for graph nodes.
3. Graph node and edge kinds are derived from existing canonical fields and
   optional projection metadata (entities, open loops, run ledger entries).
4. Graph scores may influence **candidate ranking** only. Every result still
   requires canonical recheck, trust-zone visibility, and (for accepted facts)
   `AcceptanceDecision` lineage.
5. Normative vocabulary lives in `spec/v1/graph-projection.md` and is staged by
   `docs/plans/graphrag-roadmap.md` (G-R0 complete with this ADR + spec).

## Consequences

Positive:

- GraphRAG work can proceed without ontology forks.
- MCP/CLI can later expose walks without redefining claims.

Tradeoffs:

- Entity resolution remains derived and imperfect until G-R4.
- Early graph edges are sparse (lineage-heavy, community-light).

## Related

- `docs/plans/graphrag-roadmap.md`
- `spec/v1/graph-projection.md`
- ADR 0001, 0007, 0009
