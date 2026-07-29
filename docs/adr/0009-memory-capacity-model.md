# ADR 0009: Memory Capacity Model

Status: accepted

Date: 2026-07-29

## Context

Frontier models such as Kimi K3 separate **total parametric capacity** (for
example 2.8T parameters) from **active compute per token** (for example ~104B
parameters with top-k experts). They also combine long working context,
selective residual pathways across depth, procedure-preserving multi-turn
history, and product-level persistent surfaces (widgets, dashboards).

CarpeOS is not a frontier model runtime. It is a personal knowledge operating
system: append-only private knowledge with rebuildable projections for humans
and agents. Without an explicit capacity model, implementers tend to:

- treat “more retrieval” as always better;
- dump raw evidence into LLM context;
- blur procedure traces with accepted facts;
- confuse vector similarity with epistemic authority.

CarpeOS needs a durable vocabulary for **store capacity vs activation capacity**
that preserves existing invariants from ADR 0001–0008.

## Decision

CarpeOS adopts a four-layer memory capacity model:

1. **Store capacity (L1)** — append-only `CanonicalEvent` stream plus protected
   values. This is the private knowledge nucleus.
2. **Working memory (L2)** — bounded context packs, search results, and host
   session windows. Activation is governed by `ContextBudget` and expert-slot
   policy.
3. **Procedural memory (L3)** — agent thinking/tool histories captured as
   evidence-class records with protected payloads. Procedure memory supports
   resume and audit; it does not grant acceptance.
4. **Product memory (L4)** — rebuildable projections (retrieval indexes,
   Obsidian, OpenLoop/dashboard, compaction ledgers, session summaries).

**Total capacity** is all L1 knowledge visible under trust-zone and erasure
policy. **Active capacity** is the subset admitted into an L2 response after
budgets, routing, diversity caps, and canonical recheck.

CarpeOS MUST NOT:

- use personal fine-tuning of model weights as the primary personal memory path;
- treat vector hits, pack membership, or procedure traces as acceptance;
- expand v1 core `event_type` values solely to model procedure or run ledgers
  when evidence metadata and projections suffice (see program master plan).

Detailed operational rules for expert slots, diversity routing, compaction, and
latent resolutions live in the architecture note and later ADRs or specs as
those features land. This ADR freezes the capacity axes and authority boundary.

## Consequences

Positive:

- Product language matches how frontier agents actually use memory.
- Context packs and retrieval can optimize activation without claiming more
  authority.
- Procedure traces gain a first-class layer without polluting claims.

Tradeoffs:

- Pack assembly and retrieval ranking become more structured than a single
  top-k list.
- Capture adapters must carry procedure metadata carefully under protected-value
  rules.

## Related

- Master plan: `docs/plans/k3-memory-capacity-master-plan.md`
- Architecture: `docs/architecture/memory-capacity.md`
- ADR 0002 immutable epistemic model
- ADR 0007 embedding and hybrid retrieval boundary
- ADR 0008 MCP and Obsidian interfaces
