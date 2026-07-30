# v1.0.0 Freeze Decision

Status: **recorded — Approve** (2026-07-30 UTC).  
Maintainer chat: **Approve** (G010). Proceed to cut `v1.0.0` / npm `1.0.0`.

**Product definition of done (SSOT):** [product-1.0.0.md](product-1.0.0.md).  
**Contract packaging checklist:** [v1-readiness.md](v1-readiness.md).

---

## One-read Approve checklist

| # | Question | Status |
| --- | --- | --- |
| 0 | Product loop P1–P9 green on [product-1.0.0.md](product-1.0.0.md)? | **yes** |
| 1 | Contract gates G1–G8 done on [v1-readiness.md](v1-readiness.md)? | **yes** |
| 2 | Planned-breaks table empty? | **yes** — [compatibility-and-deprecations.md](compatibility-and-deprecations.md) |
| 3 | G1 recheck recorded on 0.2.1+? | **yes** — 0.2.1 + 0.2.2 |
| 4 | 0.2.x soak (S1–S7) acceptable? | **yes** — published **0.2.2** |
| 5 | Draft `## [1.0.0]` Notes ready? | **yes** — released in CHANGELOG at cut |
| 6 | Maintainer says **Approve**? | **yes** — chat Approve 2026-07-30 |

**CI product gates (monorepo):** `pnpm check` · `pnpm smoke:mcp` · `pnpm smoke:product`.

---

## Decision

| Field | Value |
| --- | --- |
| Decision | **Approve** `1.0.0` product + contract freeze |
| Date (UTC) | 2026-07-30 |
| Decider(s) | Maintainer (Innocarpe) — explicit chat **Approve** |
| Package version to ship | **`1.0.0`** |
| Git tag | **`v1.0.0`** |
| Based on | `origin/main` at G010 cut (product ultragoal G001–G009) |

### Why Approve now

1. Product loop P1–P9 green (hooks install, capture, extract, meaningful retrieval,
   product E2E, doctor/README, scenarios, gate doc).
2. Contract G1–G8 green; soak on 0.2.2 recorded.
3. Explicit maintainer **Approve** in chat (criterion 6).

---

## Product loop evidence (criterion 0)

| Product gate | Status | Evidence (public) |
| --- | --- | --- |
| P1 hooks product path | done | `carpeos setup hooks *` (PR #81) |
| P2 capture evidence | done | capture-hook + smoke:product |
| P3 extraction policy | done | ADR 0011 + policy module (PR #82) |
| P4 extract pipeline | done | Observation extract MVP (PR #83) |
| P5 meaningful retrieval | done | ranking + smoke Observation (PR #85) |
| P6 product E2E CI | done | `pnpm smoke:product` (PR #86) |
| P7 doctor + README | done | store probe + product path (PR #88) |
| P8 scenarios S1–S5 | done | checklist notes (PR #89) |
| P9 this gate | done | Approve recorded; G010 release |

---

## Contract gates G1–G8 (criterion 1)

See [v1-readiness.md](v1-readiness.md). Summary: G1–G8 **done**; G9 **Defer**.

### G1 recheck evidence (`@innocarpe/carpeos@0.2.1` / `0.2.2`)

Prior clean-profile and soak records remain valid for the published line
(0.2.1 G1 recheck + 0.2.2 S1–S7 soak). Re-run G1 recheck on the **release
candidate** package immediately before cutting `v1.0.0`.

| Step | 0.2.1 clean profile | 0.2.2 published soak |
| --- | --- | --- |
| `npm i -g` + `carpeos version` | pass | pass |
| setup plan/run/doctor (or g1-recheck) | pass | pass |
| project identify / sync status | pass | pass |
| monorepo `pnpm smoke:mcp` | pass | pass (CI) |
| monorepo `pnpm smoke:product` | n/a (landed later) | pass on `main` CI |

---

## Draft `## [1.0.0]` CHANGELOG Notes (criterion 5)

**Do not** paste into `CHANGELOG.md` as a dated release until Decision is
**Approve** and `node scripts/release.mjs 1.0.0` (or equivalent) is intentionally
run. Ready copy:

```markdown
## [1.0.0] - YYYY-MM-DD

### Notes

- First stable **product** release for `@innocarpe/carpeos`: setup installs
  capture hooks, session evidence lands in local SQLite (encrypted raw +
  EvidenceArtifact), Observations are derived from eligible lifecycle events,
  and memory search / context-pack return meaningful units first-class on the
  local path (see docs/maintainers/product-1.0.0.md).
- First stable **public contract**: CLI commands/flags, setup/env/`~/.carpeos`
  layout, MCP tool names + JSON shapes (docs/contracts/mcp-tools-v1.md), local
  store migration policy, and trust-zone / visibility semantics (including
  documented default resolution order: flag → env → config → device default).
- Breaking changes on those surfaces after this release require a **MAJOR** bump
  (see docs/maintainers/versioning-and-releases.md).
- Hosted Cloudflare edge, GraphRAG, multi-Mac polish, and production embeddings
  remain **non-goals** of 1.0 and may ship later as additive `1.x` MINOR work.

### Added

- Product setup: capture hooks install/verify/uninstall; doctor reports hooks,
  recent capture, and meaningful-unit counts.
- Evidence → Observation extraction MVP (policy-gated; PostToolUse off by default).
- Meaningful-first retrieval ranking and product E2E gate (`pnpm smoke:product`).
```

Fold remaining Unreleased bullets from `CHANGELOG.md` into the release section
at cut time.

---

## Release (G010)

**Approved.** Cut path:

```sh
node scripts/release.mjs 1.0.0
git push origin main   # or merge release PR first
git push origin v1.0.0
# Release workflow: pnpm check → npm publish → GitHub Release
npm view @innocarpe/carpeos version   # expect 1.0.0
```

---

## Explicit non-goals (unchanged)

Canonical list: [product-1.0.0.md](product-1.0.0.md).

- GraphRAG / multi-hop completeness  
- Multi-Mac “just works”  
- Hosted Cloudflare as a public product  
- Production embedding providers (deterministic-local-dev OK)  
- Logging every PostToolUse by default  
- Cutting `v1.0.0` without maintainer **Approve**
