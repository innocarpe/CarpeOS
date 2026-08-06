---
name: carpeos-pr
description: >-
  Open or update CarpeOS GitHub pull requests with full, reviewable descriptions.
  Use when creating a PR, editing a PR body, running gh pr create/edit, shipping
  a feature branch, or when the user asks for a PR, pull request, or PR
  description. Applies to Claude Code, Codex CLI, Grok Build, and Gajae Code/GJC.
metadata:
  short-description: "Full PR body template for CarpeOS (gh pr create/edit)"
---

# CarpeOS Pull Request (shared harness skill)

**Same standard for Claude Code, Codex CLI, Grok Build, and Gajae Code/GJC.**

Minimal three-bullet PR bodies are **not acceptable**. Every PR must follow the
repository template and fill every section with real content (or an explicit
`Not applicable` / `None` / `Not run` where required).

## Source of truth

| Artifact | Path |
| --- | --- |
| Template | `.github/PULL_REQUEST_TEMPLATE.md` |
| Labels | `.github/labels.json` + `docs/maintainers/github-labels.md` |
| Agent rules | `AGENTS.md` (Pull Request section) |
| Contributing | `CONTRIBUTING.md` |

## When to use

Trigger on: open PR, create PR, `gh pr create`, edit PR body, `gh pr edit`,
update PR description, ship branch, stack PR, draft PR for review.

## Hard rules

1. **Fill the full template** — all sections below. Do not stop at Summary/Why/Test plan.
2. **No empty sections** — if a section does not apply, write `None` or `Not applicable` with a one-line reason.
3. **Validation must be honest** — only list commands you actually ran; put results in the table.
4. **Public boundary** — no credentials, private paths, real project names, production logs, or runtime dumps. Use synthetic identifiers in examples.
5. **Labels are mandatory (hard gate)** — every PR must have **exactly one kind** label
   (`feat|fix|docs|spec|chore`) and **zero or one area** label
   (`capture|sync|retrieval|interfaces|infra`). Prefer `--label` on
   `gh pr create`. If labels were omitted, apply immediately with
   `gh pr edit <N> --add-label …`. A PR without a kind label is **incomplete**.
6. **Commits MUST be atomic** — each commit contains one independently understandable
   change, uses an English Conventional Commit subject, and does not mix unrelated
   files or concerns.
7. **PRs are semantic review units, not commit containers** — a PR SHOULD include the
   complete set of tightly coupled atomic commits needed for one user-visible,
   architectural, or milestone-level change. Never create one PR per commit merely
   to make commit history look tidy unless the user explicitly requests commit-level
   PRs.
8. **Preserve atomic history** — do not squash, reorder, or force-push atomic commits
   to manufacture a PR boundary. When a semantic change spans commits, use a stacked
   PR or a branch range whose diff is exactly that semantic unit.
9. **Before creating a PR**, inspect `git log <base>..<head>` and
   `git diff <base>...<head> --stat`; confirm the PR has one semantic purpose,
   its base is intentional, and no unrelated commit/file has leaked in.
10. **Local preflight is mandatory (hard gate)** — before `gh pr create` / push for
    review, run the local PR-lean gate and keep it green:
    - preferred: `make preflight` or `pnpm preflight` / `pnpm preflight:pr`
    - auto-format then gate: `make preflight-fix`
    - agent iteration only: `make preflight-quick` (not enough alone for PR open)
    - preflight runs format/lint/public-boundary in parallel, then build, then
      typecheck∥test, plus merge-tree conflict probe vs `origin/main`
    - list the exact preflight command + `PREFLIGHT PASS` in the Validation table
    - **Do not open a PR on a red preflight.** CI re-runs the same invariants; local
      green is required to stop wasting Actions minutes on format/boundary nits
    - still document Linux-only gaps (bubblewrap Product 4 sandbox, Gitleaks) as
      `Not run — Linux GHA only` when applicable
11. **Title** — English Conventional Commit subject matching the semantic PR change
    (and matching the kind label).
