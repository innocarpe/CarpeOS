# Memory Capacity Architecture

Status: accepted architecture note for capacity axes; feature status varies by
story in the master plan.

This note explains how CarpeOS stores, activates, and projects knowledge. It
implements ADR 0009.

## Layers

```text
L1 Store capacity          CanonicalEvent + protected values
        |
        v  (rebuild)
L4 Product projections     retrieval, Obsidian, OpenLoop, compaction, summaries
        |
        v  (activate)
L2 Working memory          context packs, search hits, host LLM window
        ^
        |
L3 Procedural memory       procedure-trace evidence (protected), optional summaries
```

### L1 — Store capacity

- Append-only events in a physical trust zone.
- Protected plaintext lives outside canonical rows.
- Erasure is ledgered; projections rebuild to apply it.
- Total capacity grows with capture, not with context-pack size.

### L2 — Working memory

- `memory_context_pack`, `memory_search`, and related MCP tools.
- Hard limits: `ContextBudget.max_items`, `ContextBudget.max_characters`.
- Soft structure: expert-slot allocation and diversity caps (program M2/M5/M6).
- Host LLM session window is outside CarpeOS process control; CarpeOS only
  supplies a deterministic bounded projection.

### L3 — Procedural memory

- Agent thinking and tool histories captured for continuity and audit.
- Represented as evidence-class captures with procedure-trace metadata.
- Never auto-writes `AcceptanceDecision`.
- Default pack inclusion is summarized and policy-gated.

### L4 — Product memory

- Rebuildable, non-authoritative outputs.
- Includes retrieval chunks/indexes, Obsidian notes, OpenLoop/dashboard views,
  compaction ledgers, and future graph views.
- Safe to delete and rebuild from L1 (+ erasure ledger).

## Total vs active capacity

| Axis | Definition | Operator question |
| --- | --- | --- |
| Total | Visible L1 under zone/erasure filters | How much private knowledge exists? |
| Active | L2 admission after budget + routing + recheck | What should the agent load now? |

A healthy system can have large total capacity and small active capacity. That
is intentional sparse activation, analogous to MoE top-k expert selection.

## Epistemic residual selection

When assembling working memory, CarpeOS selects across epistemic depth rather
than concatenating all text:

1. Accepted facts with acceptance lineage.
2. Conflicts, supersessions, and review gaps that prevent false certainty.
3. Observations and evidence pointers that support or challenge.
4. Procedure summaries only when needed for resume or tool continuity.

This is the product analogue of selective residual pathways: do not accumulate
uniformly; re-query what matters under policy.

## Multi-resolution units

Retrieval and packs SHOULD prefer compact resolutions:

| Resolution | Typical payload |
| --- | --- |
| R0 | identifiers and kinds |
| R1 | embedding vectors |
| R2 | statement / short summary |
| R3 | full visible text or protected reference |

Default pack text is R2-class. Escalation to R3 requires budget and
protected-value policy.

## Compaction

When active working memory would exceed budgets or host windows, compaction
produces L4 summary projections with pointers back to L1. Compaction does not
mutate claims or acceptance.

## Long-horizon runs

Multi-hour agent work uses a run ledger projection linking rounds to event and
artifact ids. The ledger is not a sixth core `event_type` in v1.

## Frontier models as consumers

Open-weight or API frontier models (including Kimi K3-class agents) may consume
CarpeOS through MCP or CLI. They provide parametric skill and session reasoning.
CarpeOS remains the private hippocampus and epistemic control plane.

## Status map

See `docs/plans/k3-memory-capacity-master-plan.md` for delivery stories M1–M10
and merge order. Features land only when their PR tests pass; this document
describes the target architecture.
