# Local Capture Guide

Status: G004 local runtime.

This guide covers the implemented local capture surface. It uses synthetic
payloads only. Remote sync is not implemented in G004. Later local-only guides
describe the G005 sync code path and the G008 synthetic end-to-end proof, but
this guide remains scoped to local capture.

For current sync and cross-Mac operator boundaries, see
[Cloudflare Sync Guide](cloudflare-sync.md) and
[Cross-Mac Bootstrap and Recovery](cross-mac-bootstrap-recovery.md).

## Prerequisites

- Node.js 22.22 or newer.
- pnpm 11.16 or newer.
- A built workspace:

```sh
pnpm install
pnpm build
```

The provider templates call `carpeos`. That binary must be available on `PATH`
when templates are installed in Codex, Claude Code, or Grok Build. In repository
development, the same command behavior can be exercised through the compiled
entrypoint:

```sh
node apps/carpeos-cli/dist/index.js init
```

Node 22.22 prints an `ExperimentalWarning` for `node:sqlite`. The CLI shebang
suppresses that warning when the installed `carpeos` binary is executed, but
direct `node apps/carpeos-cli/dist/index.js ...` development commands may still
show it.

## Runtime Directory

CarpeOS stores local runtime data under `CARPEOS_HOME` when it is set.
Otherwise, it uses `.carpeos` under the current user home directory.

```sh
export CARPEOS_HOME=.carpeos-example
```

The runtime creates:

- `carpeos.sqlite` for local capture metadata, protected values, canonical rows,
  and outbox state;
- `local-aes256.key` for local AES-256-GCM key material;
- `device-client-id` for stable local trust-zone derivation.

The runtime directory is created with mode `0700`. The key file is created with
mode `0600`.

## Project Identity

Project identity is resolved in this order:

1. `--project-id`, kept as-is when already canonical or normalized with a
   deterministic hash suffix when readability cleanup would otherwise be
   lossy;
2. sanitized `git remote.origin.url`, hashed without credentials;
3. device-local workspace path hash.

The Git remote hash lets two machines identify the same repository without
storing credentials or raw remote URLs in the canonical event. The path fallback
is device-local, so it should not be used when cross-machine identity matters.

Cross-Mac sharing requires later sync setup outside this G004 guide. G004 only
prepares local project identity and outbox data.

## Initialize

```sh
carpeos init
```

Common options:

- `--home <dir>` overrides `CARPEOS_HOME`;
- `--project-id <id>` sets explicit project identity;
- `--trust-zone <id>` sets explicit local trust-zone identity.

The command prints JSON with `runtime_dir`, `database_path`, `project_id`,
`client_id`, and `trust_zone_id`.

## Identify a Project

```sh
carpeos project identify
```

This opens or initializes the local store and prints the resolved `project_id`,
`client_id`, and `trust_zone_id`.

## Capture a Hook Payload

Read JSON from standard input:

```sh
printf '%s\n' '{"hook_event_name":"SessionEnd","session_id":"session_synthetic","timestamp":"2026-01-01T00:00:00Z","message":"synthetic capture"}' |
  carpeos capture-hook --provider codex
```

Read one JSON argument:

```sh
carpeos capture-hook --provider codex --input argv \
  '{"hook_event_name":"SessionEnd","session_id":"session_synthetic","timestamp":"2026-01-01T00:00:00Z","message":"synthetic capture"}'
```

Supported providers:

- `codex`;
- `claude`;
- `grok`.

Capture options:

- `--fail-open` returns exit code 0 if capture fails and writes a structured
  warning to standard error;
- `--quiet` suppresses successful capture output;
- `--idempotency-key <key>` overrides derived idempotency for tests or explicit
  replay boundaries;
- `--home <dir>`, `--project-id <id>`, and `--trust-zone <id>` have the same
  meaning as `init`.

Successful capture returns JSON with `event_id`, `event_type`, `local_sequence`,
`outbox_id`, `request_fingerprint`, `trust_zone_id`, and `project_id` unless
`--quiet` is set.

Raw hook JSON is encrypted into a protected value. It is not printed and is not
stored inline in the canonical event. A valid provider timestamp is preserved as
`valid_time.start`; the local ingestion clock is stored separately as
`recorded_time.start`.

## Inspect the Outbox

```sh
carpeos outbox status
```

The status command returns counts for:

- `pending`;
- `leased`;
- `delivered`.

## Lease Outbox Items

```sh
carpeos outbox lease --limit 1 --lease-ms 30000
```

The lease command moves due `pending` rows, and expired `leased` rows, into a
new lease. It returns `lease_id`, `leased_until`, and leased items. Each item
contains the outbox row, local sequence, attempts count, protected value ID, and
sync push request.

This does not upload anything. It is a durable metadata-outbox primitive for
sync code outside the G004 capture scope. The sync guide defines how later
Worker/client paths upload or transfer the encrypted protected-value blob
addressed by that ID.

## Acknowledge Delivery

```sh
carpeos outbox ack --outbox-id 1 --lease-id lease_synthetic
```

Acknowledgement succeeds only when the row is currently leased with the matching
lease ID. It marks the row `delivered`. A wrong lease ID returns JSON with
`ok: false` and exits with code 2.

## Retry Delivery

```sh
carpeos outbox retry \
  --outbox-id 1 \
  --lease-id lease_synthetic \
  --delay-ms 0 \
  --error "synthetic retry"
```

Retry succeeds only when the row is currently leased with the matching lease ID.
It returns the row to `pending`, records a bounded error message, and schedules
the next availability time.

## Provider Templates

Public templates live under `adapters/`.

| Provider | Template | Behavior |
| --- | --- | --- |
| Codex | `adapters/codex/hooks.json.example` | Forwards selected lifecycle command hooks with JSON on standard input. |
| Codex notify | `adapters/codex/notify.toml.example` | Separate notification example that passes one JSON argument with `--input argv`. |
| Claude Code | `adapters/claude/settings.json.example` | Forwards selected lifecycle command hooks and uses documented `async: true`. |
| Grok Build | `adapters/grok/hooks.json.example` | Forwards selected lifecycle command hooks with JSON on standard input. |

Official references:

- Codex hooks: <https://learn.chatgpt.com/docs/hooks>
- Claude Code hooks: <https://code.claude.com/docs/en/hooks>
- Grok Build hooks: <https://docs.x.ai/build/features/hooks>

Templates use:

```sh
carpeos capture-hook --provider <provider> --fail-open --quiet
```

That keeps AI agent workflows moving if CarpeOS capture fails and avoids adding
successful capture output to the agent conversation.

## Current Limits

G004 does not include:

- remote sync;
- cross-Mac sharing;
- MCP retrieval;
- embedding;
- GraphRAG;
- Obsidian projection;
- extraction into observations, claims, acceptance decisions, or supersessions;
- a background daemon installer.

The metadata outbox is durable, but protected-value blob transfer and a
background remote worker are outside this G004 capture guide.
