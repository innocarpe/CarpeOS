# V6 milestone tracker (maintainers)

Status truth table for CarpeOS 6.0.0 Agentic Layer. Update only with test/receipt evidence.  
**Model: DeepSeek V4 Flash (`deepseek-v4-flash`) only.**

| Milestone | Exit criteria | Evidence | Status |
| --- | --- | --- | --- |
| **V6-P0** Architecture freeze | ADR 0017 + PRD-v6 + DoD + architecture + scaffold + golden skeleton | docs + `packages/agentic` + golden-12; PR #265 scaffold on main | **complete** |
| **V6-P1** Proposal jobs | Durable jobs E1–E5; proposals `canonical_effect: none`; fake default | unit/integration tests (P1a job store landed; E1–E5 stages in progress) | in progress |
| **V6-P2** Hold materialize | draft Observation + `agentic_v1` hold; human promote | CLI + store tests | pending |
| **V6-P3** Narrow auto-promote | allowlist + E5 + precision ≥ 0.90 | eval receipt | pending |
| **V6-P4** Link / graph density | provenance edges → meaning_unit graph uplift | graph metrics test | pending |
| **V6-P5** Draft Claims | decision/fact_candidate drafts; accept = 0 auto | Claim fixtures | pending |
| **V6-P6** GraphRAG ranking | typed promoted units in ranking path | offline query set | pending |
| **npm 6.0.0** | major surface + activation | release skill | pending |

## Hard fences

- Capture: no LLM/network/agentic await
- Real model id: **only** `deepseek-v4-flash`
- No automatic AcceptanceDecision
- adj_v3 remains comparison + noise prefilter
- V5 package remains draft cortex; agentic owns promotion bridge

## Operator commands (future)

```sh
# planned — not all implemented at P0
carpeos agentic status
carpeos agentic run --once          # process job backlog offline/fake
carpeos agentic run --allow-network # Flash live; spend cap required
carpeos adjudicate list-held
```

## Recompute / eval

```sh
pnpm --filter @carpeos/agentic test
# golden-12 under fixtures/agentic/v1/golden-12/
```
