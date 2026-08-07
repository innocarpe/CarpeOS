# Design Review — CarpeOS Agentic Quality Ultragoal v2

- Reviewer: Codex (requested gpt-5.6-sol xhigh; actual model: gpt-5.6-sol)
- Date: 2026-08-07
- Document: docs/plans/agentic-quality-ultragoal.md (v2)
- Model note: The actual model matches the requested gpt-5.6-sol; no model substitution occurred.
- Scope: Independent design review only. No source implementation was performed.

## 1. Verdict

**Accept with conditions.**

V2 has corrected the central architectural error in v1: it now treats signal recovery, the model/verifier text boundary, CJK verification, live fake fallback, and recovery of already-promoted bad units as substrate defects rather than assuming prompt-level noise suppression will create useful meaning.

The design is not yet safe to implement unchanged. The remaining conditions are concentrated but material:

1. Define the exact text actually visible to Flash and verify against that same view.
2. Carry structured source/segment provenance across signal recovery and packing.
3. Fix transcript recovery semantics rather than reusing the existing scoring primitive blindly.
4. Move live fake-fallback containment earlier and define retry behavior.
5. Make whole-session tool-noise correction part of the required path.
6. Define a precise, candidate-level bulk-retraction selector.
7. Replace success criteria that are impossible or underspecified.

**Q0 is safe to complete after owner approval. Q1′ is not safe as currently scoped.** It becomes safe after the QD0/Q1′ text is revised to cover the actual model-visible request body, prepared-pack ownership, scrub coverage, and an end-to-end request-body regression test.

## 2. Executive summary

V2 successfully fixes most of the v1 design failures:

- It elevates `transcript_path` starvation to H0 and proposes removing the full-envelope `JSON.stringify` fallback.
- It recognizes that raw `signal` is sent to Flash while E5 verifies `packed.pack_text`.
- It recognizes that ASCII-only tokenization breaks non-containment Korean grounding.
- It catches live Flash failure falling through to fake candidates under promote defaults.
- It makes recorded-Flash replay mandatory rather than optional licensing evidence.
- It adds recall and retrieval criteria rather than allowing “drop almost everything” to pass.
- It treats already-promoted bad units as a rollback problem.
- It keeps the core fences: no capture LLM, no multi-model escalation, no automatic `AcceptanceDecision`, and no load-bearing human review.

Residual risk remains in the design contracts beneath those corrections.

First, QD0 still does not describe the actual text boundary. `packed.pack_text` is local to `runAgenticProposalPipeline`; it is absent from `AgenticPipelineResult` (`packages/agentic/src/pipeline.ts:48-70,120-149`). More importantly, `callAgenticFlash` truncates both triage and extract bodies to the first 12,000 characters (`packages/agentic/src/flash.ts:76-80`), while E5 verifies against the full pack (`packages/agentic/src/pipeline.ts:193`). Passing `packed.pack_text` into `callAgenticFlash` would therefore improve privacy but would not establish the plan’s claimed “same string” invariant.

Second, QD2 requires segment provenance after the current APIs have erased it. `readCaptureSignalText` and `extractSignalTextFromCapturePayload` return a single string (`packages/local-store/src/store.ts:4951-4969,5557-5570`). Flash citations then use a hard-coded segment ID and model-supplied offsets (`packages/agentic/src/stages.ts:263-283`), while verification accepts the quote if it occurs anywhere in the pack, regardless of whether the supplied offsets identify that occurrence (`packages/agentic/src/verify.ts:108-116`). A provenance-primary filter cannot be trustworthy on this representation.

Third, reusing `signalsFromTranscriptPath()` without adapting its semantics creates another recall defect. Its durable-prose filter treats wording containing “will” as future intent and drops it (`packages/capture/src/transcript-signals.ts:235-249`), while the agentic triage rules explicitly treat “we will” as a decision signal (`packages/agentic/src/stages.ts:64-65`). The proposed recovery path can therefore discard a common committed-decision form before agentic processing sees it.

Fourth, the PR sequence still delays two P0/P1 safety and recall fixes. Q7′ is placed after prompt/filter work even though the live fake path writes proposals before Flash completes and can materialize after failure. Q10 remains optional even though the whole-session `TOOL_NOISE` predicate will become more consequential as soon as Q3′ begins feeding recovered transcripts.

Finally, several success criteria remain insufficiently falsifiable. In particular, Q-S7 cannot hold on the listed positive-heavy corpus: a kept positive needs triage plus extract, so it costs two stage calls, whereas the stated average is at most 1.2 calls per admitted row. The spend criterion needs either a separately weighted workload corpus or per-stage call budgets.

