# ADR 0018 Review — Codex high-effort (requested: gpt-5.6-sol)

Date: 2026-08-07  
Model actually used: **gpt-5.4** with `model_reasoning_effort=xhigh`  
Note: Codex with this ChatGPT login returned `gpt-5.6` “not supported”; review
filename kept for traceability to the owner request.

Subject: `docs/adr/0018-agentic-hitl-free-compound-loop.md`

## Verdict

**APPROVE_WITH_CHANGES**

The direction is correct. The current Product 6 defaults do make HITL load-bearing, and ADR 0018 correctly tries to restore the owner invariant that CarpeOS must complete `capture -> meaning -> next agent` without required human review.

I am not recommending rejection because the architectural direction is sound:

- keep capture LLM-free;
- keep Flash-only when LLM is used;
- keep `AcceptanceDecision` human-only;
- keep projections out of SoT;
- move human tools to correction and audit, not value creation.

I am also not recommending clean approval because the current ADR still leaves two product-contract branches unresolved:

- whether `fact_candidate` can satisfy the HITL-free loop without changing claim semantics;
- whether "always-on" actually means background post-capture processing, or only opportunistic drain on later entrypoints.

Those are not editorial nits. They determine whether implementation restores the intended product loop or merely rebrands the current staging path.

## Intent Restoration

ADR 0018 restores the right product intent in four important ways:

- It correctly states that required human queue-clearing is a product failure, not a safety feature.
- It correctly separates usable meaning from formal acceptance.
- It correctly flips the center of gravity from hold-first to promote-when-clean.
- It correctly treats human review surfaces as correction-only, not the happy path.

That is the right correction to ADR 0017 D6 and the current implementation in:

- `packages/agentic/src/gate.ts:14-16,55-81`
- `packages/agentic/src/runner.ts:120-132,212-221`
- `packages/agentic/src/materialize.ts:25-29,165-168`

The review below is adversarial because the ADR now needs to become implementation-safe. Right now it still permits a few "looks aligned, still fails the invariant" interpretations.

## Critical Findings

### C1. The ADR does not explicitly supersede the `fact_candidate` / claim-only rule it is now contradicting.

**Why this is critical**

ADR 0018 says it supersedes conflicting defaults in ADR 0017 D6 and D10 P2 only. That scope is too narrow. Its own D4 then says the `fact_candidate / decision` path must produce agent-visible knowledge without human accept. ADR 0017 still says `fact_candidate` lands as draft Claim only and never auto-accepted.

That means the current draft simultaneously says:

- `fact_candidate` must be usable without HITL; and
- `fact_candidate` remains a draft Claim that default retrieval excludes unless later accepted.

That is a direct contract collision.

**Evidence**

- `docs/adr/0018-agentic-hitl-free-compound-loop.md:3-6`
- `docs/adr/0018-agentic-hitl-free-compound-loop.md:129-140`
- `docs/adr/0017-agentic-layer-write-time-knowledge.md:106-117`
- `packages/agentic/src/claims.ts:34-48`
- `packages/agentic/src/materialize.ts:270-315`
- `packages/schema/src/index.ts:694-715`
- `packages/okf-projection/src/map.ts:96-105`

**What the evidence shows**

- ADR 0018 limits supersession scope to D6 / D10 P2 framing.
- ADR 0018 D4 still requires a no-HITL usable path for `fact_candidate`.
- ADR 0017 D7 keeps `fact_candidate` as draft Claim only.
- The implementation matches ADR 0017 today: `fact_candidate` materializes as claim-only, and claims remain draft.
- Default retrieval contracts are active/promoted-only unless `include_held` is explicitly enabled.
- OKF export excludes draft claims without accepted lineage.

**Required ADR change**

ADR 0018 must do one of these, explicitly:

1. Supersede ADR 0017 D7 and D10 P5 for the Product 6 default path, and define a new v1 landing contract for `fact_candidate`.
2. Or exclude `fact_candidate` from the HITL-free v1 success path and say so directly in D3, D4, and S1-S2.

Leaving this ambiguous will let implementation claim success while preserving the exact HITL dependency the ADR is meant to remove.

### C2. D5 and S3 promise an always-on post-capture brain, but the plan still allows a later-entrypoint drain that is not actually post-capture.

**Why this is critical**

The ADR says the brain must breathe without the operator typing `carpeos agentic run`, and S3 says setup enables post-capture drain by default. The plan's Phase A does not meet that promise. It runs agentic work only when the MCP server or selected CLI commands later open the store.

