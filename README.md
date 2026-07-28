# CarpeOS

[English](README.md) | [한국어](README.ko.md)

**Capture context. Compound knowledge.**

CarpeOS is a personal knowledge operating system for AI-assisted work.

It is designed to capture work across AI agents, structure it as
provenance-aware knowledge, synchronize it across devices, and expose that
knowledge through retrieval interfaces for both humans and LLMs. The current
G004 implementation covers local capture and outbox storage only. Remote sync,
cross-device sharing, retrieval, MCP, embedding, GraphRAG, and Obsidian
projections are planned milestones, not active features.

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

Remote sync is not implemented in G004. Events can accumulate locally in the
metadata outbox, but another machine will not receive them until a future sync
service defines encrypted blob transfer, uploads the events, and reconciles
them.

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

The provider templates in `adapters/` expect a `carpeos` binary on `PATH`. In
this repository, command behavior is tested through the compiled CLI entrypoint
under `apps/carpeos-cli/dist/index.js`; package installation and binary
distribution are separate packaging work.

See [Local Capture Guide](docs/guides/local-capture.md) for the complete command
surface and hook template notes.

## Architecture Model

CarpeOS separates immutable capture from derived retrieval views.

```text
AI lifecycle hooks
        |
        v
Local append-only outbox
        |
        v
Private sync service           <- planned G005+
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

CarpeOS is designed for hybrid retrieval:

- structured queries for project, bitemporal time, lifecycle, authority, and
  trust-zone filters;
- full-text search for exact terms;
- vector search for semantic similarity;
- graph traversal for lineage, dependency, and supersession paths;
- bounded context packing for LLM prompts.

The target LLM-facing interface is MCP. Planned tools include:

- `memory_search`
- `memory_get`
- `memory_context_pack`
- `memory_trace`
- `memory_timeline`
- `memory_related`
- `memory_open_loops`
- `memory_capture`

These tools are planned API surfaces, not completed features.

## Agent Integrations

CarpeOS is provider-neutral by design. The current templates normalize selected
Codex, Claude Code, and Grok Build lifecycle events into a common capture
envelope.

References:

- Codex hooks: <https://learn.chatgpt.com/docs/hooks>
- Claude Code hooks: <https://code.claude.com/docs/en/hooks>
- Grok Build hooks: <https://docs.x.ai/build/features/hooks>

Agents should eventually be able to read from the same knowledge plane through
MCP without coupling the canonical store to one provider. That read path is not
implemented yet.

## Local-First Sync

CarpeOS is designed to work locally first:

- each device writes to a local append-only outbox;
- sync uploads events to a private remote instance;
- projections can be rebuilt from canonical events;
- conflicts are resolved at the event, decision, supersession, and
  erasure-ledger layers, not by editing generated notes directly.

G004 implements the first bullet only. Cross-Mac sharing is not active until a
G005+ remote sync service exists.

## Cloudflare Path

The planned hosted path can use Cloudflare components:

- Workers for API and extraction jobs;
- D1 for canonical event metadata;
- R2 for encrypted evidence artifacts and protected-value blobs;
- Workers AI for optional extraction and embedding;
- Vectorize for optional semantic search;
- Pages for an optional dashboard.

Workers AI and Vectorize are optional adapters. CarpeOS should also support
local or self-hosted alternatives where practical.

For a personal MVP, the free-tier path is expected to be useful if the system
embeds only meaningful knowledge units, such as session summaries, decisions,
claims, and selected evidence chunks, instead of embedding every raw hook event.

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

5. Add retrieval.
   - structured search
   - context pack generation
   - MCP server
   - optional vector adapter

6. Add projections and sync.
   - Obsidian projection generator
   - Cloudflare sync adapter
   - optional dashboard

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

CarpeOS is pre-MVP. The G004 local capture runtime is implemented and tested,
but the project is not ready as a packaged end-user release.

Do not treat planned sync, retrieval, MCP, adapter installation, projection, or
deployment paths as stable until they are implemented, tested, and documented in
this repository.
