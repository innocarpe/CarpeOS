# Review: ADR 0018 + HITL-free compound loop design

Reviewer: Claude (Opus)
Date: 2026-08-07
Scope reviewed:

- `docs/adr/0018-agentic-hitl-free-compound-loop.md`
- `docs/plans/agentic-hitl-free-compound-loop.md`

Cross-read against the implementation on `worktree/6.0.0` @ `79a4bf3`
(`packages/agentic`, `packages/local-store`, `packages/retrieval`,
`apps/carpeos-cli`, `apps/carpeos-mcp-server`, `fixtures/agentic/v1/golden-12`)
and against ADR 0017.

---

## 1. Verdict

**Accept the premise. Do not accept the current safety argument.**

The product judgment in D1 is right and I would not argue against it: a knowledge
OS whose meaning units require a human to click promote is a ticket system with a
transcript log attached. The drift diagnosis in §14 of the plan ("safety theater
was treated as product completion") is accurate and the ADR is correct that ADR
0017 D6 is the root cause, not the implementers.

What the ADR gets wrong is **what is currently holding the line**. The ADR treats
hold-first as redundant safety on top of a working E5 verifier, and therefore
treats removing it as a defaults change. It is not. Today the human review step
*is* the verifier for statement fidelity — E5 as implemented does not check the
thing the ADR says it checks (§3.1), and the precision suite the ADR cites as the
release gate (D3.5 / S4) cannot detect the failure it is supposed to detect
(§3.2). Flipping the default on top of that is not "restoring intent"; it is
removing the only real check.

This is fixable, and the fix does not reintroduce HITL. The strongest version of
this ADR replaces the human with a **deterministic second checker**, rather than
deleting the check. Concrete proposal in §6.

Recommended disposition:

| | |
| --- | --- |
| ADR 0018 D1 / D2 / D6 / D7 / D8 / D9 | Accept |
| ADR 0018 D3 (promote-when-clean) | Accept **conditional** on B1 + B2 + B3 landing first |
| ADR 0018 D4 (materialize defaults) | Accept option A; internal contradiction to fix (§4.2) |
| ADR 0018 D5 (always-on runner) | Accept intent; Phase A as specified is not safely implementable today (§3.7). Defer Phase B out of the release |
| Plan PR order | Re-order (§7) |
| "Ship as minor 6.6.x" | Needs a consent decision for existing installs (§4.6) |

---

## 2. What I verified in the code

Recording this because several ADR claims are correct and should not be
re-litigated by the next reviewer.

| ADR / plan claim | Verified? | Evidence |
| --- | --- | --- |
| Gate default is hold-first, auto-promote is opt-in | Yes | `packages/agentic/src/gate.ts:59-73` |
| CLI `--allow-auto-promote` defaults false | Yes | `apps/carpeos-cli/src/index.ts:1485` |
| Materialize writes `draft` unless promote is explicitly allowed | Yes | `packages/agentic/src/materialize.ts:165-167` |
| MCP default retrieval is active-only; `include_held` adds draft | Yes | `apps/carpeos-mcp-server/src/tools.ts:593-594` |
| Runner must be invoked by an operator (no scheduler, no drain) | Yes | `processAgenticOnce` has exactly one caller, `apps/carpeos-cli/src/index.ts:1565`; MCP server has no agentic code and does not depend on `@carpeos/agentic` (`apps/carpeos-mcp-server/package.json`) |
| Capture path has no LLM / network / agentic await | Yes | `packages/local-store/src/store.ts:990-1007` — feed insert is post-commit, synchronous SQLite, swallowed on error |
| D4 option A needs no schema change | **Yes, and cleanly** | Observation chunks derive lifecycle from the observation alone (`packages/retrieval/src/chunks.ts:165-180`), so a dual-written draft Claim does not poison the active Observation chunk; Claim chunks pull in supporting events (`chunks.ts:122-131`) and go draft via `deriveLifecycleStatus` (`chunks.ts:294-296`), so a `decision` dual-write yields one visible active chunk and one hidden draft chunk — no duplicate in default search |
| GraphRAG already favours active meaning units | Yes | `packages/retrieval/src/graphrag.ts:48-61` |
| `fact_candidate` currently lands as draft-Claim-only, invisible to default search | Yes | `packages/agentic/src/claims.ts:41-43` + `tools.ts:594` |

So: D4's "no schema break" and S2's feasibility are real. The retrieval half of
this ADR is sound. The problems are all upstream of materialize.

---

## 3. Blocking findings

### B1 — E5 verifies the citation, not the statement. This is the load-bearing gap.

D3 condition 1 reads "E5 cite integrity pass (`cite_ok`, non-empty citations,
quote ⊆ pack)". That is exactly what `verifyExtractCandidate` implements
(`packages/agentic/src/verify.ts:8-39`): it tests that `citations[].quote` is a
substring of the pack, and runs a secret regex over statement and quote.

