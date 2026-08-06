# <img src="docs/assets/carpeos-mark.png" alt="" width="36" height="36" align="left" />&nbsp; CarpeOS

[English](README.md) · [한국어](README.ko.md)

[![npm](https://img.shields.io/npm/v/@innocarpe/carpeos.svg?style=flat&label=npm&color=cb3837)](https://www.npmjs.com/package/@innocarpe/carpeos)
[![CI](https://github.com/innocarpe/CarpeOS/actions/workflows/ci.yml/badge.svg)](https://github.com/innocarpe/CarpeOS/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/innocarpe/CarpeOS?style=flat)](LICENSE)
[![Node](https://img.shields.io/node/v-lts/@innocarpe/carpeos?style=flat&label=node)](package.json)
[![Website](https://img.shields.io/badge/docs-website-4f7cff?style=flat)](https://innocarpe.github.io/carpeos-website/)

**Capture context. Compound knowledge.**

Local-first personal knowledge OS for AI-assisted work. CarpeOS captures agent
sessions with provenance, **adjudicates** what is worth keeping
(`promote` · `hold` · `reject`), and retrieves accepted meaning through CLI, MCP,
and Obsidian — without treating every chat dump as “memory.”

> **Public code. Private knowledge.** Your sessions and credentials stay on your machine.

<p align="center">
  <img src="docs/assets/readme-hero.jpg" alt="Network of knowledge nodes around a central core" width="920" />
</p>

## Install

Requires **Node.js ≥ 22.22**.

```sh
npm install -g @innocarpe/carpeos
carpeos setup plan
carpeos setup run --apply
carpeos setup hooks install --apply
carpeos setup doctor
```

Or one-liner:

```sh
curl -fsSL https://raw.githubusercontent.com/innocarpe/carpeos/main/scripts/install.sh | bash
```

Pin a release when you need a fixed surface:

```sh
npm install -g @innocarpe/carpeos@5.0.0
```

Current package line: **[`@innocarpe/carpeos@5.0.0`](https://www.npmjs.com/package/@innocarpe/carpeos)**
([changelog](CHANGELOG.md) · [tag `v5.0.0`](https://github.com/innocarpe/CarpeOS/releases/tag/v5.0.0)).

## Quick start

```sh
# After setup + a host session (Claude Code / Codex / Grok Build hooks)
carpeos retrieval rebuild --trust-zone tz_local_default
carpeos memory search \
  --query "durable decision" \
  --trust-zone tz_local_default \
  --visible-trust-zone tz_local_default

# Review queue for held drafts
carpeos adjudicate --stats
carpeos adjudicate list-held --limit 50
```

Default search is **promoted / active only**. Held items stay out of the default
path until you promote them or pass `--include-held`.

## How it works

```text
hooks → evidence (encrypted raw + metadata)
      → adjudicate (promote | hold | reject)
      → promoted meaning
      → retrieval / MCP / CLI / Obsidian projections
```

| Piece | Role |
| --- | --- |
| **Capture** | Fail-open hooks from Claude Code, Codex CLI, Grok Build |
| **Adjudication** | Precision-first `adj_v3` — noise is not automatic “memory” |
| **Store** | Local append-only events under `~/.carpeos` |
| **Retrieval** | Search, graph/hybrid recall, context packs |
| **Projections** | MCP tools, OKF export, optional Obsidian — rebuildable, not source of truth |
| **Optional** | Private sync, opt-in `carpeos v5` draft lane (`canonical_effect: "none"`) |

Hosted multi-tenant SaaS and production edge deploy are **not** claimed by this repo.

<p align="center">
  <img src="docs/assets/architecture-flow.svg" alt="Capture, store, then use from MCP, CLI, and Obsidian" width="920" />
</p>

## Documentation

| Topic | Link |
| --- | --- |
| Website / product overview | [carpeos-website](https://innocarpe.github.io/carpeos-website/) |
| One-stop install | [docs/guides/one-stop-install.md](docs/guides/one-stop-install.md) |
| Capture & hooks | [docs/guides/local-capture.md](docs/guides/local-capture.md) |
| Retrieval CLI | [docs/guides/retrieval.md](docs/guides/retrieval.md) |
| MCP server | [docs/guides/mcp-server.md](docs/guides/mcp-server.md) |
| MCP tool contract | [docs/contracts/mcp-tools-v1.md](docs/contracts/mcp-tools-v1.md) |
| OKF export | [docs/guides/okf-export.md](docs/guides/okf-export.md) |
| Sync (optional) | [docs/guides/cloudflare-sync.md](docs/guides/cloudflare-sync.md) |
| Architecture | [docs/architecture/overview.md](docs/architecture/overview.md) |
| Product requirements | [docs/PRD.md](docs/PRD.md) |
| Changelog | [CHANGELOG.md](CHANGELOG.md) |
| Versioning / releases | [docs/maintainers/versioning-and-releases.md](docs/maintainers/versioning-and-releases.md) |

Maintainer DoDs and release receipts live under
[`docs/maintainers/`](docs/maintainers/) (for example
[product-5.0.0](docs/maintainers/product-5.0.0.md),
[product-4.0.0](docs/maintainers/product-4.0.0.md)).

## Develop from source

```sh
git clone https://github.com/innocarpe/CarpeOS.git
cd CarpeOS
pnpm install
pnpm build
node scripts/install-local.mjs run --apply
```

Checks: `pnpm check` · smokes: `pnpm smoke:mcp` · `smoke:product` · `smoke:knowledge` · `smoke:dogfood`.

## Contributing

Issues and PRs welcome. Please:

1. Keep examples **synthetic** — no real projects, transcripts, or credentials.
2. Follow Conventional Commits and the PR template.
3. Run `pnpm check` (or `make preflight`) before opening a PR.
4. Agents working in this repo: read [`AGENTS.md`](AGENTS.md).

Labels, CI policy, and release process:

- [GitHub labels](docs/maintainers/github-labels.md)
- [CI policy](docs/maintainers/ci-policy.md)
- [Major release surface](docs/maintainers/major-release-surface.md)
- Skill: [`skills/carpeos-release/SKILL.md`](skills/carpeos-release/SKILL.md)

## License

[Apache-2.0](LICENSE)
