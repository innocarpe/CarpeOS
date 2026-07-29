# MCP Server Guide

Status: G007 local stdio implementation and synthetic tests. Not hosted.

This guide covers the implemented local CarpeOS MCP server. It uses synthetic
placeholders only. Do not put real runtime database paths, vault paths,
credentials, private repository URLs, transcripts, or production logs in public
docs or fixtures.

## Boundary

The MCP server runs as a local stdio process over a local CarpeOS SQLite store.
It does not open a network listener and this repository does not claim a hosted
MCP deployment.

The implemented binary is:

```sh
carpeos-mcp-server
```

In repository development, the tested entrypoint is the built package output:

```sh
node apps/carpeos-mcp-server/dist/index.js
```

That direct Node entrypoint is covered by the G007 spawned stdio client/server
test. Client-specific setup examples below are public-safe
templates unless marked otherwise.

## Environment

Startup requires explicit local configuration:

| Variable | Required | Purpose |
| --- | --- | --- |
| `CARPEOS_MCP_STORE_PATH` | yes | Local SQLite store path. |
| `CARPEOS_MCP_WORKSPACE_ROOT` | yes | Synthetic or private workspace root used by the local store. |
| `CARPEOS_MCP_TRUST_ZONE` | yes | Active local trust-zone ID. |
| `CARPEOS_MCP_VISIBLE_TRUST_ZONES` | yes | Comma-separated allowlist of visible trust-zone IDs. Must include the active local trust zone. |
| `CARPEOS_MCP_RUNTIME_DIR` | no | Runtime directory. Defaults to the store directory. |
| `CARPEOS_MCP_PROJECT_ID` | no | Explicit project ID when path or Git-derived identity is not desired. |

Startup fails without required configuration and writes no protocol data to
stdout. Protocol diagnostics are sanitized and written to stderr.

## Tools

The server exposes exactly eight tools:

| Tool | Purpose |
| --- | --- |
| `memory_search` | Search visible local memory and return budgeted canonical record refs. |
| `memory_get` | Retrieve one visible canonical event or erasure record by stable ID. |
| `memory_context_pack` | Build a deterministic bounded context pack for an agent task. |
| `memory_trace` | Show visible provenance and support lineage for one record. |
| `memory_timeline` | Return a visible bitemporal timeline. |
| `memory_related` | Return visible records related by deterministic graph edges. |
| `memory_capture` | Capture local evidence through the existing outbox. |
| `memory_propose_claim` | Write a draft `Claim` with visible support references. |

`memory_open_loops` is not implemented in G007.

## Visibility

Every tool input must include:

```json
{
  "visibility": {
    "visible_trust_zone_ids": ["tz_synthetic_example"],
    "protected_value_policy": "metadata_only"
  }
}
```

Allowed `protected_value_policy` values:

- `metadata_only`
- `allow_decrypt`
- `deny`

The server fails closed when visibility is absent, malformed, unknown, or not
configured. Protected values return metadata or redactions unless policy allows
access. Retrieval candidates are rechecked against the canonical local store
before output.

## Context Budget

Retrieval-facing tools require `context_budget`:

```json
{
  "max_items": 8,
  "max_characters": 4000
}
```

The budget is deterministic by item count and stable serialized character
count. It is not token-exact. Responses report:

- `used.items`
- `used.characters`
- `truncated`
- `omitted.items`
- `omitted.characters`

## Claim Proposal

`memory_propose_claim` creates a draft `Claim` only. It:

- validates every support reference before writing;
- rejects unknown, hidden, unauthorized, and cross-zone support references;
- writes through the local canonical outbox;
- accepts optional `valid_time`;
- assigns `recorded_time` from the local-store clock;
- returns `proposed` or `replay`;
- returns an empty `acceptance_decision_event_ids` array.

It never writes an `AcceptanceDecision` and never marks a claim accepted.

## Client Setup Examples

Use a built workspace or an installed package that provides
`carpeos-mcp-server` on `PATH`. The examples use relative synthetic paths. Keep
private paths and credentials outside public repository files.

### Codex CLI

Status: syntax supported by the current OpenAI Codex manual; CarpeOS-specific
client registration was not executed in G007. The server entrypoint is covered
by local spawned stdio tests.

```sh
codex mcp add carpeos \
  --env CARPEOS_MCP_STORE_PATH=./.carpeos-example/carpeos.sqlite \
  --env CARPEOS_MCP_RUNTIME_DIR=./.carpeos-example \
  --env CARPEOS_MCP_WORKSPACE_ROOT=. \
  --env CARPEOS_MCP_TRUST_ZONE=tz_synthetic_example \
  --env CARPEOS_MCP_VISIBLE_TRUST_ZONES=tz_synthetic_example \
  -- carpeos-mcp-server
```

Codex can also use `config.toml`:

