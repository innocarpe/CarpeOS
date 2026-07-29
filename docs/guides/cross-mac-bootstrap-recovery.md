# Cross-Mac Bootstrap and Recovery

Status: G008 operator guidance. Synthetic examples only. Not live deployed.

This guide describes how cross-Mac sync is intended to work for a private
operator. It distinguishes implemented local behavior from private deployment
work that the public repository cannot prove.

## Boundary

The public repository proves only synthetic local behavior. It does not prove:

- a hosted Worker;
- production D1 or R2 resources;
- a real cross-Mac sync cycle;
- adoption of a private Obsidian vault;
- package publishing or binary installation.

Cloudflare stores metadata and encrypted blobs. It does not store the
trust-zone sync key and cannot decrypt protected values by itself.

## First Device

On the first device:

1. Initialize the local runtime.
2. Capture synthetic or private events.
3. Generate a bearer credential outside Git.
4. Generate one 32-byte trust-zone sync key outside Git.
5. Hash the bearer credential with `carpeos sync credential-hash`.
6. Seed only the hash into the private D1 database.
7. Run one bounded `sync once` against the private Worker URL.

Use local files with mode `0600` for the bearer credential and trust-zone sync
key. Never pass raw credentials in argv.

## Second Device

On the second device:

1. Install/build the same CarpeOS code or package version.
2. Initialize a local runtime for the same trust zone.
3. Copy the same trust-zone sync key by a private channel.
4. Copy or create an authorized bearer credential by a private channel.
5. Configure the same private Worker URL.
6. Run bounded `sync pull` or `sync once`.
7. Rebuild retrieval and any private Obsidian projection from the pulled
   canonical records.

The second device can decrypt pulled protected values only when it has the
correct trust-zone sync key.

## Recovery Matrix

| Failure | Recovery |
| --- | --- |
| Outbox transport failure | Retry `sync once`; retryable rows remain eligible. |
| Idempotent replay | Safe; replay should not allocate another server sequence. |
| Bearer credential leaked | Remove or rotate the authorization hash in private D1 and replace local credential files. |
| Bearer credential lost but D1/admin access remains | Generate a new credential, hash it, seed the new hash, and remove the old hash. |
| Trust-zone sync key missing on second device | Recopy the key from an enrolled device by a private channel. |
| Trust-zone sync key lost everywhere | Encrypted protected values for that trust zone are unrecoverable from Cloudflare alone. |
| Local SQLite store lost but keys remain | Reinitialize local runtime and pull from the private sync service, then rebuild projections. |
| Local protected-value key lost before sync | Unsynced local protected payloads can be unrecoverable. |
| R2 upload succeeded but D1 metadata failed | The encrypted orphan is discoverable by deterministic object metadata; cleanup is operator work. |
| Generated Obsidian note stale or leaked | Rebuild or delete the projection; canonical events remain the recovery point. |

## Unrecoverable Cases

CarpeOS cannot recover plaintext when every decrypting local key for that
protected value or trust zone is gone. The Worker, D1, and R2 are intentionally
not key escrow.

CarpeOS also cannot prove private deployment state from public repository files.
An operator must keep separate evidence for real Worker URL, D1 database, R2
bucket, migrations, seeded authorization, and successful bounded sync.