## 3. Hypothesis / root-cause ranking review

| Hypothesis | Assessment | Review |
| --- | --- | --- |
| **H0 — signal starvation** | **Accept; broaden** | Correctly P0. The current helper inspects a small set of flat string fields and otherwise serializes the envelope (`packages/local-store/src/store.ts:5557-5569`). The proposed remedy must also parse inline transcript JSONL, not label every string-valued `transcript` field as prose. It must adapt the transcript primitive’s decision semantics and preserve source/role information. |
| **H0b — pack/Flash mismatch** | **Accept diagnosis; change remedy** | Correctly P0 and privacy-relevant. Raw `signal` is passed to Flash (`packages/agentic/src/runner.ts:192-198,223-229`) while the pipeline packs, scrubs, and verifies another representation. However, the effective HTTP body is a 12,000-character slice (`packages/agentic/src/flash.ts:76-80`), not the full `packed.pack_text`. QD0 must define an explicit model-visible view rather than testing only the argument passed into `callAgenticFlash`. |
| **H0c — CJK grounding** | **Accept with wording correction** | The defect is real: token-overlap grounding produces no Korean tokens (`packages/agentic/src/verify.ts:88-102,127-131`). Exact or normalized containment can still pass, so “all CJK grounding is broken” is slightly too absolute. Non-containment/paraphrase grounding for Korean is broken, which is sufficient to keep it P0 given the stated bilingual goal. |
| **H0d — live fake promotion** | **Accept; move earlier** | Correctly P0. The fake pipeline runs first (`packages/agentic/src/runner.ts:168-181`), writes proposal rows (`packages/agentic/src/pipeline.ts:228-240`), and remains the selected pipeline if both Flash responses are absent (`packages/agentic/src/runner.ts:238-254`). It can then materialize under promote defaults (`packages/agentic/src/runner.ts:289-299`). The defect also includes duplicate proposal side effects and lost retry opportunity. |
| **H1 — metadata-heavy signal** | **Accept** | Correct as a dominant consequence of H0. It is not exclusively an H0 effect: transcript prose can itself contain assistant-authored restatements of session plumbing, so provenance and hard-negative coverage remain necessary after envelope starvation is fixed. |
| **H2 — unconstrained kinds** | **Accept** | Correctly P1 because the gate already prevents `fact_candidate` from promotion (`packages/agentic/src/gate.ts:62-89`). Prompt and parser restrictions are still valuable for spend, diagnostics, and proposal-table quality. |
| **H3 — no post-extract filter** | **Change and elevate** | Correct diagnosis, but the missing substrate is larger than a filter function. Candidate offsets are not authenticated, segment identity is hard-coded, and the string-only signal API cannot distinguish prose, envelope metadata, role, or turn. Provenance integrity must precede the filter. |
| **H4 — triage / `need_context` weakness** | **Accept; expand contract** | Correct. The runner separately parses triage JSON and extracts for both `keep` and `need_context` (`packages/agentic/src/runner.ts:208-220`), while the pipeline treats `need_context` as terminal (`packages/agentic/src/pipeline.ts:160-166`). QD3 should require a single typed parse path and define where a non-extracted `need_context` outcome is persisted and listed. |
| **H5 — fake path misalignment** | **Accept** | Correctly P1. Fake mode currently hard-codes confidence and makes statement approximately equal to quote (`packages/agentic/src/stages.ts:188-237`), so it cannot license the behavior of recorded Flash. The plan should also decide whether fake promotion is a fixture-only capability or a supported offline product path. |
| **H6 — empty sentinel** | **Accept** | Correct and easy to fix. The runner converts an empty signal into a non-empty synthetic string (`packages/agentic/src/runner.ts:160`), bypassing the existing empty-signal admit drop (`packages/agentic/src/admit.ts:54-56`). |
| **H7 — whole-session tool-noise drop** | **Accept hypothesis; reject deferral** | The predicate is applied to the entire signal (`packages/agentic/src/admit.ts:13-14,74-76`). After transcript recovery, a legitimate decision in a session that also mentions a matching tool phrase can be discarded before Flash. Q10 cannot remain optional after the v1 DoD unless a mandatory mixed decision-plus-tool-noise fixture proves the existing behavior safe. |

Three residual root causes should be added to the plan, whether as extensions of H0/H0b/H3 or new rows:

