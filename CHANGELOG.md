# Changelog

All notable changes to the public package **`@innocarpe/carpeos`** are documented
in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versioning policy: [docs/maintainers/versioning-and-releases.md](docs/maintainers/versioning-and-releases.md).

## [Unreleased]

### Added

- Named G5 MCP smoke gate: `pnpm smoke:mcp` (`scripts/smoke-mcp.mjs`) covering
  MCP tool list, `memory search`, and `memory context-pack`, wired into CI

### Changed

- v1 readiness G5 marked **done**

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

[Unreleased]: https://github.com/innocarpe/carpeos/compare/v0.1.3...HEAD
[0.1.0]: https://github.com/innocarpe/carpeos/releases/tag/v0.1.0
[0.1.1]: https://github.com/innocarpe/carpeos/releases/tag/v0.1.1
[0.1.2]: https://github.com/innocarpe/carpeos/releases/tag/v0.1.2
[0.1.3]: https://github.com/innocarpe/carpeos/releases/tag/v0.1.3
