# Design: HITL-free Agentic compound loop (restore original intent)

Status: **Design (proposed)** — implement only after external review + owner OK  
Date: 2026-08-07  
Normative ADR: [ADR 0018](../adr/0018-agentic-hitl-free-compound-loop.md)  
Related: [ADR 0017](../adr/0017-agentic-layer-write-time-knowledge.md), [PRD-v6](../PRD-v6.md)

## 1. Problem statement

Agentic Layer was added so CarpeOS could complete:

```text
session → capture → meaning → next agent uses it
```

**without a human in the loop.**

What shipped through 6.5.0 built most **machinery** but encoded **hold-first /
opt-in promote / manual run** as defaults. That makes HITL load-bearing for
value — which the product owner rejects as existential failure.

This design restores the original product contract **before further feature work**.

## 2. Goals

1. **Unattended compound:** clean extracts become default-searchable without human promote.
2. **Always-on brain:** post-capture processing runs without typing `agentic run` each time.
3. **Agent-first consumption:** MCP/CLI defaults return those units.
4. **Keep hard fences:** no capture LLM; Flash-only; no auto `AcceptanceDecision`.
5. **Human = correction only:** promote-held / accept-claim are not the happy path.

## 3. Non-goals

- Auto `AcceptanceDecision`
- LLM inside capture
- Multi-model escalation
- Hosted graph as SoT
- Replacing adj_v3 golden suite overnight
- Perfect entity ER / free-form related graph

## 4. Target product loop

```text
Host hooks (fail-open)
  → EvidenceArtifact + agentic_capture_feed (no LLM)
  → post-capture runner (default ON after setup; kill: CARPEOS_AGENTIC=off)
       E1 admit → E2 pack → E3/E4 (fake|Flash) → E5 verify
       → E7 gate promote-when-clean → E8 active Observation (+ optional claim)
       → E9 retrieval/graph rebuild
  → MCP / CLI default search (promoted/active)
  → next agent session uses meaning

Optional human (not required for value):
  kill switch | reject bad unit | formal accept stamp | reconcile review
```

## 5. Behavioral changes (from 6.5.0)

| Area | Current (6.5) | Target |
| --- | --- | --- |
| Gate default | hold unless `--allow-auto-promote` | **promote-when-clean** |
| CLI run | auto-promote off | **auto-promote on** (or flag removed) |
| Materialize promote | opt-in | **default for promote gate** |
| fact_candidate | draft Claim only (often non-default search) | **usable Observation path** (Claim optional additive) |
| Runner | manual | **setup-installed / opportunistic drain** |
| Human CLI | presented as product path | **correction / observability** |
| AcceptanceDecision | human-only (keep) | human-only (keep); **not required for S1** |

## 6. Gate algorithm (promote-when-verified)

```text
if secret_like or injection → reject
if not quote ⊆ pack or no citations → reject
if statement not grounded in cited span(s) (E5 D3.1) → reject
if statement too short / invalid kind → reject
if kind in {decision, constraint, preference} and E5 verified → promote
if kind procedure → hold-biased (config later)
if kind fact_candidate → not in v1 allowlist (draft Claim only; not main path)
if kind open_question or need_context → hold side channel (must be listable) or explicit drop
else → reject
```

**Licensing corpus** (ADR D3.3) must pass under these defaults — not the
hint_kind/fake tautology suite alone.

## 7. Always-on runner (v1 proposal)

**Phase A (minimal, ship first):**

- On `carpeos` MCP server start and selected CLI commands that open the store,
  call `processAgenticOnce` with **bounded limit** and short timeout budget
  (e.g. max 3 jobs / 2s wall) fail-open.
- Document that long sessions still benefit from explicit `run` or scheduler.

**Phase B (product default for S3):**

- `carpeos setup` installs optional user-level timer (launchd on macOS / systemd
  user timer on Linux) for:
  `carpeos agentic run --once --materialize`
  every **30 minutes** when feed non-empty (skip if empty).
