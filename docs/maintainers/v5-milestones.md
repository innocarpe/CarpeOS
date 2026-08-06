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
| **V5-M8** Integration | Body-free 4.0 seam scan + final opt-in decision; accept only with independent release evidence | `src/m8-seam.ts`, `scripts/m8-decision.mjs`, `carpeos v5 m8` | **mechanism complete**; **release seam still deferred** after Product 4 package identity `4.0.0` on main (install-smoke only; no release-authority accept) |
| **E2E pipeline** | redact→pack→extract→draft reduce→eval | `src/pipeline.ts`, `src/draft-reduce.ts`, `test/pipeline.test.ts` | **complete (offline)** |
| **Operator CLI** | Opt-in `carpeos v5` (status/readiness/eval-all200/draft/m8) | `apps/carpeos-cli` | **complete** (not capture-hook) |
| **ADR** | Draft-only + DeepSeek primary decision record | `docs/adr/0016-v5-draft-only-deepseek-primary.md` | **complete** |
| **Product DoD** | Maintainer 5.0.0 definition of done | `docs/maintainers/product-5.0.0.md` | **complete (doc)** |

## Hard fences (do not violate)

- Do not modify schema-v1, adj_v3, or canonical migrations.
- Sidecar rows must not allocate canonical sequences or enter outbox/retrieval.
- No revocation probe / D1 lookup before signed in-memory admission.
- No credentials or provider bodies in fixtures/receipts/logs.
- Capture transaction must not perform LLM/network work.

## Product 4.0 package plane (observed)

| Item | Status (as of last maintainer verify) |
| --- | --- |
| `@innocarpe/carpeos` version on `main` | **4.0.0** (#242) |
| `CHANGELOG` `[4.0.0]` | present |
| Git tag `v4.0.0` / npm / GitHub Release | **missing** (npm still last published 3.2.0) |
| M8 accepted release seam | **no** — do not invent from package identity |

Recommended order: finish public **4.0.0** tag+npm, then cut **5.0.0**. Draft-lane
code does not require M8 complete; public SemVer order does prefer 4 before 5.

## Provider notes

- Primary: DeepSeek Direct `deepseek-v4-flash` @ `https://api.deepseek.com`.
- Auth: `DEEPSEEK_API_KEY` via `~/.carpeos/v5-provider.env` (0600) only.
- OpenRouter optional; not required for 5.0.0 draft-lane completion.
- Cost experiment: [v5-cost-experiment.md](v5-cost-experiment.md).

## Draft-lane readiness (without M8)

### CI (required path)

Do **not** add a separate GitHub Actions job for `verify:offline`, `m0:check`, or
the cost dry-run. PR lean / monorepo `pnpm check` already covers the draft lane:

| Covered by monorepo CI | How |
| --- | --- |
| `@carpeos/v5` unit/contract tests | `pnpm test` (includes M0 `--check-only` spawn, pipeline, provider, eval, M8) |
| CLI `v5` operator surface | `apps/carpeos-cli` tests (`status`, `readiness`, `eval-all200`, `m8`, offline `draft`) |
| Format / lint / build / typecheck / public-boundary | rest of `pnpm check` |

Rationale: a second workflow would re-run the same package tests, burn PR lean
budget, and violate [ci-policy](ci-policy.md) (no duplicate monorepo build/test
steps). Full offline stack (M0 + tests + cost dry-run) is **local/maintainer
only**.

### Local offline gate (maintainer convenience)

Preferred local command (no network, no M0 receipt rewrite, not a release cut):

```sh
pnpm --filter @carpeos/v5 verify:offline
```

Equivalent steps:

```sh
pnpm --filter @carpeos/v5 m0:check
pnpm --filter @carpeos/v5 test
pnpm --filter @carpeos/v5 cost:experiment:dry
```

`v5DraftLaneReadiness` allows M8 `deferred` while marking the draft lane ready when M0–M7 + pipeline + DeepSeek primary + local telemetry + V5-off path pass.

## Recompute / experiment

```sh
# check-only (local / package test; does not rewrite artifacts/v5/m0 timestamps)
# Already exercised under pnpm test via packages/v5/test/m0-recompute.test.ts —
# do not wire a standalone CI job for this script.
node packages/v5/scripts/m0-recompute.mjs --check-only
# rewrite receipts under artifacts/v5/m0 (operator/maintainer)
node packages/v5/scripts/m0-recompute.mjs
pnpm --filter @carpeos/v5 test
node packages/v5/scripts/live-cost-experiment.mjs --dry-run
# live (operator):
# set -a && source ~/.carpeos/v5-provider.env && set +a
# node packages/v5/scripts/live-cost-experiment.mjs --allow-network --spend-cap-usd 0.05
```

