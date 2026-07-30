# Product 2.0.0 — Definition of Done (knowledge adjudication)

Status: **design SSOT** for the next major product milestone.  
Not shipped. Do not claim 2.0.0 until this document’s gates are green **and** a
maintainer records explicit Approve.

Related:

- [Product 1.0.0 DoD](product-1.0.0.md) — **what already shipped** (honest scope)
- [ADR 0011](../adr/0011-meaningful-unit-extraction-policy.md) — lifecycle extraction defaults (1.0)
- [ADR 0002](../adr/0002-immutable-epistemic-model.md) — Observation / Claim / Acceptance
- Public package line after 1.0: `@innocarpe/carpeos` stays on SemVer; **2.0.0 is a
  product-meaning major**, not “rename the same loop”

---

## Honest split: 1.0 vs 2.0

| | **1.0.0 (shipped)** | **2.0.0 (this document)** |
| --- | --- | --- |
| What it is | Local **pipeline + contract freeze** | **Knowledge OS**: decide what is brain-worthy |
| Core success | Capture → store → extract shell → search | **Adjudicate** what becomes durable meaning |
| Judgment today | Lifecycle allowlist + privacy patterns | Content/value/durability judgment |
| Risk if frozen early | Call storage “memory” | — |
| Tag policy | Already cut `v1.0.0` — **do not untag** | New major only after this DoD + Approve |

**Maintainer stance (2026-07-30):** Calling the pipeline freeze “1.0 product complete”
overstated the original CarpeOS thesis. Version number stays; product truth moves to **2.0**.

> Without reliable judgment of *what is worth remembering*, CarpeOS is an encrypted
> session dump + search UI — **not** a knowledge operating system.

---

## What 2.0.0 means (SOURCE OF TRUTH)

**`2.0.0` means CarpeOS can decide, with explicit policy and evidence, which session
fragments become durable knowledge (and which stay raw evidence or are discarded
from the meaning surface).**

Core loop (all must be true):

```
LLM session (Claude / Codex / Grok / …)
  → capture still lands encrypted evidence (1.0 path remains)
  → CANDIDATE generation (what might be knowledge)
  → ADJUDICATION (brain-worthy? durable? sensitive? noise?)
  → disposition: promote | hold | reject | forget-later
  → promoted units are Observation / Claim / Decision with provenance
  → search + context-pack default to **adjudicated** meaning first
  → human (or strict policy) can accept/reject Claims
  → automated E2E proves judgment quality on synthetic fixtures
  → THEN freeze 2.0 public contracts that depend on judgment APIs
```

### Non-goals for 2.0 (explicit)

| Non-goal | Why |
| --- | --- |
| GraphRAG completeness | Projection quality; orthogonal to “worth remembering” |
| Multi-Mac “just works” | Ops, not judgment |
| Hosted public edge | Trust boundary separate |
| Perfect human-level taste | MVP must be **better than dump**, not omniscient |
| Logging every tool call into meaning | Still noise by default |
| Silently rewriting 1.0 contract without MAJOR | 1.0 freeze stands |

Private CF sync may keep working; it does not define 2.0.

---

## The missing product: adjudication

### 1.0 judgment (insufficient alone)

1. Hook fired?  
2. Lifecycle on extraction allowlist?  
3. Secret-like text?  
4. Never auto-AcceptanceDecision  

Useful plumbing. **Not** “is this knowledge?”

### 2.0 judgment (required)

| Stage | Question | Output |
| --- | --- | --- |
| **Candidate** | What spans of session/evidence could be knowledge? | Candidate set (with evidence refs) |
| **Value** | Worth remembering later? (decision, constraint, preference, fact, procedure) | score + labels |
| **Durability** | One-off chatter vs lasting? | durable / ephemeral |
| **Trust** | Self-report, observed, derived, needs review? | epistemic hint (not acceptance) |
| **Risk** | Secret, toxic dump, wrong-zone? | block promote |
| **Disposition** | promote / hold / reject / schedule-forget | action + reason code |
| **Form** | Observation vs Claim draft vs Decision support? | unit type |
| **Surface** | Default search/pack include? | yes / no / secondary |