- **Effective model-view mismatch:** the HTTP layer slices input after the caller boundary.
- **Commitment/turn provenance loss:** transcript recovery merges user and assistant prose without carrying role or turn identity.
- **Candidate/event identity mismatch for rollback:** coarse source/policy disposition identity is insufficient for selecting individual materialized candidates.

## 4. Decision-by-decision review

| Decision | Verdict | Review |
| --- | --- | --- |
| **QD0** | **Change** | The principle is correct, but “Flash input equals `packed.pack_text`” is not yet a complete invariant. Define a prepared pack plus explicit `triage_view_text` and `extract_view_text`, their digests, and the exact verifier surface. Assert against the serialized fetch body, not only the `callAgenticFlash` argument. The scrub contract also needs broader path/URI coverage: the current implementation handles selected roots and schemes only (`packages/agentic/src/pack.ts:216-222`). |
| **QD1** | **Accept** | The allowlist matches ADR 0018 and preserves the gate as authority. Diagnostic attempts for non-emittable kinds should be counted before dropping them, without creating promotable proposals. |
| **QD2** | **Change** | Provenance-primary filtering is the right direction, but the plan needs a data model. Define segment classes, stable segment IDs, role/turn metadata where available, and offset rules. A citation is eligible only when its verified range maps to a prose segment. Model-provided offsets must not be trusted merely because the same quote occurs elsewhere. |
| **QD3** | **Change** | Accept the prompt and spend direction. Replace the runner’s shadow JSON/regex decision logic with the same closed parser used by the pipeline. Specify whether `need_context` becomes a persisted triage receipt, a terminal feed skip, or a retryable state; do not call it a gate hold unless a real candidate/proposal exists. |
| **QD4** | **Change** | Parser-enforced caps and kinds are correct. Add finite integer offset validation, exact slice equality, unique-occurrence handling when offsets are absent, confidence range validation, and binding to the effective extract view. “Quote is somewhere in the full pack” is not sufficient for provenance. |
| **QD5** | **Change** | Resolve path-based transcripts, but also parse inline transcript text rather than sending raw JSONL or structured dumps as prose. Do not reuse the scoring helper unchanged because it drops common committed “we will” decisions. Return a structured result such as `{source, text, segments}` rather than a bare string if QD2 remains provenance-primary. |
| **QD6** | **Change** | Recorded-Flash licensing is now correctly mandatory. Add hard negatives that pass admit and triage and reach the quality filter/gate, per-kind positive sample minimums, assistant-suggestion versus accepted-decision cases, repeated-quote offset ambiguity, tail-position decisions, and mixed decision-plus-tool-noise. |
| **QD7** | **Change** | A multi-row flush cannot have one `signal_source` or one `mode`. Use count maps such as `signal_source_counts` and `mode_counts`. Define attempted, network-started, successful, and billable Flash calls separately. Default output must omit nested proposal statements and quotes; today the CLI emits the full report (`apps/carpeos-cli/src/index.ts:1638-1646`), and each proposal embeds the candidate (`packages/agentic/src/proposals.ts:16-30`). |
| **QD8** | **Change** | The stage-cost table is honest, but the 1.2 aggregate target is not compatible with the named corpus. Use per-stage budgets and a separately weighted representative spend corpus. Define cost per promoted unit for the zero-promote case. |
| **QD9** | **Change** | “No fake promotion” is necessary but insufficient. In live mode, do not run a proposal-writing fake pipeline before Flash. On transient failure, produce zero fake proposals and zero materializations, then leave or return the feed row to a bounded retry path. Current feed completion supports only terminal `done` or `skipped` (`packages/local-store/src/store.ts:4893-4916`). |
| **QD10** | **Change** | Bulk retract is required, but `policy_version` or `formation:agentic_v1` alone selects all agentic units, not specifically metadata-formed units (`packages/agentic/src/materialize.ts:203-218`). Require a proposal/event-level dry-run manifest, exact selection predicate, human-confirmed audited apply, idempotent replay, and a regression proving valid units are not retracted. |

## 5. Blocking issues before implementation

The following must be resolved in the plan before source implementation begins. Q0 may incorporate these revisions; Q1′ should wait for them.

1. **Define the effective model-visible text contract.**

   The plan must name the canonical prepared input and distinguish the full scrubbed pack from bounded triage/extract views. The verifier must operate on, or cryptographically bind to, the exact view from which the candidate could have been produced. The Q1′ regression must inspect the serialized HTTP request body.

