# CarpeOS v1 Capture and MCP

Status: G007 local MCP implementation and normative capture contract.

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

G007 exposes a local stdio MCP server over the typed local store. It does not
open a network listener, deploy a hosted MCP service, or make any projection
authoritative.

The MCP surface MUST expose exactly these tools, in this order:

- `memory_search`;
- `memory_get`;
- `memory_context_pack`;
- `memory_trace`;
- `memory_timeline`;
- `memory_related`;
- `memory_capture`;
- `memory_propose_claim`.

The machine-readable contract is
`spec/v1/schema/mcp-api.schema.json`.

Every tool input MUST include explicit visibility:

```json
{
  "visible_trust_zone_ids": ["tz_synthetic_example"],
  "protected_value_policy": "metadata_only"
}
```

The server MUST fail closed when visibility is absent, malformed, unknown, or
outside the configured allowlist. The active local trust zone MUST be included in
the requested visible trust zones. A tool MUST authorize before resolving or
serializing content and MUST perform a canonical local-store recheck before any
retrieval candidate becomes output.

Protected values MUST return metadata or redaction markers unless policy allows
access. Diagnostics MUST go to standard error and MUST NOT include protected
plaintext. Standard output is reserved for MCP JSON-RPC frames.

## Context Budgets

Agent-facing retrieval responses use `ContextBudget`:

```json
{
  "max_items": 8,
  "max_characters": 4000
}
```

The budget is deterministic for fixed canonical inputs, projection inputs,
configuration, visibility, and tool arguments. It limits item count and stable
serialized character count. It is not a token-exact budget and MUST NOT be
documented as one.

Budgeted responses MUST include:

- `used.items` and `used.characters`;
- `truncated`;
- `omitted.items` and `omitted.characters`.

Context budgets define **active working-memory capacity**. They do not measure
or limit total store capacity in the canonical event stream. See ADR 0009 and
`docs/architecture/memory-capacity.md` for the total-vs-active capacity model.
Procedure traces captured as evidence MUST NOT be treated as accepted facts
solely because they appear in a budgeted response.

## Tool Semantics

| Tool | Implemented behavior |
| --- | --- |
| `memory_search` | Searches visible local memory through structured, FTS, vector, or hybrid retrieval paths as configured, then applies canonical recheck and `ContextBudget`. |
| `memory_get` | Retrieves one visible canonical event or erasure record by stable event, payload, or erasure ID. Hidden records return a safe `not_found` error. |
| `memory_context_pack` | Builds a deterministic bounded context pack with separate accepted facts, draft claims, rejected claims, observations, evidence summaries, conflicts, supersessions, erasures, verification gaps, redactions, and budget metadata. |
| `memory_trace` | Returns bounded visible provenance/support/decision/supersession lineage for one visible record. |
| `memory_timeline` | Returns a bounded bitemporal timeline of visible events and erasures ordered by recorded time and ID. |
| `memory_related` | Returns bounded visible records related by deterministic canonical graph edges. It does not infer acceptance from similarity. |
| `memory_capture` | Writes local evidence through existing capture and outbox idempotency. It returns `captured` or `replay`; it does not create accepted facts. |
| `memory_propose_claim` | Writes a draft `Claim` through the local-store outbox, validates visible support references before writing, returns `proposed` or `replay`, and never writes an `AcceptanceDecision`. |

`memory_open_loops` is not a G007 tool. Open-loop projection work remains
planned.

## Accepted Facts

MCP context packs SHOULD return:

- accepted facts derived at query time from visible canonical events;
- draft and proposed claims separately from accepted facts;
- rejected claim lineage;
- visible conflicts;
- visible supersession and erasure metadata;
- open verification gaps;
- redacted protected-value markers when content is not available.

An accepted fact MUST be emitted only when the visible event graph contains:

1. a visible `Claim`;
2. a visible `AcceptanceDecision` with `decision: "accepted"` for that claim;
3. no visible rejection for the same claim;
4. no visible supersession, erasure, protected-value denial, trust-zone denial,
   lifecycle exclusion, authority exclusion, valid-time exclusion, or
   recorded-time exclusion that blocks fact eligibility.

Draft claims, rejected claims, conflicted claims, superseded claims, erased
records, hidden records, and protected-policy-denied records MUST NOT be
promoted into `accepted_facts`. They remain visible only in their corresponding
context-pack sections when authorization permits.

## Capture and Draft Claims

`memory_capture` stores local client-provided evidence or observations through
the existing capture core. Duplicate delivery uses idempotency replay
semantics.

`memory_propose_claim` is bitemporal:

- `valid_time` describes when the proposed statement applies in the modeled
  domain;
- `recorded_time` is assigned by the local-store write clock and is not
  caller-controlled.

When `valid_time` is omitted, the local store defaults `valid_time.start` to the
same instant used for the new `recorded_time.start` and sets `valid_time.end` to
`null`. Historical and future `valid_time` values are allowed when they pass
schema validation and trust-zone policy.

`memory_propose_claim` validates every support reference before writing. Unknown,
hidden, unauthorized, and cross-zone support references fail closed without
writing a partial claim.

## Failure Modes

| Failure mode | Required behavior |
| --- | --- |
| Provider hook missing provenance | Attach external provenance if available, or reject the event. |
| Duplicate hook delivery | Use idempotency replay semantics. |
| Agent omits visibility | Return safe authorization failure. |
| Agent requests forbidden trust zone | Return safe authorization failure before resolving content. |
| Protected value denied | Return metadata or redaction markers, not plaintext. |
| Context pack exceeds budget | Return bounded sections with `used`, `truncated`, and `omitted` metadata. |
| Capture extraction uncertain | Create observations or proposed claims, not accepted facts. |
| Draft claim support is not visible | Reject before writing. |
| MCP startup config missing | Fail startup without protocol output on stdout. |

## Synthetic Example

A generic coding hook submits a synthetic message artifact. The adapter stores
the transcript as an `EvidenceArtifact` with external provenance, extracts an
`Observation` with evidence references, proposes a `Claim` with support
references, and leaves acceptance to a later `AcceptanceDecision`. An MCP query
can retrieve the claim and its lineage, but it cannot treat the claim as an
accepted fact until a visible decision accepts it.
