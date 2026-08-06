# Product 5.0.0 — Definition of Done (maintainers)

Status: **Draft-lane complete in-tree; M8 release seam deferred; npm major not cut**

Primary path: **DeepSeek Direct** (`deepseek-v4-flash`). OpenRouter not required.

## Thesis

Optional LLM-assisted extraction stays draft-only (`canonical_effect: "none"`), privacy-safe, and reversible without becoming canonical authority.

## Code DoD (draft lane)

| Gate | Evidence |
| --- | --- |
| M0 contract freeze | `artifacts/v5/m0/*-computation-receipt.json`; `node packages/v5/scripts/m0-recompute.mjs` |
| M1–M3 offline | `@carpeos/v5` redaction / pack / reducer tests |
| M4 DeepSeek primary | `ProviderBoundary.defaultExtractRoute()` → `deepseek_direct`; live cost script |
| M5 sidecar | attempts/review/rollback; no canonical writes |
| M6 local telemetry | `telemetry-store` + `migrations/telemetry/001_telemetry_initial.sql` |
| M7 all-200 | `carpeos v5 eval-all200` / `runAll200Evaluation()` |
| E2E pipeline | `runDraftPipeline` / `carpeos v5 draft` |
| Operator CLI | `carpeos v5 status\|readiness\|eval-all200\|draft\|m8` |
| ADR | `docs/adr/0016-v5-draft-only-deepseek-primary.md` |
| V5-off path | `verifyV5OffReleasePath` green with V5 disabled |
| Final decision receipt | `node packages/v5/scripts/m8-decision.mjs` → `artifacts/v5/m8/final-decision-receipt.json` |

## M8 (4.0 seam)

| Condition | Outcome |
| --- | --- |
| Body-free **accepted release** evidence present | M8 may `accepted` |
| Only install-smoke / blocked release-gate | M8 **deferred** (not invented green) |
| Present unaccepted seam forced as accepted | **Forbidden** |

PRD-v4 remains independently releasable; V5 never gates 4.0.0.

## Explicit non-goals for this DoD

- Capture-hook / hot-path LLM or network
- Canonical migrations / schema-v1 / adj_v3 changes
- Requiring OpenRouter
- Cloudflare Worker telemetry deploy (operator-optional)
- Claiming npm `@innocarpe/carpeos@5.0.0` without the release skill + maintainer publish authorization

## npm / GitHub Release (separate)

Only after maintainer authorization:

1. Fold Unreleased changelog for 5.0.0
2. `node scripts/release.mjs 5.0.0 --dry-run` then cut
3. Push tag only with explicit OK
4. Activate global CLI at exact version and smoke `carpeos v5 readiness`

Until then, public package remains the current published line (e.g. 3.2.x); V5 is in-tree opt-in.

## Commands

```sh
pnpm check
node packages/v5/scripts/m0-recompute.mjs
node packages/v5/scripts/m8-decision.mjs
# after monorepo CLI build:
node apps/carpeos-cli/dist/index.js v5 readiness
node apps/carpeos-cli/dist/index.js v5 m8
```
