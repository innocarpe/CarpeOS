# ADR 0018: Agentic Layer completes the CarpeOS loop without required HITL

Status: **Proposed — revised after external design review**  
Date: 2026-08-07  
Supersedes in part: [ADR 0017](0017-agentic-layer-write-time-knowledge.md)
**D6 default hold-first, D7 fact_candidate “draft Claim only as sole landing” for product
visibility, D10 P2 “human promote as product path” framing**  
Does not supersede: capture-no-LLM, Flash-only model freeze, no automatic
`AcceptanceDecision`, plane separation, schema-v1  

External reviews (must-read before implementation):

- `docs/plans/reviews/adr0018-review-claude-opus.md` (Claude Opus)
- `docs/plans/reviews/adr0018-review-gpt56-sol.md` (Codex gpt-5.4 xhigh; gpt-5.6-sol
  unavailable on this Codex login — noted in review header)

## Context

### Product north star

CarpeOS is a **personal knowledge OS for AI-assisted work**:

> Capture context. Compound knowledge.

Agents and humans produce sessions across hosts. CarpeOS must:

1. Capture without blocking work (fail-open).
2. Form durable meaning from that evidence.
3. Make that meaning available to the **next agent** by default.
4. Keep provenance and epistemic honesty (“decided” ≠ “once suggested”).

If (2)–(3) require a human to review a queue every session, the product is not a
knowledge OS for agents — it is a **ticket system**. The product owner’s
invariant:

> **The compound loop must not require human-in-the-loop.**  
> Humans may correct, audit, and kill — they must not be load-bearing for value.

### Why Agentic Layer exists

ADR 0017 introduced `@carpeos/agentic` so CarpeOS can form **typed, cited,
graph-linked knowledge at write time** (post-capture) under a deterministic gate,
Flash-only, without LLM in capture.

That plane was intended to **close the product loop autonomously**:

```text
multi-host sessions → capture → agentic brain → usable meaning → default retrieval / MCP
```

without a human clicking promote/accept for knowledge to exist for the next agent.

### Drift (implementation + ADR 0017 defaults)

ADR 0017 D6 and early slices codified **hold-first** as the default materialization
and treated auto-promote as a narrow opt-in (P3). Implementation followed:

| Surface | Drifted default | Effect |
| --- | --- | --- |
| Gate | `allow_auto_promote` false → always `hold` | Meaning stays non-search-default |
| CLI `agentic run` | `--allow-auto-promote` default false | Product path is staging, not compound |
| Materialize | hold → draft Observation | Default search excludes the brain’s output |
| Human tools | promote-held / accept-claim as “product path” | HITL becomes load-bearing |
| Runner | operator must invoke `run` | Brain does not breathe without human |

This ADR corrects that drift. Phases P0–P6 machinery may remain; **defaults and
product contract** change.

## Decision

### D1 — Agentic Layer product contract (normative)

Agentic Layer’s success criterion is:

> After agent sessions, **without any human review step**, CarpeOS has more
> **default-searchable, typed, cited meaning units**, and the next agent can
> retrieve them via MCP/CLI defaults.

| Path | HITL required? |
| --- | --- |
| Capture → agentic process → usable meaning in default retrieval | **No** |
| Kill switch / spend cap / network off | Operator config only |
| Correct a bad unit, reject a false promote, audit | **Optional after the fact** |
| Human must clear held queue for value | **Forbidden as product design** |

### D2 — Two epistemic layers (keep honesty without required HITL)

Separate **usable meaning** from **formal acceptance**:

| Layer | Who creates | Default retrieval | HITL |
| --- | --- | --- | --- |
| **Usable meaning** (active Observation; agentic-visible Claim units) | Agentic gate after E5 | **Included by default** | Not required |
| **Formal acceptance** (`AcceptanceDecision`) | Human only, explicit | May further boost ranking | Never automatic; never required for S1–S3 success |

Still true from ADR 0017:

- Never auto-create `AcceptanceDecision`.
- Never LLM-only `Supersession`.
- LLM confidence is a feature, not sole authority.

### D3 — Gate default flips: **promote-when-verified** (not hold-first)

Replace ADR 0017 D6 default materialization.

**Old:** default HOLD; auto-promote only if opt-in flag (human review was the real
statement check).  
**New:** default **PROMOTE usable meaning** only when **deterministic verification
actually grounds the statement**, not merely when a quote substring exists.

#### D3.1 E5 must verify statement grounding (blocking prerequisite)

