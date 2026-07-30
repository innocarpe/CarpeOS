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

Status: `todo` until stories land.

| # | Criterion | Status |
| --- | --- | --- |
| K0 | Spec: this document + ADR for adjudication model | **todo** |
| K1 | Candidate model + fixtures (synthetic sessions only) | **todo** |
| K2 | Rule-based adjudicator MVP (value/durability/risk/disposition) | **todo** |
| K3 | Wire promote → Observation/Claim draft; reject stays off meaning index | **todo** |
| K4 | Retrieval/pack **default = adjudicated promoted only**; evidence secondary; held optional | **todo** |
| K5 | Metrics + golden fixtures (precision-oriented; false-promote tests) | **todo** |
| K6 | Doctor reports adjudication health (promote/hold/reject rates, policy version) | **todo** |
| K7 | `pnpm smoke:knowledge` (or extend product smoke) proves non-dump behavior | **todo** |
| K8 | Scenario dogfood: “noise session” does not pollute meaning search | **todo** |
| K9 | Freeze decision for 2.0 contracts (Defer until Approve) | **todo** |
| K10 | SemVer **2.0.0** release only after explicit Approve | **blocked** |

---

## Suggested story order (ultragoal-ready)

Use plan id e.g. `carpeos-product-200` when creating goals.

| Story | Title |
| --- | --- |
| K001 | Spec/ADR: knowledge adjudication model + dispositions |
| K002 | Candidate extraction from evidence (better than metadata-only shell) |
| K003 | Rule adjudicator MVP + fixtures |
| K004 | Promote/hold/reject write path + idempotency |
| K005 | Retrieval/pack adjudicated-first |
| K006 | Optional LLM adjudicator adapter (off by default; same interface) |
| K007 | Doctor + operator path + EN/KO honesty |
| K008 | Knowledge smoke + CI |
| K009 | Dogfood noise vs knowledge scenarios |
| K010 | 2.0 freeze decision (Defer) |
| K011 | 2.0.0 release (**only** after Approve) |

---

## Relationship to 1.0 shipped code

**Reuse:** capture, local-store, hooks install, policy hooks, retrieval ranking hooks, smoke harness.  
**Replace/extend:** metadata-only “Observation for every Stop/SessionEnd” must become **candidate → adjudicate → maybe promote**.  
**Do not:** pretend lifecycle allowlist alone is brain-worthy judgment.

---

## Versioning note

- Keep **`1.0.0`** on npm as the pipeline/contract baseline. No force-retag.  
- Ship judgment work as **`1.x` MINOR** while APIs stay compatible when possible; cut **`2.0.0`** when adjudication becomes the public product contract (breaking defaults: e.g. search no longer treats raw lifecycle extracts as first-class knowledge without promote).  
- If defaults change in a breaking way earlier, document under SemVer deliberately — prefer one clear **2.0** product story over quiet behavior shifts.

---

## Current recommendation

1. Treat **1.0.0** as **infrastructure 1.0** (honest external language).  
2. Make **adjudication** the only critical path for “CarpeOS product complete.”  
3. Start ultragoal `carpeos-product-200` from this brief when ready to execute.

**Do not cut `v2.0.0` without this DoD green + explicit Approve.**
