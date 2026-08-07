# Design Review — Agentic Quality Ultragoal Plan v2
Reviewer: Claude Opus 5 (xhigh effort)
Date: 2026-08-07
Document: docs/plans/agentic-quality-ultragoal.md (v2 revised)

---

## 1. Verdict

**Accept with conditions.**

v2 is a materially better document than v1. The reframing — B (true meaning not
promoted) is the ultragoal, A (garbage held) is a spend nuisance already contained
by the gate — is correct, and every P0 substrate defect it names (H0, H0b, H0c,
H0d) is real and verified in code. The plan is no longer a noise-suppression plan
mislabeled as a quality plan.

It is not yet safe to implement as written. Six issues must be resolved first
(§5). Four of them are ordering defects rather than analysis defects: v2 correctly
identified what is broken but scheduled several fixes such that an earlier PR
makes a latent problem actively harmful, or such that a later PR depends on
infrastructure no PR builds. The most serious is **B-v2-1**: `carpeos agentic run`
already serializes verbatim candidate statements and citation quotes to stdout,
and the shipped 30-minute timer appends stdout to a plaintext log file. Today that
log contains hook metadata. Q3′ turns it into a growing plaintext mirror of
private session prose outside the encrypted store.

Answering the launch questions directly:

- **Did v2 correctly elevate substrate?** Yes, on all five counts. Verified below.
- **Is PR order still wrong anywhere?** Yes — four places (§7).
- **Are success criteria falsifiable?** Mostly. Q-S7 is arithmetically
  unsatisfiable and unmeasurable where asserted; Q-S3, Q-S5, Q-S9 have undefined
  denominators or thresholds.
- **Remaining code-level defects the plan misses?** Nine, listed in §5–§6. The
  three that change the design are: QD2 is not implementable on the current pack
  format; QD5's "reuse the capture primitive" imports a filter that rejects the
  exact sentences the plan wants; and `admit.ts` whole-signal regexes become mass
  recall killers the moment Q3′ lands.
- **Safe to start Q0/Q1′ after owner OK?** **Q0 yes. Q1′ yes with one
  amendment** (state the pack_text plumbing mechanism, N1). Q3′ must not start
  until the redaction PR lands.

---

## 2. Executive summary

### What v2 fixed

| v1 defect | v2 resolution | Assessment |
| --- | --- | --- |
| Treated metadata suppression as the cause of low promote rate | §1 explicitly retracts the inference; ultragoal is B | Correct and well argued |
| No substrate analysis | H0–H0d added as P0 with code citations | All four verified real |
| `hold_or_promote` vacuous expectations | QD6 mandates exact `promote`/`no_promote`/`hold` | Correct; existing corpora confirmed vacuous |
| Recorded-Flash deferred | QD6 + §8 make it mandatory in the Q2′/Q6′ path | Right call; scope understated (B-v2-6) |
| No baseline | QD6 + Q-S10 require pre-mutation counters | Right idea; one baseline is not enough (§7) |
| Korean unaddressed | Goal 3, H0c, Q4′, Q-S8, resolved-question 4 | Right; incomplete (N3) |
| Regex-primary filtering | QD2 makes provenance primary, regex a thin belt | Correct instinct, not implementable yet (B-v2-2) |
| Rollback = flags only | QD10 adds bulk retract of already-promoted units | Right; primitive is thinner than claimed (N7) |

The plan's self-critique in §14 ("v1 optimized for noise suppression … v2 makes
substrate + measurement load-bearing") is accurate, not performative.

### Residual risk

1. **Privacy regression is scheduled into the plan.** Q3′ is the PR that makes
   real prose flow. Nothing before it stops that prose from being written to a
   plaintext log. (B-v2-1)
2. **QD2 has no substrate.** The pack is two records, one segment each, capped at
   eight records. "Cite a prose segment" is not expressible today. (B-v2-2)
3. **QD5 under-specifies the reuse.** `signalsFromTranscriptPath()` is tuned for
   a different consumer and discards decision sentences by construction. (B-v2-3)
4. **Two admit-stage regexes will erase real sessions** the moment transcripts
   flow, and they gate the fake path the corpus must pass under. Deferring them to
   optional Q10 confounds every measurement Q2′–Q6′ depends on. (B-v2-4)
5. **Q-S7 cannot be met or measured.** (B-v2-5)
6. **The privacy fence in QD0 overpromises** relative to what
   `scrubAgenticPackText` actually does. (N8)

Nothing in v2 breaches the ADR 0018 epistemic fences (§9). The one fence v2 does
not actually hold is the privacy scrub — and it does not hold it today either.

---

## 3. Hypothesis / root-cause ranking review

All P0 claims verified against code at the cited files.

### H0 — Signal starvation. **Confirmed. Ranking correct.**

`store.ts:4951-4971` decrypts the envelope and delegates to
`extractSignalTextFromCapturePayload`, which at `store.ts:5562` probes only flat
keys `transcript|text|message|content|body|summary` and at `store.ts:5566-5570`
falls back to `JSON.stringify(obj)`. Claude SessionEnd carries `transcript_path`,
never `transcript`. So the agentic body is the stringified envelope — which is
exactly why Flash extracts "the hook event is SessionEnd".

