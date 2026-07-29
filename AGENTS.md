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

## Release and versioning (all harnesses)

When releasing, publishing to npm, creating git tags, or cutting GitHub
Releases for `@innocarpe/carpeos`, **load and follow** the shared skill:

- `skills/carpeos-release/SKILL.md`

Policy SSOT:

- `docs/maintainers/versioning-and-releases.md`
- `CHANGELOG.md`
- `scripts/release.mjs`
- `.github/workflows/release.yml`

Do not invent alternate version schemes. Same process for Claude Code, Codex
CLI, and Grok Build. Install user-global skill links:

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

## Pull Request Rules (all harnesses)

When opening or updating a GitHub PR (`gh pr create`, `gh pr edit`, ship branch):

1. **Load and follow** `skills/carpeos-pr/SKILL.md` (shared skill for Claude
   Code, Codex CLI, and Grok Build).
2. **Use the full template** in `.github/PULL_REQUEST_TEMPLATE.md`. Fill every
   section. Minimal “Summary + Why + Test plan” bodies are **not** sufficient.
3. Prefer `gh pr create --body-file …` / `gh pr edit --body-file …` so the body
   is not truncated by shell history.
4. Apply labels when creating or immediately after: one kind + optional area.
5. Validation table must list **actual** commands and results; skipped checks
   need an explicit “Not run — reason”.
6. Keep public/private boundary: no credentials, private paths, real project
   names, production logs, or runtime dumps in the PR text.

Install the skill into user harness dirs:

```sh
./scripts/install-pr-skill.sh
```

## Verification Rules

Before reporting completion:

- run the smallest relevant verification;
- inspect `git status --short`;
- confirm no private data or credentials were introduced;
- state any verification gap clearly.