2. **Define a provenance-carrying signal and pack representation.**

   A bare string cannot support QD2. The design needs stable segments with source class, role/turn where recoverable, offsets, and a clear rule for inline versus path-derived transcripts.

3. **Close citation offset and duplicate-quote ambiguity.**

   `extractFlash` currently accepts supplied `start` and `end` without proving `pack_text.slice(start, end) === quote` (`packages/agentic/src/stages.ts:263-283`), and E5 accepts a quote found anywhere (`packages/agentic/src/verify.ts:108-116`). QD2 cannot be a safety control until this is repaired.

4. **Move and fully specify live-failure containment.**

   Q7′ must move immediately after Q1′ or merge into it. It must prohibit fake proposal writes and materialization in live mode, preserve retryability for transient failures, cap attempts, and prove exactly-once eventual materialization.

5. **Make H7 correction required before transcript recovery is licensed.**

   Add a mandatory mixed decision-plus-tool-noise case and move Q10 into the core sequence unless the test proves no recall loss.

6. **Specify candidate-level bulk-retraction selection.**

   One disposition is keyed by source event, trust zone, and policy version (`packages/local-store/src/store.ts:2922-2953,4567-4577`), while QD4 may emit up to three candidates. QD10 must identify materialized event IDs through proposal-level evidence, not infer them from a coarse source-level disposition.

7. **Repair the acceptance suite.**

   Replace the impossible Q-S7 metric, add per-kind recall floors and minimum counts, ensure negative cases reach each intended control, fix retrieval queries and `k`, and extend Q-S11 beyond “no promote.”

## 6. Non-blocking improvements

- Clarify whether fake mode is fixture-only, a deterministic offline product mode, or merely a comparison baseline. “Flash-only” and “fake under production defaults” currently leave this ambiguous.
- Record prompt version, model ID, effective-view digest, parser version, and quality-policy version on proposal/receipt evidence.
- Keep `need_context` terminology distinct from gate `hold`; otherwise operators may infer that a human review queue is required.
- Freeze the Unicode grounding algorithm, normalization form, thresholds, and adversarial cases instead of specifying only “CJK-safe tokenize.”
- Separate the quality corpus from a workload-distribution corpus used for spend averages.
- State an exact advisory Q-S5 threshold instead of “e.g. 0,” even though it is not release-blocking.
- Include synthetic assistant suggestion, rejected suggestion, correction, and superseded decision cases to test epistemic classification without creating `AcceptanceDecision`.
- Add a no-private-content serialization test that recursively scans default flush JSON for candidate statements, quotes, and raw pack text.

## 7. PR plan critique

| PR | Verdict | Critique |
| --- | --- | --- |
| **Q0** | **Accept with revisions** | Correct docs-first boundary. It should land only after both v2 reviews, synthesis, the conditions above, and owner approval are reflected in the plan. |
| **Q1′** | **Change** | The runner has no `packed` value because packing occurs inside the pipeline. Q1′ therefore needs an explicit prepare/execute boundary or equivalent internal API. Include effective request views, fetch-body inspection, scrub coverage, and empty pre-Flash drop. |
| **Q2′** | **Change** | “Red” conflicts with “each PR green under `make preflight`.” Land green characterization snapshots and non-gating expected failures, then convert them into release gates as fixes land. Record stage-by-stage baselines, not only aggregate outcomes. |
| **Q3′** | **Change** | Expand from `transcript_path` resolution to structured inline/path transcript recovery, role/turn provenance, and agentic-suitable commitment semantics. |
| **Q4′** | **Change** | Keep before prompt tuning. Freeze normalization, segmentation/fallback, thresholds, and adversarial KO/mixed cases. |
| **Q5′** | **Change** | Correctly follows Q3′, but must include authenticated offsets/segment mapping. The filter cannot reconstruct provenance after it has been erased. |
| **Q6′** | **Change** | Parser clamps should be independently reviewable from prompt tuning if the diff becomes large. Recorded-Flash fixtures must be pinned to prompt, model, parser, and effective-view digests. |
| **Q7′** | **Reject current position** | Its content is mandatory, but its position is wrong for an H0d/P0 safety defect. Move immediately after Q1′ or merge with Q1′. Include retry/requeue and zero fake proposal side effects. |
| **Q8′** | **Change** | Add dry-run selection evidence, exact candidate/event identities, human-confirmed apply, idempotency, audit records, and zero collateral retractions. |
| **Q9′** | **Accept conditionally** | Correct final documentation PR after all automated criteria and the rollback drill are green. |

