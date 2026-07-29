# v1.0.0 Readiness

Status: **tracking checklist** for the first stable public contract (`1.0.0`).
Not a product-completion roadmap.

Related:

- [Versioning and Releases](versioning-and-releases.md) — SemVer rules + freeze surfaces
- [Release Readiness](release-readiness.md) — per-release CI/local evidence (G008, etc.)
- Public package: `@innocarpe/carpeos`

## What 1.0.0 means

`1.0.0` freezes the **public contract**. After that tag, breaking changes on frozen
surfaces require a **MAJOR** bump. It does **not** require GraphRAG, multi-Mac
sync polish, production embeddings, or full session-capture UX.

## Contract surfaces (must freeze)

| Surface | Freeze commitment |
| --- | --- |
| CLI commands + flags | Documented commands keep behavior or get deprecation windows |
| MCP tool names + JSON | Agent-facing tools do not rename/reshape without MAJOR |
| Setup / env / home layout | `carpeos setup *`, `CARPEOS_*`, `~/.carpeos` stay compatible |
| Local store / events | Existing homes upgrade via migrations; no silent wipe |
| Trust-zone + visibility | `tz_*` ids and `--visible-trust-zone` semantics hold |

## Gate checklist

Update the **Status** column as work lands. Status values: `done` · `partial` ·
`todo` · `n/a`.

| # | Gate | Status (as of G7 inventory PR) | Evidence / notes |
| --- | --- | --- | --- |
| G1 | Clean-machine install: `npm i -g @innocarpe/carpeos` + `carpeos setup plan` + `run --apply` + `doctor` | **partial** | Verified on maintainer Mac for 0.1.1/0.1.2; keep re-checking each release |
| G2 | CLI + setup expose complete `--help`; README matches reality | **partial** | Help shipped in 0.1.2; keep README/setup docs in sync on every surface change |
| G3 | `carpeos version` reports published package version | **done** (this PR) | `carpeos version` / `-V`; npm build embeds package version |
| G4 | Exit codes documented (help + this doc) | **done** (this PR) | Root `--help` + table below |
| G5 | MCP smoke (list / search / context-pack) documented + CI or scripted gate | **done** | `pnpm smoke:mcp` (`scripts/smoke-mcp.mjs`) + CI step “Run MCP smoke (G5)” |
| G6 | Local store migration story written; no silent wipe of existing homes | **todo** | Need explicit migration policy + test for config/schema bumps |
| G7 | MCP tool contract inventory (names + schema versions) frozen in docs | **done** | [`docs/contracts/mcp-tools-v1.md`](../contracts/mcp-tools-v1.md) + JSON + `tool-inventory.test.ts` |
| G8 | No open “will rename soon” breaks in CHANGELOG / known issues | **partial** | Pre-1.0: breaking still allowed as MINOR; clear list before 1.0 |
| G9 | Maintainer decision recorded (PR or release notes) to cut `v1.0.0` | **todo** | Deliberate; never automatic from release.mjs alone |

## Explicit non-goals for 1.0

These may remain incomplete at `1.0.0` and ship later as `1.x` MINOR:

- GraphRAG / multi-hop recall completeness
- Hosted Cloudflare production edge
- Cross-Mac sync “just works” polish
- Production embedding providers (beyond deterministic local-dev)
- Full automatic session capture hooks UX

## Exit codes (public CLI)

Documented for automation. JSON errors still go to stderr when applicable.

| Code | Meaning |
| --- | --- |
| `0` | Success; also help/version plain success paths |
| `1` | Retryable operational failure (e.g. some sync retries) or internal error |
| `2` | Invalid usage / validation / missing required flags |
| `3` | Idempotency conflict (explicit key reused with different content) |
| `4` | Non-retryable sync / remote block |

`capture-hook --fail-open` may return `0` with a JSON **warning** on stderr when
capture fails, so the host agent can continue.

## How to advance this checklist

1. Prefer small PRs that flip one row `todo` → `done` with linked tests/docs.
2. When cutting any `0.y.z` release that improves a gate, update the Status column
   in the same PR (or the release PR).
3. Tag `v1.0.0` only when **G1–G9** are `done` (or consciously `n/a` with
   written rationale) **and** a maintainer records the freeze decision.

## Suggested 1.0 CHANGELOG shape

```markdown
## [1.0.0] - YYYY-MM-DD

### Notes

- First stable public contract for CLI, setup, MCP tools, and local store layout.
- Breaking changes after this release require a MAJOR bump.
```

## Current recommendation

Stay on **`0.y.z`** until G5–G8 are solid. Install/help (G1–G2) and version/exit
docs (G3–G4) are the near-term track; do not rush `1.0.0` for marketing.
