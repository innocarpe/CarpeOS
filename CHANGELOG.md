# Changelog

All notable changes to the public package **`@innocarpe/carpeos`** are documented
in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versioning policy: [docs/maintainers/versioning-and-releases.md](docs/maintainers/versioning-and-releases.md).

## [Unreleased]

### Added

- (none yet — fold entries here before the next release)

## [1.0.0] - 2026-07-30

### Notes

- First stable **product** release for `@innocarpe/carpeos`: setup installs
  capture hooks, session evidence lands in local SQLite (encrypted raw +
  EvidenceArtifact), Observations are derived from eligible lifecycle events,
  and memory search / context-pack return meaningful units first-class on the
  local path (see `docs/maintainers/product-1.0.0.md`).
- First stable **public contract**: CLI commands/flags, setup/env/`~/.carpeos`
  layout, MCP tool names + JSON shapes (`docs/contracts/mcp-tools-v1.md`), local
  store migration policy, and trust-zone / visibility semantics (including
  documented default resolution order: flag → env → config → device default).
- Breaking changes on those surfaces after this release require a **MAJOR** bump
  (see `docs/maintainers/versioning-and-releases.md`).
- Hosted Cloudflare edge, GraphRAG, multi-Mac polish, and production embeddings
  remain **non-goals** of 1.0 and may ship later as additive `1.x` MINOR work.

### Added

- Product setup: `carpeos setup hooks plan|install|uninstall|doctor` (merge-safe
  capture hooks; absolute `~/.local/bin/carpeos` commands)
- Setup doctor: hook status, recent capture, Observation/Claim counts
  (`--require-hooks` / `--require-capture` / `--require-units`)
- README EN/KO product path: install → hooks → doctor → rebuild/search/context-pack
- Meaningful-unit extraction policy (ADR 0011; PostToolUse off by default)
- Evidence → Observation extraction MVP; CLI `capture-hook` extract default +
  `carpeos extract --event-id` (idempotent)
- Retrieval ranks Observation/Claim/decision above `evidence_excerpt`; CLI
  lifecycle filters align with MCP (`active`+`draft`)
- Product E2E gate: `pnpm smoke:product` (CI)
- Product 1.0 DoD + scenario checklist + freeze Approve gate docs

## [0.2.2] - 2026-07-30

### Added

- Retrieval: project `EvidenceArtifact` events as metadata-only
  `evidence_excerpt` chunks (kind / media_type / artifact_id / subject / event
  id — never protected raw payload), so capture → rebuild → `memory search`
  works on day-to-day homes that only have hook evidence

### Fixed

- Retrieval freshness: advance `last_indexed_zone_sequence` from scanned events
  as well as produced chunks (capture-only stores no longer stuck
  `stale:behind_sync_cursor` after a clean rebuild)
- CLI `memory search`: default `epistemic_authority` filter includes `imported`
  (and the rest of the authority set), matching MCP `memory_search` so imported
  capture evidence is not silently filtered out

## [0.2.1] - 2026-07-29

Post-`0.2.0` local/sync completeness from private dogfood (hosted Cloudflare remains
operator-private; not required for `1.0.0` per v1 readiness non-goals).

### Added

- `carpeos project identify` / `carpeos sync status`: `trust_zone_source`
  (`flag` | `env` | `config` | `device_default`) so operators can see how the
  active zone was resolved
- `carpeos outbox status` → `errors[]` and `carpeos sync status` →
  `local.outbox_errors[]` for pending/leased rows with `last_error`
- Shared PR authoring skill `skills/carpeos-pr` + `./scripts/install-pr-skill.sh`
  (Claude Code / Codex / Grok); expanded `.github/PULL_REQUEST_TEMPLATE.md`
- Cloudflare sync guide: trust-zone resolution order, status diagnosis fields,
  same-device push→pull as sequence-only replay

### Fixed

- Sync Worker: rebind `protected_value_uploads` on conflict when re-uploading
  under a different trust zone (stale wrong-zone row no longer blocks push)
- Sync client: fail closed **before network** when outbox trust zone ≠ store
  zone; release blocked leases (delay 0) instead of leaving rows stuck `leased`
- Sync client: transport failures include `HTTP {status}` in the message (no
  response bodies)
- Local store: same-origin pull treats remote-only `zone_sequence` as idempotent
  **replay** (content divergence still fails closed)
- CLI: default trust zone prefers `--trust-zone` → `CARPEOS_TRUST_ZONE` /
  `CARPEOS_MCP_TRUST_ZONE` → `config.json` `trust_zone_id` before device-derived
  `tz_local_<client>` (aligns with installer `tz_local_default`)

