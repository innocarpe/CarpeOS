# CarpeOS v1 Capture and MCP

Status: planned normative design for the v1 runtime.

CarpeOS is provider-neutral. Capture and retrieval protocols must not depend on
one AI provider, editor, note application, or hosting platform.

## Capture Contract

Provider adapters SHOULD convert lifecycle hooks into a common capture envelope.
Examples of providers include Codex, Grok-based coding workflows, Claude Code,
and generic shell tools.

Capture adapters MUST:

- preserve non-empty source provenance;
- assign or request idempotency metadata;
- place content in the correct trust zone;
- use `ProtectedValueRef` for sensitive or large content;
- distinguish raw evidence from observations, claims, decisions, and
  supersessions;
- avoid embedding private runtime data in public repository artifacts.

Capture adapters MUST NOT:

- mark claims as accepted by editing claims;
- treat a provider transcript as authoritative by default;
- bypass protected-value policy for convenience;
- require one provider-specific event shape in canonical storage.

## MCP Retrieval Contract

The planned MCP surface SHOULD expose bounded tools for retrieval and capture.
Potential tools include:

- `memory_search`;
- `memory_get`;
- `memory_context_pack`;
- `memory_trace`;
- `memory_timeline`;
- `memory_related`;
- `memory_open_loops`;
- `memory_capture`.

These tools MUST apply trust-zone authorization and protected-value policy before
returning content to an agent.

MCP context packs SHOULD return:

- accepted facts derived at query time;
- provenance summaries;
- visible conflicts;
- open verification gaps;
- redacted protected-value markers when content is not available.

MCP tools MUST NOT expose decrypted private evidence to an agent unless the
requester is authorized for that trust zone and protected value.

## Failure Modes

| Failure mode | Required behavior |
| --- | --- |
| Provider hook missing provenance | Attach external provenance if available, or reject the event. |
| Duplicate hook delivery | Use idempotency replay semantics. |
| Agent requests forbidden trust zone | Return authorization failure or redacted result. |
| Context pack exceeds budget | Return bounded summary with truncation metadata. |
| Capture extraction uncertain | Create observations or proposed claims, not accepted facts. |

## Synthetic Example

A generic coding hook submits a synthetic message artifact. The adapter stores
the transcript as an `EvidenceArtifact` with external provenance, extracts an
`Observation` with evidence references, proposes a `Claim` with support
references, and leaves acceptance to a later `AcceptanceDecision`. An MCP query
can retrieve the claim and its lineage, but it cannot treat the claim as an
accepted fact until a visible decision accepts it.
