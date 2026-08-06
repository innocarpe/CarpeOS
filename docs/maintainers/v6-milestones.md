# V6 milestone tracker (maintainers)

Status truth table for CarpeOS 6.0.0 Agentic Layer. Update only with test/receipt evidence.  
**Model: DeepSeek V4 Flash (`deepseek-v4-flash`) only.**

| Milestone | Exit criteria | Evidence | Status |
| --- | --- | --- | --- |
| **V6-P0** Architecture freeze | ADR 0017 + PRD-v6 + DoD + architecture + scaffold + golden skeleton | docs + `packages/agentic` + golden-12; PR #265 scaffold on main | **complete** |
| **V6-P1** Proposal jobs | Durable jobs E1–E5; proposals `canonical_effect: none`; fake default | unit tests + feed/runner product loop on main | **complete** |
| **V6-P2** Hold materialize | draft Observation + `agentic_v1` hold; human promote | materialize + CLI list-held/materialize; golden-12 green | **complete** (hold-first) |
| **V6-P3** Narrow auto-promote | allowlist + E5 + precision ≥ 0.90 | precision suite offline; `carpeos agentic precision` | **complete** (offline suite) |
| **npm 6.1.0** | P3 ship | precision suite + CLI; npm+tag+local activate | **complete** |
| **V6-P4** Link / graph density | provenance edges → meaning_unit graph uplift | graph metrics test + `carpeos agentic graph-metrics` | **complete** |
| **V6-P5** Draft Claims | decision/fact_candidate drafts; accept = 0 auto | Claim fixtures + materialize tests | **complete** |
| **V6-P6** GraphRAG ranking | typed promoted units in ranking path | offline query set | pending |
| **npm 6.0.0** | major surface + activation | hold-first cut + major-release-surface | **complete** |
| **npm 6.1.0** | P3 narrow auto-promote | precision suite receipt | **complete** |
| **npm 6.2.0** | P4 link / graph density | structure edges + density metrics; npm+tag+local activate | **complete** |
| **npm 6.3.0** | P5 draft Claims | fact_candidate/decision draft Claims; zero auto AcceptanceDecision; npm+tag+local activate | **shipping** |

## Hard fences

- Capture: no LLM/network/agentic await
- Real model id: **only** `deepseek-v4-flash`
- No automatic AcceptanceDecision
- adj_v3 remains comparison + noise prefilter
- V5 package remains draft cortex; agentic owns promotion bridge

## Operator commands

```sh
carpeos agentic status
# Product path: capture writes feed (no LLM) → runner drains:
carpeos agentic run --once --materialize
carpeos agentic list-held
carpeos agentic materialize --proposal-id <id> --artifact-id <id>
carpeos agentic run --once --golden
# Live Flash (operator only):
DEEPSEEK_API_KEY=… carpeos agentic run --once --allow-network --spend-cap-usd 1
# Kill switch (skips capture feed + runner):
CARPEOS_AGENTIC=off carpeos capture-hook …
```

## Recompute / eval

```sh
pnpm --filter @carpeos/agentic test
# golden-12 under fixtures/agentic/v1/golden-12/ (offline, network_used=false)
```
