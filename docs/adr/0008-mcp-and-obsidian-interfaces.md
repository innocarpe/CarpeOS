# ADR 0008: MCP and Obsidian Interfaces

Status: accepted for G007 local implementation

Date: 2026-07-29

## Context

CarpeOS needs local interfaces that let agents and humans read private memory
without turning generated views into the source of truth.

G004 created the local capture store and protected-value outbox. G005 added the
sync boundary. G006 added local retrieval projections with canonical recheck.
G007 exposes those local records through:

- a local stdio MCP server;
- deterministic MCP context packs;
- a deterministic Obsidian Markdown projection.

The public repository must remain synthetic. It must not contain real vaults,
runtime stores, local user paths, credentials, transcripts, private repository
URLs, or production logs.

## Decision

CarpeOS exposes MCP locally over stdio only. G007 does not open an HTTP listener,
ship a hosted MCP service, or claim a live deployment.

The server registers exactly these tools:

- `memory_search`
- `memory_get`
- `memory_context_pack`
- `memory_trace`
- `memory_timeline`
- `memory_related`
- `memory_capture`
- `memory_propose_claim`

Every MCP request must declare visible trust zones and protected-value policy.
The server fails closed when visibility is missing, malformed, outside the
configured allowlist, or does not include the active local trust zone. Retrieval
tools recheck candidates against the canonical local store before returning
records. Protected plaintext is not written to standard output or standard
error.

G007 pins the MCP SDK packages exactly:

- runtime: `@modelcontextprotocol/server@2.0.0`
- protocol tests: `@modelcontextprotocol/client@2.0.0`

The stdio runtime uses `serveStdio(..., { legacy: "serve" })`. This preserves
the SDK v2 legacy stdio serving path that the G007 spawned client/server tests
exercise. A future transport migration must be explicit and tested before this
compatibility choice changes.

`memory_propose_claim` writes a draft `Claim` to the local canonical outbox. It
validates support references before writing, accepts optional domain
`valid_time`, assigns `recorded_time` from the local-store clock, and never
writes an `AcceptanceDecision`.

MCP context packs derive accepted facts only when visible accepted
`AcceptanceDecision` lineage exists for a visible claim after trust-zone,
protected-value, lifecycle, authority, conflict, supersession, erasure,
valid-time, and recorded-time checks. Draft, rejected, conflicted, superseded,
erased, hidden, and redacted records remain separate lineage.

Context budgets are deterministic item and character budgets. `max_items` and
`max_characters` are not token-exact limits. Budgeted responses report `used`,
`truncated`, and `omitted` metadata.

Obsidian is a manifest-bounded projection, not authority. The projection package
generates Markdown notes and `.carpeos-obsidian-projection-manifest.json` from
typed local-store snapshots. It uses a closed category enum:

- `accepted_fact`
- `observation`
- `evidence_summary`
- `proposed_claim`
- `rejected_claim`
- `conflict`
- `supersession`
- `erasure`
- `index`

Every generated note includes source lineage and front matter with
`carpeos_projection: true` and `canonical_effect: "none"`. Rebuilds write only
inside the configured output root, reject unsafe paths, delete previously
managed files only when a valid manifest proves ownership, and preserve
unmanaged notes.

MCP and Obsidian code use typed local-store APIs and snapshots. Interface
packages must not issue ad hoc SQL against canonical tables.

## Consequences

- Agents can access the same local memory plane through a provider-neutral MCP
  surface.
- The server can be used by Codex CLI, Claude Code, Grok Build, and other MCP
  clients without changing canonical storage.
- Tool results remain bounded and deterministic enough for tests and reviews.
- Accepted facts stay tied to visible canonical acceptance lineage.
- Generated Obsidian notes are rebuildable review surfaces and can be deleted
  or recreated from the manifest without becoming source records.
- Hosted and multi-user authorization designs remain out of scope for G007.

## Non-Goals

G007 does not implement:

- hosted MCP;
- HTTP MCP transport;
- multi-user authorization server;
- hosted Obsidian sync;
- live Cloudflare deployment;
- Workers AI or Vectorize operation;
- graph projection;
- dashboard deployment;
- open-loop MCP tools;
- Obsidian edits as canonical writes.
