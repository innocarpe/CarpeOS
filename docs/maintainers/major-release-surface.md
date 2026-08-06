# Major release surface (mandatory)

Status: maintainer harness for **every public MAJOR** cut of `@innocarpe/carpeos`
(`X.0.0`, and any intentional major that advances the product thesis).

**npm tag + GitHub Release alone are not a complete major.** Agents and humans
must update the public documentation surface in the same release window (same
PR series or an immediate follow-up docs PR before claiming “major complete”).

Related:

- [Versioning and Releases](versioning-and-releases.md)
- skill `skills/carpeos-release/SKILL.md`
- checker `scripts/check-major-release-surface.mjs`
- PRD index [docs/PRD.md](../PRD.md)

## When this applies

| Event | Required? |
| --- | --- |
| Patch / minor (`X.Y.Z` with Y or Z > 0) | Partial: README “Latest release” + package README pin + CHANGELOG section |
| **Major** (`X.0.0` or product thesis major) | **Full surface** below |
| Pre-release / dry-run | No public status flip until real tag |

## Mandatory surface checklist (MAJOR)

Complete **all** rows before reporting the major as complete. Use honest
status language: do not mark PRD thesis “shipped” if only a code plane or
partial DoD landed.

| # | Surface | Path / action | Pass criteria |
| --- | --- | --- | --- |
| M1 | Package identity | `packages/carpeos/package.json` | `version` = `X.Y.Z` |
| M2 | Changelog | `CHANGELOG.md` | `## [X.Y.Z] - YYYY-MM-DD` with honest Added/Changed/Safety/Notes |
| M3 | Git tag + Release workflow | `vX.Y.Z` | Annotated tag; Release job green; npm publish |
| M4 | npm + GitHub Release | registry + Releases | `npm view @innocarpe/carpeos version` = `X.Y.Z`; non-draft GH Release |
| M5 | Local activation | maintainer machine | Exact `@X.Y.Z` install; `carpeos --version`; real-home `setup doctor` pass (or recorded disposable smoke + doctor on real home) |
| M6 | Root README (EN) | `README.md` | “Latest release” and “What works today” / version table cite `X.Y.Z` |
| M7 | Root README (KO) | `README.ko.md` | Same substance as EN |
| M8 | Package README | `packages/carpeos/README.md` | Install pin and “current public release” = `X.Y.Z` |
| M9 | PRD index | `docs/PRD.md` | Major row status + DoD link updated (not left “planned” if package shipped) |
| M10 | Major PRD | `docs/PRD-vX.md` | Status line matches reality (shipped / partial / residual) |
| M11 | Maintainer DoD / receipt | `docs/maintainers/product-X.Y.Z.md` | Exists; release + activation evidence; residual authority called out |
| M12 | Architecture overview | `docs/architecture/overview.md` | Current-main boundary includes this major’s shipped plane and defers |
| M13 | Versioning policy banner | `docs/maintainers/versioning-and-releases.md` | “Current public release” points at shipped version, not “target after merge” |
| M14 | Follow-on majors / minors | e.g. `v5-milestones.md`, remaining checklists | Do not claim previous major still “missing tag/npm” |
| M15 | Harness reinstall | `./scripts/install-release-skill.sh` | Optional but recommended after skill edits |

## Partial vs full product claim

Majors may ship a **code / trust plane** without inventing live authority:

- **Allowed:** “Package plane shipped; independent release authority remains
  out of band / fail-closed.”
- **Forbidden:** Flipping PRD status to “complete product thesis” when DoD
  residuals (human approval, live credentials, apply writers) are still open.

Record residuals explicitly in `product-X.Y.Z.md` and CHANGELOG Safety/Notes.

## Checker

```sh
node scripts/check-major-release-surface.mjs
# or after package bump:
node scripts/check-major-release-surface.mjs --version 4.0.0
```

Exit `0` only when the tree’s package version and the mandatory file mentions
align. Does **not** prove npm/GitHub remote state (run those commands in the
release skill verification step).

## Agent rules (all harnesses)

1. Load `carpeos-release` skill **and** this document for every major cut.
2. Do not report “4.0.0 complete” (or any major) after tag/npm alone if M6–M14
   are stale.
3. Prefer one semantic docs PR immediately after the package cut if docs lag.
4. Keep public/private boundary: synthetic examples only in receipts.

## Historical example (4.0.0)

Product 4 package cut shipped governed evidence / trust-plane contracts as
`@innocarpe/carpeos@4.0.0` with residual independent authority out of band.
See [product-4.0.0.md](product-4.0.0.md) and [PRD-v4.md](../PRD-v4.md).
