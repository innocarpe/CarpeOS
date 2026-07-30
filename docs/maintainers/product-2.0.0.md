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
| K4 | Retrieval/pack **default = adjudicated promoted only**; evidence secondary; held optional | **done** (default `active` only; CLI `--include-held` / MCP `include_held` opt-in) |
| K5 | Metrics + golden fixtures (precision-oriented; false-promote tests) | **done** (12-case must-promote / hold / reject golden suite in capture tests) |
| K6 | Doctor reports adjudication health (promote/hold/reject rates, policy version) | **done** (`setup doctor` + `adjudicate --stats`; default search = promoted only) |
| K7 | `pnpm smoke:knowledge` (or extend product smoke) proves non-dump behavior | **done** |
| K8 | Scenario dogfood: “noise session” does not pollute meaning search | **done** (`pnpm smoke:dogfood` multi-hook public-safe scenarios) |
| K9 | Freeze decision for 2.0 contracts (Defer until Approve) | **done (Defer)** — one-read decision recorded; freeze not approved |
| K10 | SemVer **2.0.0** release only after explicit Approve | **blocked** |

## Known gaps and debt after the MVP

The MVP proves the adjudication control flow, not calibrated knowledge quality.
These gaps are first-class backlog for `carpeos-product-210`; a cold start should
not infer that a **done** plumbing gate closes them.

| Area | Current evidence on `main` | Required follow-up | Gate |
| --- | --- | --- | --- |
| Candidate text | Candidate v1 adds bounded decision / preference / constraint / procedure spans with evidence refs; promoted/held statements may include the primary sanitized fragment. | Keep fail-closed secret/dump and scoring-only transcript cases in the golden regression corpus. | K1, K5 **done** |
| Candidate structure | Candidate v1 extracts up to three labeled spans from explicit message/procedure fields. Transcript/text may score but never enter statements directly. Session-level de-noising is not implemented. | Add de-noising only with precision evidence from golden fixtures and dogfood; do not widen raw-text ingestion for recall. | K1 **done (v1)**; K8 residual |
| Calibration | The deterministic golden corpus has four must-promote, four must-hold, and four must-reject cases with reason, lifecycle, and statement-safety assertions. Maintainer dogfood calibration is still pending. | Extend thresholds/fixtures only from public-safe dogfood evidence; do not widen recall speculatively. | K5 **done**; K8 residual |
| Knowledge form | Promote/hold still create **Observations only**. Explicit draft Claims remain available via MCP `memory_propose_claim` (never auto-accepted). | Keep adjudicated auto-Claim drafting **deferred** until claim-form precision fixtures exist; do not enable `allow_auto_claim` for recall. | G009 **defer (evidence-backed)** |
| Hold review | `adjudicate list-held`, `promote-held`, and `reject-held` provide a terminal append-only review path. Promote appends active meaning; reject leaves draft off default search. | Keep review idempotency and no-auto-AcceptanceDecision behavior covered as policy versions evolve. | Operator readiness **done (v1)** |
| Doctor | `setup doctor` reports policy version, promote/hold/reject counts, and promoted-only default search; `adjudicate --stats` remains available. | Keep EN/KO public wording honest as later gates land. | K6 **done** |
| Held retrieval | CLI `--include-held` and MCP `include_held` include draft/held units only when requested; default remains active/promoted only. | Keep docs/tests current as retrieval surfaces expand. | K4 operator surface **done** |
| Policy replay | Dispositions are keyed by `(source_event_id, trust_zone_id, policy_version)`; same policy replays, new policy appends. Active search remains lifecycle `active` only. | Optional operator migration/cleanup of superseded active Observations from older policies. | Audit durability **done (v1)** |
| Dogfood depth | `smoke:dogfood` covers decision/preference promote, PostToolUse noise floods, UserPromptSubmit floods, secret-like rejects, and thanks/ok chatter without default-search pollution. | Keep extending only with public-safe fixtures when new pollution classes appear. | K8 **done** |
| Product proof | `smoke:product` proves the 1.0 capture/extract/search pipeline; it does not prove brain-worthy judgment. | Keep both smoke suites and their claims separate. | K7, honesty |
| Release language | K0–K8 green with evidence; K9 is **Defer** (this decision); K10 remains blocked without chat **Approve**. | Do not tag, publish, deploy, or claim product 2.0 complete. | K9 **Defer**, K10 **blocked** |

The review queue and policy replay work must preserve an append-only disposition
audit. Hooks remain fail-open and fast; no story may move heavy adjudication into
the host-hook path.

## Held review workflow (operator v1)

```sh
# Capture remains fail-open; adjudication runs post-capture.
carpeos adjudicate --event-id "$EVENT_ID"

# Review only unresolved hold dispositions.
carpeos adjudicate list-held --limit 50
carpeos adjudicate promote-held --event-id "$EVENT_ID"
# or: carpeos adjudicate reject-held --event-id "$EVENT_ID"

# Rebuild/search keeps the default promoted-only meaning surface.
carpeos retrieval rebuild
carpeos memory search --query "synthetic durable decision"
```