12. **Length** — aim for a reviewable body: enough that a cold reviewer can understand problem, approach, risk, and how to verify without reading the whole diff. Prefer complete sentences over telegram bullets alone.
13. **Post-create verify** — after create/edit, run the label gate below. Do not report
    the PR as done until it passes.

## Atomic commits vs semantic PRs

These are separate boundaries and MUST be decided separately:

- **Commit boundary:** one independently understandable change per commit. Keep
  prerequisite, implementation, test, documentation, and cleanup commits atomic
  when they have independent meaning.
- **PR boundary:** one semantic review and validation unit. A PR MAY contain multiple
  atomic commits when they collectively implement one feature, architectural plane,
  migration, or other coherent milestone.
- **Default grouping:** choose PRs by semantic scope, ownership, dependency and
  acceptance/verification boundary — never by commit count.
- **Stacked work:** use an intentional base branch when a semantic unit depends on
  another PR. Record the dependency in the PR body and keep each PR's diff
  limited to its own semantic unit.
- **Explicit exception:** create one PR per commit only when the user explicitly asks
  for commit-level PRs. “Keep commits atomic” alone is NOT that request.

Before opening PRs for a multi-commit branch:

1. Read `git log <base>..<head> --oneline` and group commits by semantic unit.
2. Inspect `git diff <base>...<head> --stat` for each proposed PR base/head pair.
3. Create one PR per semantic group, preserving all atomic commits inside it.
4. Verify that no unrelated milestone, file, or acceptance boundary crossed into the PR.
## Mandatory semantic-boundary receipt

Before `gh pr create` or `gh pr edit`, record these decisions in the PR description or
the execution ledger:

1. One sentence stating the PR's semantic purpose and acceptance boundary.
2. The atomic commits included in that purpose, grouped by dependency when needed.
3. The intentional PR base and head, verified with `git log <base>..<head>` and
   `git diff <base>...<head> --stat`.
4. A statement that the PR is not split merely because commits are atomic.

If the branch contains multiple semantic purposes, split it by semantic ownership or
dependency into stacked PRs. If it contains one semantic purpose, keep its complete
atomic commit set in one PR. Never infer the PR count from the commit count.

## Required body structure

Copy this shape (same as `.github/PULL_REQUEST_TEMPLATE.md`) and **fill every field**:

```markdown
## Summary

- <user- or maintainer-visible outcome 1>
- <outcome 2>
- <outcome 3 if needed>

## Why

<Paragraph(s): problem before the change, who hits it, what fails today, and
why this PR is the right slice. Include dogfood/repro narrative when relevant,
still synthetic/public-safe.>

## Scope and changes

- **In scope:** <packages/apps/docs touched and what changed in each>
- **Key behavior:** <before → after for the main path>
- **Intentionally not changed:** <list>

## Labels

- Kind: `<feat|fix|docs|spec|chore>`
- Area (optional): `<capture|sync|retrieval|interfaces|infra>`

## Architecture/data-contract impact

<None, or spell out effects on events, trust zones, MCP, migrations, CLI flags,
schemas, or projections.>

## Validation

| Command | Result |
| --- | --- |
| `pnpm …` | <pass / fail / Not run — reason> |

## Public-data/security boundary

- [x] Synthetic fixtures/examples only
- [x] No credentials, private paths, private knowledge, production logs, or runtime exports
- [x] Private issues reduced to public-safe repros when applicable

## Compatibility/migrations/deployment

- Compatibility: <SemVer / CLI / MCP note>
- Migrations: <None / local store / D1 — details>
- Deployment: <Not applicable / private operator only / …>

## Risks and rollback

- Risks: <main review hazards>
- Rollback: <revert PR / redeploy previous Worker / …>

## Review guide

- Start with: `<path>`
- Pay attention to: <edge cases, fail-closed paths>
- Suggested local check: `<command>`

## Out of scope/follow-ups

- <non-blocking follow-ups; link related PRs if any>

## Checklist

- [x] Title is Conventional Commit English
- [x] One coherent milestone / change
- [x] Labels from `.github/labels.json` only
- [x] Validation table honest
- [x] Deploy/migration status explicit
```

