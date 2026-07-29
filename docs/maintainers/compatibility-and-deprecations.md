# Compatibility and Deprecations

Status: **G8 inventory** — open renames, deprecations, and “will break soon”
items for public `@innocarpe/carpeos`.

Related:

- [v1 Readiness](v1-readiness.md) (gate G8)
- [Versioning and Releases](versioning-and-releases.md)
- [MCP Tools Contract v1](../contracts/mcp-tools-v1.md)
- [Local Store Migrations](../architecture/local-store-migrations.md)
- [CHANGELOG](../../CHANGELOG.md)

## Purpose

Before cutting `1.0.0`, this file must show **no open “we will rename/remove this
soon without a path”** items on freeze surfaces. Deprecations are allowed if they
have a clear preferred replacement and removal policy.

Update this file in the **same PR** as any new public deprecation or planned break.

## Freeze surfaces (reminder)

| Surface | Freeze at 1.0 |
| --- | --- |
| CLI commands + flags | yes |
| MCP tool names + JSON | yes |
| Setup / env / home layout | yes |
| Local store / events | yes (via migrations) |
| Trust-zone + visibility | yes |

## Active deprecations

| Item | Status | Preferred | Removal policy |
| --- | --- | --- | --- |
| `carpeos setup --yes` / `-y` | **deprecated**, still works | `carpeos setup run --apply` | Keep at least through **1.0.0**; earliest removal is a **MINOR** after 1.0 with CHANGELOG `### Breaking`, or **MAJOR** if no long deprecation window |
| `install-local.mjs --yes` / `-y` | **deprecated**, still works | `node scripts/install-local.mjs run --apply` | Same as setup `--yes` |
| `setup --hosts` | alias of `--register-mcp` | `--register-mcp` | Keep as alias; not scheduled for removal |
| `setup --doctor` / `--plan` flags | aliases of subcommands | `setup doctor` / `setup plan` | Keep as aliases; not scheduled for removal |
| MCP SDK `serveStdio({ legacy: "serve" })` | internal runtime path | (none for operators) | Internal SDK option; not a public CLI flag. Track with SDK upgrades only |

There are **no** other public flags or MCP tool names currently marked
“will be renamed before 1.0.”

## Explicit non-commitments (not deprecations)

These are **not** scheduled renames; they are product areas that may still grow
after 1.0 as additive MINOR features:

| Area | Notes |
| --- | --- |
| `memory_open_loops` MCP tool | Not implemented; must not appear in `listTools` until added under contract process |
| GraphRAG / multi-hop recall | Roadmap; additive when ready |
| Production embedding providers | Beyond `deterministic-local-dev`; additive |
| Hosted Cloudflare edge | Operator-private; not part of npm contract |
| Session capture host hooks | Separate from MCP registration (`adapters/`) |

## Planned breaks before 1.0

| Item | Planned? | Notes |
| --- | --- | --- |
| Rename any of the eight MCP tools | **No** | See mcp-tools-v1 inventory |
| Change `schema_version` from `"v1"` without dual-read | **No** | New versions require dual support or MAJOR after 1.0 |
| Silent wipe of `~/.carpeos` on upgrade | **Forbidden** | See local-store-migrations |
| Remove `--apply` safety gate | **No** | Part of setup UX contract |
| Require interactive TTY for setup | **No** | Keep scriptable |

**G8 is satisfied when this “Planned breaks before 1.0” table stays empty** (aside
from documented deprecations above).

## Historical soft spots (already resolved or stable)

| Topic | Resolution |
| --- | --- |
| Setup only documented as `setup --yes` | Replaced by plan/run/doctor/show + `--apply` (0.1.x); `--yes` kept as alias |
| Wrappers pointing at `dist/cli.js` broke `setup` | Fixed in 0.1.1 — wrappers use package `bin/` |
| Missing `carpeos --help` / `version` | Added in 0.1.2 / 0.1.3 |
| Ad-hoc MCP smoke only in guides | Named `pnpm smoke:mcp` + CI (G5) |

## How to add a deprecation

1. Prefer the new name/flag in help and README **first**.
2. Keep the old path working and emit a short stderr note when used (if cheap).
3. Add a row to **Active deprecations** with removal policy.
4. CHANGELOG: `### Deprecated` (and `### Breaking` only when removed).
5. While on `0.y.z`, removals that break scripts are **MINOR** + `### Breaking`.

## How to clear G8 for a 1.0 cut

Checklist for the freeze PR / release notes:

- [ ] This file reviewed; “Planned breaks before 1.0” is empty
- [ ] Active deprecations all have preferred replacements and post-1.0 removal policy
- [ ] MCP inventory and setup help match this file
- [ ] No README/agent docs invent alternate tool names or install paths
- [ ] CHANGELOG Unreleased has no “will rename in next release” bullets without a row here

## Last review

| Field | Value |
| --- | --- |
| Date (UTC) | 2026-07-30 |
| Package at review | `@innocarpe/carpeos` ≥ 0.1.3 (+ unreleased G5–G7 docs on main) |
| Open “rename soon” items | **none** |
| G8 status | **done** (inventory clear; only documented deprecations remain) |
