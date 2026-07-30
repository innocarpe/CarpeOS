# Local-First Operator Runbook

Status: G008 local operator guidance. Synthetic examples only. Not deployed.

This runbook separates implemented local behavior from private operator actions.
It does not claim package publishing, private vault adoption, cross-Mac live
deployment, or hosted Cloudflare resources.

## Proven G008 Evidence

G008 has these local-only proofs:

- `pnpm check` passes on Node 22.22.0;
- the opt-in synthetic end-to-end Worker/D1/R2 gate passes locally:

```sh
mise exec node@22.22.0 -- pnpm check
mise exec node@22.22.0 -- pnpm --filter @carpeos/sync-worker test:e2e
```

The opt-in test is a synthetic local Worker+D1+R2 proof. It is not a hosted
deployment proof. Remote CI must report this gate separately before maintainers
claim CI evidence.

## Local Setup

From a clean checkout, install and build:

```sh
pnpm install
pnpm build
```

Initialize a local runtime with synthetic identifiers:

```sh
node apps/carpeos-cli/dist/index.js init \
  --home .carpeos-example \
  --project-id project_example_alpha \
  --trust-zone tz_synthetic_example
```

Capture one synthetic hook payload:

```sh
node apps/carpeos-cli/dist/index.js capture-hook --provider codex --input argv \
  --home .carpeos-example \
  --project-id project_example_alpha \
  --trust-zone tz_synthetic_example \
  '{"hook_event_name":"SessionEnd","session_id":"session_synthetic","timestamp":"2026-01-01T00:00:00Z","message":"We decided to keep this smoke proof synthetic."}'
```

Check the outbox:

```sh
node apps/carpeos-cli/dist/index.js outbox status --home .carpeos-example
```

## Local Retrieval

Rebuild local retrieval projections:

```sh
node apps/carpeos-cli/dist/index.js retrieval rebuild \
  --home .carpeos-example \
  --trust-zone tz_synthetic_example
```

Search with explicit visibility:

```sh
node apps/carpeos-cli/dist/index.js memory search \
  --home .carpeos-example \
  --query "project_example_alpha" \
  --project-id project_example_alpha \
  --trust-zone tz_synthetic_example \
  --visible-trust-zone tz_synthetic_example \
  --limit 10
```

Retrieval output is a projection. A search result does not make a claim
accepted. This smoke query targets the projected project id in the metadata-only
Observation statement, not the raw hook `message` or `session_id` fields.

## MCP and Obsidian

The MCP server is local stdio only. It requires explicit environment variables
described in [MCP Server Guide](mcp-server.md). It exposes exactly the G007
eight-tool surface and fails closed on missing visibility.

The Obsidian projection package writes generated Markdown and a manifest under
a private output root. Generated notes have `canonical_effect: "none"` and are
not source records. See [Obsidian Projection Guide](obsidian-projection.md).

## Private Operator Actions

These actions are not proven by the public repository alone:

- provisioning a real Cloudflare Worker, D1 database, or R2 bucket;
- replacing placeholder `wrangler.toml` bindings with private resource IDs;
- seeding real authorization hashes into D1;
- copying a trust-zone sync key to another device by a private channel;
- scheduling repeated sync;
- adopting a generated Obsidian output root as a private vault;
- publishing packages or installing a global `carpeos` binary.

Do not claim any of those as complete without private operator evidence.

## Stop Conditions

Stop and do not continue automation when:

- a command would print a credential, key, protected value, runtime export, or
  private project name;
- a sync URL is not HTTPS and is not loopback local development;
- the trust-zone sync key is missing or has the wrong size;
- a projection output path escapes the intended private output root;
- the operator cannot prove which Worker/D1/R2 resources are bound.