Recommended order:

1. Q0 — revised plan, dual reviews, synthesis.
2. Q1′ — prepared pack/effective view, complete privacy scrub contract, empty drop.
3. Q7′ — no fake side effects in live mode plus retry semantics.
4. Q2′ — green characterization corpus, counters, and recorded baselines.
5. Q3′ — structured inline/path transcript recovery.
6. Required former Q10 — line/segment-scoped tool-noise behavior.
7. Q4′ — Unicode/CJK grounding.
8. Q5′ — provenance filter and authenticated citations.
9. Q6′ — typed triage/extract parsers and v2 prompts.
10. Q8′ — precise bulk-retraction workflow.
11. Q9′ — final architecture and DoD documentation.

## 8. Success criteria gaps

| Criterion | Verdict | Gap / required correction |
| --- | --- | --- |
| **Q-S1** | **Change** | Name the exact manifest, settings, prompt/model/view digests, and per-case oracle. Clarify fake mode’s role relative to production. |
| **Q-S2** | **Change** | Zero leaks is good, but the negative set needs minimum coverage and stage targets. Include negatives that pass admit and triage and reach QD2/E5/gate. |
| **Q-S3** | **Change** | An aggregate 80% can hide zero recall for one kind. Require at least 80% separately for decision, constraint, and preference, with a fixed minimum such as ten fixtures per kind. |
| **Q-S4** | **Change** | Define the receipt schema version and a recursive absence assertion for statements, quotes, raw pack text, paths, and URIs. Define counter aggregation semantics. |
| **Q-S5** | **Change** | Advisory is appropriate, but “≤ stated integer threshold (e.g. 0)” is not a criterion. Choose the integer and state how classification is produced without exposing private text. |
| **Q-S6** | **Change** | Correct fence, but specify executable checks: capture dependency/import boundary, zero capture network/LLM calls, model-ID allowlist, and zero runner-created `AcceptanceDecision` events. |
| **Q-S7** | **Reject as written** | A positive row requires two calls. The named corpus is positive-heavy, so an average of at most 1.2 per admitted row is unattainable without an artificial workload mix. Replace with: admit drop = 0 calls; triage drop or `need_context` = at most 1; kept row = at most 2; no row exceeds 2; report a separately weighted workload mean. |
| **Q-S8** | **Accept with clarification** | Require both exact/containment and non-containment Korean grounding cases, plus mixed-language and Unicode-normalization variants. |
| **Q-S9** | **Change** | Fix the query strings, index state, `k`—for example `k=5`—expected event IDs, acceptable ranks, and metadata IDs that must be absent. |
| **Q-S10** | **Change** | “State delta” is falsifiable as documentation but not as quality. Either make it characterization-only or require named directional deltas for the controls being changed. |
| **Q-S11** | **Change** | Require zero fake proposals, zero fake materializations, a retryable row after transient failure, bounded retry accounting, and exactly one eventual materialization after a successful replay. |

The corpus also needs an explicit long-tail case in which the only decision appears outside the first 12,000 characters. That case will falsify an implementation that passes `packed.pack_text` into `callAgenticFlash` but still silently tests only the leading slice.

## 9. Fence check

| Fence | Status | Review |
| --- | --- | --- |
| **HITL load-bearing?** | **Pass, with terminology condition** | Runtime value does not require review, and Q-S5 is advisory. Human confirmation for bulk retraction is correction-only and does not violate ADR 0018. `need_context` must not become a required operator queue. |
| **Multi-model?** | **Pass** | The production LLM policy remains DeepSeek Flash only. Fake mode is deterministic rather than another LLM, but its product-versus-fixture role needs clarification. |
| **Automatic `AcceptanceDecision`?** | **Pass** | The plan preserves the fence, and the current materialization path targets Observations/draft Claims rather than `AcceptanceDecision`. |
| **Privacy scrub?** | **Not yet proven** | QD0 correctly elevates privacy, but the present scrubber matches selected path roots and URI schemes only (`packages/agentic/src/pack.ts:216-222`). The actual HTTP body is separately sliced (`packages/agentic/src/flash.ts:76-80`). Default flush also emits nested proposals today (`apps/carpeos-cli/src/index.ts:1638-1646`). Q1′ and QD7 need explicit end-to-end privacy tests before this fence passes. |

## 10. Recommended plan text revisions

Make the following concrete edits before implementation.

