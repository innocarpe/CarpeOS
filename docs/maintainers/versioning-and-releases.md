# Versioning and Releases

Status: maintainer policy for the public npm package and Git tags.

This document is the source of truth for how CarpeOS versions are chosen, tagged,
and published. Follow it before the first and every subsequent npm release.

## What is versioned

| Artifact | Version source | Tag / publish |
| --- | --- | --- |
| **Public npm package** `@innocarpe/carpeos` | `packages/carpeos/package.json` → `version` | Git tag `vX.Y.Z` + npm publish |
| Monorepo root `@carpeos/root` | stays `0.0.0` private | not published |
| Internal workspace packages (`@carpeos/*`) | private `0.0.0` (bundled into npm package) | not published separately |

Only **one public version line** is managed: **`@innocarpe/carpeos`**.

## Semantic Versioning (SemVer 2.0)

Format: `MAJOR.MINOR.PATCH` (`X.Y.Z`).

### While `0.y.z` (current phase)

CarpeOS is pre-1.0. Compatibility promises are intentionally soft, but bumps
still follow a consistent rule:

| Bump | When | Example |
| --- | --- | --- |
| **PATCH** `0.1.0 → 0.1.1` | Bug fixes, docs-only user-facing install fixes, no intentional API/CLI break | fix context-pack crash |
| **MINOR** `0.1.0 → 0.2.0` | New features **or** intentional breaking CLI/MCP/setup changes | new `carpeos memory *` command; changed MCP env names |
| **MAJOR** `0.x → 1.0.0` | First stable public contract + local pipeline freeze | “v1 CLI + MCP + capture pipeline” |
| **MAJOR** `1.x → 2.0.0` | Knowledge adjudication becomes default product contract | “adjudicated meaning-first OS” ([product-2.0.0](product-2.0.0.md)) |

In `0.y.z`, treat **breaking changes as MINOR** (not silent patches). Call them
out in the changelog under `### Breaking`.

### What about `2.0.0`?

**Product 2.0** = knowledge **adjudication** (what is brain-worthy), not another
pipeline polish. SSOT: [product-2.0.0.md](product-2.0.0.md). Prefer shipping
judgment work as `1.x` while compatible; cut **`2.0.0`** when adjudicated
meaning becomes the default public product contract. Explicit Approve required.

### When is `1.0.0` allowed?

`1.0.0` (already cut) was a **pipeline + contract** milestone:

1. **Product:** the core loop works end-to-end — setup installs capture, evidence
   lands, meaningful units (Observation/Claim) are derived, search/context-pack
   return those units, homes migrate safely, product E2E + scenarios pass.
   SSOT: **[Product 1.0.0 DoD](product-1.0.0.md)**.
2. **Contract freeze (packaging):** maintainers are willing to treat the surfaces
   below as stable under SemVer **after** 1.0 (breaking changes require MAJOR).
   Tracker: **[v1 Readiness](v1-readiness.md)**.

Contract freeze is **necessary packaging**, not sufficient product completion.

| Contract surface | Freeze means |
| --- | --- |
| CLI command tree + flags | Documented commands (`init`, `memory *`, `setup *`, …) keep behavior or get deprecation windows |
| MCP tool names + JSON shapes | Tools used by agents do not rename/reshape without MAJOR |
| Setup / env vars | `CARPEOS_*`, `~/.carpeos` layout, wrapper contract stay compatible |
| Event / store schema | Existing local stores upgrade via migrations; no silent wipe |
| Trust-zone + visibility model | Same semantics for zone ids and `--visible-trust-zone` |

**Not required for 1.0.0:** GraphRAG completeness, multi-Mac sync polish,
production embedding providers, or hosted Cloudflare as a public product.
**Required for shipped 1.0 pipeline:** capture install, extract shell, retrieval of
those units. **Not claimed as complete knowledge OS:** brain-worthy content
adjudication — that is [product-2.0.0.md](product-2.0.0.md).

**Practical gate (checklist before tagging `v1.0.0`):**

