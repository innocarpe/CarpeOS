# ADR 0002: Immutable Epistemic Model

Status: Accepted for planned v1 design

## Context

AI systems often blur raw evidence, extracted observations, proposed claims, and
accepted knowledge. Mutating a claim to encode acceptance or rejection loses
audit history and makes conflicts hard to reason about.

## Decision

CarpeOS will model epistemic state with immutable events:

- `EvidenceArtifact`;
- `Observation`;
- `Claim`;
- `AcceptanceDecision`;
- `Supersession`.

Claims are immutable. Acceptance, rejection, and review outcomes are represented
only by `AcceptanceDecision`; those outcomes are not epistemic-authority values.
Replacement and invalidation are represented by `Supersession`. Accepted facts
are derived at query time.

## Consequences

- The system preserves provenance and disagreement.
- Queries can expose conflicts instead of hiding them.
- Accepted facts require query semantics, not direct row mutation.
- Implementations must keep lifecycle status separate from epistemic authority:
  stored lifecycle is only `draft` or `active`, while epistemic authority is
  only `unverified`, `self_reported`, `observed`, `imported`, `derived`, or
  `verified`.
