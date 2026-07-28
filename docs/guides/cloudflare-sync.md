# Cloudflare Sync Guide

Status: G005 local implementation and synthetic integration tests. Not deployed.

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

One private operator provisions the Cloudflare resources outside Git:

```sh
pnpm --filter @carpeos/sync-worker exec wrangler d1 create carpeos-sync-example
pnpm --filter @carpeos/sync-worker exec wrangler r2 bucket create carpeos-protected-values-example
```

Then run local and remote D1 migrations from the Worker package:

```sh
pnpm --filter @carpeos/sync-worker d1:migrations:local
pnpm --filter @carpeos/sync-worker d1:migrations:remote
```

`apps/carpeos-sync-worker/wrangler.toml` contains placeholder identifiers only.
Replace them in private operator configuration before any real deployment. This
repository does not claim that a live Worker, D1 database, or R2 bucket exists.
The package scripts target the placeholder `carpeos_sync` database name from the
example config; private operators must bind that name to a real D1 database ID
outside the public repo before remote use.

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
```

Run one bounded push and pull cycle:

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
then bounded pull. There is no daemon or infinite loop in G005.

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
