# ADR 0018 external review synthesis

Date: 2026-08-07  
Inputs:

- Claude Opus → `adr0018-review-claude-opus.md`
- Codex **gpt-5.4** xhigh → `adr0018-review-gpt56-sol.md`  
  (requested **gpt-5.6-sol**: Codex ChatGPT login returned “gpt-5.6 not supported”;
  highest available substitute used and labeled)

## Consensus

| Topic | Agreement |
| --- | --- |
| D1 HITL must not be load-bearing | **Accept** — this is the original Agentic Layer intent |
| Diagnosis (0017 D6 hold-first drift) | **Accept** |
| D2 usable meaning vs formal AcceptanceDecision | **Accept** |
| No capture LLM / Flash-only / no auto AcceptanceDecision | **Keep** |
| Default flip without stronger E5 | **Reject / block** |
| fact_candidate as main usable path | **Reject for v1 allowlist** |
| Always-on must honestly meet S3 | **Agree** — opportunistic-only is insufficient theater |

## Blocking items (must land before promote default flip)

From Opus (verified against code):

1. **E5 statement grounding** — today only quote⊆pack; statement can diverge under Flash.
2. **Non-tautological licensing suite** — golden-12 fake+hint_kind does not license flip.
3. **Retraction primitive** — no local demote of wrongly promoted active units.
4. **Migration bound** — do not mass-promote historical feed backlog unattended.

From Codex (gpt-5.4):

5. **Explicitly supersede 0017 fact_candidate sole-landing** for product visibility story.
6. **S3 vs Phase A mismatch** — timer or capture-complete drain required for S3 claim.

## Incorporated into ADR 0018 / plan (this revision)

- Renamed default to **promote-when-verified** with D3.1–D3.4.
- D4b retraction; formation audit marker.
- D3/D4 fact_candidate clarified (out of v1 allowlist; decision Observation-primary).
- D5 phased S3 honesty + day spend + triage-gated extract + first-run bound.
- PR plan reordered: prerequisites under hold-first, then single flip PR, then timer.

## Residual open questions for product owner

1. Accept **procedure hold-biased** (recommended) vs auto-promote?
2. Ship **timer in same minor as flip** vs flip+opportunistic first (S3 incomplete until timer)?
3. Existing install **consent** for behavior-change minor (CHANGELOG + optional hold-first restore flag)?

## Verdict for implementation start

**Do not implement the default flip yet.**  
**Do implement PR1 (docs) + PR2a–2d (prerequisites)** after owner accepts this revised ADR.

Intent restoration: **yes, with safety checkers replacing load-bearing HITL** — not by deleting checks.
