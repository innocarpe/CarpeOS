# Private Cloudflare Operator Config

Status: Private operator configuration contract. Documentation only. Not
deployed.

This guide defines the private Cloudflare configuration boundary for one
operator-owned CarpeOS instance. The public repository tracks only synthetic
placeholders. The tracked `apps/carpeos-sync-worker/wrangler.toml` must never
contain real Cloudflare account IDs, D1 database IDs, R2 bucket names, Worker
routes, tokens, credentials, private project names, or local operator paths.

The ignored private file is a complete standalone Wrangler configuration. Do
not treat it as a partial file. Every remote Wrangler command in this guide
passes the private file with an explicit quoted `--config "$CARPEOS_CF_CONFIG"`.

Official references:

- Wrangler configuration:
  <https://developers.cloudflare.com/workers/wrangler/configuration/>
- Wrangler Worker commands:
  <https://developers.cloudflare.com/workers/wrangler/commands/workers/>
- Worker secrets:
  <https://developers.cloudflare.com/workers/configuration/secrets/>
- D1 Worker API:
  <https://developers.cloudflare.com/d1/worker-api/d1-database/>
- R2 Worker API:
  <https://developers.cloudflare.com/r2/api/workers/workers-api-reference/>

## Public Boundary

Public docs and tracked files show synthetic placeholders only. If a command or
raw output would expose a real identifier, keep that output under ignored
`.carpeos` and redact it before copying evidence into an issue, pull request, or
release note.

The tracked config is placeholder-only evidence for repository shape. It is not
a deployment config. Do not edit tracked placeholders into real values. Create
and maintain the ignored private file instead:

```sh
CARPEOS_REPO_ROOT="$(git rev-parse --show-toplevel)"
CARPEOS_CF_DIR="$CARPEOS_REPO_ROOT/.carpeos/cloudflare"
CARPEOS_CF_CONFIG="$CARPEOS_CF_DIR/wrangler.toml"
CARPEOS_CF_DRY_RUN_DIR="$CARPEOS_CF_DIR/dry-run"

umask 077
mkdir -p "$CARPEOS_CF_DIR" "$CARPEOS_CF_DRY_RUN_DIR"
chmod 0700 "$CARPEOS_CF_DIR" "$CARPEOS_CF_DRY_RUN_DIR"
touch "$CARPEOS_CF_CONFIG"
chmod 0600 "$CARPEOS_CF_CONFIG"
git check-ignore "$CARPEOS_CF_CONFIG"
```

`git check-ignore` must print the ignored private path before the operator adds
real identifiers.

## Standalone Config

Use this complete private file shape. The sample below intentionally uses only
synthetic placeholders; a private operator fills the ignored file with the real
Worker name, D1 database name, D1 database ID, R2 bucket name, and non-secret
environment label.

```toml
name = "carpeos-sync-private-example"
main = "../../apps/carpeos-sync-worker/src/index.ts"
compatibility_date = "2026-07-29"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "carpeos_sync_private_example"
database_id = "d1-database-id-from-cloudflare"
migrations_dir = "../../apps/carpeos-sync-worker/migrations"

[[r2_buckets]]
binding = "PROTECTED_VALUES"
bucket_name = "carpeos-protected-values-private-example"

[vars]
CARPEOS_ENV = "private-example"
```

The private config path is absolute because
`pnpm --filter @carpeos/sync-worker exec` runs Wrangler with the Worker package
as its current working directory. Passing a relative `--config` path would make
Wrangler search from `apps/carpeos-sync-worker`, not from the repository root.
The `main` and `migrations_dir` values inside the private config remain relative
to the private config file itself, so they point back from
`.carpeos/cloudflare/wrangler.toml` to the tracked Worker source and migrations.

This initial private sync config intentionally excludes Workers AI and Vectorize
bindings. Those resources stay out of the private sync deployment config until
they have their own hosted embedding and vector projection evidence gates.

Do not put raw bearer credentials, sync keys, API tokens, or password material in
`[vars]`, Wrangler config files, shell history, or command arguments. The raw
bearer credential is stored only on enrolled machines as a `0600` local file.
The trust-zone sync key is also a `0600` local file. The authorization hash is
seeded into D1 in a later rollout step; this guide does not automate that
mutation. Wrangler authentication uses Wrangler's normal account login or API
token mechanisms outside this repository.

## Preflight

Run preflight from anywhere inside the repository before any remote operation:

```sh
CARPEOS_REPO_ROOT="$(git rev-parse --show-toplevel)"
CARPEOS_CF_DIR="$CARPEOS_REPO_ROOT/.carpeos/cloudflare"
CARPEOS_CF_CONFIG="$CARPEOS_CF_DIR/wrangler.toml"
CARPEOS_CF_DRY_RUN_DIR="$CARPEOS_CF_DIR/dry-run"

test -f "$CARPEOS_CF_CONFIG"
test "$(stat -f "%Lp" "$CARPEOS_CF_DIR")" = "700"
test "$(stat -f "%Lp" "$CARPEOS_CF_CONFIG")" = "600"
git check-ignore "$CARPEOS_CF_CONFIG"
pnpm --filter @carpeos/sync-worker exec wrangler deploy \
  --dry-run \
  --outdir "$CARPEOS_CF_DRY_RUN_DIR" \
  --config "$CARPEOS_CF_CONFIG"
```

The dry run proves only that Wrangler can parse the private configuration and
bundle the Worker entrypoint. It does not prove a hosted Worker exists, that D1
or R2 resources are reachable, that migrations ran, that auth hashes were
seeded, or that a sync client has completed a remote cycle. Raw dry-run output
may include private identifiers; store it only under ignored `.carpeos` or a
private evidence store and redact it before sharing.

## Future Mutation Gates

This guide does not authorize mutation of Cloudflare resources. Later rollout
steps may add operator procedures for these commands, but each mutation still
requires fresh private evidence and explicit use of the ignored standalone
config:

```sh
CARPEOS_REPO_ROOT="$(git rev-parse --show-toplevel)"
CARPEOS_CF_DIR="$CARPEOS_REPO_ROOT/.carpeos/cloudflare"
CARPEOS_CF_CONFIG="$CARPEOS_CF_DIR/wrangler.toml"
CARPEOS_D1_NAME="carpeos_sync_private_example"

pnpm --filter @carpeos/sync-worker exec wrangler d1 migrations apply \
  "$CARPEOS_D1_NAME" \
  --remote \
  --config "$CARPEOS_CF_CONFIG"

pnpm --filter @carpeos/sync-worker exec wrangler deploy \
  --config "$CARPEOS_CF_CONFIG"
```

Do not run those commands from the tracked placeholder config. Do not use package
scripts for private remote mutations unless the script accepts and passes the
same explicit private config path.

## Validation

Before claiming private Cloudflare readiness, keep these evidence classes
separate:

- Repository evidence: tracked config contains placeholders only; ignored
  private config path is proven by `git check-ignore`; docs show only synthetic
  placeholders.
- Local parse evidence: `wrangler deploy --dry-run --outdir ... --config ...`
  succeeds and stores raw output privately.
- Resource evidence: the operator can identify the intended Worker, D1 database,
  and R2 bucket from Cloudflare-controlled state.
- Mutation evidence: migrations and deploy commands use the quoted private
  config path and produce private, redacted evidence.
- Runtime evidence: a later bounded sync command reaches the hosted Worker and
  proves D1/R2 behavior without leaking credentials or protected values.

This guide can claim only repository evidence and local parse evidence.
Resource, mutation, and runtime evidence belong to later rollout steps.

## Stop Conditions

Stop before running a command or copying output when:

- the command would use `apps/carpeos-sync-worker/wrangler.toml` for private
  remote work;
- `git check-ignore "$CARPEOS_CF_CONFIG"` does not prove the private config is
  ignored;
- a file or directory mode is broader than `0700` for directories or `0600` for
  local credential/config files;
- raw bearer credentials, sync keys, API tokens, D1 IDs, R2 bucket names, private
  project names, local paths, or account details would be printed into tracked
  files;
- Workers AI or Vectorize bindings are needed before hosted embedding and vector
  projection evidence gates exist.

## Rollback And Cleanup

Repository rollback is docs-only: revert the guide changes and confirm tracked
Wrangler config still contains placeholders only.

Private cleanup stays outside Git:

```sh
CARPEOS_REPO_ROOT="$(git rev-parse --show-toplevel)" || {
  printf 'not inside a git checkout\n' >&2
  exit 1
}
test -n "$CARPEOS_REPO_ROOT" || {
  printf 'empty repository root\n' >&2
  exit 1
}
CARPEOS_CF_DIR="$CARPEOS_REPO_ROOT/.carpeos/cloudflare"
CARPEOS_CF_DRY_RUN_DIR="$CARPEOS_CF_DIR/dry-run"

case "$CARPEOS_CF_DRY_RUN_DIR" in
  "$CARPEOS_REPO_ROOT/.carpeos/cloudflare/dry-run")
    rm -rf -- "$CARPEOS_CF_DRY_RUN_DIR"
    ;;
  *)
    printf 'refusing to remove unexpected dry-run path: %s\n' \
      "$CARPEOS_CF_DRY_RUN_DIR" >&2
    exit 1
    ;;
esac
```

Remove the private config only when the operator has another copy of the
Cloudflare resource mapping or intentionally wants to discard it. Do not copy the
removed config contents into tracked files during cleanup.