1. **Section 5.3 — expand H0 and H0b.**

   Add that inline transcript strings may be structured JSONL and must use transcript parsing rather than direct return. Add that the effective Flash body is currently `pack_text.slice(0, 12_000)`, so the mismatch exists both before and inside `callAgenticFlash`.

2. **Section 6 — replace the single-string loop with a prepared-input contract.**

   Use text equivalent to:

   > Signal recovery returns structured prose segments with source, role/turn where available, and stable offsets. Packing produces a scrubbed full pack plus explicit bounded triage and extract views. The serialized Flash request and E5 provenance checks are bound to the same effective extract view and digest.

3. **QD0 — replace the current regression rule.**

   Require all of:

   - packing occurs once per row;
   - no raw signal reaches the network;
   - the serialized fetch body equals the declared model-visible view;
   - verifier/provenance checks use the same view or a proven offset map into it;
   - scrub tests cover POSIX, macOS, Windows, tilde, `file:`, HTTP(S), and other supported URI/path forms;
   - prepared text is not exposed in the default runner report.

4. **QD2 — add a citation-integrity subsection.**

   Define segment classes such as `prose`, `envelope_metadata`, `synthetic_title`, and `tool`. Require valid finite offsets, exact range equality, and unique-occurrence recovery when offsets are omitted. Reject ambiguous repeated quotes rather than assigning the first occurrence silently.

5. **QD5 — revise “reuse `signalsFromTranscriptPath()`.”**

   State that the existing bounded file-reading and JSONL parsing primitives may be reused, but their scoring policy must be adapted for agentic decision recovery. Preserve committed “we will” forms, parse inline transcripts, and return source/segment metadata rather than only a string.

6. **QD6 — add stage-targeted corpus requirements.**

   Require:

   - at least ten positive fixtures for each promotable kind;
   - hard negatives that reach QD2/E5/gate;
   - assistant suggestion versus explicit decision;
   - mixed decision-plus-tool-noise;
   - repeated quote with conflicting segment classes;
   - decision beyond the current 12,000-character request boundary;
   - transient Flash failure followed by successful retry;
   - bulk-retraction selection with both bad and good agentic units.

7. **QD7 — replace scalar source/mode fields.**

   Use count maps and define denominators. Separate call attempts, network-started calls, successful responses, and billable calls. State that default JSON contains aggregate counters and identifiers only; full statements require an explicit local verbose flag.

8. **QD8 — replace the 1.2 criterion.**

   Use deterministic per-row stage budgets and a separate fixed workload mix for any aggregate average. Keep cost per promoted unit as a reported metric until a baseline supports a justified threshold.

9. **QD9 — define the terminal state machine.**

   State:

   > In live mode, fake stages may be used only for non-writing diagnostics or fixtures. They create no proposal rows and cannot materialize. Transient Flash failure leaves the capture row retryable with bounded attempt metadata; permanent or exhausted failures terminate with an explicit reason. A later successful retry creates at most one proposal/materialization set.

10. **QD10 — define selection and application separately.**

    Require a dry-run manifest of proposal ID, materialized event ID, policy/prompt/view versions, matching reason, and current lifecycle. Apply must be human-confirmed, append-only, idempotent, and refuse ambiguous rows. Policy version or formation marker alone must never authorize retraction.

11. **Section 8 — reorder Q7′ and promote Q10.**

    Move Q7′ immediately after Q1′. Move Q10 into the required sequence before transcript-recovery changes are licensed. Replace “red” in Q2′ with “green characterization baseline; later converted to gating expectations.”

12. **Section 10 — replace Q-S3, Q-S7, Q-S9, and Q-S11.**

    Use the falsifiable forms described in §8 of this review.

## 11. Closing note

V2 is now genuinely substrate-first. It correctly identifies the five defects that most directly explain why a mechanically functioning loop fails to produce useful compound knowledge: wrong input, missing transcript recovery, broken non-English grounding, unsafe live fallback, and incomplete rollback.

The remaining changes do not require abandoning that design. They require making its boundaries executable:

- define the exact model-visible text;
- preserve provenance until the filter can verify it;
- adapt transcript semantics for agentic decisions;
- fail safely and retry on live errors;
- select retractions at candidate/event granularity;
- and use acceptance metrics that the planned two-stage architecture can actually satisfy.

Accordingly, **Q0 may proceed after owner approval and incorporation of this review. Q1′ should not begin under the current wording.** Once QD0/Q1′ is revised to include the effective request view, prepared-pack ownership, scrub coverage, and fetch-body verification, Q1′ is a safe and appropriate first source change.