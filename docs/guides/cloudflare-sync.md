# Cloudflare Sync Guide

Status: G005 local implementation and synthetic integration tests. G008 adds a
synthetic local Worker+D1+R2 end-to-end proof. Not deployed.

This guide describes how the G005 sync path is intended to be operated for a
private CarpeOS instance. It uses synthetic placeholders only. Do not copy real
tokens, database exports, transcripts, project names, local paths, or production
logs into this repository.

## Architecture

G005 sync has four boundaries:

- the local SQLite runtime stores canonical metadata, encrypted protected values,
  outbox state, and pull cursors;
- the CLI runs bounded `sync push`, `sync pull`, `sync once`, and `sync status`
  commands;
- the Cloudflare Worker exposes authenticated sync endpoints;
- D1 stores canonical sync metadata while R2 stores encrypted protected-value
  ciphertext bytes.

The Worker is not key escrow. API authorization uses a bearer credential hashed
for remote authorization. Decryption uses an out-of-band 32-byte trust-zone sync
key stored only on enrolled Macs.

## Cloudflare Setup

`apps/carpeos-sync-worker/wrangler.toml` contains placeholder identifiers only.
Do not replace tracked placeholders with real values. Use an ignored complete
standalone private Wrangler config for private operator work; see
[Private Cloudflare Operator Config](private-cloudflare-operator-config.md).
This repository does not claim that a live Worker, D1 database, or R2 bucket
exists. The local migration command uses the tracked placeholder `carpeos_sync`
database for local work. Private remote operations require an ignored standalone
private Wrangler config.

One private operator provisions the Cloudflare resources outside Git in a later
rollout step. These are examples of that later rollout resource creation shape,
not deployment proof:

```sh
pnpm --filter @carpeos/sync-worker exec wrangler d1 create carpeos-sync-example
pnpm --filter @carpeos/sync-worker exec wrangler r2 bucket create carpeos-protected-values-example
```

Decline any Wrangler prompt that would write real binding data into the tracked
`apps/carpeos-sync-worker/wrangler.toml`. Real bindings belong only in the
ignored standalone private config.

Run local D1 migrations from the Worker package script:

```sh
pnpm --filter @carpeos/sync-worker run d1:migrations:local
```

An authorized remote migration must use the package operator route with
`CARPEOS_CF_CONFIG` pointing to the ignored standalone private config:

```sh
pnpm --filter @carpeos/sync-worker run d1:migrations:remote
```

The operator validates the private config and passes it explicitly to Wrangler.
The tracked `apps/carpeos-sync-worker/wrangler.toml` remains placeholder-only.

For the broader local-first operator boundary, see
[Local-First Operator Runbook](local-first-operator-runbook.md). For the
maintainer evidence gate before release or deployment claims, see
[Release Readiness](../maintainers/release-readiness.md).

## Authorization Seeding

Generate a high-entropy bearer token outside Git, hash it using the CLI
`sync credential-hash` helper, and seed only the hash into D1. Store the raw token on
each enrolled Mac in a local file outside the repository:

```sh
umask 077
mkdir -p "$HOME/.carpeos"
chmod 0700 "$HOME/.carpeos"
openssl rand -base64 48 > "$HOME/.carpeos/sync-credential"
chmod 0600 "$HOME/.carpeos/sync-credential"
```

The CLI requires the credential file to be a regular file with mode `0600`.
Never pass the raw token in argv.

Generate the D1 authorization hash from the local credential file:

```sh
carpeos sync credential-hash \
  --credential-file "$HOME/.carpeos/sync-credential"
```

Seed only the returned `token_hash_sha256` value into D1:

```sql
INSERT INTO client_authorizations (client_id, trust_zone_id, token_hash_sha256)
VALUES ('client_synthetic_example', 'tz_synthetic_example', 'sha256_hex_from_cli_output');
```

## Trust-Zone Sync Key

Generate one 32-byte trust-zone sync key outside Git and copy it to each Mac by
a private channel. The file may contain either 64 hex characters or base64url
encoding of exactly 32 bytes.

```sh
umask 077
mkdir -p "$HOME/.carpeos"
chmod 0700 "$HOME/.carpeos"
openssl rand -hex 32 > "$HOME/.carpeos/trust-zone-sync.key"
chmod 0600 "$HOME/.carpeos/trust-zone-sync.key"
```

Use the same trust-zone sync key on the MacBook and Mac mini when they are meant
to share one trust zone. The key is never sent to Cloudflare; it unwraps device
keys locally so another enrolled Mac can decrypt pulled protected values.

## Local Commands

Check local sync readiness without exposing secrets:

```sh
carpeos sync status
carpeos project identify
```

`sync status` and `project identify` report the active `trust_zone_id` and how
it was resolved (`trust_zone_source`: `flag` | `env` | `config` |
`device_default`). Pending outbox zone mismatches surface as a structured
warning. Rows with `last_error` appear under `outbox_errors` when that field is
available in the installed CLI.

### Thin remote admission (default)

Default policy: **`remote_thin_promoted_v1`** (env `CARPEOS_SYNC_ADMISSION`).

| Decision | Rows |
| --- | --- |
| **Skip** | Raw `EvidenceArtifact`; draft/held Observation/Claim |
| **Admit** | `lifecycle_status=active` Observation/Claim (brain units) |

**Local-full / remote-thin:** capture may still store encrypted Evidence locally.
Thin policy only governs what leaves the machine via outbox → Worker.