It never relates the **statement** to the **quote**.

In the live path the statement is unconstrained model output:

```ts
// packages/agentic/src/stages.ts:265-275
const quote = (c.quote ?? c.statement ?? "").trim();
if (quote.length === 0 || !input.pack_text.includes(quote)) continue;
...
statement: (c.statement ?? quote).trim(),
```

Failure mode under promote-when-clean: Flash returns
`{kind: "decision", statement: "We decided to disable the sync credential check",
quote: "<any 8+ char substring that really is in the transcript>", confidence: 0.8}`.
`cite_ok` = true, `secret_ok` = true, kind is allowlisted, length gate passes,
confidence floor passes → **promote** → active Observation → default search → next
agent reads it as a decision the team made. There is no human step and, per B3, no
retraction path.

Under hold-first this is survivable: the statement lands as a draft and a human
sees it before it can be retrieved. The ADR removes that reviewer without
strengthening the check that the reviewer was performing.

Note this is invisible in every existing test, because in fake mode the statement
*is* the quote (`stages.ts:216-229`), so statement/quote divergence has literally
never been exercised.

**Required before D3 ships:**

1. A deterministic statement-grounding check in E5: statement must be the cited
   span, a normalized subset of it, or exceed a token-overlap threshold against
   the cited span; plus `len(statement) ≤ k · len(quote)`.
2. Fixtures where `statement ≠ quote`, including the adversarial case above.
3. D3 condition 1 reworded from "quote ⊆ pack" to "statement is grounded in the
   cited span", so a future implementer cannot satisfy the ADR with the current
   check.

### B2 — S4 / D3.5 cite a precision suite that is a tautology. It cannot license the flip.

`evaluateAutoPromotePrecisionSuite` runs the pipeline with `mode: "fake"`
(`packages/agentic/src/precision.ts:57-68`). In that mode:

- The extractor is the same regex family as the classifier
  (`stages.ts:64-72`, `188-238`).
- The kind is **supplied by the fixture**, not inferred:
  `hint_kind` is passed straight through (`precision.ts:62` → `pipeline.ts:175` →
  `stages.ts:202`), and all four positive cases in
  `fixtures/agentic/v1/golden-12/manifest.json` carry a `hint_kind`. The kind
  allowlist — the primary promote condition — is therefore evaluated against
  ground truth.
- Confidence is hardcoded `0.72` (`stages.ts:219`), so the `>= 0.55` floor at
  `gate.ts:58` can never bind.
- All eight negatives are killed **before the gate**: noise and injection at
  admit/triage regex (`admit.ts:56-75`, `stages.ts:118-123`), ambiguous at triage
  `need_context`, which returns early with zero proposals (`pipeline.ts:157-164`).

So the gate is exercised on 4 hand-labelled positives and 0 negatives, and
`precision = 4/4 = 1.0` by construction. `must_not_promote_leaks = 0` is not
evidence that the gate rejects bad promotes; it is evidence that the admit regex
matched the strings the fixture author wrote for it to match. I ran the suite —
it passes, and it would pass with the gate's allowlist check deleted.

The corpus is also not representative of the input D3 will actually see. All 12
cases are single sentences of 40–90 characters. The real S1 input is a SessionEnd
transcript: multi-topic, mixed speaker, containing hypotheticals, quoted error
text, and abandoned proposals. Nothing in the suite tests "model picks the wrong
one of six candidate decisions out of a 4KB pack".

**Required before D3 ships:**

1. A Flash-mode evaluation corpus: record real `deepseek-v4-flash` responses once,
   commit the recorded JSON, replay offline and deterministically. This stays
   within D9's network-off default and within ADR 0017 D3 (same model id).
2. Cases with **no** `hint_kind`, so kind assignment is measured rather than given.
3. Negatives that reach the gate — content that passes admit and triage but must
   not promote (hypotheticals, quoted third-party statements, superseded
   decisions, statements about what someone *proposed*).
4. Real SessionEnd-shaped packs, not one-liners.
5. S4 reworded: "offline precision suite" is not a meaningful bar; name the corpus
   and the mode.

