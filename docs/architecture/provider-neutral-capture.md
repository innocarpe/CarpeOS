# Provider-Neutral Capture and MCP

Status: G004 local capture implemented; MCP and remote retrieval planned.

CarpeOS works across AI agents by normalizing provider lifecycle payloads into a
common capture envelope. Provider adapters parse provider-specific hook JSON.
The capture core writes exactly one raw `EvidenceArtifact` for the local runtime
and leaves extraction, claims, acceptance, retrieval, and projection to later
stages.

## Capture Pipeline

```text
Codex / Claude Code / Grok Build hook JSON
  -> provider adapter
  -> capture envelope
  -> AES-256-GCM protected value
  -> metadata-only EvidenceArtifact
  -> local append-only SQLite rows
  -> durable outbox item
  -> remote sync                 <- planned G005+
  -> retrieval and MCP           <- planned
```

The current store is local-only. It uses Node 22.22+ `node:sqlite`; Node prints
an `ExperimentalWarning` because the built-in SQLite module is still marked
experimental in Node 22.22.

## Implemented Adapter Surface

The CLI supports:

- `carpeos capture-hook --provider codex`;
- `carpeos capture-hook --provider claude`;
- `carpeos capture-hook --provider grok`;
- `--input stdin` for command hooks that pass JSON on standard input;
- `--input argv` for Codex notification-style payloads passed as one JSON
  argument;
- `--fail-open` to return exit code 0 when local capture fails;
- `--quiet` to suppress successful hook output.

The adapter normalizes:

- Codex and Claude snake_case fields such as `hook_event_name`, `session_id`,
  `turn_id`, `workspace_root`, and `cwd`;
- Grok camelCase fields such as `hookEventName`, `sessionId`, `turnId`, and
  `workspaceRoot`;
- Codex notify fields such as `type` and `thread-id`.

Each captured payload becomes an encrypted protected value. The canonical event
contains a `ProtectedValueRef` with the same `protected_value_id` used by local
encrypted storage and future erasure targeting, plus provenance, idempotency
metadata, and request fingerprint. It does not include the raw hook JSON inline.

When a provider supplies a valid timestamp, it becomes the evidence event's
`valid_time.start`. The local store clock independently sets
`recorded_time.start`, preserving the bitemporal distinction defined by the
canonical model. Source-valid capture time participates in derived idempotency
and request fingerprint identity; local recording time and workspace paths do
not.

## Hook Templates

Public templates live in `adapters/`:

| Provider | Template | Notes |
| --- | --- | --- |
| Codex | `adapters/codex/hooks.json.example` | Command hooks receive JSON on standard input. The template does not claim async hook support. |
| Codex notify | `adapters/codex/notify.toml.example` | Separate user-level notification example. It uses `--input argv` and is not a general lifecycle hook replacement. |
| Claude Code | `adapters/claude/settings.json.example` | Command hooks receive JSON on standard input. The template uses Claude Code's documented `async: true`. |
| Grok Build | `adapters/grok/hooks.json.example` | Command hooks receive JSON on standard input. The template makes no native async claim. |

Official references:

- Codex hooks: <https://learn.chatgpt.com/docs/hooks>
- Claude Code hooks: <https://code.claude.com/docs/en/hooks>
- Grok Build hooks: <https://docs.x.ai/build/features/hooks>

## Adapter Responsibilities

Adapters SHOULD:

- preserve non-empty provider and session provenance;
- write raw provider content as protected `EvidenceArtifact`;
- attach idempotency key and request fingerprint;
- keep provider-specific field names behind the adapter boundary;
- fail open in lifecycle hooks when capture would otherwise interrupt agent
  work.

Adapters MUST NOT:

- store raw provider payload inline in canonical events;
- derive `Observation`, `Claim`, `AcceptanceDecision`, or `Supersession` during
  raw capture;
- mutate claims into accepted facts;
- make provider output authoritative by default;
- expose protected values to unauthorized clients;
- assign canonical `zone_sequence` locally.

## MCP Responsibilities

MCP tools are planned. They should eventually return:

- query-time accepted facts;
- visible lineage;
- conflicts and gaps;
- redacted protected-value markers;
- projection freshness metadata when available.

MCP tools MUST enforce trust-zone boundaries before returning content. The G004
runtime does not expose an MCP server or retrieval API yet.
