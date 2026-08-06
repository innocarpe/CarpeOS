# ADR 0017: Agentic Layer for write-time knowledge (Product 6)

Status: **Accepted for Product 6.0.0 planning and implementation**  
Date: 2026-08-06

## Context

CarpeOS is a **unified personal knowledge store**. Capture multi-host hooks produce
large volumes of `EvidenceArtifact` records. Rule-based adjudication (`adj_v*`)
rejects most tool noise and promotes only a thin Observation band; auto-Claim
and auto-`AcceptanceDecision` remain off. Product 5.0 delivered an opt-in
**draft-only** LLM lane (`@carpeos/v5`, ADR 0016) that must never become
canonical authority and must never run inside capture transactions.

Operator product intent for the next major:

- Without a **brain**, the store remains sensory logs, not knowledge.
- **DeepSeek V4 Flash** (`deepseek-v4-flash` via DeepSeek Direct) is the only
  real LLM model for Product 6 (cost is the hard constraint).
- Knowledge must be **classified, typed (ontology), and linked (graph)** at
  **write time** (post-capture, near-write), so later search / GraphRAG recalls
  structured memory rather than raw transcripts.
- Multiple **specialized LLM stages** (workflows) are preferred over a single
  mega-prompt, to reduce failure rates — but **one model id only**.

This ADR freezes the Product 6 plane so ultragoal / multi-PR implementation does
not re-open architecture mid-flight.

## Decision

### D1 — Product thesis (6.0)

> Can a post-capture **Agentic Layer**, driven only by **DeepSeek V4 Flash**, form
> **grounded, typed, graph-linked knowledge units** under a **deterministic gate**,
> without LLM in capture and without automatic `AcceptanceDecision`?

Success is **answerability + lineage of meaning**, not growth of Evidence counts.

### D2 — Plane separation (non-negotiable)

| Plane | Role | Authority |
| --- | --- | --- |
| Capture / Evidence | Sensory intake | Append-only evidence SoT for raw hooks |
| `adj_v3` (frozen) | Cheap noise prefilter + comparison baseline | **Not** the only long-term promote path; unchanged by 6.0 code freeze rules for its golden suite |
| `@carpeos/v5` | Untrusted **cortex** primitives (redact, pack, provider, cost, kill) | Draft only (`canonical_effect: "none"`) when used as draft pipeline |
| **`@carpeos/agentic` (new)** | Durable jobs, multi-stage workflows, verify, gate, materialize bridge | **`policy_version: agentic_v1`** dispositions; may materialize Observations / draft Claims only through local-store typed writers |
| Canonical store | Long-term epistemic records | schema-v1 event types only |
| Graph / vector / MCP | Rebuildable projections | Never establish acceptance alone |

**Do not** treat V5 `runDraftPipeline` as the production orchestrator. Reuse its
**parts**; own orchestration in `@carpeos/agentic`.

### D3 — Model freeze: DeepSeek V4 Flash only

1. **Only real model id:** `deepseek-v4-flash` @ `https://api.deepseek.com`
   (`DEEPSEEK_API_KEY` from env / `~/.carpeos/` private files only).
2. **No second real model** for escalation, critic ensembles, or silent fallback
   in Product 6. Multi-workflow means **multiple stages / prompts / schemas on
   the same Flash model**, not multi-vendor model shopping.
3. **Fake / offline** profiles remain for tests and network-off defaults.
4. Optional OpenRouter / Luna profiles from V5 stay **out of Product 6 default
   path** and must not be required for 6.0 DoD.

Rationale: cost is the primary operational constraint; stage specialization
reduces failure modes without multiplying $/token from larger models.

### D4 — Capture stays dumb

- Hooks remain fail-open and fast.
- **No LLM, no network, no agentic job await** inside the capture transaction.
- Agentic work is **post-commit**, at-least-once via durable local jobs.

### D5 — Multi-stage workflow topology (same model)

```text
E0 Capture → EvidenceArtifact
E1 Rule admit (adj_v3 sibling / feed) — drop PostToolUse-class noise
E2 Redact + EvidencePack (reuse @carpeos/v5)
E3 LLM Triage (Flash) — keep | drop | need_context  [batchable]
E4 LLM Extract (Flash) — typed spans + mandatory citations
E5 Deterministic Verify — quote ⊆ pack, secrets, enum, length  [mandatory]
E6 LLM Structure/Link proposals (Flash) — optional merge with E4 in slice-1
E7 Gate agentic_v1 — default HOLD; narrow auto-promote only after E5
E8 Materialize — Observation and optional draft Claim; never AcceptanceDecision
E9 Project — retrieval + graph rebuild
E10 Periodic reconcile — dedupe/contradict proposals; human hold path
```

**Deterministic Verify (E5) is never optional** before any persist path that can
affect default search.

### D6 — Gate semantics (`agentic_v1`)

1. LLM **confidence is a feature, not authority**.
2. Default LLM materialization: **hold** (draft Observation).
3. **Auto-promote** only when all of:
   - E5 cite integrity pass;
   - kind ∈ allowlist (`decision` | `constraint` | `preference` initially);
   - length/secret gates pass;
   - golden “must_not_promote” suite remains green.
4. **Never** auto-create `AcceptanceDecision`.
5. **Never** LLM-only `Supersession`.
6. Disposition identity: `(source_event_id, trust_zone_id, policy_version)` with
   `policy_version = agentic_v1` (name frozen for v1; bump only via ADR).

### D7 — Ontology freeze (v1)

Knowledge **kinds** (align adj spans; do not invent a sixth core event type):