That may remove the explicit `run` command, but it does not create a real post-capture default. It still makes later human/tool activity load-bearing for processing to begin.

**Evidence**

- `docs/adr/0018-agentic-hitl-free-compound-loop.md:142-158`
- `docs/adr/0018-agentic-hitl-free-compound-loop.md:183-186`
- `docs/plans/agentic-hitl-free-compound-loop.md:84-99`
- `packages/agentic/src/runner.ts:54-57`

**What the evidence shows**

- The ADR claims a default post-capture runner after setup.
- The plan's first shippable mechanism is opportunistic drain on later entrypoints.
- The current runner only runs when `processAgenticOnce(...)` is called.

**Required ADR change**

Choose one contract and write it normatively:

- Preferred: v1 requires a true background user-level runner after setup; opportunistic drain is additive only.
- Acceptable fallback: lower the promise and stop saying "post-capture runner" or "brain breathes" by default, then redefine S3 accordingly.

I recommend the first option. The owner invariant is about value not depending on humans. A later-entrypoint drain is better than manual `run`, but it is still not the same thing as autonomous post-capture progression.

## Major Findings

### M1. D4 still leaves a normative fork where only one branch is currently compatible with retrieval and claim semantics.

**Problem**

D4 says implementation may pick Option A or Option B. That is too open for an ADR that is trying to restore a hard product invariant. Option B is not a harmless implementation choice. It implies schema/search/default retrieval changes that do not currently exist.

**Evidence**

- `docs/adr/0018-agentic-hitl-free-compound-loop.md:129-140`
- `packages/agentic/src/claims.ts:15-24,34-48`
- `packages/agentic/src/materialize.ts:26-29,165-168,270-315`
- `packages/schema/src/index.ts:694-715`
- `packages/okf-projection/src/types.ts:79-83`
- `packages/okf-projection/src/map.ts:96-105,189-207`

**Why it matters**

If the ADR leaves both branches open, implementers can choose:

- Observation-primary, which fits the current active/default-search model; or
- Claim-visible-by-default, which currently collides with draft-claim and acceptance semantics.

That is too much product-definition work to defer to implementation.

**Required ADR change**

Collapse D4 to one v1 rule:

- Promote path writes active Observation as the authoritative HITL-free usable unit.
- Draft Claim may be additive only.
- No v1 path may depend on default-visible draft claims.

If `fact_candidate` cannot fit that rule cleanly, defer it from the default HITL-free loop.

### M2. "Default retrieval" is underspecified across actual product surfaces.

**Problem**

S2 says default retrieval must return the promoted units without `include_held` or `accept-claim`. That is directionally correct, but it is too vague for this codebase. "Default retrieval" is not one surface.

There are already separate contracts for:

- MCP `memory_search`
- MCP `memory_context_pack`
- GraphRAG ranking
- projection/export surfaces such as OKF

These do not all treat draft units the same way.

**Evidence**

- `docs/adr/0018-agentic-hitl-free-compound-loop.md:183-188`
- `packages/schema/src/index.ts:694-715`
- `packages/okf-projection/src/types.ts:79-83`
- `packages/okf-projection/src/map.ts:96-105,189-207`
- `packages/retrieval/src/graphrag.ts:46-66`

**Why it matters**

Without naming the bound surfaces, implementation can satisfy one surface and quietly miss the others. That is how contract drift returns.

**Required ADR change**

Add a short normative retrieval contract section that names at least:

- MCP `memory_search`
- MCP `memory_context_pack`
- CLI default search / retrieval surfaces
- any default projection or export surface that product copy treats as "knowledge"

Then state exact v1 behavior:

- promoted active Observations must appear by default;
- held/draft Observations remain excluded unless explicitly requested;
- draft Claims remain excluded unless a future ADR changes claim visibility semantics;
- GraphRAG may score draft typed units internally, but S2 is satisfied only by default-visible promoted active units.

### M3. The precision gate is currently offline-fake only, but the runner has a separate live Flash execution path.

**Problem**

ADR 0018 relies on the precision suite as a hard fence for promote-when-clean. That is necessary, but not sufficient for the live network path the runner already supports.

The code runs an offline-first fake pass, then, when network is allowed, separately calls live Flash triage and extract and reruns the pipeline with those results. The precision suite does not validate that live path today.

