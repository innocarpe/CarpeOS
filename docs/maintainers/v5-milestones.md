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
| **V5-M4** Provider boundary | OpenRouter-first; DeepSeek Flash default; Luna predeclared; fakes only | `src/provider.ts` | **implemented (fake-only)** |
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

## Recompute command

```sh
node packages/v5/scripts/m0-recompute.mjs
pnpm --filter @carpeos/v5 test
```
