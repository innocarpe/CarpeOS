---
name: carpeos-ci
description: >-
  Design, change, and operate CarpeOS GitHub Actions and local check scripts
  under a solo-maintainer PR-lean / main-full budget. Use when editing
  .github/workflows, package.json CI scripts, pnpm check, smoke/e2e jobs,
  Product 4 candidate workflows, branch protection checks, or when CI is slow,
  noisy, invalid, or about to gain a new step. Applies to Claude Code, Codex CLI,
  Grok Build, and Gajae Code/GJC.
metadata:
  short-description: "CarpeOS CI lanes, budgets, and change gate (all harnesses)"
---

# CarpeOS CI (shared harness skill)

**Same standard for Claude Code, Codex CLI, Grok Build, and Gajae Code/GJC.**

Do **not** grow CI ad hoc. Load this skill and the policy SSOT before adding,
moving, or “temporarily” wiring any check.

## Source of truth

| Artifact | Path |
| --- | --- |
| **Policy SSOT** | `docs/maintainers/ci-policy.md` |
| Primary workflow | `.github/workflows/ci.yml` |
| Secret scan | `.github/workflows/secret-scan.yml` |
| Trust plane (gated) | `.github/workflows/product-4-candidate-*.yml` |
| Release | `.github/workflows/release.yml` |
| Local entrypoints | root `package.json` (`check`, `test`, `smoke:*`) |
| Agent rules | `AGENTS.md` / `Agents.md` (CI section) |

Read **`docs/maintainers/ci-policy.md` in full** before changing workflows or
check composition. This skill is the operating procedure; the doc is the contract.

## When to use

Trigger on any of:

- edit under `.github/workflows/`;
- change `pnpm check` / `test` / smoke / e2e scripts used by CI;
- “CI is slow”, “Actions is red noise”, “add a required check”;
- Product 4 evaluate / attest / publish workflow work;
- proposal to run heavy evals on every PR;
- after a merge that reintroduces invalid workflow YAML.

## Hard rules (fail closed)

1. **Lanes first.** Every check belongs to exactly one default lane:
   - `pr-lean` — merge-blocking, budgeted for iteration;
   - `main-full` — deeper integration after merge;
   - `trust-release` — Product 4 / release authority planes;
   - `local-only` — agent/human, not GHA.
2. **PR lean budget.** Target **≤ 2 minutes** wall clock on `ubuntu-latest` with
   warm cache. If a change would push PR Checks **> 3 minutes**, stop and either
   re-home work to `main-full` / tests or get explicit maintainer approval in the
   PR Why section.
3. **No duplicate monorepo work on PR.** Do not rebuild packages already built by
   `pnpm check` (or the lean equivalent) only to run a short eval on every PR.
4. **Prefer tests over new workflows.** New invariants land as package tests or
   `scripts/test/*.test.mjs` first. New YAML needs the change-gate table.
5. **Job-level `env` must not reference `runner.*`.** Use step `with:` / `run:` or
   a setup step + `GITHUB_ENV`. Invalid workflow files (0s, path-as-name) are **P0**.
6. **Trust plane is not default PR CI.** Product 4 candidate workflows are not
   required merge gates until activation policy says so. Logic is enforced by
   unit/contract tests; live GHA may be off, dispatch-only, or non-required.
7. **Release credentials never on PR.** No npm tokens, signing keys, or
   checks-write App privileges on untrusted `pull_request` jobs.
8. **Same commands locally.** Agents reproduce CI with root `pnpm` / `node --test`
   scripts. Do not invent CI-only unverifiable glue.
9. **Harness-neutral.** Do not add “Claude-only” or “Grok-only” CI rules. Update
   this skill + `docs/maintainers/ci-policy.md` instead.
10. **Honest PR validation.** When CI changes, the PR validation table lists real
    commands and results (`carpeos-pr` skill).

## Default lane contents (summary)

### PR lean (default merge gate)

- format, lint, build, typecheck, unit/contract tests, public-boundary  
  (commonly one step: `pnpm check` **if** it does not include smokes/e2e)
- **Path-filtered:** full monorepo work only when CI-relevant paths change
  (see `ci.yml` `dorny/paths-filter`); docs/README-only PRs still report
  job `Checks` as success so required checks do not block. Do **not** use
  bare `paths-ignore` that skips the whole workflow.
- secret scan (`secret-scan.yml`) — every PR (not path-skipped)

### Main full

- PR lean set, plus smokes (`smoke:dogfood`, `smoke:mcp`, `smoke:product`,
  `smoke:knowledge`), selected package evals, sync-worker e2e—**without**
  redundant rebuilds where avoidable

### Trust / release

- Product 4 evaluate → attest → publish chain per PRD trust separation
- **Pre-activation default:** evaluate is `workflow_dispatch` only (not PR auto);
  product4 unit/contract tests + preflight remain the PR quality gate