The sibling path already does this correctly: `store.ts:3331` and `store.ts:3370`
call `signalsFromTranscriptPath()`, imported at `store.ts:23`. The plan's framing
("already used by sibling scoring path; already imported") is accurate — but the
implication that reuse is therefore cheap is not (B-v2-3).

H0 as **P0 and root** is right. Every downstream hypothesis about prompts is
downstream of this.

### H0b — Pack/Flash text mismatch. **Confirmed. Ranking correct.**

`runner.ts:160` builds `signal`, and `runner.ts:194` / `runner.ts:225` pass
`pack_text: signal` — the raw pre-scrub string — to `callAgenticFlash`. Meanwhile
`pipeline.ts:125-129` packs and scrubs, `pipeline.ts:193` verifies against
`packed.pack_text`, and `stages.ts:266` requires `input.pack_text.includes(quote)`.
The model is asked to quote from string A and graded on string B.

Two consequences, both correctly identified: unscrubbed absolute paths and URLs
leave the machine, and any quote spanning a scrubbed region fails
`citation_not_in_pack`. P0 is right.

### H0c — CJK grounding. **Confirmed, with a severity nuance the plan should absorb.**

`verify.ts:127-132`: `tokenize` splits on `/[^a-z0-9]+/` and keeps tokens longer
than 2 chars. Korean text produces zero tokens, hitting
`statement_ungrounded_empty_tokens` at `verify.ts:90-92`.

Nuance: the containment check at `verify.ts:80-86` runs **first**, so a Korean
statement that is an exact substring of (or identical to) a quote still grounds.
And `stages.ts:272` defaults `statement` to `quote` when the model omits it. So
the failure is specific to **paraphrased** Korean statements — which is the normal
and desirable model behaviour, so it is still P0, but the Q4′ fixtures must force
paraphrase or they will pass without exercising the bug.

The plan also misses a second CJK defect of equal severity — NFC asymmetry (N3).

### H0d — Fake candidates can promote in live mode. **Confirmed. P0 correct.**

`runner.ts:169-181` always runs a fake pipeline first, unconditionally. If the
live block at `runner.ts:184-255` produces neither triage nor extract text, the
guard at `runner.ts:238` never fires and `pipeline` remains the fake result.
`runner.ts:289-315` then materializes it, and `extractFake` hard-codes
`confidence: 0.72` (`stages.ts:219`) — above the gate's 0.55 threshold
(`gate.ts:92`). Network failure therefore promotes heuristic output as active
knowledge.

The plan misses a concrete instance of this that makes it worse than described
(N5): the fake path's `pickQuote` returns the pack **title**.

### H1–H7 — ranking review

| ID | Verdict |
| --- | --- |
| H1 | Correct to mark as an effect of H0, not an independent cause. |
| H2, H3 | Correct at P1. `gate.ts:81-89` does contain `fact_candidate` to hold, so these are spend/UX, not correctness. |
| H4 | Correct and under-weighted. `runner.ts:217` extracts on `keep \|\| need_context`, while `pipeline.ts:160-167` returns at triage for `need_context` with zero proposals. So the extract call is bought and then thrown away — a pure-waste path. Worth P0 on spend grounds. |
| H5 | Correct at P1, but see B-v2-4: the fake path is not merely "not aligned", it will reject realistic fixtures wholesale. |
| H6 | Correct. `runner.ts:160` substitutes `` `(empty capture …)` ``, which is 30+ chars and passes `admit.ts:84`'s length floor and `admit.ts:54`'s empty check. QD0's "empty → pre-Flash drop" fixes it. |
| **H7** | **Correct diagnosis, wrong priority.** See B-v2-4. This is not "P1, activate after H0" — it is a same-PR requirement for Q3′, and the plan's own corpus cannot pass under fake without it. |

**Missing hypothesis — H8 (recommend adding).** Admit-stage `SECRETISH`
(`admit.ts:58`) tests the **entire** signal, not a span. Real engineering
transcripts contain the literal words "api key", "secret", "password" constantly.
Once Q3′ lands, a large fraction of the highest-value sessions will be dropped at
admit with `secret_like_material` and never reach Flash. This is a bigger recall
hazard than H7 and appears nowhere in v2.

---

## 4. Decision-by-decision — QD0–QD10

