# v1.0.0 Freeze Decision

Status: **recorded — Defer** (2026-07-30 UTC).  
This is the G9 decision record. Cutting `1.0.0` is **not** approved yet.

**Product definition of done (SSOT):** [product-1.0.0.md](product-1.0.0.md).
Approve only when the product loop is green **and** contract packaging is ready.
Contract-only G1–G8 completion is not sufficient.

Do **not** treat `node scripts/release.mjs major` / `1.0.0` as automatic.
Approve by updating this document (or a successor PR) and flipping the decision
row to **Approve**, then cut the tag.

## Decision

| Field | Value |
| --- | --- |
| Decision | **Defer** `1.0.0` contract freeze (not Approve) |
| Date (UTC) | 2026-07-30 |
| Decider(s) | Maintainer (Innocarpe) — draft recorded via PR; final Approve requires explicit re-ack |
| Package version to ship | n/a (stay on `0.y.z`; current public package `0.2.2`) |
| Git tag | n/a |
| Based on commit SHA | `f78874e897f76602d1d50e3f23234720264e2929` (`origin/main` at decision draft) |

### Why defer (not approve)

G1–G8 are **done**, G1 recheck is recorded (0.2.1 + 0.2.2), soak criterion **4**
is **done** on published **0.2.2**, and criterion **5** CHANGELOG Notes are
**drafted** below. Freeze is still deferred because:

1. **Criterion 0 (product loop)** — [product-1.0.0.md](product-1.0.0.md) is not
   green yet (capture install as setup, Evidence→Observation/Claim, meaningful
   retrieval, product E2E). Contract G1–G8 alone must not ship 1.0.
2. **Criterion 6** — explicit maintainer **Approve** has not been recorded yet.
   G9 Approve is a deliberate product judgment, not an automatic consequence of
   green contract checklists or a published patch line.
3. **Trust-zone defaulting (0.2.1)** and **capture→search (0.2.2)** soaked cleanly
   on a day-to-day home, but the freeze still waits for product DoD + a conscious
   “lock the public contract now” ack rather than momentum alone.
4. **Hosted Cloudflare** remains an explicit **1.0 non-goal** and must not be
   mistaken for a freeze requirement *or* proof that the public npm contract is
   “production edge ready.”

### G1 recheck evidence (`@innocarpe/carpeos@0.2.1`)

Recorded **2026-07-30** (UTC date of run; local maintainer machine). Clean
temporary home + bin-dir (not the day-to-day `~/.carpeos`). Public-safe summary:

| Step | Result |
| --- | --- |
| `npm i -g @innocarpe/carpeos@0.2.1` + `carpeos version` | **pass** — `version: 0.2.1` |
| `carpeos setup plan --home <tmp> --bin-dir <tmpbin> --trust-zone tz_local_default --register-mcp false` | **pass** (exit 0) |
| `carpeos setup run --apply` (same flags) | **pass** (exit 0); wrote `config.json`, `mcp.env`, store, wrappers |
| `carpeos setup doctor` | **pass** — `CarpeOS setup doctor: PASS`, `failures: []` |
| `carpeos project identify --home <tmp>` | **pass** — `trust_zone_id: tz_local_default`, `trust_zone_source: config` |
| `carpeos sync status --home <tmp>` | **pass** — same zone/source; empty outbox |
| `pnpm smoke:mcp` from monorepo at `origin/main` (after `pnpm build`) | **pass** — unit smokes + CLI process smoke |

Notes:

- `--register-mcp false` kept agent host configs out of the clean-profile run so
  the recheck isolates runtime home creation, wrapper install, and store init
  (G1 core). MCP host registration remains covered by normal maintainer setup
  and G5 CI smoke.
- Ephemeral temp directories used for the recheck are discarded and are not
  durable evidence locations.

### Criteria to flip to Approve

All of the following should be true (or consciously waived in writing):