The initial hold disposition and draft Observation are immutable. `promote-held`
records an append-only review before appending a distinct active Observation;
`reject-held` records review only. Repeating the same decision replays safely,
while an opposite second decision for the same policy version fails. Neither path creates an
`AcceptanceDecision`, and held/draft units remain excluded from default search.

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


## G010 Freeze decision (2026-07-30) — **Defer**

**Decision: Defer freezing product-2.0 public contracts. Do not tag, publish, deploy, or claim product 2.0 complete.**

This is a one-read freeze packet for maintainers. It is **not** approval to release.

### Green gates (evidence on `main`)

| Gate | Evidence |
| --- | --- |
| K0–K3 | ADR 0012 + adj_v1 + Observation promote/hold/reject wiring (PR #94 lineage) |
| K1/K5 | Candidate v1 + 12-case golden suite (PR #97 / #99) |
| K4 | Promoted-only default search; `--include-held` / `include_held` opt-in (PR #103) |
| Operator hold queue | `list-held` / `promote-held` / `reject-held` append-only (PR #100) |
| Policy history | `(source_event, zone, policy_version)` disposition identity (PR #101) |
| K6 | Doctor adjudication health + promoted-only default search (PR #102) |
| K7 | `pnpm smoke:knowledge` |
| K8 | `pnpm smoke:dogfood` multi-hook public-safe scenarios (PR #104) |
| G009 | Adjudicated Claim drafts **deferred** with evidence (PR #105) |

### Validation commands (public-safe)

```sh
pnpm build
pnpm --filter @carpeos/capture test
pnpm --filter @carpeos/local-store test
pnpm --filter @carpeos/cli test
pnpm --filter @carpeos/mcp-server test
pnpm smoke:knowledge
pnpm smoke:dogfood
pnpm smoke:product
pnpm public-boundary
```

### Residual risk (why freeze stays Defer)

1. **Calibration depth** — golden + dogfood are synthetic; no maintainer-signed real-session calibration pack is claimed.
2. **Session de-noising** — candidate v1 does not implement multi-turn session de-noising.
3. **Claim form** — adjudicated Claim drafts remain deferred (G009); accepted facts still require explicit AcceptanceDecision paths outside adjudication.
4. **Older-policy active units** — policy re-adjudication can leave historical actives; cleanup is optional residual.
5. **1.0 vs 2.0 honesty** — 1.0 remains pipeline infrastructure; 2.0 adjudication is operator-real MVP, not a finished knowledge product.

### Deferred work (not blockers for documenting Defer)

- Claim-form precision suite before any `allow_auto_claim` / adjudicated Claim drafts
- Optional cleanup of superseded actives across policy versions
- Further de-noising only with precision evidence
- K10 release packaging **only** after explicit maintainer chat **Approve**

### Hard non-actions without Approve

- Do **not** cut or retag `v2.0.0`
- Do **not** publish `@innocarpe/carpeos@2.0.0`
- Do **not** unpublish or retag `v1.0.0` / `@innocarpe/carpeos@1.0.0`
- Do **not** claim product 2.0 complete in README or release notes

**Freeze status:** Defer.
**Release status (K10/G011):** blocked until a maintainer says **Approve** in chat after reading this packet.


## Relationship to shipped code

**Already merged in PR #94:** candidate scoring, `adj_v1`, disposition storage,
promote→active / hold→draft / reject→evidence-only routing, promoted-only default
retrieval, and `smoke:knowledge`.

- **Reuse:** capture, local-store, fail-open hooks, policy guards, retrieval
  ranking, and both smoke harnesses.
- **Extend:** candidate calibration and session de-noising, policy-version
  disposition history, doctor, and explicit held retrieval.
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


## G009 Claim-form decision (2026-07-30)

**Decision: Defer auto Claim drafting from adjudication.**

Evidence reviewed:

1. Candidate v1, golden adjudication suite, held review, policy history, doctor, held-search opt-in, and dogfood are green — Observation precision is stable enough for the MVP meaning loop.
2. Current adjudicate path still materializes **Observation** on promote/hold only (`packages/local-store` + `adj_v1`). There is no claim-form selector with precision fixtures comparable to the Observation golden corpus.
3. Product defaults keep `allow_auto_claim: false` (ADR 0011). Enabling it without claim-specific must-promote/must-hold/must-reject fixtures would be a recall-seeking classification change.
4. Operators already have an explicit, non-auto path: MCP `memory_propose_claim` writes **draft** Claims only and never writes `AcceptanceDecision` (ADR 0002 / 0008).
5. Dogfood/K8 pollution proof validates Observation promote vs noise; it does not prove assertive Claim quality.

Therefore G009 does **not** wire adjudicated Claim drafts. Follow-up requires:

- public-safe claim-form golden fixtures (must_draft_claim / must_observation_only / must_reject),
- explicit provenance/support rules for auto drafts,
- still **no** automatic `AcceptanceDecision`.
