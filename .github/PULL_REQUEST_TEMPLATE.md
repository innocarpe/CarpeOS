<!--
Title: English Conventional Commit subject, e.g.
  fix(sync): rebind protected upload row when trust zone changes
  docs: document trust-zone resolution for operators
  chore: enforce full PR bodies via carpeos-pr skill

Milestone PRs: one semantic review unit may contain multiple atomic commits.
Commit atomicity and PR grouping are separate: group PRs by semantic ownership,
dependency, and acceptance boundary, not by commit count.

═══════════════════════════════════════════════════════════════════════════
AGENT / HARNESS RULES (Claude Code, Codex CLI, Grok Build, Gajae Code/GJC)
═══════════════════════════════════════════════════════════════════════════
- Fill EVERY section below with real content. A three-bullet Summary-only body
  is NOT acceptable.
- Prefer complete sentences in Why, Scope, Risks, and Review guide.
- Validation table: only commands you actually ran. Use
  "Not run — <reason>" for skips. Never invent green checkmarks.
- Empty sections are forbidden. Write "None" or "Not applicable" + one reason.
- Public boundary: synthetic examples only. No credentials, private paths,
  real project names, production logs, or runtime dumps.
- Labels: one kind + optional one area from .github/labels.json.
- Prefer: gh pr create|edit --body-file …
- Full skill: skills/carpeos-pr/SKILL.md
  Install: ./scripts/install-pr-skill.sh
═══════════════════════════════════════════════════════════════════════════
-->

## Summary

<!-- 2–4 bullets: user-visible or maintainer-visible outcomes only. -->

-
-
-

## Why

<!--
Cold-reader context: problem before this PR, who hits it, what fails today,
and why this slice is the right fix. Use synthetic/public-safe identifiers.
-->

<!-- Example shape (replace with real content):
Before this change, <operator path> failed with <symptom> because <root cause>.
That blocked <capability>. This PR addresses <slice>, not <out of scope>.
-->



## Scope and changes

<!-- Packages/apps/docs touched; before → after for the main path; what you left alone. -->

- **In scope:**
  -
- **Key behavior (before → after):**
  - Before:
  - After:
- **Intentionally not changed:**
  -

## Labels

<!-- Apply via UI or: gh pr edit N --add-label <kind> --add-label <area> -->

- Kind: `<!-- feat | fix | docs | spec | chore -->`
- Area (optional): `<!-- capture | sync | retrieval | interfaces | infra -->`

## Architecture/data-contract impact

<!--
Canonical events, ontology, trust zones, adapters, MCP tools, migrations,
CLI flags/JSON, schemas, projections, docs/types/tests.
Write "None — <one reason>" if no contract impact.
-->



## Validation

<!-- Honest results only. Add/remove rows as needed. -->

| Command | Result |
| --- | --- |
| `pnpm format:check` | Not run — |
| `pnpm lint` | Not run — |
| `pnpm typecheck` | Not run — |
| `pnpm test` | Not run — |
| `pnpm public-boundary` | Not run — |
| `pnpm check` | Not run — |
| `<!-- package-scoped test, e.g. pnpm --filter @carpeos/cli test -->` |  |

## Public-data/security boundary

- [ ] Uses only synthetic fixtures, examples, transcripts, and public protocol examples.
- [ ] Includes no credentials, tokens, cookies, private keys, production logs, runtime database exports, private repository URLs, local user paths, or private project names.
- [ ] Reduces any private-data-derived issue to a public-safe synthetic reproduction.

## Compatibility/migrations/deployment

- **Compatibility:** <!-- SemVer / CLI flags / MCP tools / soft behavior change -->
- **Migrations:** <!-- None / local store / D1 — details -->
- **Deployment:** <!-- Not applicable / private Worker redeploy / npm release path -->

## Risks and rollback

- **Risks:**
  -
- **Rollback:**
  -

## Review guide

- **Start with:** `<!-- highest-signal path -->`
- **Pay attention to:** <!-- edge cases, fail-closed paths, contract diffs -->
- **Suggested local check:** `<!-- command -->`

## Out of scope/follow-ups

<!-- Non-blocking; link related PRs if any. -->

-
-

## Checklist

- [ ] PR title uses an English Conventional Commit subject.
- [ ] PR covers one coherent semantic change; multiple atomic commits are allowed when they form that change.
- [ ] No unrelated changes are included.
- [ ] Fixtures, examples, and sample data are synthetic only.
- [ ] No credentials, private paths, private knowledge, production logs, or runtime data are included.
- [ ] `README.md` and `README.ko.md` stay equivalent when README content changes.
- [ ] Schema, docs, types, and tests are aligned when contracts change.
- [ ] Local checks were run, or every skip is explained in the Validation table.
- [ ] CI status is passing or the current failure is documented above.
- [ ] Compatibility / migrations / deployment status is explicit (including "Not applicable").
- [ ] Labels use only entries from `.github/labels.json` (one kind, optional area).
- [ ] Why / Scope / Risks / Review guide use enough detail for a cold reviewer.