```toml
[mcp_servers.carpeos]
command = "carpeos-mcp-server"
args = []
startup_timeout_sec = 20
tool_timeout_sec = 60

[mcp_servers.carpeos.env]
CARPEOS_MCP_STORE_PATH = "./.carpeos-example/carpeos.sqlite"
CARPEOS_MCP_RUNTIME_DIR = "./.carpeos-example"
CARPEOS_MCP_WORKSPACE_ROOT = "."
CARPEOS_MCP_TRUST_ZONE = "tz_synthetic_example"
CARPEOS_MCP_VISIBLE_TRUST_ZONES = "tz_synthetic_example"
```

Reference:
<https://learn.chatgpt.com/docs/extend/mcp.md#configure-with-the-cli>

### Claude Code

Status: syntax supported by current Claude Code MCP docs; CarpeOS-specific
client registration was not executed in G007. The server entrypoint is covered
by local spawned stdio tests.

```sh
claude mcp add \
  --env CARPEOS_MCP_STORE_PATH=./.carpeos-example/carpeos.sqlite \
  --env CARPEOS_MCP_RUNTIME_DIR=./.carpeos-example \
  --env CARPEOS_MCP_WORKSPACE_ROOT=. \
  --env CARPEOS_MCP_TRUST_ZONE=tz_synthetic_example \
  --env CARPEOS_MCP_VISIBLE_TRUST_ZONES=tz_synthetic_example \
  --transport stdio carpeos \
  -- carpeos-mcp-server
```

Project-scoped `.mcp.json` example:

```json
{
  "mcpServers": {
    "carpeos": {
      "type": "stdio",
      "command": "carpeos-mcp-server",
      "args": [],
      "env": {
        "CARPEOS_MCP_STORE_PATH": "./.carpeos-example/carpeos.sqlite",
        "CARPEOS_MCP_RUNTIME_DIR": "./.carpeos-example",
        "CARPEOS_MCP_WORKSPACE_ROOT": ".",
        "CARPEOS_MCP_TRUST_ZONE": "tz_synthetic_example",
        "CARPEOS_MCP_VISIBLE_TRUST_ZONES": "tz_synthetic_example"
      }
    }
  }
}
```

Reference:
<https://code.claude.com/docs/en/mcp>

### Grok Build

Status: illustrative example. The current xAI docs describe `grok mcp add` and
TOML MCP server configuration; this exact CarpeOS registration was not
independently executed in G007.

```sh
grok mcp add carpeos -- carpeos-mcp-server
```

Grok TOML example:

```toml
[mcp_servers.carpeos]
command = "carpeos-mcp-server"
args = []
enabled = true
startup_timeout_sec = 30
tool_timeout_sec = 6000

[mcp_servers.carpeos.env]
CARPEOS_MCP_STORE_PATH = "./.carpeos-example/carpeos.sqlite"
CARPEOS_MCP_RUNTIME_DIR = "./.carpeos-example"
CARPEOS_MCP_WORKSPACE_ROOT = "."
CARPEOS_MCP_TRUST_ZONE = "tz_synthetic_example"
CARPEOS_MCP_VISIBLE_TRUST_ZONES = "tz_synthetic_example"
```

Reference:
<https://docs.x.ai/build/features/mcp-servers>

### Generic MCP Client

Status: illustrative example. MCP clients use different config file names and
field names. Use this shape only for clients that document a Claude-style
`mcpServers` JSON object.

```json
{
  "mcpServers": {
    "carpeos": {
      "type": "stdio",
      "command": "carpeos-mcp-server",
      "args": [],
      "env": {
        "CARPEOS_MCP_STORE_PATH": "./.carpeos-example/carpeos.sqlite",
        "CARPEOS_MCP_RUNTIME_DIR": "./.carpeos-example",
        "CARPEOS_MCP_WORKSPACE_ROOT": ".",
        "CARPEOS_MCP_TRUST_ZONE": "tz_synthetic_example",
        "CARPEOS_MCP_VISIBLE_TRUST_ZONES": "tz_synthetic_example"
      }
    }
  }
}
```

For stdio MCP servers, logs must not go to stdout because stdout carries the
JSON-RPC protocol stream. CarpeOS follows that boundary and writes sanitized
diagnostics to stderr.

Reference:
<https://modelcontextprotocol.io/docs/develop/build-server>

## Test Coverage

The G007 local test suite includes coverage for:

- exact tool list order;
- in-process dispatch for all implemented tool paths;
- spawned stdio client/server list and call behavior with
  `@modelcontextprotocol/client@2.0.0`;
- missing startup configuration;
- malformed and unauthorized visibility failure;
- protected plaintext not appearing in MCP output or stderr;
- deterministic budget metadata;
- accepted, draft, rejected, conflict, supersession, erasure, and redaction
  context-pack separation;
- idempotent `memory_capture`;
- draft-only `memory_propose_claim`.