| # | Criterion | Status |
| --- | --- | --- |
| 0 | Product loop DoD green on [product-1.0.0.md](product-1.0.0.md) (P1–P9) | **open** (ultragoal carpeos-product-100) |
| 1 | G1–G8 still **done** on [v1-readiness.md](v1-readiness.md) | yes |
| 2 | Planned-breaks table empty in [compatibility-and-deprecations.md](compatibility-and-deprecations.md) | yes |
| 3 | G1 recheck procedure completed on **0.2.1+** (or later) and recorded | **done** (0.2.1 section + 0.2.2 recheck) |
| 4 | No known “will rename soon” on freeze surfaces after 0.2.x soak | **done** — S1–S7 pass on published **0.2.2** (includes #75 retrieval fix) |
| 5 | CHANGELOG ready for a `## [1.0.0]` Notes bullet (product + first stable contract) | **done** (draft staged below; paste into CHANGELOG only when cutting 1.0.0 — extend Notes for product loop when G009 lands) |
| 6 | Maintainer explicitly changes this decision row to **Approve** | not yet |

### Soak checklist (criterion 4)

Repeatable day-to-day checks on a **real maintainer home** (not only the clean
temp G1 profile). Public-safe summary only — no private URLs, credentials, or
runtime dumps.

Initial run **2026-07-30** against published `@innocarpe/carpeos@0.2.1`.
**Re-verified 2026-07-30** against published **`@innocarpe/carpeos@0.2.2`**
(after tag `v0.2.2` / npm publish; day-to-day home, not clean-profile G1 temp).

| # | Check | How | Status |
| --- | --- | --- | --- |
| S1 | Published package version in daily use | `carpeos version` → `0.2.1+` | **pass** — `0.2.2` |
| S2 | Trust zone comes from config after install | `carpeos project identify` → `trust_zone_source: config` (or env if intentionally set) | **pass** — `trust_zone_id: tz_local_default`, `trust_zone_source: config` |
| S3 | Outbox/status diagnosis is usable | `carpeos sync status` shows zone, `outbox_errors`, no unexpected mismatch warning for normal capture | **pass** — zone + source present; `outbox_trust_zone_mismatch: false`; `outbox_errors: []` |
| S4 | Capture + local memory path still works | capture-hook → retrieval rebuild → memory search/context-pack (no crash) | **pass on 0.2.2** — rebuild `chunks: 6`, freshness `stale: false`, `memory search` returns `evidence_excerpt` hits; default epistemic filter includes `imported`. (0.2.1 had been empty/stale on capture-only homes; fixed by #75 and shipped in 0.2.2.) |
| S5 | Optional private sync still works if enrolled | `sync once` against private edge; no sticky leased rows | **pass** (operator-private edge) — after once: outbox `pending:0` `leased:0`, delivered count advanced, no zone mismatch / outbox errors |
| S6 | Clean recheck still green | `node scripts/g1-recheck.mjs --version 0.2.2` (or later) | **pass** — install gates green with `--skip-smoke` on **0.2.2** |
| S7 | No new “rename soon” items | [compatibility-and-deprecations.md](compatibility-and-deprecations.md) planned-breaks table still empty | **pass** — planned breaks empty; only documented aliases |

Criterion **4** is **done** on published **0.2.2**. Criterion **5** draft is
staged below. Remaining freeze step is explicit Decision **Approve**
(criterion 6). G9 stays **Defer** until Approve.

### Draft `## [1.0.0]` CHANGELOG Notes (criterion 5)

**Do not** paste this into `CHANGELOG.md` as a dated release section until the
decision row is **Approve** and `node scripts/release.mjs 1.0.0` (or equivalent)
is intentionally run. This block is the ready copy for that cut.

```markdown
## [1.0.0] - YYYY-MM-DD

### Notes

- First stable **product** release for `@innocarpe/carpeos`: capture install →
  evidence → meaningful units (Observation/Claim) → search/context-pack on the
  local path (see [product-1.0.0.md](product-1.0.0.md)).
- First stable **public contract**: CLI commands/flags, setup/env/`~/.carpeos`
  layout, MCP tool names + JSON shapes ([mcp-tools-v1](docs/contracts/mcp-tools-v1.md)),
  local store migration policy, and trust-zone / visibility semantics (including
  documented default resolution order: flag → env → config → device default).
- Breaking changes on those surfaces after this release require a **MAJOR** bump
  (see [versioning-and-releases](docs/maintainers/versioning-and-releases.md)).
- Hosted Cloudflare edge, GraphRAG, multi-Mac polish, and production embeddings
  remain **non-goals** of 1.0 and may ship later as additive `1.x` MINOR work.
```

Optional `### Changed` / `### Added` bullets for the 1.0 cut should summarize
what lands between the last `0.y.z` and the product+contract freeze.

Helper for S6 (from monorepo):

```sh
npm install -g @innocarpe/carpeos@0.2.2
node scripts/g1-recheck.mjs --version 0.2.2
# or: pnpm g1:recheck --version 0.2.2
# monorepo smoke is included; use --skip-smoke for install-only
```

## Gate sign-off (at decision time)

Copied from [v1-readiness.md](v1-readiness.md) and release history through `0.2.1`:

| Gate | Status | Notes / evidence |
| --- | --- | --- |
| G1 install | **done** | Clean-profile recheck on **0.2.1** recorded above (plan/run/doctor/identify + monorepo `pnpm smoke:mcp`) |
| G2 help/docs | **done** | Root/command help, setup help, README install paths |
| G3 version | **done** | `carpeos version` / `-V`; npm embeds package version (`0.2.1` verified post-publish) |
| G4 exit codes | **done** | Root help + readiness table `0|1|2|3|4` |
| G5 MCP smoke | **done** | `pnpm smoke:mcp` + CI step |
| G6 migrations | **done** | [local-store-migrations.md](../architecture/local-store-migrations.md) + preserve-events test |
| G7 MCP inventory | **done** | [mcp-tools-v1](../contracts/mcp-tools-v1.md) + JSON + inventory test |
| G8 deprecations clear | **done** | [compatibility-and-deprecations.md](compatibility-and-deprecations.md) — planned breaks empty; only documented aliases |
| G9 this document | **partial** | Defer recorded; **Approve** not yet |

## Freeze commitment (what we will not break without MAJOR after Approve)

When Approve is recorded, these surfaces freeze:

- CLI commands/flags documented in `carpeos --help` and setup help
- MCP tools in [mcp-tools-v1](../contracts/mcp-tools-v1.md)
- Setup/env/`~/.carpeos` layout and migration policy
- Trust-zone + visibility semantics (including documented default resolution order:
  flag → env → config → device default)

Until Approve, pre-1.0 SemVer rules still apply (`0.y.z`: intentional breaks →
MINOR + CHANGELOG `### Breaking` where required).

## Known deprecations retained at 1.0 (when frozen)

From [compatibility-and-deprecations.md](compatibility-and-deprecations.md):

| Item | Preferred | Removal policy |
| --- | --- | --- |
| `carpeos setup --yes` / `-y` | `carpeos setup run --apply` | Keep at least through **1.0.0**; remove only with documented window after 1.0 |
| `install-local.mjs --yes` / `-y` | `run --apply` | Same |
| `setup --hosts` | `--register-mcp` | Alias; not scheduled for removal |
| `setup --doctor` / `--plan` flags | subcommands | Alias; not scheduled for removal |

## Explicit non-goals still open after 1.0 (when frozen)

Canonical list: [product-1.0.0.md](product-1.0.0.md). These may remain incomplete
at `1.0.0` and ship later as additive `1.x` MINOR:

- GraphRAG / multi-hop recall completeness
- Hosted Cloudflare production edge as a public product
- Cross-Mac sync “just works” polish
- Production embedding providers (beyond deterministic local-dev)
- Logging every PostToolUse by default
- `memory_open_loops` MCP tool (not implemented; must not appear in listTools until contracted)

**Not** non-goals for product 1.0 (required by product DoD): capture hooks via
official setup path, Evidence→Observation/Claim extraction MVP, search returning
meaningful units first-class.

## Related evidence (public-safe)

| Evidence | Status |
| --- | --- |
| npm `@innocarpe/carpeos@0.2.1` | published |
| Git tag `v0.2.1` | published |
| npm `@innocarpe/carpeos@0.2.2` | published |
| Git tag `v0.2.2` | published |
| Local+private Worker dogfood after 0.2.1 (single-Mac push/pull, config trust zone) | private operator evidence only; not a public deploy claim |
| Day-to-day soak S1–S7 on 0.2.1 then re-verify on **0.2.2** (2026-07-30) | recorded above; criterion 4 **done** on published 0.2.2 |
| Planned breaks before 1.0 | empty |

## Release actions after Approve (not now)

```sh
# after main is green at the freeze commit and this doc says Approve
node scripts/release.mjs 1.0.0
# PR + merge if required by branch protection
git push origin v1.0.0   # triggers npm publish + GitHub Release
```

CHANGELOG must include a `## [1.0.0]` section with a **Notes** bullet that this
is the first stable public contract.

## Signatures / ack

| Name | Ack |
| --- | --- |
| Innocarpe (maintainer) | ☐ Defer as written · ☐ Override → Approve (fill criteria waiver) |

---

## Template residual

If this document is later replaced by a pure Approve record, preserve history via
git and restate gate sign-off at the freeze commit SHA.
