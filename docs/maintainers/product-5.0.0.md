# Product 5.0.0 — Definition of Done (maintainers)

Status: **Draft-lane complete; package base is `@innocarpe/carpeos@4.0.0` on `main`; ready for npm `5.0.0` cut when maintainer authorizes (prefer after public `v4.0.0` tag/npm)**  
M8 **release seam** remains deferred (install-smoke only; no invented release-authority acceptance).

Primary path: **DeepSeek Direct** (`deepseek-v4-flash`). OpenRouter not required.

## Post-Product-4 alignment (2026-08-06)

| Fact | Evidence |
| --- | --- |
| Product 4 **code plane** + package identity **4.0.0** on `main` | #242 `chore/release-v4.0.0`; `packages/carpeos/package.json` |
| Public **tag / npm / GitHub Release** for 4.0.0 | **Complete** — `v4.0.0`, `npm view` = `4.0.0`, [GitHub Release](https://github.com/innocarpe/CarpeOS/releases/tag/v4.0.0) |
| M8 full accept | **Still deferred** — public package ship ≠ accepted body-free release-authority seam |
| Draft lane shippable without M8 complete | `carpeos v5 m8` / `artifacts/v5/m8/final-decision-receipt.json` |
| 5.0.0 release dry-run | `4.0.0 -> 5.0.0 (tag v5.0.0)` — cut waits on maintainer authorization |

Do not invent M8 green from package version or public npm alone.

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
| Body-free **accepted release-authority / release-gate passed** evidence present | M8 may `accepted` |
| Package identity `4.0.0` on main only | **Not** sufficient for M8 accept |
| Only install-smoke / blocked release-gate | M8 **deferred** (not invented green) |
| Present unaccepted seam forced as accepted | **Forbidden** |

PRD-v4 remains independently releasable; V5 never gates 4.0.0.

## Explicit non-goals for this DoD

- Capture-hook / hot-path LLM or network
- Canonical migrations / schema-v1 / adj_v3 changes
- Requiring OpenRouter
- Cloudflare Worker telemetry deploy (operator-optional)
- Claiming npm `@innocarpe/carpeos@5.0.0` without the release skill + maintainer publish authorization

## npm / GitHub Release checklist

Preflight (this worktree / main):

```sh
git fetch origin && git status --short   # clean on main @ origin/main
# Prefer public 4.0.0 complete first:
#   git tag -l v4.0.0 && npm view @innocarpe/carpeos version   # expect 4.0.0
pnpm check
node packages/v5/scripts/m0-recompute.mjs --check-only
node packages/v5/scripts/m8-decision.mjs
node apps/carpeos-cli/dist/index.js v5 readiness   # after build
node scripts/release.mjs 5.0.0 --dry-run           # expect 4.0.0 -> 5.0.0
```

Cut (local only until push authorized):

```sh
node scripts/release.mjs 5.0.0
# verify:
node -p "require('./packages/carpeos/package.json').version"   # 5.0.0
git tag -l 'v5.0.0'
```

Publish (requires explicit maintainer OK):

```sh
git push origin main
git push origin v5.0.0
# Release workflow: check → npm publish → GitHub Release
```

Activate:

```sh
npm install --global "@innocarpe/carpeos@5.0.0"
carpeos --version
carpeos v5 readiness
carpeos help v5
```

### SemVer note

Public package cut is **4.0.0 → 5.0.0** for the V5 draft-lane product major.
Product 4 public ship **4.0.0** is complete (tag + npm + GitHub Release). M8 full
accept still needs separate body-free release-authority evidence and is **not**
implied by the 4.0 or 5.0 package cut.

## Commands

```sh
pnpm check
node packages/v5/scripts/m0-recompute.mjs --check-only
node packages/v5/scripts/m8-decision.mjs
# after monorepo CLI build:
node apps/carpeos-cli/dist/index.js v5 readiness
node apps/carpeos-cli/dist/index.js v5 m8
```
