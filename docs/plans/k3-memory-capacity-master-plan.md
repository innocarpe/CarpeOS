# CarpeOS Memory Capacity Master Plan

Status: active execution plan  
Worktree: `carpeos-k3-memory-capacity` (`feat/k3-memory-capacity` and stacked PR branches)  
Origin inspiration: Moonshot Kimi K3 open-weight architecture (2.8T total / ~104B active, Stable LatentMoE, KDA, Attention Residuals, 1M context, preserved thinking history, Widgets/Dashboard)  
Date: 2026-07-29

## 1. Purpose

Apply Kimi K3-derived **memory structure and knowledge-capacity** ideas to CarpeOS without treating frontier model weights as the personal knowledge store.

CarpeOS remains:

- public implementation for private knowledge;
- append-only canonical events as source of truth;
- rebuildable projections for LLM and human interfaces.

K3 informs **capacity economics**, **sparse activation**, **selective residual retrieval**, **procedure memory**, and **long-horizon external state** — not a requirement to host 2.8T parameters.

## 2. Product thesis

| K3 concept | CarpeOS counterpart |
| --- | --- |
| 2.8T total parameters | Canonical private store capacity (events + protected blobs) |
| ~104B active experts | Context-pack / retrieval activation budget |
| top-16 of 896 MoE | Expert-slot routing across pack sections and retrieval paths |
| LatentMoE compression | Multi-resolution latent ladder (id → embedding → summary → full) |
| Attention Residuals | Epistemic residual selection (authority, supersession, zone, recency) |
| 1M context + compaction | Working-memory window + compaction projections |
| Preserved thinking history | ProcedureTrace capture as protected evidence, never accepted fact |
| Widgets / Dashboard | OpenLoop and product dashboard projections |
| Open weights | Optional frontier **consumer** of CarpeOS MCP, not the store itself |

Effective personal-agent intelligence is modeled as:

```text
f(C_canonical, A_pack, W_session, S_epistemic, E_interfaces)
```

where CarpeOS owns `C_canonical`, `A_pack`, `S_epistemic`, and `E_interfaces`, while the host LLM owns parametric skill and the session window `W_session`.

## 3. Non-goals

- Self-hosting or fine-tuning Kimi K3 inside CarpeOS.
- Injecting personal knowledge into model weights as the primary memory path.
- Flattening vector hits into accepted facts.
- Auto-accepting claims from procedure traces or agent improvisation.
- Hosted Workers AI / Vectorize production claims without private operator evidence.
- Expanding the v1 **canonical event type set** beyond the five core types unless a later ADR explicitly opens that door.

## 4. Capacity model (normative target)

Four memory layers:

| Layer | Name | Authority | Rebuildable? | Examples |
| --- | --- | --- | --- | --- |
| L1 | Parametric / store capacity | Canonical events + protected values | No (append-only / shred) | Claims, evidence blobs |
| L2 | Working memory | Context packs and session windows | Yes | `memory_context_pack` |
| L3 | Procedural memory | Evidence artifacts tagged as procedure traces | Partial (summaries rebuild; raw protected) | thinking/tool histories |
| L4 | Product memory | Projections | Yes | Obsidian, OpenLoop, dashboard, compaction ledger |

**Total vs active:**

- **Total capacity** = all visible canonical knowledge in allowed trust zones.
- **Active capacity** = items admitted into a context pack or retrieval response after budgets, expert slots, diversity caps, and canonical recheck.

Implementations MUST keep these axes separate in docs, APIs, and metrics.

## 5. Dependency graph

```text
M1 capacity model (docs/ADR/spec)
 ├─► M3 ProcedureTrace capture schema
 │     └─► M8 long-horizon run ledger
 ├─► M2 expert-slot context pack ──► M5 cache-friendly pack layout
 │     └─► M4 compaction projection
 ├─► M6 hybrid diversity router ──► M7 multi-resolution latent ladder
 └─► M9 OpenLoop/dashboard projection (after M2 section model)
       └─► M10 Kimi/K3 MCP consumer adapter (after MCP pack contracts stable)
```

Parallel-safe pairs after M1 lands:

- M3 ∥ M2 ∥ M6
- M5 depends on M2
- M4 depends on M2
- M7 depends on M6
- M8 depends on M3
- M9 can start docs after M1; implementation prefers M2
- M10 last among product interfaces

## 6. PR sequence

Each PR is atomic, tested, labeled with one kind and optional area, then merged to `main` before the next feature branch is cut from updated `main` (unless explicitly stacked with rebase after merge).

