# Local Store Migrations

Status: **G6 policy** — how CarpeOS upgrades on-disk local homes without silent
wipes.

Related:

- Implementation: `packages/local-store/src/store.ts` (`LocalCaptureStore.migrate`)
- Retrieval projection: `packages/retrieval/src/local-index.ts`
  (`migrateLocalRetrievalIndex`)
- v1 readiness: [G6](../maintainers/v1-readiness.md)
- Install home layout: [one-stop install](../guides/one-stop-install.md)

## Goals

1. **No silent wipe** of an existing operator home (`~/.carpeos` or
   `$CARPEOS_HOME`).
2. Opening a store always applies **pending** migrations and is **idempotent**.
3. Canonical events remain **append-only** (DB triggers reject UPDATE/DELETE).
4. Future schema changes ship as **new migration IDs**, never by rewriting old
   IDs.

## What lives on disk

| Artifact | Path (default) | Migrated by |
| --- | --- | --- |
| SQLite home DB | `$CARPEOS_HOME/carpeos.sqlite` | Capture store + retrieval migrations into the same file |
| Install config | `$CARPEOS_HOME/config.json` | Installer / setup (not SQL); rewritten intentionally by setup |
| MCP env | `$CARPEOS_HOME/mcp.env` | Installer / setup |
| Keys / secrets | under home (mode-restricted) | Never rewritten by migrations |

Private knowledge is **only** in the local home. Public git never contains it.

## Migration ledger

Both capture and retrieval use:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
```

A migration runs only when its `migration_id` is absent. Re-opening the store
must not re-apply DDL that would destroy data.

### Registered migration IDs (current)

| ID | Package | Purpose |
| --- | --- | --- |
| `001_local_capture_store` | `@carpeos/local-store` | projects, capture_requests, protected_values, canonical_events, outbox + append-only triggers |
| `002_sync_transfer_imports` | `@carpeos/local-store` | protected_value_imports, sync_inbox_*, sync_cursors |
| `003_retrieval_local_index` | `@carpeos/retrieval` | retrieval_chunks, projection_freshness, local_vectors, FTS5 |

Code anchors:

- `LOCAL_STORE_MIGRATION_IDS` in `packages/local-store/src/store.ts`
- `RETRIEVAL_LOCAL_INDEX_MIGRATION_ID` in `packages/retrieval/src/local-index.ts`

## Invariants

### Must

- Use `CREATE TABLE IF NOT EXISTS` / additive `ALTER` for upgrades.
- Record each migration ID exactly once.
- Preserve existing `canonical_events` rows across reopen and upgrade.
- Keep capture/outbox idempotency keys stable.
- Fail closed if a required runtime capability is missing (e.g. FTS5) rather than
  deleting data and continuing.

### Must not

- `DROP TABLE` / `DELETE FROM` of user tables inside a default open-path migration.
- Reuse or rename a shipped `migration_id`.
- Auto-delete `$CARPEOS_HOME` when schema is newer/older.
- “Reset store” as a silent side effect of `carpeos init`, `setup`, or upgrade.

### Allowed destructive paths (explicit only)

Destructive cleanup is **operator-initiated**, out of band, and never automatic:

```sh
# operator-owned; not part of carpeos migrate
rm -rf "$CARPEOS_HOME"   # only when the operator intends a full reset
```

Document any future `carpeos store reset` as an **explicit** command with
confirmation flags — do not fold wipe into upgrade.

## Adding a migration

1. Choose the next sequential id: `004_…` (never rewrite 001–003).
2. Implement additive SQL under a new `if (existing === undefined)` branch
   (capture) or `INSERT OR IGNORE` (retrieval).
3. Export the id in the package’s public migration constant list.
4. Add a unit test: open store → apply new migration → close → reopen →
   prior rows still present + migration row recorded.
5. Note in CHANGELOG; if the change breaks readers of the old on-disk format
   without a migration path, that is a **break** (MINOR on `0.y.z`, MAJOR after
   `1.0.0`).

## Install `config.json` vs SQLite

`config.json` is install metadata (home, bin wrappers, MCP paths). Setup may
rewrite it on `carpeos setup run --apply`. That is **not** a data wipe:

- SQLite event history stays unless the operator changes `--home` to a new path.
- Pointing setup at a **new** home creates a **new** empty store (expected).

## Verification

Existing automated coverage:

| Test | Asserts |
| --- | --- |
| `packages/local-store/test/store.test.ts` “keeps migrations idempotent across reopen” | migration count stable on reopen |
| `packages/local-store/test/store.test.ts` “preserves events across reopen after migrations” | event rows survive reopen (G6) |
| `packages/local-store/test/retrieval-index.test.ts` migration idempotency | retrieval migrate safe to re-run |

Manual smoke:

```sh
# after install
carpeos init --home "$HOME/.carpeos" --trust-zone tz_local_default
# upgrade CLI package
npm install -g @innocarpe/carpeos@latest
carpeos init --home "$HOME/.carpeos" --trust-zone tz_local_default
# store should open; prior events still queryable
carpeos memory context-pack --task "smoke" --trust-zone tz_local_default \
  --visible-trust-zone tz_local_default
```

## Compatibility with v1 freeze

After `1.0.0`, changing on-disk layout without a forward migration that
preserves existing homes is a **MAJOR** break. Pre-1.0, still treat wipes as
bugs; prefer additive migrations even while on `0.y.z`.