### B3 — There is no way to retract a wrongly promoted unit.

Canonical events are append-only. `packages/local-store/src/store.ts` exposes no
local erasure or supersession writer — the only erasure entry point is
`importPulledErasure` (`store.ts:3862`), which applies erasures arriving from
sync. `reject-held` operates on held dispositions, i.e. only on units that are
still drafts.

The plan's rollback section (§13) says the flag "restores pre-0018 staging
defaults". That restores the *default for future units*. It does not touch units
already written to default search.

D1's contract says humans "may correct, audit, and kill" and D6 frames correction
as "optional after the fact". Both are currently false for a promoted unit: there
is no correction primitive. Removing the pre-write review while the post-write
correction does not exist leaves no control at all on the false-positive path.

**Required:** a retraction primitive (human Supersession, or a lifecycle demote +
reprojection with an audit record) must land **with or before** the default flip,
not as a follow-up. This is the single cheapest thing that makes promote-when-clean
defensible, and it is fully consistent with D2 — retraction is a human correction,
not a human gate.

Related: the human promote path today writes a **held review audit record**
(`store.ts:2990-3050`, `review_id` / decision / reviewer) before materializing an
active Observation. The agentic promote path writes no equivalent canonical audit
— only a disposition row plus a proposal row in the agentic **sidecar** DB. After
the flip, the canonical store will contain active Observations whose formation
decision is only recorded outside the canonical plane. D2's "keep honesty" claim
should be made concrete here.

### B4 — The migration flips a switch in front of an unbounded backlog.

On upgrade, `agentic_capture_feed` may hold an arbitrary number of pending rows
(and `backfillAgenticFeed` exists to add more —
`packages/agentic/src/backfill.ts:15`, `store.ts:1457`). The moment D3 + D5 are
both on, the first drain converts that entire backlog into active Observations in
one pass, unattended, with no per-day budget (see B6).

For an existing dogfooding install this is the worst possible first impression of
the feature: default search goes from "clean" to "hundreds of machine-authored
units" between one command and the next, with no retraction path (B3).

**Required:** the ADR's Migration section must bound the first run. Options, in
order of preference: (a) promote-when-clean applies only to feed rows created
after the flip; historical backlog requires an explicit
`carpeos agentic backfill --promote`; (b) a first-run cap with a printed receipt.

---

## 4. Major findings

### 4.1 — After promote, nothing at retrieval time marks a unit as machine-formed

Agentic Observations are written through `proposeObservationDraft`, which
hardcodes `epistemic_authority: "observed"` (`store.ts:1642`) — byte-identical to
the human/rule extraction path. Retrieval filters on `lifecycle_status` and
`epistemic_authority` (`packages/retrieval/src/query.ts:136`, `:156`) and GraphRAG
boosts on `is_promoted_active` (`graphrag.ts:51`). `policy_version: agentic_v1`
lives on the *disposition*, not on the event, and is not projected into chunks.

Consequence: once D3 ships, an operator cannot ask "show me only human-derived
meaning", cannot filter a suspected-bad batch out of retrieval, and cannot bulk
retract by policy version. MCP results cannot be labelled for the consuming agent.

D2 argues honesty is preserved because `AcceptanceDecision` remains a separate
layer. That is true and worth keeping, but it is a layer **nothing in default
search can see**. The honesty guarantee that actually matters at read time is
missing.

**Recommend:** carry agentic provenance onto the unit — a provenance ref with
`policy_version`, or a chunk-level marker — so filter / audit / bulk-retract /
label are all possible. This also makes B3's retraction primitive implementable as
a set operation rather than one event at a time.

### 4.2 — D3 and D4 contradict each other on `fact_candidate`

- D3 sets the v1 usable allowlist to `decision | constraint | preference`. So
  `fact_candidate` holds.
- D4 says the Claim path "must produce **agent-visible** knowledge without human
  accept" and names it "Claim path (fact_candidate / decision dual-write)", and
  forbids "main path that only writes draft Claim excluded from default search".

Both cannot hold. Under D3, `fact_candidate` never reaches promote, so its
materialize target is irrelevant; under D4 it must be visible.

Sharpening this matters because `fact_candidate` is the fake extractor's
**fallback kind** (`stages.ts:382`) and `materializeTargetsForKind` gives it
Claim-only with no Observation (`claims.ts:41-43`). Whatever the extractor cannot
classify becomes an invisible draft Claim. If D4 is read as "make fact_candidate
visible", the flip converts the *unclassified* bucket into default-searchable
knowledge — the exact opposite of what an allowlist is for.