| PR | ID | Title | Kind | Area | Depends |
| --- | --- | --- | --- | --- | --- |
| #A | M1 | Memory capacity model ADR + master plan + architecture note | `docs` / `spec` | — | — |
| #B | M3 | ProcedureTrace capture envelope on EvidenceArtifact path | `feat` | `capture` | M1 |
| #C | M2+M5 | Expert-slot context pack + stable serialization order | `feat` | `interfaces` | M1 |
| #D | M6 | Hybrid retrieval diversity / quantile balancing | `feat` | `retrieval` | M1 |
| #E | M4 | Compaction projection + non-authoritative ledger records | `feat` | `retrieval` | M2 |
| #F | M7 | Multi-resolution latent ladder for retrieval units | `feat` | `retrieval` | M6 |
| #G | M8 | Long-horizon run ledger (projection + capture metadata) | `feat` | `capture` | M3 |
| #H | M9 | OpenLoop / dashboard projection package | `feat` | `interfaces` | M2 |
| #I | M10 | Kimi / frontier MCP consumer adapter templates | `feat` | `interfaces` | M2, MCP stable |

If GitHub PR numbers differ, the IDs above remain the plan story keys.

## 7. Story specs

### M1 — Memory capacity model

**Deliverables**

- `docs/plans/k3-memory-capacity-master-plan.md` (this document)
- `docs/adr/0009-memory-capacity-model.md`
- `docs/architecture/memory-capacity.md`
- Spec cross-links in `spec/v1/retrieval-projections.md` and `spec/v1/capture-and-mcp.md` (capacity language only; no false “implemented” claims)
- Ultragoal brief/goals under `.omc/ultragoal/` (repo-local planning artifact; may be gitignored if project ignores `.omc`)

**Acceptance**

- Four layers and total/active axes are documented.
- Explicit mapping from K3 mechanisms to CarpeOS invariants.
- Non-goals include no parametric personal fine-tune requirement.

### M3 — ProcedureTrace

**Design choice (locked for this program)**

Do **not** add a sixth canonical `event_type`. Represent procedure memory as:

- `EvidenceArtifact` with `kind` extended or media_type + capture metadata;
- payload remains protected-value referenced;
- capture adapter sets provenance relationship and a stable `procedure_trace` marker in structured capture metadata stored alongside the event (local store / outbox metadata), while the canonical payload stays schema-valid.

Prefer:

```text
EvidenceArtifact.kind = "message" | "other"  (existing)
media_type = application/vnd.carpeos.procedure-trace+json
capture metadata: procedure_trace { provider, session_id, turn_id, completeness }
```

If schema needs a new `kind` value, add `procedure_trace` only after JSON Schema + TypeScript + tests update.

**Acceptance**

- Hooks/MCP can capture synthetic procedure traces.
- Traces are never auto-promoted to `AcceptanceDecision`.
- Context packs include procedure summaries only under expert slots / protected-value policy.
- Tests prove redaction and non-authority.

### M2 — Expert-slot context pack

**Design**

Replace pure sequential section filling with **slot allocation** defaulting to 16 expert slots inspired by K3 top-k, configurable via optional pack policy (defaults preserve current budgets):

| Slot class | Default slots | Source section |
| --- | --- | --- |
| accepted_facts | 6 | accepted_facts |
| open_conflicts | 3 | conflicts + supersessions |
| procedure | 3 | procedure evidence summaries |
| observations | 2 | observations |
| evidence_pointers | 2 | evidence_summaries |

Global `max_items` / `max_characters` still apply. Diversity cap: soft limit on same `subject_ref` / project concentration.

**Acceptance**

- Deterministic ordering.
- Over-budget behavior reports `truncated` + `omitted`.
- Tests cover diversity and section floors when data exists.
- Accepted facts still require acceptance lineage.

### M5 — Cache-friendly pack layout

**Design**

Stable JSON key and array order for MCP structured content:

1. policy / visibility echoes (if any)
2. accepted_facts
3. open loops / conflicts / supersessions
4. observations
5. evidence summaries / procedure summaries
6. draft / rejected claims
7. erasures / redactions / verification gaps
8. budget

High-churn sections last so host LLM prefix caches can reuse durable accepted-fact prefixes when packs are rebuilt for related tasks.

**Acceptance**

- Golden snapshot test for key order.
- Documented in MCP guide.

### M6 — Hybrid diversity router

**Design**

Extend ranking beyond weighted sum:

1. Score candidates (existing hybrid scores).
2. Apply **quantile balancing** across `chunk_kind` and optional subject buckets so one class cannot monopolize top-k.
3. Optional soft penalty for near-duplicate text (hash/token Jaccard).

Still fail closed through canonical recheck.

**Acceptance**

- Unit tests with synthetic multi-kind corpora.
- No change to authority semantics.
- Ranking remains deterministic.

### M4 — Compaction projection

**Design**

When a pack or session exceeds thresholds, emit a rebuildable **compaction projection** record (not canonical authority):

- inputs: event ids / chunk ids compacted
- outputs: summary text, pointer set, budget stats
- ledger: append-only local projection table or files under projection dir

CLI (if exposed): `retrieval compact --dry-run` optional; at minimum library API + tests.

**Acceptance**

- Compaction never mutates claims.
- Rebuild from canonical stream discards stale compaction outputs.
- Tests cover round-trip rebuild.