Promote without disposition audit trail is not allowed.

---

## Architecture (target)

Keep 1.0 layers; **insert adjudication between evidence and meaning surface**.

```
hooks → capture → EvidenceArtifact (encrypted raw)
                      │
                      ▼
              candidate extractor
                      │
                      ▼
              ADJUDICATOR (rules ± optional LLM)
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
      promote       hold        reject
   Observation/   quarantine   evidence only
   Claim draft    for review   (or drop from
                                meaning index)
                      │
                      ▼
         retrieval index (meaning-first;
         optional “held” tier)
```

### Design defaults (recommendation until overridden)

| Decision | Default for 2.0 MVP |
| --- | --- |
| Where judgment runs | **Post-capture / extract path**, not inside host hook (hooks stay fail-open/fast) |
| Rules vs LLM | **Rules + features first**; optional LLM scorer behind flag (deterministic offline tests must pass without paid LLM) |
| Fail mode | Prefer **hold/reject promote** over false promote (high precision over recall) |
| Dump path | Evidence may still exist; **meaning index must not flood** with rejects |
| Human loop | Claim still needs AcceptanceDecision for “accepted fact”; adjudicator never auto-accepts |
| Idempotency | Same evidence + policy version → same disposition (replay safe) |

---

## Product gates (living) — 2.0

Status below reflects `main` after the adjudication MVP merged in PR #94. A gate
moves to **done** only with linked implementation and verification evidence.

| # | Criterion | Status |
| --- | --- | --- |
| K0 | Spec: this document + ADR for adjudication model | **done** (ADR 0012) |
| K1 | Candidate model + fixtures (synthetic sessions only) | **done** (candidate v1: labeled spans + evidence refs + safe statement fragments) |
| K2 | Rule-based adjudicator MVP (value/durability/risk/disposition) | **done** (`adj_v1`) |
| K3 | Wire promote → Observation/Claim draft; reject stays off meaning index | **done** (promote→active, hold→draft, reject→disp only) |
| K4 | Retrieval/pack **default = adjudicated promoted only**; evidence secondary; held optional | **done** (CLI/MCP search default `active` only) |
| K5 | Metrics + golden fixtures (precision-oriented; false-promote tests) | **partial** (unit + smoke fixtures; no golden suite yet) |
| K6 | Doctor reports adjudication health (promote/hold/reject rates, policy version) | **partial** (`carpeos adjudicate --stats`; doctor wiring later) |
| K7 | `pnpm smoke:knowledge` (or extend product smoke) proves non-dump behavior | **done** |
| K8 | Scenario dogfood: “noise session” does not pollute meaning search | **partial** (smoke covers PostToolUse noise) |
| K9 | Freeze decision for 2.0 contracts (Defer until Approve) | **todo** |
| K10 | SemVer **2.0.0** release only after explicit Approve | **blocked** |

## Known gaps and debt after the MVP

The MVP proves the adjudication control flow, not calibrated knowledge quality.
These gaps are first-class backlog for `carpeos-product-210`; a cold start should
not infer that a **done** plumbing gate closes them.