**Recommend:** restate D4 as applying to the `decision` dual-write only
(Observation-primary, Claim additive), and state explicitly that `fact_candidate`
stays out of the v1 usable allowlist. Then PR3's real job is narrower and clearer:
make sure `decision` produces the active Observation, not a Claim-only unit.

### 4.3 — `need_context` never reaches the gate, so the "hold side channel" does not exist

Plan §6 puts `need_context` in the hold path and D3 lists `need_context` as an
explicit hold class. In the implementation, triage `need_context` returns from the
pipeline at `pipeline.ts:157-164` with zero proposals written. Nothing is held,
nothing is listable, nothing is reviewable — the evidence is simply dropped with a
reason code.

Two consequences: (1) PR2 has undeclared scope — either §6 is wrong or the
need_context path must be moved past the gate; (2) the golden corpus's ambiguous
cases (`amb-01`, `amb-02`) pass not because the gate holds ambiguity but because
they never reach the gate, which is part of why B2's suite proves so little.

### 4.4 — Always-on cost control is per-process, not per-day

`FlashSpendState` is in-memory (`packages/agentic/src/flash.ts:37-47`), created
fresh inside `processAgenticOnce` when not supplied (`runner.ts:87`) and created
fresh per CLI invocation (`apps/carpeos-cli/src/index.ts:1571`). It is never
persisted.

Today that is fine — the operator types `run`, so "cap per run" ≈ "cap per
decision to spend". D5 makes it wrong: a timer at every N minutes turns a
`--spend-cap-usd 1` into `$1 × runs/day`. ADR 0017 D9 promised "day spend caps";
D5 makes that promise load-bearing for the first time and the ADR does not
mention it.

Compounding this, the runner calls the extract stage **unconditionally, even when
triage returned drop**:

```ts
// packages/agentic/src/runner.ts:136-161
const triageRes = await callAgenticFlash({ stage: "triage", ... });
...
const extractRes = await callAgenticFlash({ stage: "extract", ... });   // not gated on triage
```

E3's entire purpose per ADR 0017 D5 is to drop before extract spend. Every dropped
row currently costs two calls instead of one. Under always-on this is the
difference between a cheap idle loop and a persistent background bill.

**Required for D5:** persist spend in the agentic DB keyed by UTC day; make the
per-day cap normative in the ADR; gate extract on triage.

### 4.5 — Phase A (opportunistic drain) is not safely implementable as specified

Plan §7 Phase A: "On `carpeos` MCP server start and selected CLI commands that
open the store, call `processAgenticOnce` with bounded limit and short timeout
budget (e.g. max 3 jobs / 2s wall) fail-open."

Four problems:

1. **No mutual exclusion on feed rows.** `listAgenticCaptureFeed({state:"pending"})`
   (`store.ts:4471`) selects rows with no lease or claim; the row is only marked
   at the end via `finishAgenticCaptureFeed` (`store.ts:4515`). The job-lease
   machinery does not gate the work — if the lease is not acquired, the pipeline
   still runs (`runner.ts:104-132`; `lease` is only consulted for job bookkeeping
   at `:183`). MCP servers are per-client stdio processes, so N concurrent agent
   sessions means N concurrent drains over the same rows. Canonical writes are
   idempotent, so this is not a correctness bug — but **Flash spend is not
   idempotent**, and D5 + network makes that N× the bill. Feed rows need a
   `leased` state with expiry, mirroring `agentic_jobs`.
2. **No deadline exists.** `processAgenticOnce` accepts `limit` but has no
   wall-clock budget; the "2s" in the plan has no implementation and cannot be
   approximated by `limit` once network is in play.
3. **Network must be forced off on this path.** As written, an operator who
   enabled network gets DeepSeek HTTP calls on MCP server startup, on the critical
   path of an agent session's first tool call. The opportunistic drain should be
   unconditionally `allow_network: false` regardless of operator config; only the
   explicit `run` / timer path may use network.
4. **The drain must never fire on capture-class entrypoints.** `memory_capture` is
   an MCP tool (`apps/carpeos-mcp-server/src/tools.ts:56`). Draining there puts
   agentic work on the capture path, contradicting ADR 0017 D4 and this ADR's own
   S5. The plan says "selected CLI commands" without saying which; make the
   exclusion normative.

Also worth stating plainly: `@carpeos/mcp-server` does not currently depend on
`@carpeos/agentic` and contains no agentic code. PR4 is a new cross-package
dependency plus a new sidecar-DB lifecycle inside the MCP server process, not a
call-site addition.