- `release.yml` on release/tag paths only

Full tables and anti-history: `docs/maintainers/ci-policy.md` §§2–6.

## Change gate (mandatory before editing CI)

Copy into the PR body (or refuse the change):

| # | Question | Answer |
| --- | --- | --- |
| 1 | Lane (`pr-lean` / `main-full` / `trust-release` / `local-only`) | |
| 2 | Failure mode not already covered by existing tests | |
| 3 | Duplicate of existing build/typecheck/test? | |
| 4 | Added wall time (order of magnitude) | |
| 5 | Could this be a unit/contract test instead? | |
| 6 | Secrets / network / privileged token needs? | |
| 7 | Job-level `runner.*` or other invalid contexts? | |
| 8 | If trust plane: activation ready for required checks? | |

If row 3 is yes, or row 4 blows the PR budget without approval, **do not add to PR lean**.

## Operating procedures

### A. Fix broken / invalid CI

1. Identify lane and whether the failure is **parse-time** (invalid YAML/context)
   vs **runtime** (test/smoke).
2. Parse-time: fix context usage or disable the workflow; do not leave red noise.
3. Runtime: fix the product or test; do not silence by deleting the only coverage
   of a real invariant without moving coverage to tests.
4. Re-run the smallest local command that mirrors the failing step.

### B. Speed up CI

1. Measure step timings (`gh run view <id> --json jobs` or Actions UI).
2. Classify each slow step by lane.
3. Apply in order: remove duplicates → move to main-full → replace with tests →
   path filters → only then add caching complexity.
4. Record new expected PR wall time in the PR Why section.

### C. Add a new check

1. Complete the change gate table.
2. Implement as test when possible.
3. If GHA is required, wire the correct lane only; update contract tests for
   load-bearing workflows.
4. Do not enable as branch-protection required context without an explicit
   maintainer decision documented in the PR.

### D. Product 4 / trust workflows

1. Load Product 4 PRD/policy if changing trust semantics.
2. Keep candidate unprivileged; base-owned evaluation; data-only publish.
3. Never put privileged tokens on `pull_request` candidate jobs.
4. Until activation: prefer tests + optional non-required workflows; document
   disablement as policy-compliant when reducing noise.

## Anti-patterns

- Adding smoke/e2e to every PR “for safety” without budget discussion
- Second monorepo `pnpm install` / full rebuild after `pnpm check` without need
- Job-level `CARPEOS_HOME: ${{ runner.temp }}/...` (invalid)
- Ignoring 0s workflow-file failures because “CI Checks is green”
- Turning Product 4 scaffolding into required checks before App/ruleset activation
- Tool-specific CI folklore not written into this skill / `ci-policy.md`
- Expanding `pnpm check` with multi-minute integration so local and PR both hurt

## Local verification (typical)

**Hard rule for agents:** run the local preflight gate **before** `gh pr create` /
push-for-review. Do not use GHA as a format/lint/public-boundary linter.

```bash
# Preferred — parallel PR-lean preflight (format∥lint∥boundary → build → typecheck∥test)
make preflight
# equivalents:
pnpm preflight
pnpm preflight:pr
node scripts/preflight.mjs --mode=pr

# Fast agent loop (not sufficient alone to open a PR)
make preflight-quick

# Auto-format then full preflight
make preflight-fix

# Sequential exact CI Checks step (also valid; slower than preflight)
pnpm check

# Workflow contract tests when editing Product 4 YAML
node --test scripts/test/product4-workflows.test.mjs

# Inspect a slow/failed run
gh run list --workflow CI --limit 5
gh run view <id> --json jobs --jq '.jobs[].steps[] | {name, conclusion, startedAt, completedAt}'
```

`scripts/preflight.mjs` also probes merge conflicts vs `origin/main` and prints
Linux-only gaps (bubblewrap Product 4 sandbox, Gitleaks) so agents do not claim
full CI parity on macOS.

## Install this skill for every harness

From a CarpeOS checkout:

```sh
./scripts/install-ci-skill.sh
```

Installs/links into:

- Claude Code: `~/.claude/skills/carpeos-ci`
- Codex CLI: `~/.codex/skills/carpeos-ci`
- Codex / agents: `~/.agents/skills/carpeos-ci`
- Grok Build: `~/.grok/skills/carpeos-ci`
- Gajae Code/GJC: `~/.gjc/agent/skills/carpeos-ci` and `~/.gjc/skills/carpeos-ci`

In-repo:

- `skills/carpeos-ci/SKILL.md` (this file)
- `.agents/skills/carpeos-ci` (symlink)
- `.codex/skills/carpeos-ci` (symlink)
- `.claude/skills/carpeos-ci` (symlink when install runs)

## Related skills

- `carpeos-pr` — PR body must list honest validation; CI change PRs use full template
- `carpeos-release` — release/tag/npm; not PR lean
- Global `github-pr` — kind labels on every PR