- Interval overridable via config later; v1 fixed 30m.
- Reverse with `setup` uninstall / hooks uninstall path.

Kill switches: `CARPEOS_AGENTIC=off`, spend caps, network off.

## 8. Retrieval

- No schema break required if promote writes **active Observation**.
- GraphRAG typed boosts already favor active meaning units — align materialize.
- Verify MCP default tools do not require include_held for S2.

## 9. Key Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| KD1 HITL | Not load-bearing | Product existence criterion |
| KD2 Gate default | **Promote-when-verified** | Closes loop without human; E5 must ground statement |
| KD3 AcceptanceDecision | Still never auto | Epistemic stamp ≠ usable meaning |
| KD4 Decision path | Observation-primary dual-write | fact_candidate not v1 allowlist |
| KD5 Always-on | Timer (or capture-complete drain) for S3 | Opportunistic-only is not S3 |
| KD6 Escape | Hold-first debug flag | Preserve staging for tests/debug |
| KD7 Retraction | Required with flip | Correction without load-bearing HITL on happy path |
| KD8 Suite | Non-tautological licensing corpus | Must stress gate under production defaults |

## 10. Open Questions (for owner if needed)

1. Should `procedure` auto-promote or stay hold-biased?
2. Phase A only (opportunistic) vs require Phase B timer in same release?
3. Live Flash on always-on path: still network-off default (recommended) or
   setup-prompt for key + cap?

**Recommendation:** procedure hold-biased; ship Phase A + promote defaults first;
network-off default remains.

## 11. PR Plan (revised after Opus + Codex reviews)

Safe work lands **under current hold-first defaults** first; flip is last.

| PR | Title | Scope | Depends |
| --- | --- | --- | --- |
| PR1 | `docs(adr): 0018 HITL-free agentic compound loop` | ADR 0018, this plan, reviews, PRD-v6 north-star patch | — |
| PR2a | `feat(agentic): E5 statement grounding + adversarial fixtures` | verify.ts, stages contract, tests | PR1 |
| PR2b | `feat(agentic): non-tautological licensing corpus` | recorded-Flash or gate-reaching negatives; no hint_kind positives only | PR1 |
| PR2c | `feat(local-store): retract promoted unit + agentic formation audit` | demote/supersession-class writer; marker on agentic units | PR1 |
| PR2d | `feat(agentic): day spend cap + triage-gated extract + feed lease` | flash spend persistence; runner; feed concurrency | PR1 |
| PR3 | `feat(agentic): promote-when-verified default flip` | gate/CLI/materialize defaults; migration backlog bound | PR2a–2d |
| PR4 | `feat(agentic): decision Observation-primary dual-write clarity` | materialize targets; fact_candidate stays non-allowlist | PR3 |
| PR5 | `feat(setup): always-on timer (S3 honest)` | setup install/uninstall; docs | PR3 |
| PR6 | `docs: human tools are correction-only` | README, help, DoD | PR3 |

Each PR: `make preflight`, labels, English public text.

## 12. Test plan

- Unit: gate promote-when-clean without opt-in flag.
- Golden-12 / precision: pass under new defaults; must_not still 0 leaks.
- Integration: capture → processAgenticOnce → default search contains unit **without** promote-held.
- Negative: secret/noise still reject; no AcceptanceDecision from runner.
- Always-on: opportunistic drain does not block capture; respects kill switch.

## 13. Rollback

- Feature flag `CARPEOS_AGENTIC_HOLD_FIRST=1` restores pre-0018 staging defaults.
- Timer uninstall via setup.
- Minor version; no schema migration required if Observation-primary.

## 14. Why previous attempts failed (honest)

1. ADR 0017 literally said hold-first default → implementers optimized for ADR text.
2. Safety theater (staging everything) was treated as product completion.
3. Success measured by suites/CLI surface, not unattended compound.
4. Human review tools were expanded when the real gap was **default path autonomy**.

This design measures success only by **S1–S6 in ADR 0018**.
