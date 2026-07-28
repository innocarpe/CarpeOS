# Contributing to CarpeOS

Thank you for considering a contribution to CarpeOS.

CarpeOS is early-stage. Contributions should protect the central boundary:
the repository contains the public system, never a user's private knowledge.

## Contribution Principles

- Keep changes small and reviewable.
- Prefer specifications, tests, and synthetic fixtures before broad feature work.
- Do not add real personal data, real project data, credentials, or exported
  runtime stores.
- Keep provider-specific code behind adapters.
- Treat generated projections as rebuildable outputs, not canonical state.
- Use clear English commit messages.

## Data Rules

Allowed in this repository:

- fictional examples;
- synthetic events;
- synthetic transcripts;
- public protocol examples;
- generated test fixtures that cannot identify a real user or project.

Not allowed in this repository:

- real AI session transcripts;
- private repository URLs;
- real project names from private work;
- local user paths;
- production logs;
- credentials, tokens, cookies, or keys;
- SQLite, D1, R2, Vectorize, or Obsidian exports from a real instance.

If a bug is found from private data, reduce it to a synthetic reproduction
before opening an issue or pull request.

## Documentation

`README.md` is the canonical English README. `README.ko.md` should track the
same substance in Korean.

When adding documentation:

- mark planned features as planned;
- avoid commands that do not work yet;
- verify commands before documenting them as usable;
- keep design claims aligned with `spec/` and ADRs once those directories exist.

## Architecture Changes

Architecture changes should be captured in ADRs when they affect:

- the canonical event model;
- ontology semantics;
- sync conflict handling;
- MCP tool contracts;
- security or privacy boundaries;
- projection authority.

Specifications under `spec/` are the design source of truth. Runtime event
stores are the knowledge source of truth for each private instance.

## Commit Style

Use English Conventional Commit subjects:

```text
docs: add project governance
spec: define claim status model
feat: add local event store
test: cover projection rebuild
fix: preserve claim supersession order
```

Atomic commits are preferred. Each commit should explain one coherent change and
include its verification when applicable.

## Pull Request Labels

Every pull request must use only labels from `.github/labels.json` and include
exactly one type, one size, one status, one milestone, and at least one area.
Compute size from GitHub additions plus deletions.

See [GitHub Label Policy](docs/maintainers/github-labels.md) for the maintainer
workflow and lifecycle rules.

## Before Opening a Pull Request

Check the relevant items:

- documentation is accurate and does not describe planned work as complete;
- examples are synthetic;
- tests were added or updated for behavior changes;
- generated artifacts are reproducible or excluded;
- no credentials, logs, local paths, private project names, or runtime databases
  are included;
- privacy and authority boundaries remain intact.
