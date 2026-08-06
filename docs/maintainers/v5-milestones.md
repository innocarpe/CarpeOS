# V5 milestone tracker (maintainers)

Status truth table for CarpeOS 5.0.0 offline implementation. Update only with
test/receipt evidence. Do not claim network, Worker, D1 deploy, or canonical
authority without implementation.

| Milestone | Exit criteria | Evidence | Status |
| --- | --- | --- | --- |
| **V5-M0** Contract freeze | Independent recompute of redaction JCS, 4 reducer hashes, telemetry manifest + 30 snapshot sigs | `artifacts/v5/m0/redaction-computation-receipt.json`, `reducer-computation-receipt.json`, `telemetry-computation-receipt.json`; `node packages/v5/scripts/m0-recompute.mjs` | **pass** |
| **V5-M1** Offline redaction | 24-vector harness; P0 offsets; post-P0 `byte_offset:null`; NFC/LF | `@carpeos/v5` `src/redaction.ts` + `test/redaction.test.ts` | **implemented (offline)** |
| **V5-M2** EvidencePack | Bounded pack + view; consent/profile preflight; no network | `src/evidence-pack.ts` + provider/pack tests | **implemented (offline)** |
| **V5-M3** Reducer oracle | Scope-before-ordinal; audit-free hashes; 4 fixtures | `src/reducer.ts` + `test/reducer.test.ts` | **implemented (fixture oracle)** |
| **V5-M4** Provider boundary | Provider-neutral adapters (`fake` / `deepseek_direct` / `openrouter`); DeepSeek Direct primary experimental route (`deepseek-v4-flash`); OpenRouter optional + Luna predeclared; no implicit fallback; body-free cost experiment | `src/provider*.ts` + `test/provider-routing.test.ts` | **implemented (fake HTTP; real network off by default)** |
| **V5-M5** Attempts/review/rollback | One-dispatch; incidents; V5-off rollback; no canonical writes | `src/attempts.ts` | **implemented (sidecar)** |
| **V5-M6** Telemetry admission | Signed snapshot; 202 shed zero-vector; 503 disable; TELEMETRY_DB semantics offline | `src/telemetry.ts` + generator fixtures | **implemented (offline model)** |
| **V5-M7** Evaluation | Frozen ledger; denominators; circuit breaker; V5-off | `src/evaluation.ts` | **implemented (offline)** |
| **V5-M8** Integration | Body-free accepted 4.0 seam; V5-off path; opt-in draft decision | `src/integration.ts` | **deferred** (no accepted 4.0 seam in this worktree yet) |

## Hard fences (do not violate)

- Do not modify schema-v1, adj_v3, or canonical migrations.
- Sidecar rows must not allocate canonical sequences or enter outbox/retrieval.
- No revocation probe / D1 lookup before signed in-memory admission.
- No credentials or provider bodies in fixtures/receipts/logs.

## Parallel ownership

Safe after M0: redaction, pack/schema, reducer, evaluation (disjoint files).

Do **not** parallelize: canonical migrations; Worker auth + telemetry ledger; M8 seam; release/tag/publish.

## Provider notes (maintainers)

- Verified DeepSeek Direct model (2026-08-06): `deepseek-v4-flash` @ `https://api.deepseek.com` (not `deepseek-chat` / `deepseek-reasoner`).
- Verified OpenRouter slugs: `deepseek/deepseek-v4-flash-0731`, `openai/gpt-5.6-luna`.
- Price snapshot for Direct flash: official pricing page (cache hit/miss + output per 1M tokens).
- Live calls need operator-issued `DEEPSEEK_API_KEY` / `OPENROUTER_API_KEY` in env only; never fixtures or git.
- Cost experiment: synthetic pack digests only; spend cap + kill switch; body-free receipts.
- Live runner: `docs/maintainers/v5-cost-experiment.md` and `packages/v5/scripts/live-cost-experiment.mjs` (`--allow-network`, default out `~/.carpeos/v5-cost-experiments/`).

## Recompute command

```sh
node packages/v5/scripts/m0-recompute.mjs
pnpm --filter @carpeos/v5 test
```
