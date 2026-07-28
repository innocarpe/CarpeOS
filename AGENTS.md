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

- `README.md` is the canonical English README.
- `README.ko.md` should track the same substance in Korean.
- Planned features must be described as planned.
- Do not document commands as working unless they have been verified.
- Do not claim adapters, MCP tools, sync, projections, or hosted deployment are
  complete until implementation and tests exist.

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

## GitHub Label Rules

- Apply pull request labels from all five required groups: type, area, size,
  status, and milestone.
- Every pull request must have exactly one type label, at least one area label,
  exactly one size label, exactly one status label, and exactly one milestone
  label.
- Compute the size label from GitHub additions plus deletions.
- Set a new ready pull request to `status:needs-review`; after all gates are
  ready, transition it to `status:ready`; use `status:blocked` or
  `status:changes-requested` when those states apply; after merge, transition
  the status label to `status:merged`.
- Use only labels defined in `.github/labels.json`; never invent labels outside
  the catalog.

## Verification Rules

Before reporting completion:

- run the smallest relevant verification;
- inspect `git status --short`;
- confirm no private data or credentials were introduced;
- state any verification gap clearly.
