# Projections and Retrieval

Status: planned architecture for the v1 MVP.

CarpeOS projections are read models derived from canonical events. They are
interfaces, not sources of truth.

## Projection Types

Planned projections include:

- accepted-fact views;
- Obsidian notes;
- vector indexes;
- graph indexes;
- dashboards;
- MCP context packs;
- session timelines;
- open-loop lists.

All projections MUST be rebuildable from visible canonical events, erasure
records, configuration, and authorization policy.

## Query Engine

The query engine resolves:

- trust-zone visibility;
- protected-value access;
- valid-time filters;
- recorded-time filters;
- lifecycle-status filters;
- epistemic-authority filters;
- supersession chains;
- acceptance decisions;
- provenance expansion.

The query engine SHOULD return uncertainty, conflict, and redaction metadata.
It SHOULD NOT return a single polished fact when the visible event graph is
conflicted or incomplete.

## Vector Search

Vector search is a candidate-retrieval mechanism. It is not an authority model.

Vector results MUST be rechecked against canonical events before they are used
as facts. A vector hit can point to a claim, observation, or evidence artifact,
but acceptance still depends on visible `AcceptanceDecision` and
`Supersession` records.

## Graph Search

Graph projections MAY materialize provenance, entity, relation, and supersession
edges. Graph edges MUST remain traceable to canonical events or deterministic
derivation rules.

## Obsidian Projection

Obsidian is a human reading and curation surface. Obsidian files SHOULD include
stable references back to canonical events. Editing generated notes MUST NOT be
treated as canonical mutation unless a separate capture flow turns the edit into
a new canonical event.

## Failure Modes

| Failure mode | Required response |
| --- | --- |
| Projection cannot find a referenced event | Mark the projection stale or invalid. |
| Projection has plaintext after erasure | Delete or rebuild the projection. |
| Vector hit points to claim with a visible rejection decision | Return rejected lineage, not accepted fact. |
| Graph contains orphan edge | Rebuild or flag edge as invalid. |
| Context pack exceeds token budget | Return bounded summary and truncation metadata. |
