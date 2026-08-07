# Product 6.0.0 — Definition of Done (maintainers)

Status: **Product 6 major thesis complete through `@innocarpe/carpeos@6.6.0`;
quality plane closed through `@innocarpe/carpeos@6.7.7`.**

- **6.0.0** — hold-first Agentic Layer (P0–P2 product loop)
- **6.1–6.4** — P3 precision, P4 links, P5 draft Claims, P6 GraphRAG
- **6.5.0** — E10 reconcile + human correction surface + feed backfill
- **6.6.0** — **HITL-free promote-when-verified** (ADR 0018): E5 grounding,
  licensing corpus, retract, day spend, feed lease, 30m timer
- **6.7.0–6.7.7** — **agentic quality ultragoal closed** (prepared pack +
  redaction + line-scoped admit + transcript recovery + CJK + provenance filter +
  triage/extract v2 + cite belt + corpus DoD + Q-S5 metrics + near-dup + denser
  host adapters; policy **`agentic_v1.1`**)

Base package: multi-host setup + V5 draft lane + Product 6 agentic compound loop.

**Model freeze:** DeepSeek Direct **`deepseek-v4-flash` only** for all real LLM stages.

## Thesis

Post-capture Agentic Layer forms **grounded, typed, graph-linked knowledge** under
`agentic_v1` gates — so CarpeOS is a knowledge store, not a session log silo —
**without required human-in-the-loop** on the happy path (ADR 0018).

## Relationship to 5.x

| 5.x | 6.x |
| --- | --- |
| V5 draft-only cortex | Consumed as primitives; not promotion authority |
| adj_v3 rule promote/hold/reject | Prefilter + baseline; not sole brain |
| Multi-host capture | Unchanged sensory plane |
| Claims ≈ 0, weak Observations | Explicit goal: cited Observations + optional draft Claims |

## Phases (P0–P6 + residuals)

| Phase | Exit | Evidence |
| --- | --- | --- |
| **P0** Prep | ADR + PRD + milestones + architecture + package scaffold + golden-12 | docs / scaffold |
| **P1** Proposals | Jobs + E1–E5; sidecar proposals only | `@carpeos/agentic` tests |
| **P2** Hold materialize | draft Observation + agentic_v1 hold + human promote | CLI materialize (staging era) |
| **P3** Narrow auto-promote | precision suite ≥ 0.90; allowlist kinds | 6.1.0 |
| **P4** Links | provenance edges densify meaning graph | 6.2.0 |
| **P5** Draft Claims | fact_candidate/decision draft Claims; accept still human | 6.3.0 |
| **P6** GraphRAG ranking | typed promoted units improve retrieval | 6.4.0 |
| **E10 + human + backfill** | reconcile; human accept/promote; history feed | 6.5.0 |
| **HITL-free flip** | promote-when-verified + retract + timer + day spend | **6.6.0** |
| **Quality ultragoal** | usable promote density + offline corpus DoD + residual polish | **6.7.7** |

## Code DoD (6.6.0 complete product claim)

- [x] ADR 0017 planes E0–E10 on npm
- [x] ADR 0018 promote-when-verified defaults
- [x] E5 statement grounding + adversarial fixtures
- [x] Offline licensing-promote corpus (no hint_kind-only positives)
- [x] Human retract via append-only Supersession
- [x] Persistent day spend + triage-gated extract + feed lease
- [x] 30m always-on timer install/uninstall
- [x] Capture path still has **zero** LLM calls
- [x] No automatic AcceptanceDecision from runner
- [x] `CARPEOS_AGENTIC=off` / hold-first escape
- [x] CHANGELOG `[6.6.0]` honest
- [x] Local activation of exact `@innocarpe/carpeos@6.6.0`

## Quality plane DoD (6.7.7)

- [x] Prepared pack + effective Flash views; default report redaction
- [x] Line-scoped admit; live no-fake; Flash timeout/requeue
- [x] Transcript recovery (agentic mode); CJK/NFC grounding
- [x] Provenance quality filter; triage/extract v2 + cite clamp
- [x] Quality corpus baseline #2 exact-expect green (Q-S1–S3, S7–S9, S13)
- [x] Q-S5 advisory metrics helper + N≥30 / meta 0 receipt
- [x] Near-dup hold (within-pack + recent zone); denser host adapters
- [x] Architecture notes: [agentic-quality.md](../architecture/agentic-quality.md)
- [x] Local activation of exact `@innocarpe/carpeos@6.7.7`

## Hard fences

- No LLM in capture transaction
- No multi-model escalation (Flash-only)
- No automatic AcceptanceDecision
- No silent OpenRouter/other fallback
- schema-v1 core event types

## Operator surface (6.6)

```sh
carpeos agentic status
carpeos agentic run --once --materialize
carpeos agentic timer install|uninstall|status
carpeos agentic retract --event-id evt_… --reason "…" --decided-by human --human-confirmed
# Live Flash (optional):
DEEPSEEK_API_KEY=… carpeos agentic run --once --allow-network --spend-cap-usd 1
# Kill / staging:
CARPEOS_AGENTIC=off …
CARPEOS_AGENTIC_HOLD_FIRST=1 carpeos agentic run --once --materialize
```

## Residuals (honest)

- Procedure auto-promote still hold-biased (config later)
- Live Flash remains network opt-in (timer defaults network-off)
- Hosted graph/vector not claimed
- Live recorded-Flash licensing corpus (CI stays offline fake)
- Q-S5 wall-clock “real sessions for 7 days” remains operator habit (numeric floor shipped)

## Related

- [ADR 0017](../adr/0017-agentic-layer-write-time-knowledge.md)
- [ADR 0018](../adr/0018-agentic-hitl-free-compound-loop.md)
- [PRD-v6](../PRD-v6.md)
- [architecture/agentic-layer.md](../architecture/agentic-layer.md)
- [architecture/agentic-quality.md](../architecture/agentic-quality.md)
- [v6-milestones.md](v6-milestones.md)
- [product-5.0.0.md](product-5.0.0.md)
