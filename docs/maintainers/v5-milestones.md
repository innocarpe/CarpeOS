# V5 milestone tracker (maintainers)

Status truth table for CarpeOS 5.0.0. Update only with test/receipt evidence.
**Product primary path: DeepSeek Direct.** OpenRouter is optional and not required.

| Milestone | Exit criteria | Evidence | Status |
| --- | --- | --- | --- |
| **V5-M0** Contract freeze | Independent recompute of redaction JCS, 4 reducer hashes, telemetry manifest + 30 snapshot sigs | `artifacts/v5/m0/*-computation-receipt.json`; `node packages/v5/scripts/m0-recompute.mjs` | **pass** |
| **V5-M1** Offline redaction | 24-vector harness; P0 offsets; post-P0 `byte_offset:null`; NFC/LF | `src/redaction.ts` + `test/redaction.test.ts` | **complete** |
| **V5-M2** EvidencePack | Bounded pack + view; consent/profile preflight; no network | `src/evidence-pack.ts` | **complete** |
| **V5-M3** Reducer oracle | Scope-before-ordinal; audit-free hashes; 4 fixtures | `src/reducer.ts` + `test/reducer.test.ts` | **complete** |
| **V5-M4** Provider boundary | DeepSeek Direct primary (`deepseek-v4-flash`); fake default when network off; no implicit fallback; live cost experiment | `src/provider*.ts`, `scripts/live-cost-experiment.mjs` | **complete** |
| **V5-M5** Attempts/review/rollback | One-dispatch; incidents; V5-off rollback; no canonical writes | `src/attempts.ts` | **complete** |
| **V5-M6** Telemetry | Signed admission model + local TELEMETRY_DB store + SQL migration | `src/telemetry.ts`, `src/telemetry-store.ts`, `migrations/telemetry/001_telemetry_initial.sql` | **complete (local)**; CF Worker deploy remains operator-optional |
| **V5-M7** Evaluation | Frozen all-200 ledger; denominators; circuit breaker; V5-off | `src/evaluation.ts`, `src/evaluation-all200.ts`, `carpeos v5 eval-all200` | **complete** |
| **V5-M8** Integration | Body-free accepted 4.0 seam | `src/integration.ts` | **deferred** (draft-lane readiness does not invent 4.0 acceptance) |
| **E2E pipeline** | redact→pack→extract→draft reduce→eval | `src/pipeline.ts`, `src/draft-reduce.ts`, `test/pipeline.test.ts` | **complete (offline)** |
| **Operator CLI** | Opt-in `carpeos v5` (status/readiness/eval-all200/draft) | `apps/carpeos-cli` | **complete** (not capture-hook) |
| **ADR** | Draft-only + DeepSeek primary decision record | `docs/adr/0016-v5-draft-only-deepseek-primary.md` | **complete** |

## Hard fences (do not violate)

- Do not modify schema-v1, adj_v3, or canonical migrations.
- Sidecar rows must not allocate canonical sequences or enter outbox/retrieval.
- No revocation probe / D1 lookup before signed in-memory admission.
- No credentials or provider bodies in fixtures/receipts/logs.
- Capture transaction must not perform LLM/network work.

## Provider notes

- Primary: DeepSeek Direct `deepseek-v4-flash` @ `https://api.deepseek.com`.
- Auth: `DEEPSEEK_API_KEY` via `~/.carpeos/v5-provider.env` (0600) only.
- OpenRouter optional; not required for 5.0.0 draft-lane completion.
- Cost experiment: [v5-cost-experiment.md](v5-cost-experiment.md).

## Draft-lane readiness (without M8)

```sh
pnpm --filter @carpeos/v5 test
node packages/v5/scripts/m0-recompute.mjs
```

`v5DraftLaneReadiness` allows M8 `deferred` while marking the draft lane ready when M0–M7 + pipeline + DeepSeek primary + local telemetry + V5-off path pass.

## Recompute / experiment

```sh
node packages/v5/scripts/m0-recompute.mjs
pnpm --filter @carpeos/v5 test
node packages/v5/scripts/live-cost-experiment.mjs --dry-run
# live (operator):
# set -a && source ~/.carpeos/v5-provider.env && set +a
# node packages/v5/scripts/live-cost-experiment.mjs --allow-network --spend-cap-usd 0.05
```
