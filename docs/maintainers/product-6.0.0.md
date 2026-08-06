# Product 6.0.0 — Definition of Done (maintainers)

Status: **P2 hold-first product loop on main; npm still `@innocarpe/carpeos@5.0.1` until release cut**  
Base package today: `@innocarpe/carpeos@5.0.1` (multi-host setup + V5 draft lane + agentic plane in monorepo).

**Model freeze:** DeepSeek Direct **`deepseek-v4-flash` only** for all real LLM stages.

## Thesis

Post-capture Agentic Layer forms **grounded, typed, graph-linked knowledge** under
`agentic_v1` gates — so CarpeOS is a knowledge store, not a session log silo.

## Relationship to 5.x

| 5.x | 6.0 |
| --- | --- |
| V5 draft-only cortex | Consumed as primitives; not promotion authority |
| adj_v3 rule promote/hold/reject | Prefilter + baseline; not sole brain |
| Multi-host capture | Unchanged sensory plane |
| Claims ≈ 0, weak Observations | Explicit goal: draft Claims + cited Observations |

## Phases (P0–P6)

| Phase | Exit | Evidence |
| --- | --- | --- |
| **P0** Prep | ADR + PRD + milestones + architecture + package scaffold + golden-12 skeleton | this tree / docs PRs |
| **P1** Proposals | Jobs + E1–E5; sidecar proposals only | `@carpeos/agentic` tests; no LLM Observation yet |
| **P2** Hold materialize | draft Observation + agentic_v1 hold + human promote | CLI/MCP review path |
| **P3** Narrow auto-promote | precision suite ≥ 0.90; allowlist kinds | eval receipt |
| **P4** Links | provenance edges densify meaning graph | graph rebuild metrics |
| **P5** Draft Claims | fact_candidate/decision draft Claims; accept still human | Claim count > 0 draft-only |
| **P6** GraphRAG ranking | typed promoted units improve retrieval judgments | offline query set |

## Code DoD (minimum for npm `6.0.0` major claim)

A honest 6.0.0 cut requires **at least P2 complete** plus:

- [x] ADR 0017 coded planes for E1–E5 + E7–E8 + feed/runner (E6 lineage markers; E9 hook; E10 deferred)
- [x] `@carpeos/agentic` durable jobs + Flash-only live path (`callAgenticFlash` / `--allow-network`)
- [x] Capture path still has **zero** LLM calls (feed insert only; fail-open)
- [x] Cite integrity on persist paths (E5 before proposal/materialize)
- [x] Golden-12 green in package tests
- [x] `agentic-off` / `agentic_feed: false` / `CARPEOS_AGENTIC=off` kill switches
- [ ] CHANGELOG `[6.0.0]` honest about residuals (auto-promote may still be P3+)
- [ ] Major release surface checker green for 6.0.0
- [ ] Local activation of exact `@innocarpe/carpeos@6.0.0`

**Preferred full thesis cut:** P3 green (narrow auto-promote) before calling 6.0
“brain shipped.” If shipping earlier, label as **hold-first brain** in CHANGELOG.

## Hard fences

- No LLM in capture transaction
- No multi-model escalation (Flash-only)
- No automatic AcceptanceDecision
- No silent OpenRouter/other fallback
- No inventing Product 4/5 acceptance for unrelated planes
- schema-v1 core event types; adj_v3 golden suite not casually broken

## Ultragoal / loop engineering prep

Front-loaded for one-shot implementation:

| Artifact | Path |
| --- | --- |
| ADR | `docs/adr/0017-agentic-layer-write-time-knowledge.md` |
| PRD | `docs/PRD-v6.md` |
| Milestones | `docs/maintainers/v6-milestones.md` |
| Architecture | `docs/architecture/agentic-layer.md` |
| Package scaffold | `packages/agentic/` |
| Golden skeleton | `fixtures/agentic/v1/golden-12/` |
| Handoff | `docs/plans/product6-ultragoal-handoff.md` |

## Validation commands (when implementing)

```sh
pnpm check
pnpm --filter @carpeos/agentic test
# offline only unless operator enables network:
# DEEPSEEK_API_KEY from ~/.carpeos private env — never commit
```

## Related

- [ADR 0017](../adr/0017-agentic-layer-write-time-knowledge.md)
- [PRD-v6](../PRD-v6.md)
- [product-5.0.0.md](product-5.0.0.md)
- [ADR 0016](../adr/0016-v5-draft-only-deepseek-primary.md)
