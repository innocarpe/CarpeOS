# GitHub Label Policy

CarpeOS uses a small label set for lightweight tagging, not multi-axis
classification. `.github/labels.json` is the source of truth.

## Source of Truth

- Use only labels defined in `.github/labels.json`.
- Do not create ad hoc labels from the GitHub UI.
- When the set must change, update `.github/labels.json` and GitHub together.
- Keep the catalog near **10–15** labels. Prefer fewer labels over finer
  taxonomy.
- Size, review status, and milestone tracking are **not** label concerns:
  - size is visible on the GitHub diff;
  - review state lives in the PR conversation and checks;
  - milestones use GitHub Milestones when needed.

## Label Groups

| Group | Labels | Typical use |
| --- | --- | --- |
| Kind | `feat`, `fix`, `docs`, `spec`, `chore` | What kind of change this is |
| Area | `capture`, `sync`, `retrieval`, `interfaces`, `infra` | Optional product surface |
| Community | `good first issue`, `help wanted`, `question`, `duplicate`, `wontfix` | Issue triage |

## Pull Request Guidance

Keep PRs lightly tagged:

- Apply **exactly one kind** label (`feat`, `fix`, `docs`, `spec`, or `chore`).
- Apply **zero or one primary area** when it helps discovery. Add a second area
  only when the change is truly cross-cutting.
- Do not apply community labels to ordinary feature PRs.

Examples:

| Change | Labels |
| --- | --- |
| Local capture outbox feature | `feat`, `capture` |
| Hybrid retrieval ranking fix | `fix`, `retrieval` |
| MCP server docs only | `docs`, `interfaces` |
| CI / label catalog maintenance | `chore`, `infra` |
| Spec-only ontology update | `spec` |

## Issue Guidance

Community labels are mainly for issues. Kind and area labels may be used on
issues when they make triage clearer.

## Automation

There is **no required label CI contract**. Labels are maintainer guidance and
browse/filter tags. Do not reintroduce hard cardinality checks unless the
project later decides it needs them.
