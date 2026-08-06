# CarpeOS Agent Guide

This file defines repository-local guidance for AI agents working on CarpeOS.

## Primary Boundary

CarpeOS is a public implementation for private knowledge systems.

Do not add:

- real user project names;
- real session transcripts;
- real private repository URLs;
- local user paths;
- production logs;
- credentials, tokens, cookies, or private keys;
- runtime database exports;
- private Obsidian vault exports.

Use fictional, generic, synthetic examples only.

## Documentation Rules

- `README.md` is the canonical English README: agents and humans should learn
  **what the product is, how it works, how to install, and what is shipped**.
  Keep the **hero clean** (no contradictory status lines or DoD link farms).
  Keep substantive sections (why, who, capabilities, install paths, status,
  repo boundary). Do **not** gut those for line-count vanity.
- Full product-line archaeology (every historical major row) and long agent
  install essays belong in `docs/PRD.md` / `docs/maintainers/` / this file —
  not as a second changelog under the hero.
- `README.ko.md` should track the same substance in Korean.
- Planned features must be described as planned.
- Do not document commands as working unless they have been verified.
- Do not claim adapters, MCP tools, sync, projections, or hosted deployment are
  complete until implementation and tests exist.
- After every **MAJOR** package cut, complete
  `docs/maintainers/major-release-surface.md` and run
  `node scripts/check-major-release-surface.mjs` (README needs the current
  `@innocarpe/carpeos@X.Y.Z` / `vX.Y.Z` pin, cleanly).

## Agent install (idempotent)

Keep private data **out of the git tree**.

1. Prefer `npm i -g @innocarpe/carpeos` then `carpeos setup plan` /
   `carpeos setup run --apply` (or `scripts/install.sh`).
2. Capture hooks: `carpeos setup hooks install --apply`.
3. From a checkout: `node scripts/install-local.mjs run --apply`.
4. Never commit `~/.carpeos`, credentials, or real session data.
5. Do not invent alternate install paths; setup registers MCP and optional hooks.
6. Releases: SemVer + `vX.Y.Z` only — `skills/carpeos-release/SKILL.md` and
   `./scripts/install-release-skill.sh`.

## Architecture Rules

- `spec/` is the design source of truth once it exists.
- ADRs are required for durable architecture decisions.
- Private runtime event stores are the knowledge source of truth.
- Obsidian, vector, graph, dashboard, and context-pack outputs are projections,
  not canonical knowledge.
- Provider-specific integrations belong behind adapters.

## Git Rules

- Keep commits atomic.
- Use English Conventional Commit subjects.
- Do not commit without explicit user authorization.
- Do not rewrite history, force-push, publish packages, or deploy services
  without explicit authorization.

## Release and versioning (all harnesses)

When releasing, publishing to npm, creating git tags, or cutting GitHub
Releases for `@innocarpe/carpeos`, **load and follow** the shared skill:

- `skills/carpeos-release/SKILL.md`

Policy SSOT:

- `docs/maintainers/versioning-and-releases.md`
- `CHANGELOG.md`
- `scripts/release.mjs`
- `.github/workflows/release.yml`

Do not invent alternate version schemes. Same process for Claude Code, Codex CLI,
Grok Build, and Gajae Code/GJC. Install user-global skill links:

```sh
./scripts/install-release-skill.sh
```

## GitHub Label Rules

- Use only labels defined in `.github/labels.json`.
- Keep tagging light: one kind label (`feat`, `fix`, `docs`, `spec`, or
  `chore`) plus an optional area label when it helps discovery.
- Do not invent size, status, or milestone labels. Review state lives in the PR
  conversation; milestones use GitHub Milestones when needed.
- See `docs/maintainers/github-labels.md` for the full catalog guidance.
- **Hard gate:** a PR without exactly one kind label is incomplete. Do not
  report create/merge complete until `gh pr view --json labels` shows the kind.

## Pull Request Rules (all harnesses)

When opening or updating a GitHub PR (`gh pr create`, `gh pr edit`, ship branch):

