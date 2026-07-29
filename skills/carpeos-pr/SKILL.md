---
name: carpeos-pr
description: >-
  Open or update CarpeOS GitHub pull requests with full, reviewable descriptions.
  Use when creating a PR, editing a PR body, running gh pr create/edit, shipping
  a feature branch, or when the user asks for a PR, pull request, or PR
  description. Applies to Claude Code, Codex CLI, and Grok Build.
metadata:
  short-description: "Full PR body template for CarpeOS (gh pr create/edit)"
---

# CarpeOS Pull Request (shared harness skill)

**Same standard for Claude Code, Codex CLI, and Grok Build.**

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
5. **Labels** — exactly one kind (`feat|fix|docs|spec|chore`) + optional one area (`capture|sync|retrieval|interfaces|infra`). Apply via `gh pr edit --add-label`.
6. **One coherent change** — prefer one atomic commit per PR unless the user asks otherwise.
7. **Title** — English Conventional Commit subject matching the change.
8. **Length** — aim for a reviewable body: enough that a cold reviewer can understand problem, approach, risk, and how to verify without reading the whole diff. Prefer complete sentences over telegram bullets alone.

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
gh pr create --base main --title "<conventional title>" \
  --label <kind> [--label <area>] \
  --body-file /tmp/carpeos-pr-body.md
```

Prefer `--body-file` over a tiny inline `--body` so the full template is used.

### Edit existing (including already-merged for history)

```bash
gh pr edit <N> --body-file /tmp/carpeos-pr-body.md
# labels if missing:
gh pr edit <N> --add-label <kind> --add-label <area>
```

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
- Would you merge this based only on the PR text + labels?

If any answer is no, expand the body before `gh pr create` / `gh pr edit`.

## Anti-patterns

- Three bullet Summary + one-line Why + checkbox Test plan only
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
- Codex / agents: `~/.agents/skills/carpeos-pr`
- Grok Build: `~/.grok/skills/carpeos-pr`

In-repo:

- `skills/carpeos-pr/SKILL.md` (this file)
- `.agents/skills/carpeos-pr`
- `.claude/skills/carpeos-pr`
