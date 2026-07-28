# Projections and Retrieval

Status: G006 local retrieval implementation plus planned future projections.

CarpeOS projections are read models derived from canonical events. They are
interfaces, not sources of truth.

## Projection Types

Implemented local projections include:

- retrieval chunks;
- retrieval full-text indexes;
- retrieval metadata indexes;
- local vector records;
- projection freshness records.

Planned future projections include:

- accepted-fact views;
- Obsidian notes;
- graph indexes;
- dashboards;
- MCP context packs;
- session timelines;
- open-loop lists.

All projections MUST be rebuildable from visible canonical events, erasure
records, configuration, and authorization policy.

G006 local retrieval projections are rebuilt by `carpeos retrieval rebuild`.
Rebuilds do not mutate canonical events.

## Chunking Policy

Retrieval chunks are meaningful knowledge units:

- claims;
- observations;
- acceptance decisions;
- session summaries when available;
- selected evidence metadata when safe.

Retrieval chunks MUST NOT be raw hook JSON dumps. Protected values, encrypted
ciphertext, provider payloads, credentials, local absolute paths, private
repository URLs, and production logs must not be projected into chunk text.

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

G006 local retrieval returns result metadata for source records, score
components, filters, stale projections, supersession, erasure, and exclusion
reasons. `memory search` and `memory get` require explicit visible trust-zone
filters.

## Vector Search

Vector search is a candidate-retrieval mechanism. It is not an authority model.

Vector results MUST be rechecked against canonical events before they are used
as facts. A vector hit can point to a claim, observation, or evidence artifact,
but acceptance still depends on visible `AcceptanceDecision` and
`Supersession` records.

The local `deterministic-local-dev` provider exists only for stable tests and
developer smoke checks. It does not claim semantic quality. Hosted Workers AI
and Vectorize are optional adapter paths and are not deployed by this
repository.

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