1. **Load and follow** `skills/carpeos-pr/SKILL.md` (shared skill for Claude
   Code, Codex CLI, Grok Build, and Gajae Code/GJC).
2. **Use the full template** in `.github/PULL_REQUEST_TEMPLATE.md`. Fill every
   section. Minimal “Summary + Why + Test plan” bodies are **not** sufficient.
3. Prefer `gh pr create --body-file …` / `gh pr edit --body-file …` so the body
   is not truncated by shell history.
4. **Labels are required on create:** pass `--label <kind>` (and optional
   `--label <area>`) to `gh pr create`. If already open without labels, apply
   with `gh pr edit --add-label` immediately, then verify.
5. After create/edit, run the **label gate** in `skills/carpeos-pr/SKILL.md`
   (exactly one of `feat|fix|docs|spec|chore`). Fail closed if missing.
6. Validation table must list **actual** commands and results; skipped checks
   need an explicit “Not run — reason”.
7. Keep public/private boundary: no credentials, private paths, real project
   names, production logs, or runtime dumps in the PR text.
8. **Atomic commits and semantic PRs are separate constraints:**
   - Every commit MUST be one independently understandable change.
   - A PR MAY contain multiple atomic commits when they form one semantic,
     reviewable feature, architectural plane, or milestone.
   - Default PR boundaries are semantic ownership/dependency and acceptance
     boundaries, not commit count.
   - NEVER create one PR per commit unless the user explicitly requests
     commit-level PRs.
   - For dependent semantic units, use stacked PRs with intentional bases and
     state
     the dependency in the PR body.
9. **Before creating a PR**, inspect the base-to-head commit log and three-dot
   diff, then verify that the proposed PR has one semantic purpose and no
   unrelated milestone crossed its boundary.

Install the skill into user harness dirs:

```sh
./scripts/install-pr-skill.sh
```

## CI and checks (all harnesses)

When editing GitHub Actions, `pnpm check` / smoke / e2e placement, Product 4
candidate workflows, or anything that changes what runs on PR vs main:

1. **Load and follow** `skills/carpeos-ci/SKILL.md` (Claude Code, Codex CLI,
   Grok Build, and Gajae Code/GJC).
2. Obey policy SSOT: `docs/maintainers/ci-policy.md`.
3. Assign every check to a lane (`pr-lean` / `main-full` / `trust-release` /
   `local-only`) and respect PR lean budgets (target ≤ 2 min; review if > 3 min).
4. Prefer unit/contract tests over new workflows. Do not duplicate monorepo
   build/test on PR. Do not use job-level `runner.*` in workflow `env`.
5. Product 4 trust-plane GHA is not a default required PR gate until activation
   policy says so.

Install the skill into user harness dirs:

```sh
./scripts/install-ci-skill.sh
```

## Local preflight before PR (all harnesses)

**Do not use GitHub Actions as a format/lint/public-boundary linter.**

Before `gh pr create`, push-for-review, or claiming a PR is ready:

1. Run **`make preflight`** (or `pnpm preflight` / `pnpm preflight:pr`).
2. Keep it green. On format drift: `make preflight-fix`.
3. Record the command and `PREFLIGHT PASS` in the PR Validation table.
4. Agent iteration may use `make preflight-quick`; that is **not** enough alone
   to open a PR.
5. Preflight covers PR-lean invariants in parallel and probes merge conflicts vs
   `origin/main`. It does **not** replace Linux-only Product 4 bubblewrap or
   Gitleaks — list those as explicit gaps when relevant.

Implementation: `scripts/preflight.mjs`, Makefile targets `preflight*`,
`package.json` scripts `preflight*`. Policy: `docs/maintainers/ci-policy.md`
(Local lane). PR skill: `skills/carpeos-pr/SKILL.md`.

## Verification Rules

Before reporting completion:

- run the smallest relevant verification;
- for any PR-ready claim: run `make preflight` (or `pnpm preflight`) and keep it green;
- inspect `git status --short`;
- confirm no private data or credentials were introduced;
- state any verification gap clearly (especially Linux-only GHA paths).
