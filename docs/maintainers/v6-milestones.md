# V6 milestone tracker (maintainers)

Status truth table for CarpeOS 6.0.0 Agentic Layer. Update only with test/receipt evidence.  
**Model: DeepSeek V4 Flash (`deepseek-v4-flash`) only.**

| Milestone | Exit criteria | Evidence | Status |
| --- | --- | --- | --- |
| **V6-P0** Architecture freeze | ADR 0017 + PRD-v6 + DoD + architecture + scaffold + golden skeleton | docs + `packages/agentic` + golden-12; PR #265 scaffold on main | **complete** |
| **V6-P1** Proposal jobs | Durable jobs E1–E5; proposals `canonical_effect: none`; fake default | unit tests jobs/admit/pack/stages/pipeline; stacked PRs #267–#270 | **complete** (offline) |
| **V6-P2** Hold materialize | draft Observation + `agentic_v1` hold; human promote | materialize tests + `carpeos agentic status\|run\|golden`; golden-12 offline green | **complete** (hold-first; no auto-promote) |
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

## Operator commands

```sh
carpeos agentic status
carpeos agentic run --once --text "Decision: …"   # offline fake pipeline
carpeos agentic run --once --golden               # golden-12 offline
carpeos agentic golden                            # same corpus eval
# Live Flash remains operator-gated (network off by default in this slice).
carpeos adjudicate list-held                      # human review of holds (adj path)
# Kill switch:
CARPEOS_AGENTIC=off carpeos agentic run --once --text "…"
```

## Recompute / eval

```sh
pnpm --filter @carpeos/agentic test
# golden-12 under fixtures/agentic/v1/golden-12/ (offline, network_used=false)
```