### QD0 — One text surface. **Accept (with N1).**
Correct, and correctly marked blocking. The regression test as worded ("string
passed to `callAgenticFlash` equals `packed.pack_text`") is the right assertion
shape. Two amendments:
- The mechanism is unspecified: `AgenticPipelineResult` (`pipeline.ts:48-71`)
  exposes `pack_digest` but **not** `pack_text`. Q1′ must either return it or
  recompute the pack in the runner. Returning it puts private text into
  `report.pipelines`, which is printed verbatim — see B-v2-1. State the choice.
- The "Privacy fence" row overpromises (N8).

### QD1 — Usable extract kinds. **Accept.**
Well constructed. The "Gate remains authority. QD1 does not relax `gate.ts`" note
answers the obvious reviewer objection pre-emptively and is consistent with
`gate.ts:63-89`. The `kind_not_emittable` rule fixes a verified defect:
`stages.ts:267` silently coerces OOV kinds to `open_question`.

### QD2 — Provenance-primary quality filter. **Change (blocking).**
The design instinct is right and the demotion of the "no verb of commitment"
heuristic is a good catch. But the substrate does not exist:
- `pack.ts:171-201` emits exactly two records (title, body).
- `redaction.ts:558` produces one segment per field.
- `pack.ts:29-30` caps `field_count: 8`, enforced at `redaction.ts:537`.
- Citations hard-code `segment_id: "seg_agentic_body"` in **both** extract paths
  (`stages.ts:223`, `stages.ts:277`), so no candidate carries a real segment id.

"Promote-eligible candidates must cite a span inside a prose segment" therefore
has no addressable prose segment to cite. This needs a pack-format PR (multi-record
prose/metadata packing, real segment ids on citations, limits raised past 8
records) that is absent from Q0–Q9′. See B-v2-2.

### QD3 — Triage prompt + schema + spend contract. **Accept with change.**
Good decisions throughout; the "never framed as operator review queue" line is the
right fence. Three amendments:
- "Listable hold without promote" is asserted as if it exists. `pipeline.ts:160-167`
  returns at triage with `held_need_context` and **zero proposals** — nothing is
  listable. Making it listable requires writing a proposal row at `need_context`.
  Say so.
- The input bound is specified for triage only. `flash.ts:79-80` truncates **both**
  stages to 12,000 chars against a 220,000-byte pack limit (`pack.ts:29`). Extract
  truncation is the recall risk, not triage. (N2)
- "Align `triageFake`" understates it — the fake path needs re-scoping, not
  re-tuning (B-v2-4).

### QD4 — Extract prompt + parser clamps. **Accept.**
All four clamps are right. The confidence bullet resolves a verified defect:
`stages.ts:273` defaults missing confidence to `0.5`, `gate.ts:92` requires
`≥ 0.55`, so an omitted field silently holds. Cite both lines in the PR.

### QD5 — Signal text recovery. **Change (blocking).**
Steps 1–4 are the right shape, and "do not `JSON.stringify` the envelope" is
exactly right. But step 1 — "resolve via existing `signalsFromTranscriptPath()`" —
imports a filter chain built for a different consumer:
- `transcript-signals.ts:108` gates every line on `isDurableProse`.
- `isDurableProse` (`:235-242`) first rejects anything `isFutureIntent` (`:244-250`)
  matches — which includes **"will"**, "plan to", "may", "might", "could". The
  sentence "We will use SQLite instead of Postgres" is discarded. Meanwhile
  `stages.ts:65` `DECISION_RE` treats `we will` as the *primary* decision signal.
  The two layers directly contradict each other.
- `isDurableProse` then requires a hit from a fixed decision lexicon — so anything
  not phrased in that vocabulary never reaches the pack.
- `sanitizeProse` (`:227`) discards any prose containing `{`, `}`, `[`, or `]` —
  i.e. most engineering decisions that mention code or config.
- Output is capped at the last 8 prose items (`:119`) and 8,000 chars (`:16`).

Reusing this as-is caps Q-S3's recall floor by construction and makes Q-S8's
Korean fixtures pass or fail on the Korean branch of a *capture-layer* lexicon.
QD5 must specify an agentic extraction mode (role-attributed prose, no durability
lexicon, no future-intent filter, no brace filter, larger bound) or explicitly
accept and measure the cost. See B-v2-3.

### QD6 — Quality corpus. **Accept with change.**
Case classes are well chosen; `decision_with_absolute_path` is a genuinely good
test of QD0 scrub/cite alignment. Amendments:
- `repeated_decision_across_sessions` has expect "v1: document + count; optional
  hold" — which violates this section's own "expectations are exact" rule. Give it
  an exact expect or move it to §11 as a documented gap.
- Q-S2 references `must_not_promote` fixtures, but the manifest schema has no such
  field (`golden.ts:11-18` has `expect_gate` and `must_not_active_without_cite`).
  Add the field so the criterion is mechanically checkable.
- Recorded-Flash scope is understated (B-v2-6).

### QD7 — Operator metrics + privacy. **Change (blocking on ordering).**
The counter set is good and `signal_source: inline|transcript_path|none` is
exactly the right diagnostic. Two problems:
- **Scope is too narrow.** It says "flush/status JSON". The leak is in
  `processAgenticOnce`'s report shape itself (`runner.ts:29` `pipelines`), which
  `agentic run` also prints and the timer appends to disk. Redaction must be at
  the report/serialization boundary, not in one command. (B-v2-1)
- **No PR owns it.** Q2′'s scope line mentions "QD7 counters" but not redaction,
  and Q-S4 requires both. Give redaction its own early PR.
- Minor: `flash_calls` is ambiguous — `runner.ts:201` and `:230` increment on
  failure, `flash.ts:139` increments `spend.calls` only on success. Name which.

### QD8 — Spend interaction. **Accept, except the target.**
The honesty of the "post-extract quality filter saves no Flash spend" row is
good — it is the kind of line v1 lacked. The ≤ 1.2 target is unsatisfiable
(B-v2-5).

### QD9 — No fake promotion in live mode. **Accept; move earlier.**
Correct and necessary. "Avoid double proposal rows (fake + flash) corrupting
counters" is a real observation — `runner.ts:169` writes fake proposals to the DB
before the live pass, and `runner.ts:239` reassigns `pipeline`, so the fake rows
persist in `agentic_proposals` and surface in `listAgenticHeldProposals`
(`runner.ts:350-360`) and in `agentic status` gate breakdowns.

Add the concrete instance in N5, and move this to right after Q1′ (§7).

### QD10 — Rollback includes promoted units. **Change.**
The principle — "flags alone do not fix already-promoted units" — is right and
matches ADR 0018 D4b. The mechanism is thinner than stated:
- "via existing `agentic retract`" is single-event only (`--event-id`) and
  hard-requires `--human-confirmed` (`human-review.ts:163-172`; the CLI enforces
  `--event-id`, `--reason`, `--decided-by`, `--human-confirmed`). Bulk is new work.
- **Selection by `policy_version` cannot work as written.**
  `AGENTIC_POLICY_VERSION` is a frozen literal `"agentic_v1"` (`types.ts:10`),
  unchanged across Q1′–Q8′. Every unit — bad ones promoted before the fixes and
  good ones after — carries the same value, and `formation:agentic_v1`
  (`materialize.ts:212`) is equally undiscriminating. To make QD10 selectable you
  must bump the policy version (or add a formation generation marker) in Q1′.
  Note the migration: `materialize.ts:90` rejects proposals whose
  `policy_version` mismatches, so in-flight proposals are orphaned by a bump.

---

## 5. Blocking issues before implementation

### B-v2-1 — Private session text is written to a plaintext log; Q3′ makes it real. **Blocking, privacy.**

`AgenticRunnerReport.pipelines` (`runner.ts:29`) carries
`AgenticPipelineResult.proposals` (`pipeline.ts:65`), each of which carries
`candidate` (`proposals.ts:22`) containing `statement` and `citations[].quote`
(`types.ts:95-108`) — verbatim session prose, scrubbed only for paths and URLs.

Both `carpeos agentic flush` and `carpeos agentic run` serialize the whole
`report` object to stdout. The installed timer redirects stdout to a file:
`scripts/install-agentic-timer.sh:70-72` (`StandardOutPath →
${CARPEOS_HOME}/logs/agentic-timer.log`) and `:124`
(`StandardOutput=append:…/agentic-timer.log`), running
`agentic run --once --materialize --allow-network` every 30 minutes.

Today the statements are hook metadata, so the log is harmless. **Q3′ is precisely
the PR that replaces that metadata with private prose.** As ordered, the plan
converts a latent leak into an active one, writing an ever-growing plaintext
mirror of private sessions to disk outside the encrypted protected-value store.

**Required:** a redaction PR (default-redacted report serialization, `--verbose`
opt-in, and statements never written to the timer log) landing **before** Q3′.
Q-S4 already asserts this outcome; the PR plan does not deliver it in time.

### B-v2-2 — QD2 is not implementable on the current pack format. **Blocking, design.**

Evidence: `pack.ts:171-201` (two records), `redaction.ts:558` (one segment per
field), `pack.ts:29-30` + `redaction.ts:537` (`field_count: 8` ceiling),
`stages.ts:223` and `stages.ts:277` (hard-coded `segment_id: "seg_agentic_body"`).

**Required:** add a pack-segmentation PR before Q5′ — multi-record packing with
prose/metadata record kinds, real segment ids propagated onto citations, and
limits raised past 8 records. Note explicitly that this changes `pack_digest`,
so any recorded-Flash goldens pinned in Q2′ must be re-pinned after it.

### B-v2-3 — QD5's "reuse the primitive" discards decision sentences. **Blocking, recall.**

Evidence: `transcript-signals.ts:108` → `:235-242` (`isDurableProse`) → `:244-250`
(`isFutureIntent` rejects "will"/"plan to"/"may"/"might"/"could"); `:227`
(`sanitizeProse` rejects any prose containing braces or brackets); `:119` (last 8
items); `:16` (8,000-char cap). Contradicted by `stages.ts:65`, where `we will` is
the primary decision signal.

**Required:** QD5 specifies an agentic extraction mode distinct from the scoring
mode, or states and measures the accepted recall cost. Q-S3 is not achievable
without this decision being made explicitly.

### B-v2-4 — Admit and fake-stage whole-signal regexes erase real sessions. **Blocking, ordering.**

- `admit.ts:58` — `SECRETISH` tested against the **entire** signal. Any session
  containing "api key", "secret", or "password" anywhere is dropped whole.
  (Missing hypothesis H8.)
- `admit.ts:75` — `TOOL_NOISE` tested against the entire signal, including
  `ran .+ successfully` with `.` spanning the whole transcript. Any session
  mentioning `npm install`, `git status`, or `exit 0` is dropped whole. (H7.)
- `stages.ts:118` and `stages.ts:191` — the same whole-pack `NOISE_RE` gates
  `triageFake` and `extractFake`. QD6 requires the corpus to pass "under fake"
  with realistic long fixtures; it cannot.

The plan ranks these P1 and defers to **optional Q10**. That is the wrong order:
Q3′ is what makes real transcripts flow, so from Q3′ onward every counter Q2′
recorded and every measurement Q5′/Q6′ depend on is confounded by mass drops.

**Required:** move admit/fake scoping (line- or segment-level, not whole-signal)
into the required set, landing with or immediately before Q3′.

### B-v2-5 — Q-S7 / QD8's ≤ 1.2 Flash calls per admitted row is unsatisfiable and unmeasurable. **Blocking, criteria.**

Arithmetic: every kept row costs exactly two calls — triage (`runner.ts:192`) plus
extract (`runner.ts:223`). A triage-dropped row costs one. So the ratio is
`2 − (triage drop rate)`. Hitting 1.2 requires an 80% triage-drop rate **among
admitted rows**. The QD6 corpus is roughly 7 promote-positive of 11 classes, and
its negative cases (`metadata_only_session_end`, `tool_noise_session_end`) are
expected to drop at *admit*, i.e. they are not admitted rows at all. The
achievable floor on that corpus is ≈ 1.6–2.0.

Measurability: `report.flash_calls` counts attempts including failures
(`runner.ts:201`, `:230`), whereas `spend.calls` counts billed calls
(`flash.ts:139`). And a recorded-Flash replay harness injects `flash_*_text`
without invoking `callAgenticFlash`, so `flash_calls` is 0 in exactly the corpus
where Q-S7 is asserted.

**Required:** restate as two falsifiable clauses — e.g. "≤ 2.0 calls per
triage-kept row and exactly 1.0 per triage-dropped row on the corpus", plus a
live-dogfood advisory ratio — and define which counter is authoritative.

### B-v2-6 — Recorded-Flash harness is new infrastructure, not a fixture addition. **Blocking, scope.**

No recorded-Flash fixture or replay harness exists. Manifests carry only
`pack_text` (verified: `golden-12` 12 cases, `licensing-promote` 9 cases, longest
`pack_text` 165 chars, no response field). `evaluateGoldenManifest` hard-codes
`mode: "fake"`, `allow_network: false`, **and `allow_auto_promote: false`**
(`golden.ts:82-84`) — so the existing harness structurally cannot test promote at
all. ADR 0018 D3.3 required recorded-Flash before the default flip; it never
shipped.

Q2′'s scope line ("fixtures exact expect; QD7 counters; record baseline") cannot
deliver Q-S1's "green under production promote defaults (fake + recorded-Flash)".

**Required:** name the harness work explicitly in Q2′ — manifest schema extension
for recorded responses, a runner that exercises production promote defaults, and
prompt/model digest pinning per QD4.

---

## 6. Non-blocking improvements

**N1 — QD0 plumbing unstated.** `pack_text` is not on `AgenticPipelineResult`
(`pipeline.ts:48-71`). Choose: return it (and keep it out of the serialized
report — see B-v2-1) or recompute the pack in the runner. Recomputing duplicates
`makeAgenticPackId` + `packAgenticEvidence` work; returning it is cleaner if
redaction lands first. Recommend returning it, after the redaction PR.

**N2 — Silent 12k truncation.** `flash.ts:79-80` slices both stages to 12,000
chars against a 220,000-byte pack limit (`pack.ts:29`). The
`long_session_with_one_decision` fixture is non-representative unless it exceeds
12k with the decision past the cut. Add head+tail windowing and a `pack_truncated`
counter to QD7.

**N3 — NFC asymmetry (second CJK defect).** Pack text is NFC-normalized
(`redaction.ts:270-273`, applied at `:530`), but model output is compared raw at
`stages.ts:266` (`pack_text.includes(quote)`) and `verify.ts:110`. NFD Korean —
common in macOS-originated content — fails `citation_not_in_pack` and is rejected
by `gate.ts:42-50`. Q4′ should normalize both sides and add an NFD fixture. The
plan's Q4′ covers only `tokenize`.

**N4 — H0c fixture design.** Because containment (`verify.ts:80-86`) precedes
tokenization and `stages.ts:272` defaults `statement` to `quote`, a naive Korean
fixture passes without exercising the bug. Force paraphrase in the fixture.

**N5 — Fake path can promote the pack title.** `packTextFromRedaction`
(`pack.ts:203-210`) prepends the title record, so `pack_text` begins
`agentic.evidence\n…` (`pack.ts:87`). `pickQuote` (`stages.ts:385-400`) returns the
first line ≥ 8 chars — the title. `extractFake` then emits a candidate whose
statement is literally `agentic.evidence`, grounded by containment, with
`confidence: 0.72` (`stages.ts:219`); if `inferKind` (`stages.ts:376-383`) sees
"decision"/"prefer"/"constraint" anywhere in the pack, `gate.ts:95` promotes it.
This is a live garbage-promote path and the sharpest concrete instance of H0d.
Fix in Q6′/Q7′ by excluding the title record from `pickQuote` or from `pack_text`.

**N6 — Counter semantics.** Define `flash_calls` as attempted or billed in QD7
(`runner.ts:201` vs `flash.ts:139`).

**N7 — QD10 mechanism.** State that bulk retract is new work built on
`humanRetractAgenticUnit` (`human-review.ts:162`), that the existing primitive is
single-event and hard-requires `--human-confirmed`, and that operator-invoked bulk
correction is *maintenance*, not a happy-path step (otherwise §12's "**required**,
not optional" reads as a D1 fence question). Add the policy-version bump required
for selection (§4, QD10).

**N8 — QD0's privacy-fence claim overpromises.** `scrubAgenticPackText`
(`pack.ts:216-223`) covers `http(s)`/`file` URIs, `~/`, drive letters, and only
`/tmp|/var|/home|/Users|/etc`. It misses `/opt`, `/private/var`, `/Volumes`,
`/mnt`, `/srv`, plus email addresses, IPs, and hostnames. The §9 unit test as
worded ("paths/URIs scrubbed") would pass while `/opt/homebrew/...` leaks. Also,
the path rule replaces the preceding whitespace — **including newlines** — with a
space, merging lines and shifting citation offsets. Either broaden the scrub or
soften the claim to what it actually guarantees.

**N9 — Q-S5 threshold.** "≤ stated integer threshold (e.g. 0)" is unfalsifiable
while "e.g." remains. Pick the integer.

**N10 — Q-S3 denominator.** With ~7 positive fixtures, 80% rounds to 6/7 and one
flaky fixture flips the DoD. State N and the exact required pass count.

**N11 — Q-S9 parameters.** Pin `k` and the query set for the retrieval assertion.

**N12 — Q-S2 needs a manifest field.** Add `must_not_promote: true` to the
manifest schema (`golden.ts:11-18`) so the criterion is mechanical.

**N13 — H4 is under-priced.** `runner.ts:217` buys an extract call for
`need_context`, which `pipeline.ts:160-167` then discards. Pure waste; worth
calling P0 on spend grounds even though it is a correctness non-issue.

**N14 — `need_context` listability.** See §4, QD3.

**N15 — CJK length floors.** `admit.ts:84`, `gate.ts:52`, and `verify.ts:65` all
use character counts of 8. Korean is denser per character, so short but complete
Korean decisions sit near the boundary. Consider a script-aware floor, or at
minimum a boundary fixture in Q4′.

---

## 7. PR plan critique — Q0–Q9′

**Overall:** the sequence is far better than v1's. Substrate leads, measurement is
early, prompts are last. Four changes needed.

| PR | Verdict | Note |
| --- | --- | --- |
| Q0 | **Accept** | Safe to start now. |
| Q1′ | **Accept with amendment** | Add the N1 mechanism decision. Safe to start after owner OK. |
| Q2′ | **Change** | Scope must name the recorded-Flash harness (B-v2-6) and a promote-capable runner (`golden.ts:83`). |
| Q3′ | **Blocked** | Must not land before the redaction PR (B-v2-1) or before admit scoping (B-v2-4). |
| Q4′ | **Accept with addition** | Add NFC normalization (N3) and paraphrase fixtures (N4). |
| Q5′ | **Blocked** | Depends on a pack-segmentation PR that does not exist (B-v2-2). |
| Q6′ | **Accept** | Absorb N5 (title quote) and N14 here or in Q7′. |
| Q7′ | **Move earlier** | See below. |
| Q8′ | **Accept with N7** | Requires the policy-version bump landed in Q1′. |
| Q9′ | **Accept** | Correctly last. |

### Recommended revised order

```text
Q0    docs plan + reviews                              (unchanged)
Q1′   send scrubbed pack_text to Flash                 (+ N1 mechanism, + policy_version bump for QD10)
Q1.5′ redact private statements from report/CLI/timer  (NEW — blocks Q3′)
Q7′   no fake-candidate promotion in live mode         (MOVED UP — small, independent, stops live corruption)
Q2′   quality corpus + recorded-Flash harness + baseline #1
Q2.5′ admit/fake noise scoping (line- or segment-level) (WAS optional Q10 — now blocks Q3′)
Q3′   transcript_path signal recovery                   (+ QD5 agentic extraction mode)
Q4′   CJK-safe grounding + NFC                          (+ re-record baseline #2 — "substrate baseline")
Q4.5′ pack segmentation: prose/metadata records + real segment ids (NEW — blocks Q5′; re-pins goldens)
Q5′   segment-provenance quality filter
Q6′   triage/extract v2 + parser clamps + need_context
Q8′   bulk retract metadata-formed units
Q9′   docs + DoD
```

### Rationale for the four moves

1. **Q1.5′ before Q3′** — B-v2-1. Non-negotiable; the alternative is knowingly
   shipping a privacy regression mid-plan.
2. **Q7′ right after Q1′** — H0d is ranked P0 and is *currently live*: every
   network failure promotes heuristic output. It is a small, independent change,
   and leaving it until after Q2′ means the baseline Q2′ records is polluted by
   fake promotes and duplicate proposal rows.
3. **Q2.5′ before Q3′** — B-v2-4. Otherwise the moment real transcripts flow,
   mass admit-drops confound everything downstream.
4. **Q4.5′ before Q5′** — B-v2-2, and it must precede any goldens pinning
   `pack_digest`.

### Baseline critique (Q-S10 / B6)

The plan records one baseline at Q2′ and asks Q5′/Q6′ to state deltas against it.
But Q3′ and Q4′ are the largest-magnitude changes in the plan — after them the Q2′
baseline is a measurement of a different system. Record **two**: baseline #1 at
Q2′ (pre-substrate) and baseline #2 after Q4′ (post-substrate, pre-tuning), and
have Q-S10 require deltas against the nearest preceding baseline.

---

## 8. Success criteria gaps — Q-S1–Q-S11

| ID | Falsifiable? | Gap |
| --- | --- | --- |
| Q-S1 | Yes | Blocked on B-v2-6 (no promote-capable harness: `golden.ts:83`). |
| Q-S2 | Nearly | Needs the `must_not_promote` manifest field (N12). |
| Q-S3 | Partly | Denominator and exact pass count unstated (N10); ceiling set by the unresolved QD5 filter question (B-v2-3). |
| Q-S4 | Yes | Scope too narrow — must cover `agentic run` and the timer log, not just flush (B-v2-1). |
| Q-S5 | No | "e.g. 0" is not a threshold (N9). Correctly marked advisory, which is the right fence call. |
| Q-S6 | Yes | Good, mechanically checkable. Consider asserting it as a test, not prose. |
| **Q-S7** | **No** | Unsatisfiable and unmeasurable (B-v2-5). |
| Q-S8 | Yes | Passes vacuously without paraphrase (N4) and without an NFD case (N3). |
| Q-S9 | Partly | `k` and query set unpinned (N11). |
| Q-S10 | Yes | Needs two baselines, not one (§7). |
| Q-S11 | Yes | Strongest criterion in the set. Extend to assert no fake **proposal rows** persist in live mode, not just no promotes (QD9's own counter-corruption point). |

**Missing criteria — recommend adding three:**

- **Q-S12 (privacy, blocking):** no candidate statement or citation quote appears
  in default CLI output or in `${CARPEOS_HOME}/logs/agentic-timer.log`; asserted
  by a test over the serialized report. Without this, Q-S4 is satisfied by
  redacting one command while the timer keeps writing.
- **Q-S13 (signal source):** on the corpus, `signal_source == "transcript_path"`
  for every transcript-shaped fixture and `"none"` for empty envelopes. This is
  the only direct falsifier for H0/QD5 and is cheap.
- **Q-S14 (admit recall):** zero corpus fixtures dropped at admit for
  `secret_like_material` or `tool_noise_signal` when the trigger term appears only
  incidentally. Direct falsifier for H7/H8.

---

## 9. Fence check

| Fence | Held? | Evidence |
| --- | --- | --- |
| **HITL not load-bearing** | **Yes** | QD3 explicitly bans "review queue" framing (ADR 0018 D6); QD1 keeps suppressed facts as diagnostics rather than a queue; Q-S5 is explicitly advisory and §10 states Q-S5 is not a release gate. QD10's bulk retract is operator-invoked correction, consistent with ADR 0018 D4b ("humans may correct, audit, and kill — they must not be load-bearing"). One wording risk: §12's "**required**, not optional" should say "required as a *capability*", and should note the primitive hard-requires `--human-confirmed` (`human-review.ts:163-172`). |
| **Multi-model / no escalation** | **Yes** | Flash-only preserved. QD3/QD4 bump prompt versions on the same model id (`stages.ts:403-414`, `types.ts:7`). Non-goals table explicitly freezes escalation. No PR introduces a second provider. |
| **No auto AcceptanceDecision** | **Yes** | Nothing in QD0–QD10 touches the materialize fence at `materialize.ts:304-317`, which rejects any non-draft Claim. §9 regression list asserts it. Q-S6 covers it. |
| **Privacy scrub** | **No** | Two failures: the report/timer leak (B-v2-1) is live today and worsened by Q3′; and QD0's "absolute paths / `~/…` / URLs must not leave the machine" overstates `scrubAgenticPackText` (`pack.ts:216-223`), which misses `/opt`, `/private/var`, `/Volumes`, `/mnt`, `/srv`, emails, IPs, and hostnames (N8). Fixture hygiene ("synthetic only; no private paths or real session text in repo", QD5 step 4) is correctly specified. |

**Capture-no-LLM** is also untouched and correctly asserted in Goal 10 and Q-S6.

---

## 10. Recommended plan text revisions

Concrete edits only. Everything else in v2 can stand.

**§5.3 — add H8 after H7:**
> | H8 | Admit-stage `SECRETISH` tests the whole signal, not a span; real sessions
> mention "api key"/"password"/"secret" constantly | `admit.ts:58` | **P0 once H0
> lands** (recall killer, larger than H7) |

**§7 QD0 — replace the "Privacy fence" row:**
> | Privacy fence | Flash bodies carry no `http(s)`/`file` URIs, `~/…`, drive-letter
> paths, or `/tmp|/var|/home|/Users|/etc` paths. **Known gap:** `/opt`,
> `/private/var`, `/Volumes`, `/mnt`, `/srv`, emails, IPs, hostnames are not
> scrubbed — broaden in Q1′ or record as accepted residual. |

**§7 QD0 — add a row:**
> | Report surface | `pack_text` must not enter `AgenticPipelineResult` /
> `AgenticRunnerReport` unredacted; see QD7. |

**§7 QD2 — add a prerequisite paragraph before the numbered list:**
> **Prerequisite (Q4.5′).** The current pack emits two records with one segment
> each (`pack.ts:171-201`, `redaction.ts:558`) under a `field_count: 8` ceiling
> (`pack.ts:29`), and both extract paths hard-code
> `segment_id: "seg_agentic_body"` (`stages.ts:223`, `stages.ts:277`).
> Segment-provenance requires a pack-format PR: prose/metadata record kinds, real
> segment ids propagated onto citations, raised limits. That PR changes
> `pack_digest`, so recorded-Flash goldens pinned in Q2′ must be re-pinned.

**§7 QD5 — replace step 1:**
> 1. Resolve `transcript_path` / `transcriptPath` through a **new agentic
>    extraction mode** on the transcript primitive. Do **not** reuse
>    `signalsFromTranscriptPath()` unchanged: its `isDurableProse` /
>    `isFutureIntent` chain (`transcript-signals.ts:235-250`) rejects any sentence
>    containing "will"/"plan to"/"may"/"might"/"could" — including "we will use X",
>    which `stages.ts:65` treats as the primary decision signal — and
>    `sanitizeProse` (`:227`) rejects any prose containing braces or brackets.
>    Agentic mode: role-attributed prose, no durability lexicon, no future-intent
>    filter, no brace filter, bound larger than the 8-item / 8,000-char scoring cap.

**§7 QD7 — replace the lead sentence:**
> Report serialization (`AgenticRunnerReport` / `AgenticPipelineResult`) **redacts
> candidate statements and citation quotes by default** across `flush`, `run`, and
> `status`; `--verbose` opts in. The 30-minute timer
> (`scripts/install-agentic-timer.sh:70-72`, `:124`) appends stdout to
> `${CARPEOS_HOME}/logs/agentic-timer.log`, so unredacted default output is a
> plaintext leak outside the encrypted store. This lands in **Q1.5′, before Q3′**.

**§7 QD8 — replace the target line:**
> - Target: **≤ 2.0 Flash calls per triage-kept row** and **exactly 1.0 per
>   triage-dropped row** on the quality corpus (every kept row costs triage +
>   extract: `runner.ts:192`, `:223`). A blended per-admitted-row ratio is reported
>   as an advisory dogfood metric only. Counter is **billed** calls
>   (`flash.ts:139`), not attempts (`runner.ts:201`, `:230`).

**§7 QD10 — replace the third bullet:**
> - **Bulk retract** is new work built on `humanRetractAgenticUnit`
>   (`human-review.ts:162`); today's `agentic retract` is single-event and
>   hard-requires `--human-confirmed`. Selection requires a **policy-version bump
>   in Q1′** — `AGENTIC_POLICY_VERSION` is a frozen `"agentic_v1"` literal
>   (`types.ts:10`), so pre-fix and post-fix promotes are indistinguishable today.
>   Note the migration: `materialize.ts:90` orphans in-flight proposals on a bump.
>   Bulk retract is an operator **maintenance capability**, not a happy-path step.

**§8 — adopt the revised order in §7 of this review**, and move Q10 from the
optional table into the required set as Q2.5′.

**§10 — replace Q-S7, fix Q-S5's threshold, state Q-S3's denominator, pin Q-S9's
`k`, and add Q-S12–Q-S14** (§8 of this review).

---

## 11. Closing note

v2 does the hard thing v1 avoided: it goes and looks at the code, and it lets the
code overrule the story. H0 through H0d are all real, all correctly ranked, and
naming them P0 above the prompt work is the single most valuable judgement in the
document. The retraction in §1 — "v1 treated A as the cause of B; that inference
is false" — is the kind of correction most plans never make.

The residual problems share one shape: v2 identified a defect accurately, then
scheduled the fix as though the surrounding system would hold still. Q3′ makes
real prose flow through a report that is printed to a log file. Q5′ asks for
segment provenance from a pack with two segments. QD5 reuses a primitive tuned to
reject the sentences the plan is trying to capture. Q-S7 sets a ratio the call
graph cannot produce. None of these need a redesign — they need three inserted
PRs, one reordering, and five sharpened criteria.

Do Q0 and Q1′ now. Insert the redaction PR and pull Q7′ forward before anything
touches the transcript path. Then the rest of the plan is sound.
