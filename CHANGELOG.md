# Changelog

All notable changes to the public package **`@innocarpe/carpeos`** are documented
in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versioning policy: [docs/maintainers/versioning-and-releases.md](docs/maintainers/versioning-and-releases.md).

## [Unreleased]

### Added

- (none yet — fold entries here before the next release)

## [0.1.0] - 2026-07-29

Initial public distribution of the CarpeOS CLI and local MCP server.

### Added

- npm package `@innocarpe/carpeos` with bins `carpeos` and `carpeos-mcp-server`
- `carpeos setup` / `carpeos setup --doctor` for per-machine runtime + agent MCP registration
- curl installer: `scripts/install.sh`
- git-checkout installer: `scripts/install-local.mjs`
- Local capture, retrieval, memory search/get/context-pack, and MCP tools (bundled)
- Maintainer SemVer + tag + GitHub Release / npm publish pipeline

### Notes

- Pre-1.0: CLI/MCP contracts may still evolve; breaking changes will be called out
  under `### Breaking` on MINOR bumps while on `0.y.z`.

[Unreleased]: https://github.com/innocarpe/carpeos/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/innocarpe/carpeos/releases/tag/v0.1.0
