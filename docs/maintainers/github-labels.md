# GitHub Label Policy

This guide defines the human-facing label policy for CarpeOS maintainers.
`.github/labels.json` is the source of truth for every repository label.

## Source of Truth

- Use only labels defined in `.github/labels.json`.
- Do not create ad hoc labels from the GitHub UI.
- Do not rename, remove, or add labels without updating `.github/labels.json`.
- When the label set must change, update `.github/labels.json` and GitHub
  together in a dedicated pull request.
- Keep standard community labels available for issues.
- Label names are case-sensitive; milestone labels retain the uppercase `G`
  used in the catalog.

## Pull Request Labels

Every pull request must have labels from these five groups:

| Group | Required count | Selection rule |
| --- | --- | --- |
| Type | Exactly one | Choose the label that describes the main kind of change. |
| Area | One or more | Choose every affected area. |
| Size | Exactly one | Compute from GitHub additions plus deletions. |
| Status | Exactly one | Reflect the current review lifecycle state. |
| Milestone | Exactly one | Match the milestone or release target for the PR. |

Do not open a ready-for-review PR without all five groups represented.

## Size Labels

Compute size from the total GitHub diff count:

```text
total size = additions + deletions
```

Use these bands:

| Size | Total additions plus deletions |
| --- | --- |
| xs | 0-19 |
| s | 20-99 |
| m | 100-499 |
| l | 500-999 |
| xl | 1000 or more |

Use the exact size label defined in `.github/labels.json` for the matching
band.

## Status Lifecycle

- A new ready pull request gets the `status:needs-review` status.
- After all required gates are ready, move the status to `status:ready`.
- Use `status:blocked` while the PR cannot advance because of an external
  dependency or unresolved blocker.
- Use `status:changes-requested` when reviewer feedback requires author action.
- After merge, update the status label to `status:merged`.

Only one `status:*` label may be present at any time. Remove the previous
status label when applying the next lifecycle status.

## Issue Labels

Standard community labels remain available for issues. Issue labeling does not
override the pull request cardinality rules above.
