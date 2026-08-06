# V5 live cost experiment (maintainers)

Operator-only, **opt-in** DeepSeek Direct cost measurement. Not a release gate.
Not part of the capture hot path.

## Prerequisites

1. Keys live **outside the repo**, mode `0600`:

   ```sh
   # ~/.carpeos/v5-provider.env
   export DEEPSEEK_API_KEY='…'
   ```

2. Never commit the key, paste it into chat, or put it under the worktree.

3. Load for one shell only:

   ```sh
   set -a && source ~/.carpeos/v5-provider.env && set +a
   test -n "$DEEPSEEK_API_KEY" && echo "DEEPSEEK_API_KEY is set"
   ```

## Dry run (no network)

```sh
node packages/v5/scripts/live-cost-experiment.mjs --dry-run
```

## Live run

```sh
node packages/v5/scripts/live-cost-experiment.mjs \
  --allow-network \
  --spend-cap-usd 0.05 \
  --cases 2
```

Flags:

| Flag | Default | Meaning |
| --- | --- | --- |
| `--allow-network` | off | Required for real HTTP |
| `--spend-cap-usd` | `0.05` | Hard stop when cumulative estimate ≥ cap |
| `--cases` | `2` | Number of synthetic cases (`1` or `2`) |
| `--out` | `~/.carpeos/v5-cost-experiments/…` | Body-free ledger path |
| `--dry-run` | | Plan only |

## What is recorded

Body-free only:

- provider/model/route
- pack_digest (synthetic)
- token usage (incl. cache hit/miss when provided)
- latency, HTTP status
- estimated `cost_usd` from the frozen price snapshot
- `canonical_effect: "none"`

**Not** recorded: API keys, Authorization headers, prompt/completion bodies, paths, credentials.

## Price snapshot

DeepSeek Direct `deepseek-v4-flash` (docs, 2026-08-06):

- input cache hit: $0.0028 / 1M
- input cache miss: $0.14 / 1M
- output: $0.28 / 1M

Re-verify [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/) before large runs.

## Safety

- Default network **off** without `--allow-network`.
- Spend cap kill switch stops further cases when exceeded.
- Live ledgers default under `~/.carpeos/` (private home).
- Do not commit live ledgers into the public repo.

## Related code

- Adapters: `packages/v5/src/provider*.ts`
- Offline cost helpers: `packages/v5/src/provider-cost.ts`, `provider-experiment.ts`
- Script: `packages/v5/scripts/live-cost-experiment.mjs`