1. Product loop DoD green — **[product-1.0.0.md](product-1.0.0.md)**
2. Contract gates G1–G9 on **[v1 Readiness](v1-readiness.md)** (exit codes, smoke, migrations)
3. CHANGELOG draft `## [1.0.0]` Notes; no open “will rename soon” on freeze surfaces —
   [Compatibility and Deprecations](compatibility-and-deprecations.md)
4. Maintainer **Approve** in [v1 freeze decision](v1-freeze-decision.md) — never automatic

### After `1.0.0` / toward `2.0.0`

Ship judgment work on `1.x` when backward compatible. Cut **`2.0.0`** when
defaults and contracts assume **adjudicated** knowledge (see
[product-2.0.0.md](product-2.0.0.md)). Never retag or unpublish `1.0.0`.

### After `1.0.0` (SemVer table)

| Bump | When |
| --- | --- |
| **MAJOR** | Breaking CLI flags, MCP tool contracts, setup/env renames without compat |
| **MINOR** | Backward-compatible features |
| **PATCH** | Backward-compatible fixes |

## Git tags

- Tag format: **`v` + package version** → `v0.1.0`, `v0.1.1`, `v0.2.0`
- Tags are **annotated** and created only for published (or intentionally
  release-candidate) package versions
- Tag message: `release: @innocarpe/carpeos vX.Y.Z`
- Do not move or rewrite published tags

## Changelog

- User-facing file: [`CHANGELOG.md`](../../CHANGELOG.md) (repo root)
- Format: [Keep a Changelog](https://keepachangelog.com/)-style sections
- Every release section includes: date (UTC), version, Added / Changed / Fixed /
  Breaking (as needed)
- Unreleased work may sit under `## [Unreleased]` until the release script
  folds it into a version section

## Release workflow (maintainers)

### One-time setup

1. npm org `@innocarpe` exists; publisher can `npm publish --access public`.
2. GitHub repo secret **`NPM_TOKEN`** (Automation token with publish rights to
   `@innocarpe`).
3. Local: `npm whoami` is an org member with publish permission.

### Cut a release

From a clean `main` checkout (after CI is green):

```sh
# dry-run
node scripts/release.mjs patch --dry-run

# real: bump package.json + CHANGELOG, commit, annotated tag
node scripts/release.mjs patch    # or: minor | major | 0.2.0

git push origin main
git push origin vX.Y.Z
```

Pushing the tag triggers [`.github/workflows/release.yml`](../../.github/workflows/release.yml):

1. `pnpm check` (quality gate)
2. Build `@innocarpe/carpeos`
3. `npm publish` from `packages/carpeos`
4. Create GitHub Release for `vX.Y.Z` with changelog notes

### Manual publish fallback

If Actions cannot publish:

```sh
pnpm --filter @innocarpe/carpeos build
cd packages/carpeos && npm publish --access public
gh release create "v$(node -p "require('./package.json').version")" \
  --title "v$(node -p "require('./package.json').version")" \
  --notes-file ../../CHANGELOG.md
```

Prefer the tag + workflow path so npm and GitHub stay aligned.

## What not to do

- Do not publish from a dirty or feature branch
- Do not bump version without a changelog entry
- Do not create a GitHub Release without a matching `vX.Y.Z` tag and package version
- Do not reuse a version that already exists on npm
- Do not put private paths, tokens, or runtime DB dumps in release notes

## First public release

Initial package version is **`0.1.0`**.

Suggested first tag: **`v0.1.0`** after this pipeline lands and `pnpm check` is green.

```sh
node scripts/release.mjs 0.1.0   # no-op bump if already 0.1.0; still writes changelog section if needed
# or if already 0.1.0 and changelog ready:
node scripts/release.mjs 0.1.0 --force-tag
git push origin main && git push origin v0.1.0
```

## Agent harness skill (Claude / Codex / Grok)

All coding agents should use the same release procedure:

- Skill: [`skills/carpeos-release/SKILL.md`](../../skills/carpeos-release/SKILL.md)
- Install into Claude Code, Codex/agents, and Grok Build skill dirs:

```sh
./scripts/install-release-skill.sh
```

Agents must not invent alternate SemVer, tagging, or publish flows.

## Related

- [Release readiness checklist](release-readiness.md)
- [One-stop install](../guides/one-stop-install.md)
- Package: `packages/carpeos`