### 4.6 — "Ship as minor" is a consent decision, not just a semver decision

Migration step 5 says "Ship as minor (e.g. 6.6.x) with clear CHANGELOG". Semver
defensibility aside, the actual change is: *after `npm update`, a tool the user
already installed begins writing machine-authored statements into the memory its
agents read by default, on their machine, unattended.* A CHANGELOG line is thin
consent for that, particularly with no retraction path (B3).

**Recommend:** promote-when-clean is the default for **new** installs; **existing**
installs get it on an explicit `carpeos setup` step or a one-time confirmation.
This costs one setup interaction *once* — it does not make HITL load-bearing per
session, so D1 and S3 both survive. If the owner rejects this, the ADR should say
so explicitly rather than leave it implied.

---

## 5. Minor / editorial

- **D3 mixes runtime and CI conditions.** Items 1–4 are per-candidate gate
  conditions; item 5 ("Offline precision suite remains green") is a release
  property. A runtime gate cannot evaluate it. Split D3 into "gate conditions"
  and "release gate".
- **D3.3 contradicts plan §6 on `procedure`.** ADR: "may promote with hold-bias
  score or **lower** confidence floor". Plan §6: "and **higher** floor". A
  hold-biased kind needs a *stricter* floor. Fix the ADR wording; the plan is
  right.
- **The confidence floor is inert and uncalibrated.**
  `typeof conf !== "number" || conf >= 0.55` (`gate.ts:58`) passes any candidate
  that omits confidence, and fake mode hardcodes 0.72 so it never binds in any
  test. Under D3 it becomes the only per-candidate model signal in the promote
  decision, and it has never been calibrated against Flash. Either drop it from
  D3's normative list (it currently does nothing) or require calibration evidence
  before it is allowed to carry weight — consistent with ADR 0017 D6.1.
- **Doc surface for PR1/PR6 is incomplete.** Beyond PRD-v6 / architecture /
  milestones, hold-first is encoded in `README.md:384`, `README.ko.md`,
  `docs/PRD-v6.md:45,79,82`, `docs/maintainers/v6-milestones.md:10-11,16-17`
  (P2/P3 marked "complete (hold-first)" — those rows become misleading rather than
  wrong), `docs/maintainers/product-6.0.0.md`, and
  `docs/plans/product6-ultragoal-handoff.md`. Add them to PR6's scope.
- **No observability replaces the removed queue.** With the held queue no longer
  on the product path, the only signal is `agentic status` counts
  (`apps/carpeos-cli/src/index.ts:1450-1470`). D1 says humans may "audit" — give
  them something to audit with: a per-run receipt (promotes by kind, by reason
  code, reject/hold ratios) persisted so drift is visible without a human queue.
  This is the observability that makes an unattended loop operable.
- **Test-plan interaction to check.** `scripts/smoke-dogfood.mjs:343-364` asserts
  that chatter must not produce an active extraction. That assertion targets the
  adj_v3 path, but with an always-on drain the agentic path now runs during the
  same smoke. The agentic admit rules should drop that input
  (`admit.ts:68` `NOISE_ONLY`), so I expect it to hold — but it is an assumption
  the plan should verify rather than inherit.

---

## 6. The constructive alternative the ADR does not consider

The ADR's "Alternatives considered" lists four options and rejects three of them
correctly. It is missing the one that resolves the tension it is actually caught
in.

The ADR reads as though the choice is *human review* vs *no review*. It is not.
The choice is *human reviewer* vs *deterministic reviewer*. HITL was doing real
work — verifying that the statement matches the evidence — and the ADR's job is to
replace that work, not delete it.

**Proposal: promote-when-verified, not promote-when-clean.**

1. **E5 becomes a real grounding check** (B1): the statement must be mechanically
   traceable to the cited span.
2. **Add a Flash verify stage (E5b).** A second prompt on the same model id, given
   only the pack and the candidate, answering "is this statement supported by this
   pack? yes/no + the span". Disagreement with E4 → hold. This is explicitly
   permitted by ADR 0017 D3.2, which forbids *multi-model* critic ensembles but
   defines multi-workflow as "multiple stages / prompts / schemas on the same
   Flash model". It costs one extra Flash call on the *promote* path only — the
   cheapest place to spend, and it is more than paid for by fixing the
   triage-drop-then-extract-anyway bug in §4.4.
3. **Promote only on E5 + E5b agreement.** Everything else holds.

