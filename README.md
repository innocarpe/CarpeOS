# CarpeOS

[English](README.md) | [한국어](README.ko.md)

**Capture context. Compound knowledge.**

CarpeOS is a personal knowledge operating system for AI-assisted work.

It captures work across AI agents, structures it as provenance-aware knowledge,
synchronizes it across devices, and exposes that knowledge through retrieval
interfaces for both humans and LLMs.

CarpeOS is currently an early-stage project. This repository is the canonical
place for the public design, specifications, implementation, and roadmap. It
does not contain a user's private knowledge store.

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

## Why CarpeOS Exists

AI coding agents are useful inside a single session, but their context often
disappears when the session ends, the machine changes, or another provider is
used. A simple vector database helps with semantic recall, but it usually cannot
answer higher-authority questions:

- Is this a fact, a suggestion, or a rejected hypothesis?
- What evidence supports this claim?
- When was it observed, recorded, and valid?
- Has it been superseded?
- Which agent, device, repository, or workflow produced it?
- Is the current note, vector hit, or graph edge authoritative?

CarpeOS treats memory as an event-sourced knowledge system rather than a folder
of notes or a vector index alone.

## Architecture Model

CarpeOS separates immutable capture from derived retrieval views.

```text
AI lifecycle hooks
        |
        v
Local append-only outbox
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

Planned canonical record types include:

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

CarpeOS is provider-neutral by design. The intended integration model is a
common capture protocol plus adapters for agent lifecycle hooks.

Planned adapters include:

- Codex CLI hooks;
- Grok-based coding workflows;
- Claude Code hooks;
- generic shell hooks for other tools.

Agents should be able to read from the same knowledge plane through MCP without
coupling the canonical store to one provider.

## Local-First Sync

CarpeOS is designed to work locally first:

- each device writes to a local append-only outbox;
- sync uploads events to a private remote instance;
- projections can be rebuilt from canonical events;
- conflicts are resolved at the event, decision, supersession, and
  erasure-ledger layers, not by editing generated notes directly.

The intended result is continuity across machines without making a public
repository the user's private memory store.

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

This repository is being bootstrapped. The roadmap below describes intended
work, not completed functionality.

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
   - generic hook protocol
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

CarpeOS is pre-MVP. The repository is being organized before the first usable
runtime release.

Do not treat planned commands, APIs, adapters, or deployment paths as stable
until they are implemented, tested, and documented in this repository.