### Changed

- `carpeos sync status` reports `outbox_trust_zone_ids`,
  `outbox_trust_zone_mismatch`, and structured `warnings` when outbox zones
  disagree with the active store zone

## [0.2.0] - 2026-07-30

Dogfood milestone on the road to a deliberate `1.0.0` local-contract freeze.
Cloudflare/hosted sync remains a **post-local** track (not required for 1.0 per
[v1 readiness](docs/maintainers/v1-readiness.md) non-goals).

### Added

- Named G5 MCP smoke gate: `pnpm smoke:mcp` (`scripts/smoke-mcp.mjs`) covering
  MCP tool list, `memory search`, and `memory context-pack`, wired into CI
- G7 MCP tool contract inventory:
  [`docs/contracts/mcp-tools-v1.md`](docs/contracts/mcp-tools-v1.md) +
  [`docs/contracts/mcp-tools-v1.json`](docs/contracts/mcp-tools-v1.json) with
  drift test against `CARPEOS_MCP_TOOLS`
- G6 local store migration policy:
  [`docs/architecture/local-store-migrations.md`](docs/architecture/local-store-migrations.md);
  export migration IDs; test that events survive reopen (no silent wipe)
- G8 compatibility inventory:
  [`docs/maintainers/compatibility-and-deprecations.md`](docs/maintainers/compatibility-and-deprecations.md)
  (active deprecations + empty “planned breaks before 1.0”)
- G9 freeze decision template:
  [`docs/maintainers/v1-freeze-decision.md`](docs/maintainers/v1-freeze-decision.md)

### Changed

- v1 readiness G1–G8 marked **done**; only G9 (freeze decision) remains

## [0.1.3] - 2026-07-29

### Added

- `carpeos version` / `--version` / `-V` (JSON: package name, version, Node)
- Maintainer tracker: [docs/maintainers/v1-readiness.md](docs/maintainers/v1-readiness.md)
  for the `1.0.0` contract-freeze checklist (gates G1–G9, exit codes, non-goals)

### Changed

- Root CLI help documents exit codes `0|1|2|3|4`

## [0.1.2] - 2026-07-29

### Added

- `carpeos --help` / `carpeos help [command]` human-readable CLI help for all
  commands (init, project, capture-hook, outbox, sync, retrieval, memory, setup)

## [0.1.1] - 2026-07-29

### Fixed

- npm `carpeos setup` wrappers now point at package `bin/carpeos.js` so
  `carpeos setup` keeps working when `~/.local/bin` shadows the global npm bin

## [0.1.0] - 2026-07-29

Initial public distribution of the CarpeOS CLI and local MCP server.

### Added

- npm package `@innocarpe/carpeos` with bins `carpeos` and `carpeos-mcp-server`
- `carpeos setup` CLI surface: commands `plan | run | doctor | show | help`,
  options `--home`, `--bin-dir`, `--workspace-root`, `--trust-zone`,
  `--register-mcp`, and `--apply` safety gate for per-machine runtime + agent
  MCP registration (legacy `--yes` / `-y` still accepted as a deprecated alias)
- curl installer: `scripts/install.sh`
- git-checkout installer: `scripts/install-local.mjs` (same command surface)
- Local capture, retrieval, memory search/get/context-pack, and MCP tools (bundled)
- Maintainer SemVer + tag + GitHub Release / npm publish pipeline

### Notes

- Pre-1.0: CLI/MCP contracts may still evolve; breaking changes will be called out
  under `### Breaking` on MINOR bumps while on `0.y.z`.

[Unreleased]: https://github.com/innocarpe/carpeos/compare/v1.0.0...HEAD
[0.1.0]: https://github.com/innocarpe/carpeos/releases/tag/v0.1.0
[0.1.1]: https://github.com/innocarpe/carpeos/releases/tag/v0.1.1
[0.1.2]: https://github.com/innocarpe/carpeos/releases/tag/v0.1.2
[0.1.3]: https://github.com/innocarpe/carpeos/releases/tag/v0.1.3
[0.2.0]: https://github.com/innocarpe/carpeos/releases/tag/v0.2.0
[0.2.1]: https://github.com/innocarpe/carpeos/releases/tag/v0.2.1
[0.2.2]: https://github.com/innocarpe/carpeos/releases/tag/v0.2.2
[1.0.0]: https://github.com/innocarpe/carpeos/releases/tag/v1.0.0
