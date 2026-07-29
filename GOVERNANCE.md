# CarpeOS Governance

CarpeOS governance is designed to keep the project understandable, auditable,
and safe for public development.

## Source of Truth

CarpeOS has two different sources of truth.

The public repository is the source of truth for system design:

- `spec/` defines ontology, event, API, sync, and MCP contracts;
- ADRs define durable architecture decisions;
- tests verify that implementations follow the specifications.

Each private runtime instance is the source of truth for knowledge:

- canonical event stores record what that instance knows;
- evidence, claims, decisions, and open loops belong to the private instance;
- generated notes, vector indexes, graph indexes, dashboards, and context packs
  are rebuildable projections.

These two sources of truth must not be merged. The public repository should
define how CarpeOS works, not contain what a specific user knows.

## Decision Process

Use ADRs for decisions that affect:

- canonical event semantics;
- ontology boundaries;
- claim lifecycle;
- sync protocol;
- MCP tool contracts;
- projection authority;
- security boundaries;
- supported provider adapters.

An ADR should include:

- status;
- context;
- decision;
- consequences;
- rejected alternatives, when useful.

## Project Direction

The project should prioritize:

- local-first operation;
- provider-neutral interfaces;
- explicit authority and provenance;
- rebuildable projections;
- synthetic test fixtures;
- small, composable packages;
- clear extension points for domain-specific ontology packs.

The project should avoid:

- coupling canonical knowledge to one note app;
- treating vector search as the only retrieval method;
- storing private runtime data in the repository;
- adding provider-specific assumptions to the core ontology;
- documenting planned features as completed features.

## Maintainer Responsibilities

Maintainers should:

- preserve the public implementation/private knowledge boundary;
- require synthetic fixtures in public issues and pull requests;
- keep README files aligned across English and Korean;
- require tests or explicit verification notes for behavior changes;
- keep local proof, CI proof, hosted deployment proof, and private operator
  adoption proof separate;
- keep third-party notices current when code or assets are reused.

## Release Readiness

G008 documents a local release-readiness boundary. On Node 22.22.0,
`pnpm check` passes, and the opt-in synthetic local Worker+D1+R2 gate passes
with `pnpm --filter @carpeos/sync-worker test:e2e`. That evidence is not CI
proof, hosted deployment proof, package publish proof, private vault adoption
proof, or cross-Mac live deployment proof.

Before maintainers claim a release or deployment, they must collect the evidence
listed in [Release Readiness](docs/maintainers/release-readiness.md). Without
that evidence, public documentation and release notes must keep the status as
`NOT DEPLOYED`.

## Contribution Review

Pull request review should check:

- correctness against `spec/`;
- privacy boundary compliance;
- projection authority semantics;
- provider-neutrality of core packages;
- test coverage for behavior changes;
- documentation accuracy.

The repository can accept incomplete experimental work only when it is clearly
marked as experimental and does not weaken privacy, authority, or source of
truth boundaries.
