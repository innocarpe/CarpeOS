# Projections and Retrieval

Status: G007 local retrieval, MCP context-pack, Obsidian projection, and OKF
export projection implementation; other future projections remain planned.

CarpeOS projections are read models derived from canonical events. They are
interfaces, not sources of truth.

## Projection Types

Implemented local projections include:

- retrieval chunks;
- retrieval full-text indexes;
- retrieval metadata indexes;
- local vector records;
- projection freshness records;
- graph nodes and edges (product 3.0);
- MCP context packs;
- Obsidian Markdown notes and manifests.
- OKF v0.2 export bundles (`okf-export/v1`; portable exchange, not authority).

Planned future projections include:

- accepted-fact views;
- dashboards;
- session timelines;
- open-loop lists.

The `@carpeos/okf-projection` package and `carpeos okf export` /
`carpeos okf rebuild` CLI produce OKF v0.2 bundles from explicitly visible
trust zones. This is a rebuildable, non-authoritative projection: it does not
mutate canonical events, and it has no import path in product 3.1. See the
[OKF export guide](../guides/okf-export.md), [ADR 0014](../adr/0014-okf-export-projection.md),
and [product-3.1.0](../maintainers/product-3.1.0.md).

All projections MUST be rebuildable from visible canonical events, erasure
records, configuration, and authorization policy.

G006 local retrieval projections are rebuilt by `carpeos retrieval rebuild`.
Rebuilds do not mutate canonical events.

G007 MCP context packs are built by the local stdio MCP server. They are
deterministic, budgeted agent-facing views over visible canonical events and
erasure records.

G007 Obsidian projections are rebuilt by the `@carpeos/obsidian-projection`
package from typed local-store snapshots. Rebuilds write generated notes and a
manifest under the configured output root. They do not mutate canonical events.

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

G007 MCP tools require explicit visible trust-zone filters on every request. A
request that omits visibility, asks for an unknown zone, or excludes the active
local trust zone fails closed before content resolution.

Accepted facts are emitted only when the visible canonical event graph contains
a visible accepted `AcceptanceDecision` for the visible claim. Draft, rejected,
conflicted, superseded, erased, hidden, and protected-policy-denied records are
separate lineage, not facts.

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

G007 implements a manifest-bounded Obsidian projection with this closed category
set:

- `accepted_fact`;
- `observation`;
- `evidence_summary`;
- `proposed_claim`;
- `rejected_claim`;
- `conflict`;
- `supersession`;
- `erasure`;
- `index`.

The manifest records generated file paths, category, source lineage, content
digests, configuration digest, visible trust zones, and path policy. Rebuilds
delete previously managed files only when a valid previous manifest proves
ownership. A corrupt previous manifest preserves prior files.

Generated paths MUST stay inside the configured output root. Absolute paths,
path traversal, backslashes, null bytes, empty segments, and non-Markdown paths
are rejected.

## MCP Context Packs

MCP context packs are agent-facing projections. They use deterministic
`ContextBudget` limits:

- `max_items`;
- `max_characters`.

These are stable item and character limits, not token-exact limits. Responses
report `used`, `truncated`, and `omitted` metadata.

Context packs separate accepted facts, draft claims, rejected claims,
observations, evidence summaries, conflicts, supersessions, erasures,
verification gaps, and redactions. They are rebuilt from visible canonical
records and never become canonical knowledge themselves.

## Failure Modes

| Failure mode | Required response |
| --- | --- |
| Projection cannot find a referenced event | Mark the projection stale or invalid. |
| Projection has plaintext after erasure | Delete or rebuild the projection. |
| Vector hit points to claim with a visible rejection decision | Return rejected lineage, not accepted fact. |
| Graph contains orphan edge | Rebuild or flag edge as invalid. |
| Context pack exceeds character or item budget | Return bounded sections and `used`/`truncated`/`omitted` metadata. |
| MCP request omits visibility | Fail closed before resolving content. |
| Generated Obsidian path escapes output root | Reject the rebuild. |
| Previous Obsidian manifest is corrupt | Preserve prior managed-looking files and write only the next proven manifest/files. |