## `gh` workflow

### Create

```bash
# 0) Local PR-lean gate FIRST (hard fail closed)
make preflight
# or: pnpm preflight:pr
# or: make preflight-fix   # if format drift is expected

# pick kind from title/diff; never invent labels outside the catalog
KIND=chore   # feat|fix|docs|spec|chore
AREA=        # optional: capture|sync|retrieval|interfaces|infra

gh pr create --base main --title "<conventional title>" \
  --label "$KIND" ${AREA:+--label "$AREA"} \
  --body-file /tmp/carpeos-pr-body.md
```

Prefer `--body-file` over a tiny inline `--body` so the full template is used.
**Always pass at least `--label <kind>` on create.** Do not create unlabeled PRs
and “remember later.”

### Edit existing (including already-merged for history)

```bash
gh pr edit <N> --body-file /tmp/carpeos-pr-body.md
# labels if missing:
gh pr edit <N> --add-label <kind>
# optional area:
gh pr edit <N> --add-label <area>
```

### Label gate (mandatory after create/edit)

```bash
PR=<N>   # or: PR=$(gh pr view --json number -q .number)
gh pr view "$PR" --json labels,title -q '{title,labels:[.labels[].name]}'

# Fail closed if no kind label is present:
KIND_COUNT=$(gh pr view "$PR" --json labels -q '[.labels[].name] | map(select(.=="feat" or .=="fix" or .=="docs" or .=="spec" or .=="chore")) | length')
if [ "$KIND_COUNT" -ne 1 ]; then
  echo "LABEL_GATE_FAIL kind_count=$KIND_COUNT — apply exactly one kind label" >&2
  exit 1
fi
```

If the gate fails: add the missing kind (from the conventional-commit title or
diff intent), re-run the gate, then report the PR URL.

Kind selection defaults:

| Signal | Kind |
| --- | --- |
| title/branch `feat*` / new user-visible behavior | `feat` |
| title/branch `fix*` / bug/regression | `fix` |
| docs-only | `docs` |
| contracts/specs only | `spec` |
| tooling, CI, ignore files, deps, housekeeping | `chore` |

### Draft body from git

Before writing:

```bash
git log origin/main..HEAD --oneline
git diff origin/main...HEAD --stat
git diff origin/main...HEAD   # skim for behavior, not only files
```

Map the diff into Scope, Architecture impact, Risks, and Review guide.

## Quality bar (self-check before submit)

- Can a reviewer **not** on the dogfood session understand the bug in under a minute?
- Are **before/after** behaviors stated for the main user path?
- Are **fail-closed** paths and non-goals called out?
- Is every validation row either a real result or an explicit skip reason?
- Does the PR have **exactly one kind label** (and at most one area)?
- Would you merge this based only on the PR text + labels?

If any answer is no, expand the body / fix labels before reporting done.

## Anti-patterns

- Treating each atomic commit as its own PR without an explicit user request

- Three bullet Summary + one-line Why + checkbox Test plan only
- Creating a PR then shipping/merging **without** a kind label
- “CI green” with no local commands listed
- “None” for architecture impact when CLI flags, schemas, or store semantics changed
- Leaking private Worker URLs, real D1 IDs, account emails, or home paths
- Inventing labels outside `.github/labels.json`

## Install this skill for every harness

From a CarpeOS checkout:

```bash
./scripts/install-pr-skill.sh
```

Installs/links into:

- Claude Code: `~/.claude/skills/carpeos-pr`
- Codex CLI: `~/.codex/skills/carpeos-pr`
- Codex / agents: `~/.agents/skills/carpeos-pr`
- Grok Build: `~/.grok/skills/carpeos-pr`
- Gajae Code/GJC: `~/.gjc/agent/skills/carpeos-pr` and `~/.gjc/skills/carpeos-pr`

In-repo:

- `skills/carpeos-pr/SKILL.md` (this file)
- `.agents/skills/carpeos-pr`
- `.codex/skills/carpeos-pr`
- `.claude/skills/carpeos-pr`
