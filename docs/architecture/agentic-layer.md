# Agentic Layer architecture (Product 6)

Status: **implemented architecture** for `@carpeos/agentic` (ADR 0017) through P6 on npm
`6.4.0`; E10 reconcile + human accept/promote + feed backfill land with 6.5.0.

## Why this layer exists

CarpeOS already unifies **capture** into a local event store. Without a
**write-time brain**, the store stays sensory (Evidence flood). The Agentic
Layer turns post-capture evidence into **typed, cited, graph-linked knowledge
candidates** under a deterministic gate.

## Position in the system

```text
┌─────────────────────────────────────────────────────────────┐
│ Hosts: Claude / Codex / Grok / GJC / Deep Code / Reasonix / │
│        DeepSeek Build                                       │
└───────────────────────────┬─────────────────────────────────┘
                            │ fail-open hooks (no LLM)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Local capture → protected EvidenceArtifact + metadata       │
│ adj_v3 (optional extract path): cheap noise reject          │
└───────────────────────────┬─────────────────────────────────┘
                            │ commit complete
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ @carpeos/agentic  (NEW)                                     │
│  durable jobs · Flash multi-stage · agentic_v1 gate         │
│  reuses @carpeos/v5 redact/pack/provider (Flash only)       │
└───────────────────────────┬─────────────────────────────────┘
                            │ typed writer
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Canonical store: Observation / draft Claim / dispositions   │
└───────────────────────────┬─────────────────────────────────┘
                            │ rebuild
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Projections: retrieval · graph_v2 · vectors · MCP · OKF     │
└─────────────────────────────────────────────────────────────┘
```

## Authority rules

| Component | May do | Must not do |
| --- | --- | --- |
| Capture | Write Evidence | Call LLM; await agentic |
| `@carpeos/v5` | Redact, pack, Flash I/O, draft proposals | Promote to default retrieval alone |
| Agentic gate | Hold / narrow promote Observations; draft Claims | Auto AcceptanceDecision; LLM supersede |
| Graph/vector | Project meaning | Create acceptance |

## Model policy

- **Only** `deepseek-v4-flash` for real network calls.
- Stages differ by **prompt/schema**, not by model shopping.
- Fake provider for CI and network-off default.
- Spend caps and kill switches (patterns from V5).

## Job model

- Sidecar table/store (not sync outbox).
- States: `pending | leased | succeeded | blocked | dead`.
- Idempotency digests per stage (pack, prompt, model, policy).
- At-least-once delivery; once effects via canonical keys.

## Stage graph

See ADR 0017 D5. Critical path:

1. Rule admit  
2. Redact+pack  
3. LLM triage (Flash)  
4. LLM extract (Flash)  
5. **Deterministic verify**  
6. Optional structure/link (Flash)  
7. Gate `agentic_v1`  
8. Materialize  
9. Project  

## Ontology and graph

Kinds and edges: ADR 0017 D7–D8.  
Graph remains rebuildable projection (`graph_v2`); denser `meaning_unit` nodes
are the signal of success.

## Failure and off switches

| Switch | Effect |
| --- | --- |
| Network off | Fake stages; no provider egress |
| Agentic-off | No jobs; capture+adj_v3 only |
| Kill spend | Stop leasing LLM stages |
| V5-off | No draft cortex calls if agentic depends on them |

## Implementation map (ultragoal)

| Concern | Package / path |
| --- | --- |
| Jobs + orchestrator | `packages/agentic` |
| Redact/pack/LLM I/O | `packages/v5` (reuse) |
| Canonical append | `packages/local-store` writers only |
| Rule admit | `packages/capture` adj feed |
| Graph/retrieval | `packages/retrieval` rebuild |
| CLI | `apps/carpeos-cli` `agentic` subcommands (future) |
| Golden fixtures | `fixtures/agentic/v1/golden-12/` |

## Related

- [ADR 0017](../adr/0017-agentic-layer-write-time-knowledge.md)
- [overview.md](overview.md)
- [PRD-v6](../PRD-v6.md)
