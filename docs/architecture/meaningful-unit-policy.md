# Meaningful-unit extraction policy

Status: product 1.0 MVP pointer (implementation lives in code + ADR).

CarpeOS separates:

1. **Capture** — lifecycle hooks → encrypted raw + `EvidenceArtifact`
2. **Extraction** — eligible evidence → `Observation` and/or draft `Claim`
3. **Retrieval projection** — existing O/C/D → chunks (`meaningful_units_only`)

## Defaults (summary)

- **Extract:** `Stop`, `SessionEnd`, `PreCompact`, `UserPromptSubmit`
- **Do not extract by default:** `PostToolUse`, `SessionStart`
- **Prefer Observation**; auto Claim drafts off (`allow_auto_claim: false`)
- **Never** auto-accept claims
- **No secrets** in statement/chunk plaintext

## Source of truth

| Artifact | Path |
| --- | --- |
| ADR | [docs/adr/0011-meaningful-unit-extraction-policy.md](../adr/0011-meaningful-unit-extraction-policy.md) |
| Config / helpers | `packages/capture/src/meaningful-unit-policy.ts` |
| Spec link | [spec/v1/capture-and-mcp.md](../../spec/v1/capture-and-mcp.md) |
| Product DoD | [docs/maintainers/product-1.0.0.md](../maintainers/product-1.0.0.md) |

Future extractors (G004+) must import `isHookEligibleForExtraction`,
`recommendExtractionTarget`, and `assertSafeMeaningfulUnitText` rather than
redefining allowlists.