Operator hygiene:

```sh
# Preview / purge non-admitted pending (canonical store untouched)
carpeos outbox skip-non-admitted
carpeos outbox skip-non-admitted --apply

# After a wipe, restore active units to the queue
carpeos outbox requeue-admitted --apply

# Push under thin: lease auto-skips Evidence/draft at queue head
carpeos sync once --url https://carpeos-sync.example.workers.dev \
  --credential-file "$HOME/.carpeos/sync-credential" \
  --sync-key-file "$HOME/.carpeos/trust-zone-sync.key" \
  --limit 10
```

Opt into historical full mirror (not recommended for dogfood machines):

```sh
export CARPEOS_SYNC_ADMISSION=full_log
```

### Trust zone resolution

Without `--trust-zone`, the CLI picks a zone in this order:

1. `--trust-zone` when provided
2. `CARPEOS_TRUST_ZONE` or `CARPEOS_MCP_TRUST_ZONE` (installer writes the latter
   into `mcp.env`)
3. `~/.carpeos/config.json` `trust_zone_id` (installer default
   `tz_local_default`)
4. device-derived `tz_local_<client_suffix>`

Capture and sync must use the **same** active zone as the outbox rows they are
meant to process. Prefer relying on config/env after install rather than
passing a different flag only on some commands.

### Bounded single run

```sh
carpeos sync once \
  --url https://carpeos-sync.example.workers.dev \
  --credential-file "$HOME/.carpeos/sync-credential" \
  --sync-key-file "$HOME/.carpeos/trust-zone-sync.key" \
  --limit 1 \
  --max-pages 1
```

`sync push` leases one outbox row by default and ACKs it only after remote
acceptance or replay. `sync pull` imports bounded pages and advances the local
cursor only after applying the page. `sync once` performs bounded push first and
then bounded pull.

For operator-safe foreground orchestration, use `sync cycle`:

```sh
carpeos sync cycle \
  --url https://carpeos-sync.example.workers.dev \
  --credential-file "$HOME/.carpeos/sync-credential" \
  --sync-key-file "$HOME/.carpeos/trust-zone-sync.key" \
  --limit 1 \
  --max-pages 1 \
  --json
```

`sync cycle` is a single bounded run, not a daemon. It resolves the same sync
URL, credential file, sync key file, project, home, and trust-zone settings as
the other sync commands. It fails closed on invalid config, unsafe secrets,
active cycle locks, manifest-write failure, bounded sync failure, retrieval
rebuild failure, health-write failure, or lock-release failure.

Cycle runtime state is private under `<home>/cycles`: lock, health, and
manifest artifacts are written with private modes and redact secrets, raw
endpoint values, and private payload text. Each run creates an immutable
pre-run manifest before the first outbound transport call, then performs one
bounded push/pull attempt. Local retrieval rebuild runs only after bounded sync
succeeds. Latest health is replaced atomically at `<home>/cycles/health.json`
while the exclusive cycle lock is still held; the lock is released only after
that health write. If lock release fails, the command exits nonzero and rewrites
failed health while the lock still fences competing cycle runs. Health reports
only whether a pull cursor is present, never the raw cursor value.

Launch scheduling is not part of this command. Launchd setup and lifecycle
management are planned for a later PR.

### Same-device push then pull

A single enrolled Mac can push local outbox events and pull them back. Remote
accept assigns `zone_sequence`. Local captures omit that field (canonical
events are append-only). Pull treats “same content, remote sequence only” as
idempotent **replay**, not a divergent rewrite. True content divergence still
fails closed.

Clean cross-device import (second Mac, empty local store for those events) is a
separate enrollment path; it is not required to prove single-Mac remote push.

The sync URL must use HTTPS for any non-local endpoint. Plain HTTP is accepted
only for loopback local development hosts: `localhost`, `127.0.0.1`, or `[::1]`.

Launchd, cron, or another operator scheduler can run `sync once` later, but
G005 intentionally keeps scheduling outside the repository.

## Failures and Erasure

The client fails closed on auth errors, idempotency conflicts, and content
mismatches. Retryable transport failures keep local outbox rows eligible for
retry. Remote server response bodies are not printed by the CLI.

Protected-value blobs are uploaded before metadata acceptance. If an R2 upload
succeeds and a later metadata commit fails, the deterministic object key makes
the encrypted orphan discoverable for later cleanup. G005 does not implement a
background garbage collector.

Erasure records are accepted into the immutable erasure ledger. Projection
repair and background blob deletion are later operator or projection tasks, not
implicit mutation of canonical events.

## Free-Tier Caveats

The G005 path is designed to be small enough for personal synthetic testing and
early private use, but free-tier limits are operational limits, not correctness
guarantees. Keep pushes bounded, avoid uploading unnecessary raw data, and treat
Workers AI, Vectorize, extraction, embedding, dashboards, and GraphRAG as future
work.

G006 adds local retrieval and adapter boundaries for future hosted embedding,
but the sync Worker does not expose a live retrieval route. Workers AI and
Vectorize bindings in code are placeholders for private operator experiments
until real resources, quotas, migrations, deployment evidence, and tests exist.

Before enabling hosted embedding, verify current official Cloudflare Workers AI
and Vectorize limits. As of the G006 design update, Workers AI free usage is
documented in Neurons/day, and Vectorize free usage is documented in monthly
queried vector dimensions plus stored vector dimensions. These limits affect
batch sizing and queue retry policy; they do not change canonical event
correctness.
