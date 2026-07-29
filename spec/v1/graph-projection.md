# CarpeOS v1 Graph Projection Vocabulary

Status: **normative vocabulary for planned GraphRAG stages (G-R0)**.  
Materialized graph indexes and walk APIs are **not** required for conformance
until later roadmap stages land with tests.

This document freezes names for projection-only graph nodes and edges. It does
not expand the core `CanonicalEvent.event_type` enum.

## Authority

| Layer | Role |
| --- | --- |
| Canonical events + erasure ledger | Source of truth |
| Graph projection | Rebuildable candidate structure |
| Retrieval / context packs | Consumers of candidates after recheck |

Graph membership or centrality MUST NOT create or imply `AcceptanceDecision`.

## Node kinds (projection)

| Kind | Derived from | Notes |
| --- | --- | --- |
| `event` | Any `CanonicalEvent` | Primary node; id = `event_id` |
| `claim` | `Claim` payload id | May alias to claim event node |
| `observation` | `Observation` payload id | |
| `artifact` | `EvidenceArtifact` payload id | Procedure traces included |
| `decision` | `AcceptanceDecision` payload id | |
| `supersession` | `Supersession` payload id | |
| `entity` | Derived subject/project refs | Optional until G-R4 |
| `open_loop` | Product projection loops | Optional, non-canonical |
| `run` | Run ledger projection | Optional, non-canonical |

Implementations MAY collapse payload aliases onto the parent event node. If both
exist, they MUST remain linked by an explicit edge.

## Edge kinds (projection)

Edges SHOULD be directed unless noted.

| Kind | Typical source → target | Origin |
| --- | --- | --- |
| `supports` | claim → observation/event | claim support / provenance |
| `contradicts` | claim → claim/event | provenance relationship |
| `derived_from` | event → event/artifact | provenance |
| `quotes` | event → event | provenance |
| `decides` | decision → claim | acceptance claim_refs |
| `supersedes` | supersession → event | supersedes_event_id |
| `replaced_by` | event → event | replacement_event_id |
| `same_subject` | event → event | equal `subject_ref` (optional) |
| `same_run` | event → run | run ledger links (optional) |
| `related` | event → event | reserved for later derived links |

Unknown edge kinds MUST be ignored by walkers that do not understand them
(forward compatible), not treated as errors, unless a request explicitly
requires that kind.

## Visibility and erasure

- Graph rebuild MUST only include nodes/edges visible under the requested trust
  zones after erasure and supersession policy for the query context.
- Erased targets MUST NOT appear as visible graph nodes in active projections.
- Stale projections MUST be rebuildable from canonical inputs alone.

## Walk parameters (planned G-R2)

| Parameter | Meaning | Suggested default |
| --- | --- | --- |
| `root_id` | event/payload/erasure id | required |
| `max_depth` | hop limit | 2–4 |
| `max_nodes` | hard node budget | implementation-defined |
| `edge_kinds` | allowlist | all known kinds |
| `visible_trust_zone_ids` | required | fail closed if missing |

Walk responses SHOULD report budgets used/omitted similarly to context packs.

## Ranking integration (planned G-R3)

Graph neighborhood expansion is a **candidate source** parallel to FTS and
vector search. Final ranking still runs diversity selection and canonical
recheck. Graph score MUST NOT bypass acceptance rules for context packs.

## Non-goals (G-R0)

- Materialized graph storage schema (G-R1)
- CLI/MCP walk commands (G-R2+)
- Entity resolution quality guarantees (G-R4)
- Hosted graph indexes (G-R5)

## Related

- ADR 0010
- `docs/plans/graphrag-roadmap.md`
- `spec/v1/canonical-model.md`
- `spec/v1/retrieval-projections.md`
