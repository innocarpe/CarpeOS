# CarpeOS

[English](README.md) | [한국어](README.ko.md)

**Capture context. Compound knowledge.**

CarpeOS is a personal knowledge operating system for AI-assisted work.

It is designed to capture work across AI agents, structure it as
provenance-aware knowledge, synchronize it across devices, and expose that
knowledge through retrieval interfaces for both humans and LLMs. The current
G007 implementation covers local capture, durable outbox storage, a Cloudflare
Worker/D1/R2 sync backend and client, local rebuildable retrieval projections
with CLI search/get commands, a local stdio MCP server, deterministic MCP
context packs, and a manifest-bounded Obsidian projection package. These paths
have synthetic test coverage in the repository. No live Cloudflare deployment
or hosted MCP/Obsidian service is claimed. GraphRAG, hosted embedding jobs,
hosted retrieval, dashboard deployment, and production semantic retrieval
quality are planned milestones, not active features.

This repository is the canonical place for the public design, specifications,
implementation, and roadmap. It does not contain a user's private knowledge
store.

## Core Principle

**Public implementation. Private knowledge.**

The public CarpeOS repository contains:

- ontology and event specifications;
- sync and retrieval protocols;
- local collector, hook, CLI, MCP, and projection code;
- migrations, tests, and synthetic fixtures;
- architecture records and contributor documentation.

A user's private CarpeOS instance contains:

- real AI session transcripts;
- evidence artifacts;
- personal project records;
- canonical events, claims, decisions, supersessions, and derived facts;
- open loops and task history;
- device keys, zone keys, credentials, and runtime databases.

The repository should never include real user project names, real session data,
credentials, production logs, private repositories, or exported runtime stores.

## Current Implementation

G004 adds a local capture runtime:

- provider-neutral raw `EvidenceArtifact` capture;
- Codex, Claude Code, and Grok Build hook template examples;
- an AES-256-GCM protected-value store for raw hook JSON;
- local key material stored outside the SQLite database;
- a Node 22.22+ local store built on `node:sqlite`;
- append-only `capture_requests` and `canonical_events` tables;
- a durable, idempotent metadata outbox with `pending`, `leased`, and
  `delivered` state;
- project identity derived from an explicit project ID, sanitized Git remote
  hash, or device-local workspace hash;
- a CLI surface for local init, project identity, hook capture, and outbox
  inspection.

The local store writes raw provider payloads as encrypted protected values and
stores only metadata and protected-value references in canonical events. One
`protected_value_id` connects the canonical reference, encrypted local row,
leased outbox metadata, and future erasure target. Local capture assigns
`local_sequence` for device ordering. It does not assign canonical
`zone_sequence`; that remains a server-side G005 responsibility.

G005 adds the first sync boundary:

- authenticated `sync push`, `sync pull`, `sync once`, and `sync status` CLI
  commands;
- encrypted protected-value upload/download before metadata acceptance;
- D1-backed idempotency, replay, conflict, per-zone sequence, and pull cursor
  state;
- R2-backed encrypted protected-value ciphertext storage;
- out-of-band trust-zone sync key enrollment for MacBook/Mac mini sharing;
- synthetic local integration tests for the Worker, client, local store, and
  CLI.

The sync backend is deployable code and local test infrastructure only. This
repository does not claim that a production Cloudflare Worker, D1 database, or
R2 bucket has been provisioned.

G006 adds the first local retrieval boundary:

- rebuildable retrieval chunks derived from canonical events and erasure
  records;
- meaningful-unit chunking for claims, observations, decisions, and selected
  evidence metadata instead of raw hook JSON;
- FTS, structured metadata, recency, and locally stored vector candidate paths;
- canonical recheck of every result against trust-zone visibility, lifecycle,
  authority, supersession, erasure, and projection freshness;
- deterministic local development embeddings for tests and local smoke checks;
- `retrieval rebuild`, `retrieval embed`, `memory search`, and `memory get` CLI
  commands.

The deterministic embedding provider is synthetic and development-only. Workers
AI and Vectorize bindings are adapter boundaries in code, but this repository
does not claim live Workers AI/Vectorize resources, hosted embedding execution,
or production semantic quality.

G007 adds local agent and human projection interfaces:

- `@carpeos/mcp-server`, a local stdio MCP server over the typed local store;
- exactly eight MCP tools: `memory_search`, `memory_get`,
  `memory_context_pack`, `memory_trace`, `memory_timeline`, `memory_related`,
  `memory_capture`, and `memory_propose_claim`;
