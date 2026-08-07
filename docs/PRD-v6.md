# PRD v6 — CarpeOS 6.x (Agentic Layer)

Status: **Product 6 Agentic Layer shipped through `@innocarpe/carpeos@6.6.0`** —
P0–P6 machinery (6.0–6.4), complete topology residuals (6.5), and **HITL-free
promote-when-verified defaults** (6.6 / ADR 0018). Hard fences unchanged: no
capture LLM; no auto `AcceptanceDecision`; Flash-only for live stages.

Series: [PRD-v1](PRD-v1.md) · [PRD-v2](PRD-v2.md) · [PRD-v3](PRD-v3.md) ·
[PRD-v4](PRD-v4.md) · [PRD-v5](PRD-v5.md) · **PRD-v6**

---

## North-star (ADR 0018)

Agentic Layer exists so the product loop completes **without required
human-in-the-loop**:

```text
session → capture → verified usable meaning → next agent default retrieval
```

Early 6.x hold-first staging defaults made HITL load-bearing; **6.6.0 restores**
the original contract. Humans correct, audit, and kill — they are not required
for compound value.

## Version thesis

> **Can a post-capture Agentic Layer, driven only by DeepSeek V4 Flash, form
> grounded, typed, graph-linked knowledge units under a deterministic gate —
> without LLM in capture and without automatic AcceptanceDecision — so that
> CarpeOS becomes a true unified knowledge store (not a session log dump)?**

| | 5.0 | **6.x** |
| --- | --- | --- |
| Question | Can LLM drafts stay non-canonical? | **Can a brain form meaning at write time?** |
| Core engine | draft extract sandbox (`@carpeos/v5`) | **agentic jobs + Flash multi-stage + agentic_v1 gate** |
| Success signal | offline contracts + draft CLI | **cited active Observations + denser meaning graph + retrieval usefulness** |
| Failure if skipped | privacy leak / false authority from drafts | **eternal sensory store; GraphRAG on noise** |

---

## Problem

1. Multi-host capture works; Evidence volume is high; **meaning density is low**.
2. `adj_v3` is necessary but not sufficient as a brain (rules, not understanding).
3. Product 5 correctly isolated LLM drafts, but **did not connect** them to the
   knowledge thesis users need for GraphRAG / “like a brain.”
4. Without write-time typing and linking, later search only re-ranks residue.
5. Hold-first defaults re-introduced **ticket-system** HITL for value (fixed in 6.6).

---

## Goals

1. Post-capture **Agentic Layer** (`@carpeos/agentic`) with durable jobs.
2. **DeepSeek V4 Flash only** for all real LLM stages (cost freeze).
3. Multi-stage workflows (triage → extract → verify → structure/link → gate),
   same model, specialized prompts/schemas.
4. **Promote-when-verified** materialization (ADR 0018): E5 statement grounding
   + allowlist kinds → active Observation by default; procedure/fact_candidate
   hold-biased; escape `CARPEOS_AGENTIC_HOLD_FIRST`.
5. Minimal **ontology** (decision, constraint, preference, procedure,
   fact_candidate, open_question) and **graph edges** from provenance.
6. Reuse V5 **redact / pack / provider / cost / kill**; do not promote V5 drafts
   by flipping `canonical_effect` silently.
7. Preserve capture fail-open; schema-v1 core event types; no auto AcceptanceDecision.
8. Always-on brain: **30m timer** + feed lease + persistent day spend.
9. Human tools = **correction only** (retract, promote-held, accept-claim).
10. Metrics: cite integrity, precision, retrieval usefulness — not Evidence counts.

---

## Non-goals

| Non-goal | Why |
| --- | --- |
| LLM inside capture hooks | Fail-open + latency + privacy |
| Multi-model escalation (larger models) | Cost freeze: Flash-only |
| Automatic AcceptanceDecision | Epistemic model |
| Silent provider fallback | ADR 0016 / 0017 |
| Hosted graph/vector services | Still local-first |
| Free-form `related` graph spam | Precision |
| Load-bearing human promote queue | ADR 0018 product existence criterion |

---

## Requirements (summary)

### Functional

- R1: Job runner processes committed evidence without blocking hooks.
- R2: E1 rule admit drops tool-noise classes at adj baseline or better.
- R3: E2–E4 use V5 redact/pack + Flash extract with **mandatory citations**.
- R4: E5 deterministic verify **including statement grounding** before promote.
- R5: E7 `agentic_v1` promote-when-verified for allowlist kinds.
- R6: E8 appends active Observation and optional **draft** Claim via store writers.
- R7: Graph/retrieval rebuild from canonical meaning.
- R8: Human retract / promote-held / accept-claim remain available as **correction**.
- R9: Agentic-off restores capture + adj_v3 + retrieval without LLM jobs.
- R10: 30m always-on timer installable and reversible.

### Non-functional

- N1: Network off by default; spend caps; **persistent day budgets**.
- N2: Idempotent stage digests; feed leases; once effects.
- N3: No secrets/provider bodies in logs, telemetry, fixtures, public artifacts.
- N4: Offline golden + licensing corpus in CI for extract/gate regressions.

---

## Architecture snapshot

See [architecture/agentic-layer.md](architecture/agentic-layer.md),
[ADR 0017](adr/0017-agentic-layer-write-time-knowledge.md),
[ADR 0018](adr/0018-agentic-hitl-free-compound-loop.md).

```text
hooks → Evidence + agentic_capture_feed (no LLM)
     → agentic jobs (Flash multi-stage when network on)
     → E5 statement-grounded verify
     → agentic_v1 promote-when-verified
     → active Observation / draft Claim + provenance
     → retrieval + graph projections
     → human retract only when wrong
```

---

## Success criteria (ADR 0018 S1–S7)

| ID | Criterion | Target |
| --- | --- | --- |
| S1 | Zero human review between SessionEnd-class capture and default-searchable unit for verified allowlisted extracts | Met in 6.6 defaults |
| S2 | MCP/CLI default retrieval returns those units without include_held / accept-claim | Met |
| S3 | Post-capture processing without manual `agentic run` (timer and/or proven drain) | 30m timer shipped |
| S4 | Named offline licensing corpus green; zero must_not_promote leaks | `licensing-promote` + precision |
| S5 | Capture path zero LLM/network/agentic await | Unchanged |
| S6 | Zero automatic AcceptanceDecision from agentic runner | Unchanged |
| S7 | Wrongly promoted unit retractable without rewrite | `agentic retract` |

---

## npm series (honest)

| Version | Shipped slice |
| --- | --- |
| 6.0.0 | Hold-first P0–P2 brain |
| 6.1–6.4 | P3 precision, P4 links, P5 draft Claims, P6 GraphRAG |
| 6.5.0 | E10 reconcile + human accept/promote + feed backfill |
| **6.6.0** | **HITL-free promote-when-verified + retract + day spend + 30m timer** |

---

## Related

- [product-6.0.0.md](maintainers/product-6.0.0.md)
- [v6-milestones.md](maintainers/v6-milestones.md)
- [architecture/agentic-layer.md](architecture/agentic-layer.md)
