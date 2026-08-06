# Product 6 ultragoal handoff (loop engineering)

**Audience:** ultragoal / multi-agent implementation loop  
**Do not start coding product stages until P0 artifacts below are on `main`.**

## Frozen decisions

1. **ADR 0017** — Agentic Layer write-time knowledge  
2. **Model:** `deepseek-v4-flash` **only** (no multi-model escalation in 6.0)  
3. **Capture:** never LLM  
4. **Gate:** hold-first `agentic_v1`; narrow auto-promote only after E5 + precision suite  
5. **V5:** cortex primitives; not production orchestrator  

## Repo map

| Artifact | Path |
| --- | --- |
| ADR | `docs/adr/0017-agentic-layer-write-time-knowledge.md` |
| PRD | `docs/PRD-v6.md` |
| DoD | `docs/maintainers/product-6.0.0.md` |
| Milestones | `docs/maintainers/v6-milestones.md` |
| Architecture | `docs/architecture/agentic-layer.md` |
| Overview | `docs/architecture/overview.md` (6.0 boundary) |
| Package | `packages/agentic/` |
| Golden-12 | `fixtures/agentic/v1/golden-12/manifest.json` |

## Ultragoal suggested work packages (atomic PR order)

1. **P1a** — Job store + lease state machine + digests (no LLM)  
2. **P1b** — E1 admit + E2 pack wiring (reuse `@carpeos/v5`)  
3. **P1c** — E3/E4 Flash adapters (fake default; Flash when `--allow-network`)  
4. **P1d** — E5 verify + proposal records only  
5. **P2a** — Materialize draft Observation + disposition `agentic_v1` hold  
6. **P2b** — CLI `carpeos agentic status|run` + human promote integration  
7. **P3** — Allowlist auto-promote + precision suite gate  
8. **P4–P6** — links, draft Claims, ranking  

## Loop rules

- One semantic PR per work package; Conventional Commits; kind labels.  
- `pnpm check` before every PR.  
- Never put secrets in fixtures; golden text is public-safe only.  
- Do not invent AcceptanceDecision automation.  
- Do not re-open Flash-only model freeze without a new ADR.  

## Definition of “ultragoal done” for first vertical slice

See golden-12 + product-6.0.0 P2 exit: cited hold/promote Observations for
SessionEnd decisions; zero noise actives; replay idempotent; agentic-off works.

## Related reviews (session evidence)

- Architect (Opus-class): hold-first, E5 mandatory, authority plane split  
- Codex (gpt-5.6-sol): conditional PASS; durable jobs; `@carpeos/agentic` plane  