Current `verifyExtractCandidate` only checks `citations[].quote ⊆ pack` and secrets.
It does **not** bind `statement` to the cited span. Under promote defaults that is
catastrophic (model can attach any in-pack quote to a fabricated decision).

Before any default flip ships, E5 MUST enforce at least:

1. Non-empty citations; each `quote ⊆ pack` (existing).
2. **Statement grounded in cited span(s):** either statement equals/normalizes to a
   cited quote, or token-overlap / containment exceeds a frozen threshold, **and**
   `len(statement) ≤ k · max_cited_quote_len` for frozen k.
3. Secret / injection gates on statement + quotes.
4. Adversarial fixtures with `statement ≠ quote` (including “wrong decision + real
   substring quote”) must reject.

Name this **promote-when-verified**, not “promote-when-clean”, so implementers cannot
satisfy the ADR with today’s quote-only check.

#### D3.2 Promote conditions (after D3.1)

Promote usable meaning when all of:

1. E5 **statement-grounded** cite integrity (D3.1).
2. Secret / injection gates pass.
3. Kind ∈ **usable allowlist v1:** `decision` | `constraint` | `preference` only.  
   - `procedure`: hold-biased by default (config may promote later).  
   - `open_question`: hold side channel only.  
   - `fact_candidate`: **not** in v1 usable allowlist (see D4).
4. Statement length / shape gates pass.
5. **Licensing suite** (D3.3) green under the **same defaults as production**.

Otherwise reject or hold (side channel only — never the main value path).

#### D3.3 Precision / licensing suite (must not be tautological)

The existing golden-12 fake suite with `hint_kind` ground truth and admit-regex
negatives does **not** license a default flip (it never stresses the gate on
hard negatives; confidence is hard-coded; statement≡quote in fake mode).

Before flip, ship a **named offline corpus** that:

1. Replays **recorded** `deepseek-v4-flash` JSON (no live network in CI).
2. Includes cases **without** `hint_kind` (kind assignment measured).
3. Includes negatives that **reach the gate** (pass admit/triage, must not promote).
4. Includes SessionEnd-shaped multi-topic packs, not only 40–90 char one-liners.
5. Keeps must_not_promote leaks = 0 and a documented precision floor.

#### D3.4 CLI / flags

- Product default: promote-when-verified (no opt-in required).
- Escape: `CARPEOS_AGENTIC_HOLD_FIRST=1` / `--hold-first` for debug only.

### D4 — Materialize defaults: active usable units

When gate decides **promote**:

- Observation: `lifecycle_status: active` (default search).
- disposition: `promote` under `policy_version: agentic_v1`.
- Carry **agentic formation audit** onto the unit or disposition in a form
  retrievable later (policy_version / formation marker) so bulk retract and
  “machine-formed” filter are possible.

When gate decides **hold** (side channel only):

- Observation: `draft` + disposition `hold` (excluded from default search).
- Ambiguous triage (`need_context`) must either hold a listable unit or be
  explicitly documented as drop — not silently “held” in prose while dropping.

**Decision dual-write (kind=decision only):**

- **Observation-primary:** active Observation is the usable unit.
- Optional draft Claim is additive and must not block visibility.

**fact_candidate (v1):**

- Remains **out of usable allowlist** (not auto-promoted into default search).
- May still materialize as draft Claim for later formal accept — **never** as the
  sole main compound path.
- This explicitly supersedes reading ADR 0017 D7 “draft Claim only” as “and
  therefore HITL is required for any fact-like knowledge to be usable.” Usable
  knowledge for v1 compound is Observation-primary allowlist kinds.

### D4b — Retraction primitive (blocking with default flip)

Append-only store today has **no local demote/supersession writer** for a wrongly
promoted active Observation (`reject-held` only works on holds).

Before or in the **same release** as the default flip, ship a human correction
primitive that can remove a unit from default search without requiring HITL on the
happy path, e.g.:

- local Supersession / lifecycle demote + rebuild, with audit record; or
- equivalent append-only “retract agentic promote” event that projections honor.

Rollback flags that only change **future** defaults are not sufficient.

### D5 — Always-on post-capture runner (brain breathes)

- After capture commit, feed insert remains fail-open (no await LLM in capture).
- **S3 product contract:** after setup, knowledge compounds **without** the operator
  remembering to type `carpeos agentic run`. Opportunistic drain alone is **not**
  sufficient to claim S3 unless it is proven to run on the actual capture-complete
  path or a real timer is installed.

Phased delivery (honest):