**Evidence**

- `docs/adr/0018-agentic-hitl-free-compound-loop.md:99-105`
- `docs/adr/0018-agentic-hitl-free-compound-loop.md:183-188`
- `packages/agentic/src/precision.ts:1-4,26-33,56-68`
- `packages/agentic/src/runner.ts:120-177`

**Why it matters**

An offline-fake suite can prove that the gate logic is strict. It cannot prove that the actual live Flash outputs will stay inside the intended distribution once network use is enabled.

**Required ADR change**

Add one of these constraints:

- v1 promote-default ships only for offline/fake until a recorded-live or fixture-based live validation corpus exists; or
- live Flash promote-default is allowed only when a separate live-path validation gate passes under the exact prompts/model used by the runner.

Also state explicitly that any background runner with live network enabled must require explicit operator opt-in and spend caps.

### M4. "Correction later" is underspecified against the append-only store contract.

**Problem**

ADR 0018 says humans may correct, audit, and kill. That is right. But "correct" is too vague in this repository unless it is tied to append-only correction mechanisms.

The canonical store and knowledge disposition tables are explicitly append-only. Erasures are imported ledger records. Human review today is a held-review audit path plus human `AcceptanceDecision`. There is no visible local agentic supersession writer in the reviewed surfaces.

If the ADR does not spell this out, implementers may reach for deletion, mutable suppression, or projection-layer hiding as if those were canonical correction mechanisms.

**Evidence**

- `docs/adr/0018-agentic-hitl-free-compound-loop.md:27-29`
- `docs/adr/0018-agentic-hitl-free-compound-loop.md:160-169`
- `packages/local-store/src/store.ts:1217-1234`
- `packages/local-store/src/store.ts:2722-2794`
- `packages/local-store/src/store.ts:2909-3062`
- `packages/local-store/src/store.ts:3862-3890`
- `packages/local-store/src/store.ts:4212-4234`
- `packages/local-store/src/store.ts:4334-4356`

**Why it matters**

The owner invariant does not override the immutable epistemic model. If a bad promoted unit is later corrected, the correction must preserve provenance and append-only semantics.

**Required ADR change**

Add a short correction semantics clause:

- no delete or update of canonical events;
- no projection treated as SoT;
- false promote correction in v1 happens via held-review rejection before promotion, future append-only supersession, erasure-aware projection behavior, or explicit later correction ADRs;
- `AcceptanceDecision` remains separate and human-only.

### M5. `procedure` should not remain configurable for auto-promote in v1.

**Problem**

ADR 0018 keeps `procedure` in a half-open state: maybe promote with a hold bias or higher floor, product config. That is exactly the kind of escape hatch that causes a "safe exception" to become the new default later.

ADR 0017 was at least clearer: `procedure` was hold-biased.

**Evidence**

- `docs/adr/0018-agentic-hitl-free-compound-loop.md:101-105`
- `docs/adr/0017-agentic-layer-write-time-knowledge.md:112-117`

**Why it matters**

`procedure` is the most likely kind to turn incidental workflow text into polluted active memory. If the point of ADR 0018 is to restore autonomy without sacrificing epistemic hygiene, do not leave this as a config-shaped loophole in v1.

**Required ADR change**

Freeze `procedure` as hold-only for v1. Revisit only after a dedicated eval slice proves it can promote safely without pushing recall quality backward.

## Minor Findings

### N1. The ADR and design plan are future-dated relative to the current workspace date.

**Evidence**

- current workspace date: Thursday, 2026-08-06
- `docs/adr/0018-agentic-hitl-free-compound-loop.md:4`
- `docs/plans/agentic-hitl-free-compound-loop.md:4`

**Why it matters**

This is not a product-design blocker, but it is a documentation credibility defect. Forward-dated ADRs make later archaeology harder, especially when the file is still in proposed status.

**Required change**

Use `2026-08-06`, or explicitly explain why the documents are intentionally pre-dated for an August 7 review window.

### N2. A few phrases still read like product rhetoric rather than verifiable contract.

Examples:

- "brain breathes"
- "usable meaning"
- "default-searchable" without naming the surfaces

These are good thesis phrases, but the ADR should immediately tie them to observable criteria and named interfaces.

## Risks If Shipped As Written