### M7 — Multi-resolution latent ladder

**Design**

Each retrieval unit may expose resolutions:

| Level | Content | Use |
| --- | --- | --- |
| R0 | record id + kind | pointers, traces |
| R1 | embedding vector | semantic candidate gen |
| R2 | short summary / statement | default pack text |
| R3 | full visible text / protected ref | explicit get |

Chunk builder and pack assembler prefer R2, escalate to R3 only when budget and policy allow.

**Acceptance**

- Chunk schema or local projection metadata carries resolution tags.
- Search defaults remain meaningful-unit text (R2-class).
- Tests verify no raw hook JSON at R2.

### M8 — Long-horizon run ledger

**Design**

Projection + capture metadata for multi-hour/day agent runs:

```text
RunLedgerEntry {
  run_id, agent_id?, round, started_at, ended_at?,
  event_ids[], artifact_ids[], status, subject_ref
}
```

Not a sixth canonical type. Stored as local projection / structured evidence metadata linked by provenance.

**Acceptance**

- Synthetic multi-round capture test.
- Timeline / related tools can surface run linkage when present.
- Docs mark dashboard integration as optional follow-on.

### M9 — OpenLoop / dashboard projection

**Design**

New or extended projection package generating:

- open loops (unresolved tasks, conflicts, needs_review)
- simple dashboard index markdown (manifest-bounded, like Obsidian package)

`canonical_effect: "none"`.

**Acceptance**

- Deterministic files from synthetic fixtures.
- Path safety and closed categories.
- Tests for rebuild/cleanup.

### M10 — Kimi / frontier MCP consumer adapter

**Design**

Provider-neutral consumer notes + optional adapter template:

- how to point Kimi Code / OpenAI-compatible agents at local CarpeOS MCP
- preserved-thinking note: CarpeOS stores procedure traces; host must still replay host-native thinking if required by the model
- example config with synthetic project only

**Acceptance**

- Docs + template under `adapters/`
- No real credentials
- Explicit “consumer, not memory backend”

## 8. Verification matrix

| Check | When |
| --- | --- |
| `pnpm format:check` | every PR |
| `pnpm lint` | every PR |
| `pnpm build` | every PR |
| `pnpm typecheck` | every PR |
| `pnpm test` | every PR with code |
| `pnpm public-boundary` | every PR |
| focused package tests | during implementation |
| PR labels: one kind + optional area | every PR |
| no private data | every PR |

Final program gate after M10:

- full `pnpm check`
- plan status all stories complete
- short postmortem in this document’s Execution Log

## 9. Risk register

| Risk | Mitigation |
| --- | --- |
| Ontology break from new event types | Prefer evidence metadata + projections (locked) |
| Context pack non-determinism | Stable sorts, fixed projection clock in tests |
| Over-fitting to K3 branding | Keep CarpeOS vocabulary primary; K3 only in rationale |
| Scope creep into GraphRAG/hosted AI | Keep hosted paths adapter-only |
| Worktree contamination of other WIP | Only work in `carpeos-k3-memory-capacity` (and stacked branches from `main`) |
| Merge conflicts with parallel README work | Rebase onto `origin/main` before each PR push |

## 10. Execution log

| When (UTC) | Story | Action | Evidence |
| --- | --- | --- | --- |
| 2026-07-29 | bootstrap | Created worktree from `origin/main` @ `74ea77d` | path `carpeos-k3-memory-capacity` |
| 2026-07-29 | M1 | Master plan authored | this file |
| 2026-07-29 | M1 | PR #19 merged | ADR 0009 + architecture + plan |
| 2026-07-29 | M3 | PR #20 merged | procedure_trace capture |
| 2026-07-29 | M2+M5 | PR #21 merged | expert-slot packs |
| 2026-07-29 | M6 | PR #22 + #23 | diversity ranking + test fix |
| 2026-07-29 | M4+M7 | PR #24 merged | compaction + latent ladder |
| 2026-07-29 | M8 | PR #25 merged | run ledger helpers |
| 2026-07-29 | M9+M10 | product projection + kimi adapter | this branch |

_Updates append below as PRs land._

## 11. Definition of done (program)

1. All M1–M10 stories merged to `main` or explicitly deferred with rationale in this log.
2. ADR 0009 accepted and architecture doc linked from README architecture section or docs index if one exists.
3. Procedure traces, expert-slot packs, diversity ranking, compaction, latent ladder, run ledger, open-loop projection, and frontier consumer docs exist with tests where code lands.
4. No private user data introduced.
5. Ultragoal ledger checkpoints complete with final quality notes.

## 12. Implementation notes for agents

- Prefer small atomic commits with Conventional Commit subjects.
- English for code/docs in `README.md` / specs; keep `README.ko.md` in sync only when user-facing product surface changes warrant it (batch at end if needed).
- Never claim hosted Cloudflare production deployment.
- When unsure whether something is canonical: **it is a projection**.
- Parallelize only across independent packages after shared schema contracts merge.
