# @innocarpe/carpeos

CarpeOS CLI and local MCP server: capture agent context, store provenance-aware
knowledge, and retrieve it for humans and agents.

## Install

```sh
# npm — current public release
npm install -g @innocarpe/carpeos@3.2.0

# one-liner (curl)
curl -fsSL https://raw.githubusercontent.com/innocarpe/carpeos/main/scripts/install.sh | bash
```

Requires **Node.js ≥ 22.22**.

The current public release is `3.2.0`, published on npm and verified through
global activation. Versions follow
[SemVer](https://semver.org/). See the repo
[CHANGELOG](https://github.com/innocarpe/carpeos/blob/main/CHANGELOG.md) and
[versioning policy](https://github.com/innocarpe/carpeos/blob/main/docs/maintainers/versioning-and-releases.md).

## First-time machine setup

Global install puts `carpeos` and `carpeos-mcp-server` on your PATH. Then
configure the private runtime and register MCP with agent hosts:

```sh
carpeos setup --help            # full parameter interface
carpeos setup plan              # see resolved paths + actions (no changes)
carpeos setup run --apply       # apply defaults
carpeos setup doctor            # verify
carpeos setup show              # print saved config
```

Options include `--home`, `--bin-dir`, `--workspace-root`, `--trust-zone`, and
`--register-mcp auto|none|claude,codex,grok`. Setup never mutates the machine
without `--apply`.

This creates `~/.carpeos`, installs convenience wrappers under `~/.local/bin`
(if needed), and registers the CarpeOS MCP server with Claude Code, Codex CLI,
and Grok Build when those tools are available.

## Quick use

```sh
carpeos --help                  # full CLI surface
carpeos version                 # package name + version (JSON)
carpeos help memory             # one command
carpeos init --home "$HOME/.carpeos" --trust-zone tz_local_default
carpeos memory context-pack \
  --task "Summarize my current work" \
  --trust-zone tz_local_default \
  --visible-trust-zone tz_local_default
carpeos adjudicate reconcile-policy \
  --from-policy adj_v1 --to-policy adj_v3 \
  --trust-zone tz_synthetic --limit 100
```

The B0 `reconcile-policy` command is a metadata-only preview. Its supported
flags are exactly `--from-policy`, `--to-policy`, `--trust-zone`, and `--limit`.
`--apply`, `--apply-safe-subset`, acknowledgements, receipts, and Supersession
construction are unavailable; B1 write/apply/receipt work is deferred.
`adj_v3` is precision-first and session-de-noising; held review remains
policy-aware and append-only. Neither adjudication path automatically creates a
Claim or an `AcceptanceDecision`. The adjudication and knowledge-form
evaluators are evidence-only, the retrieval evaluator is synthetic, and dogfood
uses only synthetic, disposable evidence.

## Docs

- Repository: https://github.com/innocarpe/carpeos
- One-stop install (git checkout): `docs/guides/one-stop-install.md`
- MCP guide: `docs/guides/mcp-server.md`
- [OKF export guide](https://github.com/innocarpe/carpeos/blob/main/docs/guides/okf-export.md)

## License

Apache-2.0