| Kind | First landing |
| --- | --- |
| `decision` | Observation; optional later draft Claim `claim_type: decision` |
| `constraint` | Observation |
| `preference` | Observation |
| `procedure` | Observation (hold-biased) |
| `fact_candidate` | draft Claim only (`factual`), never auto-accepted |
| `open_question` | hold Observation; not primary retrieval |

**Not a unit in v1:** free-standing `entity_ref` (entities are link targets only).

Kinds may live in agentic proposal / disposition metadata until a future schema
ADR adds first-class Observation fields. Human-readable `statement` remains
required for Observations.

### D8 — Graph edges (v1)

Materialize edges only from **persisted** units (via provenance + projection):

| Edge | Meaning |
| --- | --- |
| `derived_from` | unit → evidence (required) |
| `supports` | Claim → Observation/evidence |
| `contradicts` | Claim → Claim (or unit proposals held until gate) |
| `about` | unit → subject/project |
| `supersedes` | only real Supersession events |

**Defer:** free `related`, causal graphs, fuzzy entity merge, community detection.

Graph/vector remain **projections** (ADR 0010). Knowledge “accumulation” means
canonical units + provenance that rebuild into denser `meaning_unit` graphs—not
LLM writing projection tables as SoT.

### D9 — Durable jobs

- New local sidecar job store (not the sync outbox).
- States: `pending → leased → succeeded | blocked | dead`.
- Delivery **at-least-once**; effects **once** via canonical/job digests.
- Stage identity digests include pack, prompt, model id, policy, schema versions.
- Capture never blocks on job completion.
- Network **off by default** for agentic runners; explicit allow + spend caps.

### D10 — Phased delivery (implementation order)

| Phase | Ship | Non-goals |
| --- | --- | --- |
| P0 | This ADR set + PRD/DoD + golden corpus skeleton + package scaffold | live LLM product path |
| P1 | Jobs + E1–E5; **sidecar proposals only** (`canonical_effect: none` until bridge) | Observation from LLM |
| P2 | Hold-first draft Observation + human promote path | auto-promote; Claim |
| P3 | Narrow auto-promote after precision suite | AcceptanceDecision |
| P4 | Link proposals + graph density | entity ER product claim |
| P5 | draft Claim for fact_candidate/decision | auto accept |
| P6 | GraphRAG ranking on typed promoted units | hosted graph |

### D11 — Relation to Product 5 / ADR 0016

- ADR 0016 remains true for the **V5 draft package** and its CLI surfaces.
- Product 6 **consumes** V5 primitives under a **new promotion-bridge ADR
  (this document)**; it does not silently flip V5 drafts into retrieval authority.
- V5-off and agentic-off remain valid: capture + adj_v3 + retrieval continue.

### D12 — Explicit non-goals for 6.0.0 first shippable brain slice

- LLM inside capture hooks
- Automatic AcceptanceDecision or accepted-truth views
- Multi-model escalation (Flash-only)
- Backfill of all historical evidence as a release gate
- Hosted graph/vector services
- Online learning / adaptive thresholds driving promotion
- Public dumps of private runtime knowledge

## Consequences

### Positive

- Clear ultragoal target: write-time brain without boiling the ocean.
- Cost-bounded model policy (Flash-only).
- Preserves capture reliability and epistemic immutability.
- Enables typed knowledge + graph lineage for future GraphRAG.

### Negative / costs

- New package, jobs, eval harness, and ADR surface.
- Hold queue UX required before auto-promote density feels “magical.”
- Ontology landing may start in sidecar metadata until schema evolution.

### Risks and controls

| Risk | Control |
| --- | --- |
| Fluent hallucination → active memory | E5 cite integrity; hold-first; golden must_not_promote |
| Cost explosion | Flash-only; E3 drop rate; day spend caps; SessionEnd-first slice |
| Dual promote authorities | adj_v3 prefilter vs agentic_v1 gate; separate policy_version |
| Graph spam | Edges only from persisted provenance; no free related |
| Injection / secret egress | Redact before provider; secret reject; no tool-use for model |

## Alternatives considered

1. **Keep V5 draft-only forever** — rejected; fails “knowledge OS” thesis.
2. **Replace adj_v3 with single LLM adjudicator** — rejected; loses free noise kill; cost/privacy risk.
3. **LLM in capture hot path** — rejected; fail-open and latency law.
4. **Multi-model escalation (larger model critic)** — rejected for Product 6 cost freeze; stages on Flash only.
5. **Auto-promote on model confidence** — rejected; uncalibrated; poisons default retrieval.
6. **New core event type for “KnowledgeUnit”** — deferred; use Observation/Claim + metadata first.

## Acceptance metrics (definition of “meaningful accumulation”)

Track on frozen synthetic golden + private offline dogfood (never public raw dumps):

- Cite integrity on persist paths = **100%**
- Auto-promote precision on must_not_promote ≥ **0.90** (when P3 ships)
- Type agreement on labeled sample ≥ **0.85**
- Retrieval usefulness spot-check ≥ **0.70** on fixed query set
- Auto AcceptanceDecision count = **0**
- Capture path LLM calls = **0**
- Idempotent replay: no duplicate meaning flood

## Related

- ADR 0002 immutable epistemic model  
- ADR 0010 graph projection vocabulary  
- ADR 0011 meaningful unit extraction  
- ADR 0012 knowledge adjudication  
- ADR 0016 V5 draft-only DeepSeek primary  
- `docs/PRD-v6.md`  
- `docs/maintainers/product-6.0.0.md`  
- `docs/maintainers/v6-milestones.md`  
- `docs/architecture/agentic-layer.md`  
