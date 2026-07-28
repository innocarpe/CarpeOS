<!--
Title convention: use an English Conventional Commit title, for example
`docs: add ontology ADR template` or `fix: preserve claim supersession order`.
For CarpeOS milestone PRs, keep the PR to one coherent milestone and exactly
one atomic commit unless a maintainer explicitly requests otherwise.
-->

## Summary

<!-- State the user-visible or maintainer-visible result in 2-4 bullets. -->

-

## Why

<!-- Explain the problem, design need, bug, or milestone this PR addresses. -->

-

## Scope and changes

<!-- List the changed areas and call out anything intentionally left untouched. -->

-

## Labels

<!--
Use only labels defined in .github/labels.json. Replace each placeholder with
the exact label applied to this PR.
-->

- Type: `<type-label>`
- Area: `<area-label>`; `<area-label-if-needed>`
- Size: `<size-label>`
- Status: `<status-label>`
- Milestone: `<milestone-label>`

## Architecture/data-contract impact

<!--
Describe any impact on canonical events, ontology semantics, trust zones,
adapter contracts, MCP tools, migrations, generated projections, docs, types,
or tests. Write "None" if there is no contract impact.
-->

-

## Validation

<!-- Include exact commands run and the result observed. Do not list commands that were not run. -->

| Command | Result |
| --- | --- |
| `pnpm format:check` | Not run |
| `pnpm lint` | Not run |
| `pnpm typecheck` | Not run |
| `pnpm test` | Not run |
| `pnpm public-boundary` | Not run |
| `pnpm labels:check` | Not run |
| `pnpm check` | Not run |

## Public-data/security boundary

<!--
Confirm the public/private boundary. This repository must use only fictional,
generic, synthetic examples and must not include private knowledge or runtime
exports.
-->

- [ ] Uses only synthetic fixtures, examples, transcripts, and public protocol examples.
- [ ] Includes no credentials, tokens, cookies, private keys, production logs, runtime database exports, private repository URLs, local user paths, or private project names.
- [ ] Reduces any private-data-derived issue to a public-safe synthetic reproduction.

## Compatibility/migrations/deployment

<!--
State compatibility expectations, migration status, deployment status, and any
operator action required. Use explicit "Not applicable" entries when relevant.
-->

- Compatibility:
- Migrations:
- Deployment:

## Risks and rollback

<!--
Name the main review risks and the simplest rollback path. Include data or
schema recovery notes when relevant.
-->

- Risks:
- Rollback:

## Review guide

<!-- Point reviewers to the highest-signal files, decisions, and checks. -->

- Start with:
- Pay attention to:
- Suggested local check:

## Out of scope/follow-ups

<!-- List follow-up work that should not block this PR. -->

-

## Checklist

- [ ] PR title uses an English Conventional Commit subject.
- [ ] PR covers one coherent milestone.
- [ ] CarpeOS milestone PR has exactly one atomic commit.
- [ ] No unrelated changes are included.
- [ ] Fixtures, examples, and sample data are synthetic only.
- [ ] No credentials, private paths, private knowledge, production logs, or runtime data are included.
- [ ] `README.md` and `README.ko.md` stay equivalent when README content changes.
- [ ] Schema, docs, types, and tests are aligned when contracts change.
- [ ] Local checks were run, or any skipped checks are explicitly explained above.
- [ ] CI status is passing or the current failure is documented above.
- [ ] Deploy and migration status is explicit above, including "Not applicable" when there is no deploy or migration.
- [ ] Labels use only entries from `.github/labels.json`.
- [ ] Labels include exactly one type, one size, one status, and one milestone.
- [ ] Labels include at least one area.
- [ ] Size label was computed from GitHub additions plus deletions.
