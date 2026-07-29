# <img src="docs/assets/carpeos-mark.png" alt="" width="36" height="36" align="left" />&nbsp; CarpeOS

[English](README.md) · [한국어](README.ko.md)

[![License](https://img.shields.io/badge/license-Apache%202.0-0e8a16?style=flat)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.22-0052cc?style=flat)](package.json)
[![Status](https://img.shields.io/badge/status-pre--MVP-fbca04?style=flat)](#what-is-implemented-today)

**Capture context. Compound knowledge.**

CarpeOS is a personal knowledge system for people who work with AI agents.

It records what happened in those sessions, keeps the trail of where each piece
came from, and makes that history searchable later — by you or by another
agent — without dumping everything into one chat log.

<p align="center">
  <img src="docs/assets/readme-hero.jpg" alt="Network of knowledge nodes around a central core" width="920" />
</p>

<p align="center">
  <img src="docs/assets/architecture-flow.svg" alt="Capture, store, sync, then use from MCP, CLI, and Obsidian" width="920" />
</p>

---

## Why this exists

You finish a long agent session with a real decision, a half-finished plan, or
a bug path you do not want to rediscover. A week later that context is split
across chat history, terminal scrollback, and a few notes — and the next agent
has none of it.

CarpeOS is an attempt to keep that context in one place you control, with
enough structure that “we decided X” is not treated the same as “the model
once suggested X.”

| Common problem | Approach here |
| --- | --- |
| Chat history disappears or is hard to trust | Append-only events with provenance |
| “Memory” is mostly embeddings | Claims, acceptance, and supersession stay separate records |
| Each tool keeps its own silo | Shared capture + MCP retrieval, provider-agnostic |
| Generated notes become the only source of truth | Notes and indexes are rebuildable projections |
| Two machines, messy continuity | Local-first store, optional private sync |

> **Public code. Private knowledge.**  
> This repo has design, specs, and implementation. Your real sessions,
> projects, and credentials stay on your side.

---

## Who it’s for

Useful if you:

- Switch between agents (Codex, Claude Code, Grok Build, …) and do not want a
  separate memory story for each one
- Need last week’s decisions still available, not buried in an old transcript
- Care whether something is a draft, rejected, or actually accepted when you
  search for it
- Want data local by default, with sync you run yourself if you need it
- Prefer explicit schemas and tests over a black-box “memory product”

Not a polished consumer app yet. Not hosted SaaS. Not a replacement for your
editor. Closer to plumbing for people who already live in agent workflows.

---

## What’s in the box

### Capture from tools you already use

Hook templates map selected lifecycle events from Codex, Claude Code, and Grok
Build into a common capture shape. Raw payloads can sit in encrypted storage;
the event log keeps metadata and references.

### A model that does not flatten status

Evidence is not a claim. A claim is not “true” just because it exists.
Acceptance and supersession are their own records. Search can show what is
settled, what is only proposed, and what was replaced — without stuffing it all
into one paragraph of vector text.

```mermaid
flowchart LR
  E[EvidenceArtifact] --> O[Observation]
  O --> C[Claim]
  C --> A[AcceptanceDecision]
  C --> S[Supersession]
  A --> F[Accepted fact<br/>derived at query time]
  S --> F
```

### Interfaces for people and agents

- **CLI** — rebuild, embed (dev), `memory search` / `memory get` /
  `memory context-pack`
- **MCP (stdio)** — eight local tools (`memory_context_pack`, `memory_trace`,
  `memory_capture`, `memory_propose_claim`, …)
- **Obsidian projection** — Markdown files generated from the local store
  (projection only; not the source of truth)

### Local first, sync optional

Each machine writes to a local outbox. There is deployable Cloudflare
Worker/D1/R2 code if you want private multi-device sync. Projections can always
be rebuilt from the event log.

```mermaid
flowchart TB
  subgraph devices [Your machines]
    H1[Agent hooks]
    CLI[carpeos CLI]
    MCP[MCP stdio server]
    OBS[Obsidian projection]
  end

  subgraph local [Local runtime]
    OUT[Encrypted outbox + local store]
    RET[Search + recheck]
  end

  subgraph private [Optional private sync]
    W[Cloudflare Worker]
    D1[(D1 metadata)]
    R2[(R2 encrypted blobs)]
  end

  H1 --> OUT
  CLI --> OUT
  OUT --> RET
  RET --> MCP
  RET --> OBS
  OUT <--> W
  W --> D1
  W --> R2
```

---

## How it fits together

```mermaid
flowchart LR
  A[Agent hooks] --> B[Local capture]
  B --> C[Event store]
  C --> D[Accepted facts at query time]
  C --> E[Projections]
  E --> F[MCP / CLI / Obsidian]
  D --> F
```

Rules worth knowing up front:

1. After acceptance, the event log is append-only.
2. “Accepted” is computed at query time — we do not rewrite a claim in place.
3. Sensitive plaintext is not stored inside the event body.
4. Trust zones are real isolation boundaries, not labels for show.
5. Notes, vectors, and context packs can be deleted and rebuilt; they are not
   the canonical store.

More detail:
[Architecture overview](docs/architecture/overview.md),
[Memory capacity](docs/architecture/memory-capacity.md),
[ADR 0009](docs/adr/0009-memory-capacity-model.md),
[ADRs](docs/adr/),
[spec/v1](spec/v1/).

### Memory capacity (total vs active)

CarpeOS separates **how much private knowledge you store** from **how much an
agent loads right now**:

| Axis | Meaning | Where it lives |
| --- | --- | --- |
| **Total capacity** | Visible append-only events + protected blobs under trust zones | L1 store |
| **Active capacity** | What fits a bounded pack or search response after budgets and recheck | L2 working memory |
| **Procedural memory** | Thinking/tool traces as protected evidence, never auto-accepted | L3 |
| **Product projections** | Rebuildable notes, packs, open loops, dashboards | L4 |

Context packs use sparse **expert-slot** allocation (default 16 slots) and a
cache-friendly section order so accepted facts stay ahead of high-churn drafts.
See the [memory capacity architecture note](docs/architecture/memory-capacity.md)
and the [capacity master plan](docs/plans/k3-memory-capacity-master-plan.md).
Graph-oriented recall remains planned:
[GraphRAG roadmap](docs/plans/graphrag-roadmap.md).

---

## Quick start

Needs Node.js ≥ 22.22 and pnpm ≥ 11.16.

### Install like other open-source CLIs

```sh
# npm global (recommended once published)
npm install -g @innocarpe/carpeos
carpeos setup --yes

# curl one-liner (same as Codex-style installers)
curl -fsSL https://raw.githubusercontent.com/innocarpe/carpeos/main/scripts/install.sh | bash
```

Requires Node.js ≥ 22.22. `carpeos setup` creates `~/.carpeos` and registers the
local MCP server with Claude Code / Codex / Grok when those CLIs are available.

### From a git checkout (developers)

```sh
node scripts/install-local.mjs --dry-run   # plan
node scripts/install-local.mjs --yes       # apply (idempotent)
export PATH="$HOME/.local/bin:$PATH"
node scripts/install-local.mjs --doctor
```

Details: [One-stop install guide](docs/guides/one-stop-install.md) ·
[npm package](packages/carpeos/README.md).

### Manual / synthetic path

```sh
pnpm install
pnpm build

node apps/carpeos-cli/dist/index.js init
node apps/carpeos-cli/dist/index.js project identify

# one synthetic capture
node apps/carpeos-cli/dist/index.js capture-hook --provider codex --input argv \
  '{"hook_event_name":"SessionEnd","session_id":"session_synthetic","timestamp":"2026-01-01T00:00:00Z","message":"synthetic capture"}'

node apps/carpeos-cli/dist/index.js outbox status
```

| Topic | Guide |
| --- | --- |
| One-stop install | [docs/guides/one-stop-install.md](docs/guides/one-stop-install.md) |
| Local capture & hooks | [docs/guides/local-capture.md](docs/guides/local-capture.md) |
| Private Cloudflare sync | [docs/guides/cloudflare-sync.md](docs/guides/cloudflare-sync.md) |
| Retrieval CLI | [docs/guides/retrieval.md](docs/guides/retrieval.md) |
| MCP server | [docs/guides/mcp-server.md](docs/guides/mcp-server.md) |
| MCP context-pack smoke | [docs/guides/mcp-context-pack-smoke.md](docs/guides/mcp-context-pack-smoke.md) |
| Obsidian projection | [docs/guides/obsidian-projection.md](docs/guides/obsidian-projection.md) |
| Memory capacity | [docs/architecture/memory-capacity.md](docs/architecture/memory-capacity.md) |
| GraphRAG roadmap (planned) | [docs/plans/graphrag-roadmap.md](docs/plans/graphrag-roadmap.md) |
| Threat model | [docs/architecture/threat-model.md](docs/architecture/threat-model.md) |
| Local-first operator runbook | [docs/guides/local-first-operator-runbook.md](docs/guides/local-first-operator-runbook.md) |
| Cross-Mac bootstrap & recovery | [docs/guides/cross-mac-bootstrap-recovery.md](docs/guides/cross-mac-bootstrap-recovery.md) |
| Release readiness | [docs/maintainers/release-readiness.md](docs/maintainers/release-readiness.md) |

Hook templates: [`adapters/`](adapters/).

---

## What works today

Pre-MVP. The local path — capture → outbox → sync client → retrieval → MCP →
Obsidian projection — is implemented and covered with synthetic tests in this
repo.

G008 adds release-readiness documentation and a synthetic local end-to-end
proof. On Node 22.22.0, `pnpm check` passes, and the opt-in synthetic local
Worker+D1+R2 gate passes with
`pnpm --filter @carpeos/sync-worker test:e2e`. This is local evidence only.

| Area | Status |
| --- | --- |
| Specs, ontology, ADRs | In tree |
| Local capture + outbox | Implemented (synthetic tests) |
| Sync Worker/client | Code + local tests; no production deploy claimed |
| Local hybrid retrieval | Implemented (deterministic dev embeddings) |
| MCP stdio server (8 tools) | Local only |
| Expert-slot context packs | Local only (see MCP smoke guide) |
| OpenLoop / dashboard library | Library + tests; not a shipped UI |
| Obsidian projection package | Local only |
| Synthetic G008 local e2e | Local only; opt-in Worker+D1+R2 proof |
| Hosted embeddings | Not built |
| GraphRAG traversal | Planned — [roadmap](docs/plans/graphrag-roadmap.md) |
| Packaged end-user install | Not ready |

**NOT DEPLOYED:** no hosted Worker, D1/R2 production resources, package publish,
private vault adoption, hosted MCP, or cross-Mac live deployment is proven by
this repository.

Do not treat adapter install, a live Cloudflare setup, hosted MCP, or
production search quality as done until this repo says so with tests and docs.

---

## Repo boundary

Public implementation only. Runtime knowledge stays private.

| OK here | Not OK here |
| --- | --- |
| Synthetic fixtures (`Example Alpha`, …) | Real project names or private URLs |
| Protocol examples | Real session transcripts |
| Tests and schemas | Credentials, tokens, production logs |
| Contributor docs | Runtime DB dumps, personal paths |

---

## Design influences

Some ideas overlap with
[obsidian-mind](https://github.com/breferrari/obsidian-mind) (agent memory,
hooks, retrieval for agents). CarpeOS is a separate design: append-only events
instead of a Markdown vault as authority, explicit claim/acceptance/supersession,
trust zones, protected values, and MCP that is not locked to one vendor.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), [GOVERNANCE.md](GOVERNANCE.md), and
[AGENTS.md](AGENTS.md).

```sh
pnpm check   # format, lint, build, typecheck, test, public-boundary
```

---

## License

[Apache License 2.0](LICENSE)