| Phase | Mechanism | May claim S3? |
| --- | --- | --- |
| **A** | Bounded drain on MCP start + selected CLI; fail-open; feed mutual exclusion | Only if capture-complete path also triggers drain or timer ships |
| **B** | `carpeos setup` installs reversible user timer: every **30 minutes**, if feed non-empty, `carpeos agentic run --once --materialize` (network off by default) | **Yes** for S3 |

Required with always-on:

- **Persistent day spend cap** in agentic DB (in-memory per-process caps are not enough).
- **Extract gated on triage keep** (do not always call extract after drop).
- **First-run migration bound:** promote-when-verified applies to feed rows created
  **after** flip by default; historical backlog needs explicit backfill promote or a
  capped first-run with printed receipt.
- Kill: `CARPEOS_AGENTIC=off`.
- Network still off by default.

### D6 — Human tools are correction-only

| Command / API | Role after this ADR |
| --- | --- |
| `promote-held` / `reject-held` | Correction of side-channel holds |
| `accept-claim` | Optional formal acceptance stamp |
| `reconcile` | Emits cleanup proposals; auto-apply of safe dedupe may land later under E5+identity rules |
| list-held / list-claims | Observability |

Documentation and UX must not present these as the primary way knowledge becomes usable.

### D7 — adj_v3 relationship

- `adj_v3` remains a **cheap prefilter / comparison baseline**.
- Agentic is the **write-time brain** for typed meaning when enabled.
- Product story for operators: one loop (“capture → knowledge compounds”).  
  Internal dual policy versions may remain; user-facing setup should not require
  understanding two brains to get value.

### D8 — Success criteria (HITL-free)

| ID | Criterion |
| --- | --- |
| S1 | Zero human review steps between SessionEnd-class capture and default-searchable unit for allowlisted **verified** extracts |
| S2 | MCP/CLI default retrieval returns those units without `include_held` or accept-claim |
| S3 | Post-capture processing runs without manual `agentic run` (timer and/or capture-complete drain — not opportunistic-only theater) |
| S4 | **Named** offline licensing corpus (D3.3) green under production defaults; zero must_not_promote leaks |
| S5 | Capture path still has zero LLM/network/agentic await |
| S6 | Zero automatic `AcceptanceDecision` events from agentic runner |
| S7 | Wrongly promoted unit can be retracted from default search without rewriting history (D4b) |

### D9 — Non-goals (unchanged / clarified)

| Non-goal | Note |
| --- | --- |
| LLM in capture | Unchanged |
| Auto `AcceptanceDecision` | Unchanged — not required for compound loop |
| Multi-model escalation | Unchanged Flash-only |
| Hosted graph SoT | Unchanged |
| Free-form `related` spam | Unchanged |
| Requiring human review for value | **Newly explicit anti-goal** |

## Consequences

### Positive

- Restores the reason Agentic Layer was introduced: **close the loop without HITL**.
- Aligns implementation defaults with product north star.
- Keeps epistemic honesty via separate formal acceptance layer.

### Risks

- More active Observations may enter default search → must keep E5 + precision suite hard.
- Always-on runner cost/CPU → spend caps, batching, SessionEnd-only admit remain essential.
- Operators who relied on hold-first staging need a documented escape hatch.

### Migration

1. Land this ADR + design plan + external review notes (docs only).
2. **Prerequisites (still under hold-first defaults — safe):**
   - E5 statement grounding + adversarial fixtures
   - Non-tautological licensing corpus (recorded Flash optional)
   - Retraction primitive + agentic formation audit marker
   - Day spend cap + triage-gated extract
   - Feed mutual exclusion for concurrent drain
3. Flip gate/CLI/materialize to promote-when-verified; bound historical backlog.
4. Always-on Phase B timer (or capture-complete drain that honestly meets S3).
5. Reposition human CLI as correction-only in help/README.
6. Ship as minor with explicit **behavior-change** CHANGELOG and consent note for
   existing installs (defaults change, not a silent patch).

## Alternatives considered

1. **Keep hold-first; automate only runner** — still leaves usable meaning behind HITL. Rejected.
2. **Auto AcceptanceDecision** — collapses epistemic model; rejected.
3. **Make draft units appear in default search** — confuses draft vs promoted; prefer active Observation promote-when-clean.
4. **Human-only brain** — contradicts product purpose for multi-agent workflows. Rejected.

## References

- ADR 0017 (plane split, Flash-only, E0–E10 topology, no auto AcceptanceDecision)
- ADR 0016 (V5 draft-only cortex)
- ADR 0012 / adj_v3 (prefilter baseline)
- README product thesis: Capture context. Compound knowledge.
- Owner invariant (2026-08-07 session): HITL must not be load-bearing for CarpeOS value
