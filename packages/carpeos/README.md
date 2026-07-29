# @innocarpe/carpeos

CarpeOS CLI and local MCP server: capture agent context, store provenance-aware
knowledge, and retrieve it for humans and agents.

## Install

```sh
# npm (recommended) — pin a version in production
npm install -g @innocarpe/carpeos
npm install -g @innocarpe/carpeos@0.1.0

# one-liner (curl)
curl -fsSL https://raw.githubusercontent.com/innocarpe/carpeos/main/scripts/install.sh | bash
```

Requires **Node.js ≥ 22.22**.

Versions follow [SemVer](https://semver.org/). Tags look like `v0.1.0`. See the
repo [CHANGELOG](https://github.com/innocarpe/carpeos/blob/main/CHANGELOG.md)
and [versioning policy](https://github.com/innocarpe/carpeos/blob/main/docs/maintainers/versioning-and-releases.md).

## First-time machine setup

Global install puts `carpeos` and `carpeos-mcp-server` on your PATH. Then
configure the private runtime and register MCP with agent hosts:

```sh
carpeos setup --yes
# optional checks
carpeos setup --doctor
```

This creates `~/.carpeos`, installs convenience wrappers under `~/.local/bin`
(if needed), and registers the CarpeOS MCP server with Claude Code, Codex CLI,
and Grok Build when those tools are available.

## Quick use

```sh
carpeos init --home "$HOME/.carpeos" --trust-zone tz_local_default
carpeos memory context-pack \
  --task "Summarize my current work" \
  --trust-zone tz_local_default \
  --visible-trust-zone tz_local_default
```

## Docs

- Repository: https://github.com/innocarpe/carpeos
- One-stop install (git checkout): `docs/guides/one-stop-install.md`
- MCP guide: `docs/guides/mcp-server.md`

## License

Apache-2.0
