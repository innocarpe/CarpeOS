# ADR 0001: Canonical Store and Projections

Status: Accepted for planned v1 design

## Context

CarpeOS needs durable memory for AI-assisted work. Notes, vector indexes, graph
indexes, and dashboards are useful interfaces, but each can become stale,
partial, or provider-specific.

## Decision

CarpeOS will use an append-only `CanonicalEvent` stream as the private knowledge
source of truth. Obsidian notes, vector indexes, graph indexes, dashboards,
context packs, and accepted-fact views are rebuildable, non-authoritative
projections.

## Consequences

- Runtime knowledge can be rebuilt into multiple interfaces.
- Projection bugs do not corrupt canonical state.
- Projection builders must consume erasure and authorization policy.
- Users cannot treat editing a generated note as canonical mutation unless a
  capture flow records a new event.
