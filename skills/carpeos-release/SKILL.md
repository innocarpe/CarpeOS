---
name: carpeos-release
description: >-
  Cut a CarpeOS public release with consistent SemVer, CHANGELOG, git tags,
  GitHub Releases, and npm publish for @innocarpe/carpeos. Use when the user
  asks to release, bump version, publish to npm, create a git tag, make a
  GitHub release, ship @innocarpe/carpeos, run scripts/release.mjs, or keep
  Claude Code / Codex CLI / Grok Build on the same versioning standard.
metadata:
  short-description: "SemVer + tag + npm + GitHub Release for CarpeOS"
---

# CarpeOS Release (shared harness skill)

**Same workflow for Claude Code, Codex CLI, and Grok Build.**  
Do not invent alternate version schemes, ad-hoc `npm publish`, or untagged releases.

Canonical policy (read when unsure):

- `docs/maintainers/versioning-and-releases.md`
- `CHANGELOG.md`
- `scripts/release.mjs`
- `.github/workflows/release.yml`

## When to use

Trigger on: release, version bump, npm publish, git tag, GitHub Release,
`@innocarpe/carpeos`, ship package, cut v0.x.y, SemVer.

## Hard rules (all agents)

1. **One public version line:** only `@innocarpe/carpeos` (`packages/carpeos/package.json`).
2. **Tag format:** `vX.Y.Z` must equal package `version`.
3. **No silent publish:** never `npm publish` without a matching planned tag/version unless user explicitly demands emergency fallback.
4. **Changelog required:** every release has a `## [X.Y.Z] - YYYY-MM-DD` section.
5. **Push is explicit:** `scripts/release.mjs` commits + tags locally; **you must get user OK before** `git push origin main` and `git push origin vX.Y.Z` (unless user already authorized release end-to-end).
6. **No private data** in changelog or release notes (paths, tokens, real projects).
7. **Pre-1.0 (`0.y.z`):** breaking CLI/MCP/setup changes → **MINOR** + `### Breaking` in changelog (not a quiet patch).

## Bump choice

| User intent | Command |
| --- | --- |
| Bugfix only | `node scripts/release.mjs patch` |
| Feature or intentional break (0.x) | `node scripts/release.mjs minor` |
| Explicit version | `node scripts/release.mjs X.Y.Z` |
| First tag while already `0.1.0` | `node scripts/release.mjs 0.1.0 --force-tag` |
| Preview only | add `--dry-run` |

## Checklist (execute in order)

### 0. Preconditions

```bash
git fetch origin
git status --short          # must be clean on release branch (usually main)
git rev-parse --abbrev-ref HEAD
# Prefer main at origin/main; do not release from a dirty feature worktree
```

- CI on the commit to release should be green (`pnpm check` at minimum).
- Confirm npm org / token only if user asked to publish now:
  - Local: `npm whoami` (e.g. `innocarpe-ws`)
  - GitHub secret `NPM_TOKEN` for Actions publish

### 1. Prepare changelog content

- Fold real notes under `## [Unreleased]` **before** running the cutter if there is meaningful user-facing change.
- Keep synthetic/public-safe wording only.

### 2. Dry-run

```bash
node scripts/release.mjs patch --dry-run
# or the chosen bump
```

Show the user: current → next version and tag name.

### 3. Cut release (local commit + annotated tag)

```bash
node scripts/release.mjs <patch|minor|major|X.Y.Z> [--force-tag]
```

Verify:

```bash
node -p "require('./packages/carpeos/package.json').version"
git tag -l 'v*' | tail -5
git log -1 --oneline
```

### 4. Push (only with authorization)

```bash
git push origin HEAD
git push origin vX.Y.Z
```

Tag push runs **Release** workflow: `pnpm check` → version match → `npm publish` → GitHub Release.

### 5. Verify remote

```bash
gh run list --workflow=release.yml --limit 5
npm view @innocarpe/carpeos version
gh release view vX.Y.Z
```

Report version, npm URL, and release URL to the user.

## Emergency manual publish (user must request)

Only if Actions cannot publish and user accepts fallback:

```bash
pnpm --filter @innocarpe/carpeos build
pnpm --filter @innocarpe/carpeos exec npm publish --access public
gh release create "v$(node -p "require('./packages/carpeos/package.json').version")" \
  --title "@innocarpe/carpeos v$(node -p "require('./packages/carpeos/package.json').version")" \
  --notes-file CHANGELOG.md
```

Still require matching git tag if at all possible.

## What not to do

- Do not bump root `@carpeos/root` or internal `@carpeos/*` for npm.
- Do not use calendar versions, `latest` tags without SemVer, or floating `main` as a release id.
- Do not force-push or retag a version already on npm.
- Do not release from uncommitted agent experiments.
- Do not skip `pnpm check` / CI green without user override.

## Install this skill for every harness

Repo is SSOT. From a CarpeOS checkout:

```bash
./scripts/install-release-skill.sh
```

Installs/links into:

- Claude Code: `~/.claude/skills/carpeos-release`
- Codex / agents: `~/.agents/skills/carpeos-release`
- Grok Build: `~/.grok/skills/carpeos-release`

Project copies (for agents that only read the repo):

- `skills/carpeos-release/SKILL.md` (this file)
- `.agents/skills/carpeos-release` → symlink/copy
- `.claude/skills/carpeos-release` → symlink/copy

## Quick reference commands

```bash
# policy
less docs/maintainers/versioning-and-releases.md

# dry-run
node scripts/release.mjs minor --dry-run

# cut
node scripts/release.mjs minor

# publish path
git push origin HEAD && git push origin vX.Y.Z
```