- trust-zone fail-close checks and protected-value redactions before content
  leaves the local process;
- deterministic `ContextBudget` limits by `max_items` and `max_characters`,
  with `used`, `truncated`, and `omitted` metadata, but no token-exact claim;
- accepted facts in context packs only from visible accepted
  `AcceptanceDecision` lineage after conflict, supersession, erasure,
  protected-value, trust-zone, lifecycle, authority, valid-time, and
  recorded-time checks;
- `memory_propose_claim`, which writes draft `Claim` events to the local outbox
  and never writes an `AcceptanceDecision`;
- `@carpeos/obsidian-projection`, a deterministic Markdown and manifest
  projection with closed categories, path-safety checks, manifest-bounded
  cleanup, and `canonical_effect: "none"`.

The MCP server is local stdio only. The Obsidian package generates files from
typed local-store snapshots; generated notes are not canonical authority.

## Quick Start

Prerequisites:

- Node.js 22.22 or newer;
- pnpm 11.16 or newer.

Build and verify the workspace:

```sh
pnpm install
pnpm build
```

Initialize the local runtime:

```sh
node apps/carpeos-cli/dist/index.js init
```

Identify the current project:

```sh
node apps/carpeos-cli/dist/index.js project identify
```

Capture one synthetic Codex hook payload:

```sh
node apps/carpeos-cli/dist/index.js capture-hook --provider codex --input argv \
  '{"hook_event_name":"SessionEnd","session_id":"session_synthetic","timestamp":"2026-01-01T00:00:00Z","message":"synthetic capture"}'
```

Inspect the local outbox:

```sh
node apps/carpeos-cli/dist/index.js outbox status
```

Inspect sync readiness without exposing secrets:

```sh
node apps/carpeos-cli/dist/index.js sync status
```

After configuring a private Worker URL plus local `0600` credential and
trust-zone sync key files, run one bounded sync cycle:

```sh
node apps/carpeos-cli/dist/index.js sync once \
  --url https://carpeos-sync.example.workers.dev \
  --credential-file "$HOME/.carpeos/sync-credential" \
  --sync-key-file "$HOME/.carpeos/trust-zone-sync.key"
```

The provider templates in `adapters/` expect a `carpeos` binary on `PATH`. In
this repository, command behavior is tested through the compiled CLI entrypoint
under `apps/carpeos-cli/dist/index.js`; package installation and binary
distribution are separate packaging work.

See [Local Capture Guide](docs/guides/local-capture.md) for the complete command
surface and hook template notes. See
[Cloudflare Sync Guide](docs/guides/cloudflare-sync.md) for local Worker, D1,
R2, secret-file, and MacBook/Mac mini sync setup. See
[Retrieval Guide](docs/guides/retrieval.md) for local projection rebuild,
development embedding, search, and get commands. See
[MCP Server Guide](docs/guides/mcp-server.md) for local stdio MCP setup and
client configuration examples. See
[Obsidian Projection Guide](docs/guides/obsidian-projection.md) for the
manifest-bounded Markdown projection.

## Architecture Model

CarpeOS separates immutable capture from derived retrieval views.

```text
AI lifecycle hooks
        |
        v
Local append-only outbox
        |
        v
Private sync service
        |
        v
Canonical event store
        |
        +--> query-time accepted fact view
        +--> Obsidian projection
        +--> vector projection
        +--> graph projection
        +--> search and MCP context packs
```

The append-only `CanonicalEvent` stream is the source of truth for private
knowledge. Accepted facts are derived at query time from immutable claims,
acceptance decisions, and supersessions. CarpeOS does not make a claim accepted
by mutating the claim record.

Obsidian notes, vector indexes, graph indexes, dashboards, context packs, and
accepted-fact views are rebuildable projections. They are useful interfaces, but
they are not authoritative by themselves.

Runtime data is separated by physical `TrustZone` boundaries. Public,
local-private, remote-private, shared, and exported data should not collapse into
one storage or authority model.

## Knowledge Model

The core ontology is intentionally generic. It should work for software
development, research, writing, operations, and other AI-assisted workflows
without including one user's private domain.

The canonical record types are:

| Type | Purpose |
| --- | --- |
| `CanonicalEvent` | Append-only envelope that records what happened, when it was recorded, who produced it, and which trust zone owns it. |
| `EvidenceArtifact` | Raw or externally referenced material produced during work. Large or sensitive values should be stored as protected-value references to external encrypted blobs, not copied inline by default. |
| `Observation` | A bounded statement extracted from evidence without turning it into an accepted fact. |
| `Claim` | An immutable statement evaluated through separate acceptance decisions and related to supersessions without mutating the claim. |
| `AcceptanceDecision` | An immutable decision that records `accepted`, `rejected`, or `needs_review` for a claim under a stated authority, scope, rationale, and evidence set. |
| `Supersession` | An immutable record that replaces, narrows, invalidates, or updates an earlier claim or decision. |

Derived and supporting concepts may include:

| Type | Purpose |
| --- | --- |
| `Entity` | A derived or supporting reference to a project, repository, artifact, agent, device, person, or concept. |
| `Relation` | A derived or supporting typed link between entities, claims, decisions, and evidence. |
| `OpenLoop` | A derived work-management view for unresolved tasks, risks, questions, or verification gaps. |
| `SessionSummary` | A projection-friendly compact summary of one AI-assisted work session. |

The model keeps evidence, observation, claim, acceptance, and supersession
separate so retrieval can preserve authority boundaries instead of flattening
everything into text.

CarpeOS uses bitemporal time:

- `valid_time` describes when the statement is true in the domain being modeled;
- `recorded_time` describes when CarpeOS recorded the event.

CarpeOS also separates processing lifecycle from epistemic authority. A record
can be captured, extracted, reviewed, projected, or synced as part of its
processing lifecycle. Its epistemic authority uses warrant classes:
`unverified`, `self_reported`, `observed`, `imported`, `derived`, or `verified`.
The values `accepted`, `rejected`, and `needs_review` exist only in
`AcceptanceDecision`; `superseded`, `erased`, and `stale` are derived query or
projection states. These axes should not be merged into one mutable status
field.

## Retrieval Model

CarpeOS now has a local hybrid retrieval MVP:

- structured queries for project, bitemporal time, lifecycle, authority, and
  trust-zone filters;
- full-text search for exact terms;
- vector candidate support for stored embeddings;
- lineage-aware result metadata for provenance, supersession, erasure, and
  projection freshness;
- canonical result recheck before a chunk is visible.

Vector search is a candidate-retrieval mechanism, not an authority model. Every
result must remain traceable to canonical source records, and vector hits do not
turn a claim into an accepted fact.

The current CLI commands are:

- `carpeos retrieval rebuild`
- `carpeos retrieval embed --provider deterministic-local-dev`
- `carpeos memory search --query ... --visible-trust-zone ...`
- `carpeos memory get --chunk-id ... --visible-trust-zone ...`

The implemented local LLM-facing interface is MCP over stdio. The G007 tools
are:

- `memory_search`
- `memory_get`
- `memory_context_pack`
- `memory_trace`
- `memory_timeline`
- `memory_related`
- `memory_capture`
- `memory_propose_claim`

Every MCP request must declare visible trust zones and protected-value policy.
The active local trust zone must be visible, and requests fail closed before
content resolution when visibility is missing or outside the configured
allowlist.

Context packs are deterministic projections. They separate accepted facts,
draft claims, rejected claims, observations, evidence summaries, conflicts,
supersessions, erasures, verification gaps, and redactions. Accepted facts
require visible accepted `AcceptanceDecision` lineage. Draft, rejected,
conflicted, superseded, erased, hidden, and protected-policy-denied records are
not accepted facts.

The current Obsidian interface is a local package, not a hosted sync service or
end-user Obsidian plugin. It generates manifest-bounded Markdown notes with the
closed categories `accepted_fact`, `observation`, `evidence_summary`,
`proposed_claim`, `rejected_claim`, `conflict`, `supersession`, `erasure`, and
`index`.

## Agent Integrations

CarpeOS is provider-neutral by design. The current templates normalize selected
Codex, Claude Code, and Grok Build lifecycle events into a common capture
envelope.

References:

- Codex hooks: <https://learn.chatgpt.com/docs/hooks>
- Claude Code hooks: <https://code.claude.com/docs/en/hooks>
- Grok Build hooks: <https://docs.x.ai/build/features/hooks>

Agents can read from the same local knowledge plane through the G007 stdio MCP
server without coupling the canonical store to one provider. Public-safe setup
examples for Codex CLI, Claude Code, Grok Build, and generic MCP clients are in
the MCP guide. Client examples are labeled with their verification status; the
Grok syntax is illustrative unless independently confirmed in a client session.

## Local-First Sync

CarpeOS is designed to work locally first:

