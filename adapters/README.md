# CarpeOS provider templates

These templates forward selected lifecycle events to the provider-neutral
`carpeos capture-hook` command. The command immediately appends encrypted raw
evidence and a metadata-only canonical event to the local SQLite outbox.

**Preferred product install** (merge into user host configs, absolute wrapper
path, uninstallable without wiping user hooks):

```sh
carpeos setup hooks install --apply
carpeos setup hooks doctor
```

See [one-stop install](../docs/guides/one-stop-install.md#capture-hooks-product-path).
Example files below remain the manual / advanced path.

The templates use `--fail-open`: a CarpeOS failure does not block the AI agent.
They also use `--quiet`, so successful capture does not add hook output to the
agent conversation. Review the event list and remove noisy events before
installing a template in a high-volume workflow. Product install rewrites the
command to an absolute `~/.local/bin/carpeos` (or `--bin-dir`) path.

## Codex CLI

Copy `codex/hooks.json.example` into a trusted Codex `hooks.json` layer. Codex
passes hook JSON on standard input to command hooks. The template uses only
command handlers and does not claim asynchronous hook support.

`codex/notify.toml.example` is a separate, user-level alternative for Codex
external notifications. The current `notify` contract invokes the command with
one JSON argument and supports only `agent-turn-complete`; it is not a general
lifecycle-hook replacement.

Official reference: <https://learn.chatgpt.com/docs/hooks>

## Claude Code

Merge `claude/settings.json.example` into the intended Claude Code settings
layer. Claude command hooks receive JSON on standard input. The template uses
Claude Code's documented `async: true` mode for nonblocking capture.

Official reference: <https://code.claude.com/docs/en/hooks>

## Grok Build

Install `grok/hooks.json.example` in the Grok Build hook configuration layer.
Product install targets `~/.grok/hooks.json` by default. Grok Build passes JSON
on standard input. The template intentionally makes no claim that Grok hooks
have a native asynchronous mode. Its command entries use the documented small
numeric timeout shape rather than a millisecond value.

Official reference: <https://docs.x.ai/build/features/hooks>

## DeepSeek Build

Grok-derived terminal agent (`deepseek-build` / `dsb`). Product install writes
`~/.deepseek-build/hooks.json` from `deepseek-build/hooks.json.example` and uses
`--provider deepseek_build`. MCP registration is deferred until the host exposes
a stable `mcp` CLI; hooks are prepared now for when lifecycle support lands.

## Gajae Code / GJC

Product install writes a TypeScript plugin to
`~/.gjc/agent/hooks/carpeos-capture.ts` (auto-discovered by GJC) and stores MCP
via `gjc mcp add`. Capture provider id: `gjc` (alias `gajae`).

## Deep Code

No Claude-style lifecycle hooks yet. Product install merges
`mcpServers.carpeos` into `~/.deepcode/settings.json` (other keys and secrets
are preserved). Capture provider id `deepcode` is accepted for manual envelopes.

## Reasonix

Product install registers MCP with `reasonix mcp add carpeos`. Lifecycle hooks
are not merged yet (see `reasonix/README.md`). Capture provider id: `reasonix`.

## Kimi / frontier consumers

`kimi/` documents how frontier agents (including Kimi K3-class models) consume
CarpeOS through the local MCP server. CarpeOS remains the private knowledge
store; the model is not the memory backend. See `kimi/README.md` and
`kimi/mcp.example.json`.

## Boundary

The templates contain no user path, project name, transcript, credential, or
runtime data. The `carpeos` binary must already be available on `PATH`. Captured
raw JSON is encrypted locally and is not written to command output. Remote sync,
retrieval, and MCP access are separate milestones.
