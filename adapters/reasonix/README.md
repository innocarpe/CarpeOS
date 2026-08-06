# Reasonix ↔ CarpeOS

Reasonix does not yet expose a Claude/Grok-style JSON lifecycle hooks file that
CarpeOS can merge. Product setup therefore:

1. Registers the local **CarpeOS MCP server** via `reasonix mcp add`.
2. Accepts `carpeos capture-hook --provider reasonix` for any future/manual
   envelope push.

## MCP (product install)

```sh
carpeos setup run --apply --register-mcp auto
# or explicitly:
carpeos setup run --apply --register-mcp reasonix
```

Verify:

```sh
reasonix mcp list
```

## Capture

When Reasonix gains durable lifecycle hooks, templates will land under this
directory. Until then, MCP tools (`memory_search`, etc.) still read the shared
`~/.carpeos` store filled by Claude/Codex/Grok/GJC/DeepSeek Build hooks.