- each device writes to a local append-only outbox;
- sync uploads events to a private remote instance;
- projections can be rebuilt from canonical events;
- conflicts are resolved at the event, decision, supersession, and
  erasure-ledger layers, not by editing generated notes directly.

G005 implements the first remote sync backend and client path with synthetic
local integration tests. Cross-Mac sharing becomes real only after a private
operator provisions Cloudflare D1/R2/Worker resources, seeds authorization, and
enrolls each Mac with the same out-of-band trust-zone sync key.

## Cloudflare Path

The hosted path uses Cloudflare components for the G005 sync backend:

- Workers for the sync API;
- D1 for canonical event metadata;
- R2 for encrypted protected-value blobs;
- external operator/local credential custody: authorization token hashes live in
  D1, while raw credentials remain local and outside Git.

Planned future hosted components may include:

- Workers for extraction jobs;
- Workers AI for optional extraction and embedding;
- Vectorize for optional semantic search;
- Pages for an optional dashboard.

Workers AI and Vectorize are optional adapters. CarpeOS should also support
local or self-hosted alternatives where practical.

For a personal MVP, the free-tier path is expected to be useful if the system
embeds only meaningful knowledge units, such as session summaries, decisions,
claims, and selected evidence chunks, instead of embedding every raw hook event.
Current Cloudflare limits must be checked against official documentation before
operation. As of the G006 design update, Workers AI free usage is documented in
Neurons/day and Vectorize free usage is documented in queried and stored vector
dimensions; these quotas are operational limits, not correctness guarantees.

## MVP Roadmap

1. Define the public project contract.
   - README files
   - governance and security boundaries
   - contribution rules
   - design influence notes

2. Define the core specification.
   - ontology schema
   - event schema
   - claim, acceptance decision, and supersession model
   - temporal and provenance model
   - trust zone and protected-value reference model
   - MCP tool contracts

3. Build the local runtime.
   - local SQLite store
   - append-only outbox
   - synthetic fixtures
   - projection rebuild tests

4. Add agent capture adapters.
   - Codex CLI lifecycle hooks
   - Claude Code lifecycle hooks
   - Grok Build lifecycle hooks
   - provider-neutral capture envelope

5. Add sync.
   - Cloudflare sync adapter
   - encrypted protected-value upload/download
   - cross-Mac private operator setup

6. Add retrieval.
   - structured search
   - full-text search
   - local vector projection
   - canonical recheck

7. Add projections and interfaces.
   - Obsidian projection generator: implemented locally in G007
   - context pack generation: implemented locally in G007
   - MCP server: implemented locally over stdio in G007
   - graph projection: planned
   - optional dashboard: planned

## Repository Boundary

Use synthetic examples only.

Acceptable examples:

```text
Example Alpha
Example Repository
Example Decision
Synthetic Incident
```

Unacceptable examples:

```text
real project names
real repository URLs
real session transcripts
real commit hashes from private work
real production logs
credentials or tokens
local user paths
```

Patterns discovered during private use can be generalized into public ontology
rules, tests, and documentation. The underlying private facts should stay inside
the user's private CarpeOS instance.

## Design Influences

CarpeOS was inspired in part by
[obsidian-mind](https://github.com/breferrari/obsidian-mind), especially its
vision of durable memory for AI agents, lifecycle-hook integration, and
semantic retrieval through an agent-accessible interface.

CarpeOS is an independent implementation with a different architectural model:

- an append-only canonical event log rather than a Markdown vault as authority;
- explicit CanonicalEvent, EvidenceArtifact, Observation, Claim,
  AcceptanceDecision, and Supersession semantics;
- temporal, authority, and provenance-aware ontology;
- physical trust-zone isolation and protected-value references;
- local-first multi-device synchronization;
- rebuildable Obsidian, vector, graph, and context-pack projections;
- provider-neutral integration for Codex, Grok, Claude, and other MCP-capable
  agents.

Unless otherwise noted, CarpeOS does not include source code from
`obsidian-mind`. Any reused third-party components must keep their original
copyright and license notices.

## Project Status

CarpeOS is pre-MVP. The G007 local capture, sync, retrieval, stdio MCP, context
pack, and Obsidian projection paths are implemented with synthetic test coverage
in the repository, but the project is not ready as a packaged end-user release
and no live deployment is claimed.

Do not treat adapter installation, GraphRAG, hosted embedding, Vectorize
operation, hosted MCP, hosted Obsidian sync, dashboard deployment, or other live
deployment paths as stable until they are implemented, tested, and documented in
this repository.
