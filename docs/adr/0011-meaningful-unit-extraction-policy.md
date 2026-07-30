# ADR 0011: Meaningful-unit extraction policy

Status: Accepted for product 1.0 MVP

## Context

CarpeOS capture stores lifecycle hooks as encrypted raw payloads plus
`EvidenceArtifact` metadata (`docs/adr/0005-local-capture-outbox.md`). Retrieval
already projects **existing** Observation / Claim / AcceptanceDecision events
into chunks (`docs/adr/0007-embedding-hybrid-retrieval.md`,
`packages/retrieval` policy `meaningful_units_only`).

Product 1.0 requires Evidence → **Observation and/or Claim** extraction so that
search and context-pack return meaningful units, not only artifact metadata
([product-1.0.0.md](../maintainers/product-1.0.0.md)).

Without an explicit policy:

- PostToolUse noise would flood extraction and embeddings;
- extractors might invent accepted facts;
- statement/chunk text might leak secrets that belong only in protected storage.

## Decision

### 1. Capture vs extraction

| Layer | Responsibility |
| --- | --- |
| **Capture** | May record selected host hooks as EvidenceArtifact (encrypted raw) |
| **Extraction** | Reads eligible evidence and appends Observation and/or **draft** Claim |
| **Acceptance** | Only via separate `AcceptanceDecision` (human/MCP); never auto |

Adapter templates may still fire PostToolUse for **capture**. Default policy
**excludes PostToolUse from extraction**.

### 2. Default lifecycle allowlist (extraction)

| Hook event | Extraction default | Rationale |
| --- | --- | --- |
| `Stop` | **ON** | End-of-turn boundary; high signal |
| `SessionEnd` | **ON** | Session boundary summary |
| `PreCompact` | **ON** | Context about to be lost |
| `UserPromptSubmit` | **ON** | User intent as Observation only |
| `SessionStart` | **OFF** | Low knowledge density |
| `PostToolUse` | **OFF** | Tool I/O noise; opt-in via `post_tool_use: "on"` |

Optional Codex notify `agent-turn-complete` is not in the default list; callers
may add it to `enabled_hook_events`.

### 3. Observation vs Claim (MVP)

| Unit | Default role | Required links | Auto rules |
| --- | --- | --- | --- |
| **Observation** | Preferred auto output | ≥1 `evidence_artifact_refs` | Default when eligible |
| **Claim (draft)** | Assertive + support | ≥1 `support` provenance | Only if `allow_auto_claim` and confidence ≥ threshold (default 0.85) |
| **AcceptanceDecision** | Accept / reject / review | n/a | **Never** from extractor |

Product default: `allow_auto_claim: false` → Observation-only MVP. Claims remain
available via MCP `memory_propose_claim` and a later opt-in auto path.

### 4. Privacy for statement / chunk text

Extracted statement text and retrieval chunk bodies derived from extraction
MUST NOT contain:

- protected-field names / raw payload markers (`ciphertext`, `plaintext`,
  `raw_payload`, `transcript_secret`, `local-aes256.key`);
- common credential shapes (API keys, Bearer tokens, PEM private keys, etc.).

Raw transcripts stay encrypted in the local store. Metadata-only
`evidence_excerpt` projection remains secondary to meaningful units.

### 5. Code SSOT

Machine-readable defaults and helpers live in:

`packages/capture/src/meaningful-unit-policy.ts`

| Export | Role |
| --- | --- |
| `DEFAULT_MEANINGFUL_UNIT_POLICY` | Product defaults |
| `isHookEligibleForExtraction` | Lifecycle gate |
| `recommendExtractionTarget` | `none` \| `observation` \| `claim_draft` |
| `containsSecretLikeMaterial` / `assertSafeMeaningfulUnitText` | Privacy gate |
| `OBSERVATION_VS_CLAIM_MVP` | Documented rules object |

Future extractors (G004+) MUST import these rather than duplicating defaults.

## Consequences

- Extractor implementations become policy-driven and testable without LLM.
- Capture templates need not drop PostToolUse for 1.0; extraction stays quiet.
- Epistemic model (ADR 0002) is preserved: no auto-acceptance.
- Operators can opt into PostToolUse extraction or auto claim drafts via config
  overrides without changing the ADR.

## Related

- [ADR 0002: Immutable epistemic model](0002-immutable-epistemic-model.md)
- [ADR 0005: Local capture outbox](0005-local-capture-outbox.md)
- [ADR 0007: Embedding hybrid retrieval](0007-embedding-hybrid-retrieval.md)
- [Product 1.0.0 DoD](../maintainers/product-1.0.0.md)
- Spec: [capture-and-mcp.md](../../spec/v1/capture-and-mcp.md)
