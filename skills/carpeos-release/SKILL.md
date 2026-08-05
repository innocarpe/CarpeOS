---
name: carpeos-release
description: >-
  Cut a CarpeOS public release with consistent SemVer, CHANGELOG, git tags,
  GitHub Releases, and npm publish for @innocarpe/carpeos. Use when the user
  asks to release, bump version, publish to npm, create a git tag, make a
  GitHub release, ship @innocarpe/carpeos, run scripts/release.mjs, or keep
  Claude Code / Codex CLI / Grok Build / Gajae Code/GJC on the same versioning standard.
metadata:
  short-description: "SemVer + tag + npm + GitHub Release for CarpeOS"
---

# CarpeOS Release (shared harness skill)

**Same workflow for Claude Code, Codex CLI, Grok Build, and Gajae Code/GJC.**
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
8. **Completion requires local activation:** npm and GitHub publication are not a complete public release until the exact published version is installed and exercised in the maintainer's real local environment; record the commands and results in the release receipt.

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

### 5. Verify remote publication

```bash
gh run list --workflow=release.yml --limit 5
npm view @innocarpe/carpeos version
gh release view vX.Y.Z
```

### 6. Activate and smoke the exact published CLI

In the maintainer's real local environment, install the just-published exact version;
never use `latest`, a floating tag, or an unversioned install.

```bash
npm install --global "@innocarpe/carpeos@X.Y.Z"
command -v carpeos
carpeos --version
carpeos setup doctor
```

Confirm the resolved `carpeos` executable and `carpeos --version` report `X.Y.Z`.
Run `carpeos help <new-public-command>` for every newly added public command, then
exercise the release's principal behavior with only synthetic or disposable inputs.
For a 3.1-style release, perform this ordered synthetic OKF smoke without falling
back to the maintainer's real home:

1. Create disposable home and output directories.
2. Initialize the disposable home with a synthetic trust zone, then ingest and
   adjudicate a synthetic fixture in that zone.
3. Run OKF export and then rebuild with `--home` set to the disposable home and
   `--visible-trust-zone` set to the initialized zone.
4. Verify expected bundle roots and manifest, preservation of an unmanaged file,
   and absence of a synthetic sentinel in exported output.
5. Delete both disposable directories after recording the results.

Record the actual commands and results in the release receipt. Any failure blocks a
`complete` claim. If npm and GitHub are published but the active global CLI remains
older, report **published; local activation incomplete**, not a completed release.

Report the exact version, npm URL, release URL, and release-receipt outcome to the user.

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
