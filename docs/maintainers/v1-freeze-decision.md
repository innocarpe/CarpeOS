# v1.0.0 Freeze Decision

Status: **recorded — Defer** (2026-07-30 UTC).  
This is the G9 decision record. Cutting `1.0.0` is **not** approved yet.

Do **not** treat `node scripts/release.mjs major` / `1.0.0` as automatic.
Approve by updating this document (or a successor PR) and flipping the decision
row to **Approve**, then cut the tag.

## Decision

| Field | Value |
| --- | --- |
| Decision | **Defer** `1.0.0` contract freeze (not Approve) |
| Date (UTC) | 2026-07-30 |
| Decider(s) | Maintainer (Innocarpe) — draft recorded via PR; final Approve requires explicit re-ack |
| Package version to ship | n/a (stay on `0.y.z`; current public package `0.2.1`) |
| Git tag | n/a |
| Based on commit SHA | `f78874e897f76602d1d50e3f23234720264e2929` (`origin/main` at decision draft) |

### Why defer (not approve)

G1–G8 checklist items are **satisfied on paper** and much of the local contract is
stable through `@innocarpe/carpeos@0.2.1`. Freeze is still deferred because:

1. **Soft behavior change just shipped in 0.2.1** — CLI trust-zone defaulting now
   prefers `config.json` / installer env over device-derived `tz_local_<client>`.
   That is the right fix, but it deserves a short **soak** on real maintainer
   homes before locking the surface as 1.0.
2. **G1 recheck on 0.2.1 is now recorded** (see below) on a clean temp profile.
   Remaining freeze blockers are soak judgment and explicit Approve, not missing
   G1 evidence.
3. **Private hosted sync dogfood** closed a single-Mac push→pull loop after 0.2.1
   Worker redeploy, but hosted Cloudflare remains an explicit **1.0 non-goal** and
   must not be mistaken for a freeze requirement *or* proof that the public npm
   contract alone is “production edge ready.”
4. **G9 Approve is a deliberate product judgment**, not an automatic consequence of
   green checklists. Prefer one more patch/minor cycle (or explicit soak notes)
   over rushing `1.0.0` for momentum.

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
| 1 | G1–G8 still **done** on [v1-readiness.md](v1-readiness.md) | yes |
| 2 | Planned-breaks table empty in [compatibility-and-deprecations.md](compatibility-and-deprecations.md) | yes |
| 3 | G1 recheck procedure completed on **0.2.1+** (or later) and recorded | **done** (this section) |
| 4 | No known “will rename soon” on freeze surfaces after 0.2.1 soak | open (watch trust-zone defaulting feedback) |
| 5 | CHANGELOG ready for a `## [1.0.0]` Notes bullet (first stable contract) | not yet |
| 6 | Maintainer explicitly changes this decision row to **Approve** | not yet |

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

These may remain incomplete at `1.0.0` and ship later as additive `1.x` MINOR:

- GraphRAG / multi-hop recall completeness
- Hosted Cloudflare production edge as a public product
- Cross-Mac sync “just works” polish
- Production embedding providers (beyond deterministic local-dev)
- Full automatic session capture hooks UX
- `memory_open_loops` MCP tool (not implemented; must not appear in listTools until contracted)

## Related evidence (public-safe)

| Evidence | Status |
| --- | --- |
| npm `@innocarpe/carpeos@0.2.1` | published |
| Git tag `v0.2.1` | published |
| Local+private Worker dogfood after 0.2.1 (single-Mac push/pull, config trust zone) | private operator evidence only; not a public deploy claim |
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