| Area | Current evidence on `main` | Required follow-up | Gate |
| --- | --- | --- | --- |
| Candidate text | Candidate v1 adds bounded decision / preference / constraint / procedure spans with evidence refs; promoted/held statements may include the primary sanitized fragment. | Preserve fail-closed secret/dump guards and calibrate fragment usefulness through golden fixtures. | K1 **done**; K5 residual |
| Candidate structure | Candidate v1 extracts up to three labeled spans from explicit message/procedure fields. Transcript/text may score but never enter statements directly. Session-level de-noising is not implemented. | Add de-noising only with precision evidence from golden fixtures and dogfood; do not widen raw-text ingestion for recall. | K1 **done (v1)**; K8 residual |
| Calibration | `VALUE_TERMS`, signal length, and score thresholds have unit/smoke coverage but no golden precision corpus or maintainer calibration pass. | Add must-promote / must-hold / must-reject fixtures with reason-code assertions and public-safe dogfood notes. | K5, K8 |
| Knowledge form | Promote and hold currently create Observations only. | Evaluate Claim drafting only after candidate precision is stable; Claims remain draft and never receive automatic AcceptanceDecision. | Deferred candidate for K3 |
| Hold review | Held candidates become draft Observations, but the CLI cannot list, promote, or reject the held queue. | Add an explicit append-only operator review workflow. | Operator readiness |
| Doctor | `carpeos adjudicate --stats` reports counts; setup/install doctor does not report policy version, rates, or the promoted-only search default. | Wire adjudication health into doctor and test the rendered output. | K6 |
| Held retrieval | Retrieval correctly defaults to `active`, but operator-facing CLI/MCP held opt-in is not documented as a supported workflow. | Add and test an explicit draft/held filter while preserving the default. | K4 operator surface |
| Policy replay | `knowledge_dispositions.source_event_id` is the primary key, so replay returns the existing row even if a later policy version should re-evaluate it. | Define append-only source-event + policy-version history and active-set migration semantics in an ADR and tests. | Audit durability |
| Dogfood depth | `smoke:knowledge` covers decision-like SessionEnd versus PostToolUse noise. | Add noisy multi-hook sessions, UserPromptSubmit floods, secret-like candidates, and thanks/ok chatter. | K8 |
| Product proof | `smoke:product` proves the 1.0 capture/extract/search pipeline; it does not prove brain-worthy judgment. | Keep both smoke suites and their claims separate. | K7, honesty |
| Release language | The adjudication MVP is merged, but K1/K5/K6/K8 remain partial and K9/K10 are not green. | Describe 2.0 adjudication as in progress; do not tag or publish 2.0.0 without the gate review and explicit Approve. | K9, K10 |

The review queue and policy replay work must preserve an append-only disposition
audit. Hooks remain fail-open and fast; no story may move heavy adjudication into
the host-hook path.

---

## `carpeos-product-210` story order

The post-MVP plan is intentionally sequential so each operator or policy contract
lands in a coherent PR.

| Story | Title |
| --- | --- |
| G001 | Inventory + living backlog (this document) |
| G002 | Candidate model v1 beyond the metadata shell |
| G003 | Golden adjudication precision suite |
| G004 | Held queue operator workflow |
| G005 | Policy-version re-adjudication |
| G006 | Doctor + public honesty surfaces |
| G007 | Explicit held-search opt-in |
| G008 | Public-safe dogfood scenarios |
| G009 | Optional Claim-form drafting, only after candidate precision is stable |
| G010 | Freeze decision — Defer without explicit Approve |
| G011 | 2.0.0 release — **blocked** without explicit Approve |

---

## Relationship to shipped code

**Already merged in PR #94:** candidate scoring, `adj_v1`, disposition storage,
promote→active / hold→draft / reject→evidence-only routing, promoted-only default
retrieval, and `smoke:knowledge`.

- **Reuse:** capture, local-store, fail-open hooks, policy guards, retrieval
  ranking, and both smoke harnesses.
- **Extend:** candidate calibration and session de-noising, disposition history,
  doctor, operator review, and explicit held retrieval.
- **Do not:** treat lifecycle allowlists, a disposition count, or a metadata shell
  as proof that a unit is brain-worthy.

---

## Versioning note

- Keep **`1.0.0`** on npm as the pipeline/contract baseline. No force-retag.  
- Ship judgment work as **`1.x` MINOR** while APIs stay compatible when possible; cut **`2.0.0`** when adjudication becomes the public product contract (breaking defaults: e.g. search no longer treats raw lifecycle extracts as first-class knowledge without promote).  
- If defaults change in a breaking way earlier, document under SemVer deliberately — prefer one clear **2.0** product story over quiet behavior shifts.

---

## Current recommendation

1. Treat **1.0.0** as **infrastructure 1.0** (honest external language).
2. Treat PR #94 as the **adjudication MVP**, not completion of the knowledge OS.
3. Execute `carpeos-product-210` to close candidate quality, precision proof,
   operator review, doctor, held retrieval, policy replay, and dogfood gaps.
4. Keep the 2.0 freeze decision at **Defer** until its gates are green and a
   maintainer records explicit Approve.

**Do not cut `v2.0.0` without this DoD green + explicit Approve.**