- Implementers may preserve draft-claim semantics and still claim the HITL-free loop is restored.
- Phase A opportunistic drain may be shipped and later defended as "always-on enough," even though it is not post-capture by default.
- Live Flash promotion may piggyback on fake-only precision evidence and poison default retrieval when network use is enabled.
- Correction logic may drift into projection-only hiding or mutable suppression because the ADR does not anchor it to append-only store semantics.
- `procedure` may quietly become an unsafe promote class through config rather than through an explicit ADR/eval decision.

## Concrete ADR Edits

1. Expand the supersession clause at the top of ADR 0018.
   State that ADR 0018 supersedes ADR 0017 D6, D7, and D10 product-default semantics wherever those semantics make HITL load-bearing for usable knowledge.

2. Replace D4 Option A / Option B with one normative v1 contract.
   Recommended text: "For v1, the HITL-free usable unit is an active Observation. Draft Claims remain additive and never satisfy S1-S3 on their own."

3. Explicitly carve `fact_candidate` in or out of v1.
   Recommended text: "If `fact_candidate` cannot land as an active Observation without collapsing claim semantics, it is excluded from the v1 HITL-free success path."

4. Rewrite D5 and S3 so they say the same thing.
   Recommended text: "After setup, a background user-level runner is the default path. Opportunistic drain on later entrypoints is additive only."

5. Add a "Retrieval contract" subsection after D4 or D5.
   Name the required default surfaces and define exact behavior for promoted active Observations, held Observations, and draft Claims.

6. Add a "Live-path validation" clause.
   Recommended text: "Offline precision is necessary but not sufficient for live Flash auto-promotion. Live promote-default requires separate recorded/live validation under the same prompts/model."

7. Add a short "Correction semantics" clause.
   Recommended text: "Corrections preserve append-only provenance. No canonical delete/update. No projection as source of truth."

8. Freeze `procedure` out of v1 auto-promote.
   If the owner later wants it, require a follow-up ADR or explicit eval gate.

9. Fix document dates or explain the intentional forward-dating.

## PR Plan

I would not implement this as one feature stream. The wrong order will create more semantic debt.

### PR0

`docs(adr): harden ADR 0018 product contract`

Scope:

- expand supersession scope;
- collapse D4 to one v1 path;
- resolve `fact_candidate` status;
- align D5 and S3;
- add retrieval contract and correction semantics;
- freeze `procedure` out of v1 auto-promote;
- fix dates.

### PR1

`feat(agentic): flip promote-when-clean defaults for observation-primary path`

Scope:

- default `allow_auto_promote` true across runner, pipeline, and materialize surfaces;
- keep claims draft-only;
- update gate/materialize tests and golden expectations.

### PR2

`test(retrieval): bind S2 to default retrieval surfaces`

Scope:

- MCP default search/context-pack assertions;
- projection/export assertions for default active-only visibility;
- explicit proof that promoted active Observations show up without `include_held`.

### PR3

`feat(agentic): ship true default runner semantics`

Scope:

- background user-level runner after setup;
- opportunistic drain kept as additive fallback only;
- kill switch and reversibility documented.

### PR4

`test(agentic): add live-path validation gate for Flash promote-default`

Scope:

- recorded fixture or controlled live validation for runner prompts/model;
- no live promote-default until this is green.

### PR5

`spec(agentic): decide fact_candidate v1 fate`

Scope:

- only needed if PR0 does not explicitly exclude `fact_candidate` from the default HITL-free path;
- otherwise defer to a later ADR after claim semantics are intentionally redesigned.

## Open Questions

1. Is `fact_candidate` part of the v1 HITL-free success path, or is it explicitly deferred?

2. Does "always-on by default" mean a real background runner after setup, or only processing on the next CarpeOS entrypoint?

3. If live Flash is enabled later, is autonomous background spend acceptable by default, or must that remain a second explicit opt-in after setup?

4. Are draft Claims ever intended to be visible in default retrieval without `AcceptanceDecision`? If yes, which exact surfaces change, and under what epistemic label?

5. Is `procedure` actually trusted enough for v1 auto-promote, or should the ADR fail closed and keep it hold-only?

## Bottom Line

ADR 0018 is correct about the product problem and correct about the direction of the fix.

It is not yet precise enough to implement safely.

The hard requirement for approval is simple:

- define one v1 usable-unit contract;
- define one v1 runner contract;
- bind both to the actual retrieval and append-only store semantics already present in this repository.

Do that, and the ADR becomes strong enough to drive implementation without recreating the same drift under new language.
