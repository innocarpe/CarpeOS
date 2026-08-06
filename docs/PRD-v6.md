# PRD v6 — CarpeOS 6.0.0 (Agentic Layer)

Status: **Product 6 Agentic Layer P0–P6 shipped through `@innocarpe/carpeos@6.4.0`**;
complete topology residuals (E10 reconcile, human accept/promote, feed backfill)
target **6.5.0**. Hard fences unchanged (no capture LLM; no auto AcceptanceDecision;
Flash-only).

Series: [PRD-v1](PRD-v1.md) · [PRD-v2](PRD-v2.md) · [PRD-v3](PRD-v3.md) ·
[PRD-v4](PRD-v4.md) · [PRD-v5](PRD-v5.md) · **PRD-v6**

---

## Version thesis

> **Can a post-capture Agentic Layer, driven only by DeepSeek V4 Flash, form
> grounded, typed, graph-linked knowledge units under a deterministic gate —
> without LLM in capture and without automatic AcceptanceDecision — so that
> CarpeOS becomes a true unified knowledge store (not a session log dump)?**

| | 5.0 | **6.0** |
| --- | --- | --- |
| Question | Can LLM drafts stay non-canonical? | **Can a brain form meaning at write time?** |
| Core engine | draft extract sandbox (`@carpeos/v5`) | **agentic jobs + Flash multi-stage + agentic_v1 gate** |
| Success signal | offline contracts + draft CLI | **cited Observations / draft Claims + denser meaning graph + retrieval usefulness** |
| Failure if skipped | privacy leak / false authority from drafts | **eternal sensory store; GraphRAG on noise** |

---

## Problem

1. Multi-host capture works; Evidence volume is high; **meaning density is low**.
2. `adj_v3` is necessary but not sufficient as a brain (rules, not understanding).
3. Product 5 correctly isolated LLM drafts, but **did not connect** them to the
   knowledge thesis users need for GraphRAG / “like a brain.”
4. Without write-time typing and linking, later search only re-ranks residue.

---

## Goals

1. Post-capture **Agentic Layer** (`@carpeos/agentic`) with durable jobs.
2. **DeepSeek V4 Flash only** for all real LLM stages (cost freeze).
3. Multi-stage workflows (triage → extract → verify → structure/link → gate),
   same model, specialized prompts/schemas.
4. **Hold-first** materialization; narrow auto-promote only after deterministic
   citation gates and golden precision suite.
5. Minimal **ontology** (decision, constraint, preference, procedure,
   fact_candidate, open_question) and **graph edges** from provenance.
6. Reuse V5 **redact / pack / provider / cost / kill**; do not promote V5 drafts
   by flipping `canonical_effect` silently.
7. Preserve capture fail-open; schema-v1 core event types; no auto AcceptanceDecision.
8. Metrics that define “meaningful accumulation” (cite integrity, precision,
   retrieval usefulness)—not Evidence counts.

---

## Non-goals

| Non-goal | Why |
| --- | --- |
| LLM inside capture hooks | Fail-open + latency + privacy |
| Multi-model escalation (larger models) | Cost freeze: Flash-only |
| Automatic AcceptanceDecision | Epistemic model |
| Silent provider fallback | ADR 0016 / 0017 |
| Hosted graph/vector services | Still local-first |
| Backfill-all-history as release gate | Slice-first; optional later jobs |
| Free-form `related` graph spam | Precision |

---

## Requirements (summary)

### Functional

- R1: Job runner processes committed evidence without blocking hooks.
- R2: E1 rule admit drops tool-noise classes at adj baseline or better.
- R3: E2–E4 use V5 redact/pack + Flash extract with **mandatory citations**.
- R4: E5 deterministic verify is mandatory before persist affecting search.
- R5: E7 `agentic_v1` dispositions; default hold; optional narrow auto-promote.
- R6: E8 may append Observation and **draft** Claim only via typed store writers.
- R7: Graph/retrieval rebuild from canonical meaning; evidence graph remains distinct.
- R8: Human promote-held path remains available.
- R9: Agentic-off restores capture + adj_v3 + retrieval without LLM jobs.

### Non-functional

- N1: Network off by default; spend caps; day budgets.
- N2: Idempotent stage digests; at-least-once jobs; once effects.
- N3: No secrets/provider bodies in logs, telemetry, fixtures, public artifacts.
- N4: Offline golden corpus (12+ cases) in CI for extract/gate regressions.

---

## Architecture snapshot

See [architecture/agentic-layer.md](architecture/agentic-layer.md) and
[ADR 0017](adr/0017-agentic-layer-write-time-knowledge.md).

```text
hooks → Evidence
     → agentic jobs (Flash multi-stage)
     → agentic_v1 gate
     → Observation / draft Claim + provenance
     → retrieval + graph projections
```

---

## Success criteria

| Criterion | Target |
| --- | --- |
| Cite integrity on persist | 100% |
| must_not_promote precision (P3) | ≥ 0.90 |
| Vertical slice (SessionEnd decisions) | 4/4 hit, 0/8 noise active |
| Claim auto-accept | 0 |
| Capture LLM calls | 0 |
| Model id for real calls | `deepseek-v4-flash` only |

---

## Residuals / later

- Schema-v1 Observation.kind field (optional later ADR)
- Entity resolution product (G-R4)
- Hosted projections
- Historical full backfill SLOs

## Related

- [product-6.0.0.md](maintainers/product-6.0.0.md)
- [v6-milestones.md](maintainers/v6-milestones.md)
- [ADR 0017](adr/0017-agentic-layer-write-time-knowledge.md)
- [ADR 0016](adr/0016-v5-draft-only-deepseek-primary.md)