This keeps D1 exactly as written — zero human steps, unattended compound, agent-
first retrieval — while restoring a check on the axis that actually fails. It also
gives S4 something meaningful to measure: agreement rate between the two stages is
a real precision proxy, unlike the current regex-vs-regex identity.

If the owner wants the flip shipped faster than E5b can land, the minimum viable
version is (1) + B3 alone: mechanical statement grounding plus a retraction
primitive. I would not ship D3 with neither.

---

## 7. Recommended PR re-ordering

The plan's PR1–PR6 is well-formed but front-loads the risky default flip and
defers every control that makes it safe.

| # | PR | Change from plan |
| --- | --- | --- |
| PR1 | `docs(adr): 0018` | As written, with §4 / §5 corrections folded in |
| **PR2a** | `feat(agentic): statement grounding in E5 + adversarial fixtures` | **New — B1.** Ships under the *current* hold-first default, so it is zero-risk and independently valuable |
| **PR2b** | `feat(agentic): Flash-mode replay corpus + honest precision suite` | **New — B2.** Also zero-risk under hold-first; this is what earns the right to flip |
| **PR2c** | `feat(local-store): retract/supersede a promoted agentic unit` | **New — B3.** Prerequisite for the flip, not a follow-up |
| PR3 | `feat(agentic): usable Observation path for decision kind` | Was PR3; narrow per §4.2, and move **before** the flip so the flip lands on a correct materialize path |
| PR4 | `feat(agentic): promote-when-clean default gate` | Was PR2. Now depends on PR2a/2b/2c/PR3. Include agentic provenance marking (§4.1) and the bounded migration (B4) |
| PR5 | `fix(agentic): gate extract on triage + persist per-day spend` | **New — §4.4.** Prerequisite for any always-on work |
| PR6 | `feat(agentic): feed leasing + bounded opportunistic drain` | Was PR4; add feed leases, a real deadline, forced network-off, and the capture-entrypoint exclusion (§4.5) |
| PR7 | `docs: reposition human tools as correction-only` | Was PR6; expand doc surface per §5 |
| — | `feat(setup): optional agentic timer` | Was PR5. **Defer out of this release** — answer to open question 2 |

PR2a, PR2b, PR2c and PR5 all ship safely under the *existing* hold-first default.
That means the risky part of this ADR is one PR (PR4), landing on top of four PRs
of real controls, instead of a defaults flip landing on top of nothing.

---

## 8. Answers to the plan's open questions (§10)

1. **`procedure` auto-promote or hold-biased?**
   Hold-biased, agreed — and fix the ADR's "lower confidence floor" to "higher"
   (§5). One caveat: `procedure` is the kind most likely to be *stale* rather than
   wrong, and staleness is invisible to E5. Keep it out of v1 entirely; revisit
   once the retraction primitive from B3 exists.

2. **Phase A only, or Phase B in the same release?**
   Phase A only, agreed — but Phase A as specified in §7 is not implementable
   safely today (§4.5). Scope PR6 to include feed leasing, a real deadline, forced
   network-off, and the capture-entrypoint exclusion, or the "minimal, ship first"
   framing will produce N× Flash spend across concurrent agent sessions. Phase B
   is greenfield: there is no launchd/systemd code anywhere in the repo and
   `scripts/install-local.mjs` is 251 lines. Defer it.

3. **Live Flash on the always-on path?**
   Network-off default, agreed, and go further: the *opportunistic* path should be
   network-off **unconditionally**, not by default (§4.5.3). Reserve network for
   the explicit `run` and the future timer, where the operator has consented to a
   spend budget that is actually enforced per day (§4.4).

---

## 9. Summary

The ADR is right about the product and right about the drift. Its diagnosis of
ADR 0017 D6 as the root cause is correct and the D1 invariant should be adopted
as written.

It is wrong about one thing, and it is the thing that matters: it assumes E5 and
the precision suite are holding the line, so that removing hold-first is a change
of default. Neither is holding the line. E5 checks that a quote exists in the pack
and never checks that the statement follows from it (B1); the precision suite
scores a regex extractor against hand-labelled kinds it was handed for free (B2);
and nothing can retract a unit once it is wrong (B3). Hold-first is currently the
only thing standing between an unverified model statement and the memory the next
agent reads by default.

Fix those three and promote-when-clean is not just acceptable — it is clearly
correct, and the resulting system is meaningfully stronger than the one the ADR
describes, because the check that replaces the human is deterministic, cheap, and
runs on every unit rather than on the ones a human got around to.

Ship the ADR. Ship the controls before the flip.
