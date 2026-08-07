# Design: Agentic quality ultragoal (meaning that compounds)

Status: **Design (v2.1)** — substrate-first; dual-review conditions incorporated;
implement only after **owner OK**  
Date: 2026-08-07 (v2.1)  
Depends on: [ADR 0018](../adr/0018-agentic-hitl-free-compound-loop.md) (HITL-free loop
shipped through `@innocarpe/carpeos@6.6.4`)  
Related: [ADR 0017](../adr/0017-agentic-layer-write-time-knowledge.md),
[agentic-layer architecture](../architecture/agentic-layer.md)

**Review history**

| Pass | Artifact | Verdict |
| --- | --- | --- |
| v1 plan | earlier draft in git history | noise plan mislabeled as quality |
| v1 Claude Opus 5 xhigh | (superseded by v2 review file) | Accept with conditions B1–B6 |
| v1 Codex (gpt-5.5) | (superseded) | Reject as written |
| **v2 plan** | this file (substrate-first rewrite) | dual re-review |
| **v2 Claude Opus 5 xhigh** | [review-claude-opus.md](./reviews/agentic-quality-ultragoal-review-claude-opus.md) | **Accept with conditions** B-v2-1…6 |
| **v2 Codex gpt-5.6-sol xhigh** | [review-gpt56-sol.md](./reviews/agentic-quality-ultragoal-review-gpt56-sol.md) | **Accept with conditions** (exact model gpt-5.6-sol) |
| **Synthesis** | [review-synthesis.md](./reviews/agentic-quality-ultragoal-review-synthesis.md) | Q0 OK after owner; Q1′ after QD0 contract |
| **v2.1 plan (this document)** | dual-review conditions absorbed | **awaiting owner OK** |

---

## 1. Problem statement

Through **6.6.4** CarpeOS completed the **product loop machinery**:

```text
hooks → Evidence + feed (lifecycle-only)
  → flush / 30m timer → pack → deepseek-v4-flash triage/extract
  → E5 ground → promote-when-verified → active Observation
  → default retrieval
```

Dogfood with `carpeos agentic flush --limit 10` on a real private home proved the
loop **runs** (Flash calls > 0, materializations > 0, project hook fires).

It also proved a **quality gap**. That gap is **two failures**, not one:

| Failure | Symptom | Contained today? | Product impact |
| --- | --- | --- | --- |
| **A. Garbage held** | Flash extracts session/hook metadata as `fact_candidate` | **Yes** — gate holds non-allowlist kinds | Ugly proposal table; waste Flash spend |
| **B. True meaning not promoted** | Real decisions/constraints/preferences rarely become default-searchable | **No** | Next agent does not feel compound knowledge |

**v1 of this plan treated A as the cause of B.** That inference is false.
Metadata candidates were never promote-eligible; suppressing them cleans counters
but does not raise the promote numerator. The ultragoal is **B**.

**Infrastructure ultragoal is largely closed.**  
**Meaning-quality ultragoal is not.**

This plan closes **B** (and keeps A from wasting budget) **without** reopening
HITL-as-happy-path, multi-model shopping, or auto `AcceptanceDecision`.

---

## 2. North star (quality ultragoal)

> After normal agent sessions, **without human review**, the next agent’s default
> search returns **typed, cited, decision/constraint/preference-class** meaning
> that a human would recognize as “we decided X” — not session plumbing metadata.

Success is measured by **usable meaning density + retrieval yield**, not feed drain rate.

### Relationship to ADR 0018 S1–S7

| ID | 0018 status | Quality ultragoal adds |
| --- | --- | --- |
| S1–S3 | Machinery + defaults shipped | Higher **true** promote rate on real SessionEnd |
| S4 | Licensing corpus for gate defaults | **Quality corpus**: exact expect; recorded-Flash mandatory; recall + precision floors |
| S5–S7 | Unchanged | Unchanged |

---

## 3. Goals

1. **Substrate correctness first:** Flash sees the same scrubbed text E5 verifies against.
2. **Signal recovery:** agentic path resolves host `transcript_path` (reuse capture primitive).
3. **Grounding works for Korean and mixed KO/EN** sessions (not ASCII-token only).
4. **Extract only load-bearing kinds on v1 usable path:**  
   `decision` | `constraint` | `preference` preferred;  
   `procedure` hold-biased; `fact_candidate` / `open_question` diagnostics only (never promote).
5. **Ban metadata extracts** by **provenance** (prose segment citations), with a small regex belt.
6. **Triage drops empty / telemetry-only SessionEnds** before extract spend when possible.
7. **Offline regression** with exact expectations (not `hold_or_promote` vacuous passes).
8. **Operator visibility:** versioned quality counters; flush default JSON redacts private statements.
9. **Measure before mutate:** baseline corpus counters recorded before prompt/filter PRs.
10. Keep hard fences: no capture LLM; Flash-only; no auto AcceptanceDecision; no load-bearing HITL.

---

## 4. Non-goals

| Non-goal | Why |
| --- | --- |
| Auto promote `fact_candidate` into default search | ADR 0018 D3/D4 v1 allowlist |
| Auto `AcceptanceDecision` | Epistemic fence |
| Multi-model escalation | Cost freeze |
| Perfect entity ER / free-form graph | Out of scope |
| Deleting historical skipped PostToolUse rows from DB | Optional maintenance; not quality core |
| Hosted embeddings | Non-goal |
| Making human review a step on the happy path | ADR 0018 D1 |

---

## 5. Evidence from dogfood + code audit (2026-08-07)

### 5.1 Loop proof (after 6.6.1–6.6.4)

- `credential_source: v5-provider.env`
- `network_used: true`, `flash_calls` dozens per multi-batch flush
- `materializations` and draft Claims observed
- `project_hook_invoked`

### 5.2 Quality failure shapes (synthetic-safe paraphrases only)

Flash produced candidates resembling (paraphrase — not verbatim private data):

- “The hook event is SessionEnd.”
- “The agent type is claude.”
- “The session ID is …”
- “The reason for the session ending is 'other'.”
- “The last assistant message is `find-me-token-77`.”

Gate outcomes: **hold** (`fact_candidate` not in usable allowlist) or **reject**.

Triage drop codes seen when pack text weak:

- `tool_noise`, `no_actionable_content`, `no_knowledge_signal`, `lifecycle_event`,  
  `hook_metadata_only`, `no_transcript`

### 5.3 Root causes (ranked; v2 includes code-verified substrate defects)

| # | Hypothesis | Evidence (code / dogfood) | Severity |
| --- | --- | --- | --- |
| **H0** | **Signal starvation:** `readCaptureSignalText` → `extractSignalTextFromCapturePayload` probes flat keys only; Claude SessionEnd carries `transcript_path`, not `transcript`; fallback is `JSON.stringify(payload)` | `store.ts` extract helper; sibling path already uses `signalsFromTranscriptPath()` | **P0** |
| **H0b** | **Pack/Flash text mismatch:** runner sends raw `signal` to Flash; E5 verifies quotes against scrubbed `packed.pack_text` | `runner.ts` `pack_text: signal`; `pipeline.ts` / `verify.ts` use pack; privacy + cite failure | **P0** |
| **H0c** | **CJK grounding broken:** `tokenize()` splits on `[^a-z0-9]+` → Korean yields zero tokens | `verify.ts` | **P0** |
| **H0d** | **Live network fail falls back to fake candidates that can promote** | runner keeps fake pipeline when Flash nulls; fake hard-codes confidence | **P0** |
| H1 | Signal text is envelope/metadata-heavy when starvation not fixed | Dogfood extracts restate hook fields | P0 (effect of H0) |
| H2 | Extract prompt allows any kind including unconstrained facts | Prompt lists all kinds; no ban list | P1 (gate already contains) |
| H3 | No post-extract content filter before gate | Metadata reaches gate as fact_candidate | P1 (gate already contains) |
| H4 | Triage weak on telemetry SessionEnd; `need_context` still burns extract | runner extracts on keep \|\| need_context; pipeline holds need_context | P1 |
| H5 | Fake offline path not aligned with Flash quality rules | CI won’t catch metadata extracts | P1 |
| H6 | Empty-capture sentinel admits and spends | runner substitutes `` `(empty capture …)` `` | P1 |
| H7 | Whole-session `TOOL_NOISE` admit drop will recall-kill real transcripts once H0 fixed | `admit.ts` tests entire signal | **P0 with Q3′** (required Q2.5′) |
| H8 | Admit-stage `SECRETISH` tests whole signal; real sessions mention “api key”/“password” | `admit.ts` | **P0 with Q3′** (required Q2.5′) |
| H0e | Effective Flash body is `pack_text.slice(0, 12_000)` while E5 verifies full pack | `flash.ts:79-80` | **P0** (QD0 views) |

---

## 6. Target product loop (quality — v2.1)

```text
SessionEnd / Stop / PreCompact feed row
  → recover structured signal (segments + source/role where available):
       path transcript via agentic extraction mode (NOT scoring isDurableProse)
       inline transcript JSONL parsed as prose segments
       prefer transcript/summary/message/text/content/body
       NEVER JSON.stringify envelope as sole body when no prose
       return empty → admit drops (no Flash; no empty-capture placeholder)
  → prepare pack once: scrub + multi-record prose/metadata segments
  → derive effective views:
       full scrubbed pack (digest)
       triage_view_text / extract_view_text (bounded, same scrub family)
  → Flash triage/extract on extract/triage views ONLY
       serialized fetch body MUST equal declared view
  → E5 + provenance bind to the same extract view (or proven offset map)
  → triage: drop telemetry-only; need_context does NOT extract
  → extract: decision|constraint|preference (+ optional procedure hold-biased)
       parser clamps: max N, closed reason_codes, authenticated offsets, unique quote
  → quality filter (provenance primary): cite must map to prose segment
  → E5 statement grounding (CJK-safe tokenize + NFC both sides) + quote ⊆ extract view
  → gate promote-when-verified (gate remains authority)
  → materialize active Observation (live mode: zero fake proposals / promotes)
  → default search (retrieval assertion on corpus)
  → default report/CLI/timer: redacted (no statements/quotes)
```

---

## 7. Design decisions (v2.1)

### QD0 — Substrate: prepared pack + effective model-visible views (blocking)

| Rule | Detail |
| --- | --- |
| Prepare once | Pack/scrub once per feed row; expose prepared pack + digests on an internal API (not default-serialized prose) |
| Flash input | **Never** raw `signal`. Pass **declared** `triage_view_text` / `extract_view_text` (scrubbed, bounded) |
| Same-view bind | Verifier/provenance operate on the **extract view** (or cryptographically/offset-bound map into it) — not a different string than the model saw |
| Regression | Assert **serialized HTTP request body** equals declared view; paths/URIs scrubbed on that body |
| Privacy fence | Flash bodies carry no `http(s)`/`file` URIs, `~/…`, drive-letter paths, or `/tmp|/var|/home|/Users|/etc` paths. **Known residual:** `/opt`, `/private/var`, `/Volumes`, `/mnt`, `/srv`, emails, IPs, hostnames — broaden in Q1′ or document residual |
| Empty signal | No synthetic placeholder that admits; empty → pre-Flash drop |
| Report surface | Prepared text and candidate statements must not appear in default `AgenticRunnerReport` serialization |

### QD1 — Usable extract kinds (v1 quality default)

Flash extract **emission allowlist** (prompt + parser clamp):

| Kind | Emit? | Materialize target |
| --- | --- | --- |
| decision | yes | Observation-primary (+ optional draft Claim) |
| constraint | yes | Observation |
| preference | yes | Observation |
| procedure | optional emit, **gate holds** | draft Observation only |
| fact_candidate | **no promote**; may log diagnostic attempt | — |
| open_question | side-channel / default no promote | — |
| unknown / OOV kind | **drop** with `kind_not_emittable` (do not reclassify to open_question) | — |

**Gate remains authority.** QD1 does not relax `gate.ts`. Suppressed fact attempts remain visible as diagnostics/counters, not deleted from operator visibility.

### QD2 — Quality filter: provenance-primary (not regex-primary)

**Prerequisite (Q4.5′):** current pack emits two records with one segment each under
`field_count: 8`, and extract hard-codes `segment_id: "seg_agentic_body"`.  
Segment provenance **requires** multi-record packing (segment classes:
`prose` | `envelope_metadata` | `synthetic_title` | `tool`), real segment ids on
citations, raised limits. That changes `pack_digest` → re-pin recorded goldens.

Before E5/gate:

1. **Primary:** promote-eligible candidates must cite a verified range inside a
   **prose** segment. Model-supplied offsets must prove
   `view.slice(start,end) === quote`. Ambiguous repeated quotes → reject, not
   silent first-match.
2. **Secondary (belt):** small closed regex for identity restatement / hook tautology  
   — English + common KO patterns; **not** load-bearing alone.
3. **Drop** QD2 “no verb of commitment” heuristic (recall hazard; length floors already exist).

Reason codes: `quality_metadata_segment_citation`, `quality_metadata_restatement`,
`quality_hook_tautology`, `quality_offset_mismatch`, `quality_ambiguous_quote`, …

### QD3 — Triage prompt + schema + spend contract

- Prefer **drop** for: empty body, tool I/O, hook shell JSON, “session ended with reason X” only.
- Prefer **keep** only if pack contains an explicit decision/constraint/preference span.
- Closed `reason_codes` vocabulary as **exported constant** validated at parse time.
- **`need_context`:** no extract call; terminal hold/listable without promote; **never** framed as operator review queue (ADR 0018 D6).
- Bound triage input (head+tail or ≤ ~8k chars style bound) — 220 KB packs are not free prefilters.
- Bump prompt version to `agentic.triage/v2`; record on proposal.
- Align `triageFake` with same keep/drop spirit (no keep-on-`?` alone).

### QD4 — Extract prompt + schema + parser clamps

- Emit **at most N** candidates (default 3) — **parser-enforced**.
- Kinds restricted per QD1 — **parser-enforced**.
- Explicit: do not restate session ids, hook names, agent types, end reasons.
- Quote must be exact substring of **the same** `pack_text` verifier uses (structural, already at parse).
- Bump to `agentic.extract/v2`; pin recorded-Flash goldens to prompt/model digests.
- Confidence: either require in schema or remove decorative threshold; do not default missing to silent hold.

### QD5 — Signal recovery (P0 rewrite; agentic mode)

Do **not** reuse `signalsFromTranscriptPath()` unchanged. Its scoring filters
(`isDurableProse` / `isFutureIntent` reject “will”/“plan to”/…; `sanitizeProse`
rejects braces) **contradict** agentic decision patterns (`we will` is a primary
decision signal). Reuse file I/O + JSONL parsing only.

Agentic extraction mode:

1. Resolve `transcript_path` / `transcriptPath` with **role-attributed prose**, no
   durability lexicon, no future-intent filter, no brace filter; larger bound than
   scoring’s 8 items / 8k chars.
2. Prefer prose fields: `transcript`, `transcript_text`, `summary`, `message`,
   `text`, `content`, `body`. If `transcript` is structured JSONL, parse — do not
   return raw JSONL as a single prose blob.
3. Prefer structured result `{ source, text, segments[] }` when QD2 is active;
   string-only OK only until Q4.5′ lands.
4. If no prose resolves → empty (admit → `empty_signal` before Flash).  
   **Do not** `JSON.stringify` the full envelope as the agentic body.
5. Fixtures: synthetic only; no private paths or real session text in repo.

### QD6 — Quality corpus (offline + recorded-Flash **mandatory**)

Dir: `fixtures/agentic/v1/quality-ultragoal/`

| Case class | Expect (exact) |
| --- | --- |
| decision_session | `promote` (≥1 decision) |
| constraint_session | `promote` |
| preference_session | `promote` |
| metadata_only_session_end | `no_promote` (triage drop or quality filter) |
| session_id_fact | `no_promote` |
| tool_noise_session_end | triage drop / `no_promote` |
| long_session_with_one_decision | promote decision; ignore chatter |
| decision_with_absolute_path | promote (proves scrub/cite alignment) |
| korean_decision_session | promote |
| mixed_ko_en_decision | promote |
| repeated_decision_across_sessions | v1: document + count; optional hold if identical active exists |

Rules:

- Expectations are exact (`promote` / `no_promote` / `hold`), **not** `hold_or_promote`.
- Suite must pass under **fake** and **recorded Flash JSON** (synthetic recorded only).  
  Recorded-Flash is **release licensing**, not optional later cleanup (ADR 0018 D3.3).
- Baseline counters recorded **before** prompt/filter mutation PRs (B6).

### QD7 — Operator metrics + privacy (report-wide)

**Default redaction** applies to all of: `agentic flush`, `agentic run`,
`agentic status`, and the 30m timer log
(`scripts/install-agentic-timer.sh` → `${CARPEOS_HOME}/logs/agentic-timer.log`).
`--verbose` opts into statements/quotes. **Q1.5′ must land before Q3′.**

Multi-row flushes use **count maps**, not a single `signal_source` / `mode`:

```json
{
  "quality": {
    "signal_source_counts": { "inline": 0, "transcript_path": 0, "none": 0 },
    "signal_empty": 0,
    "triage_keep": 0,
    "triage_drop": 0,
    "triage_need_context": 0,
    "extract_candidates": 0,
    "quality_filtered": 0,
    "kind_not_emittable": 0,
    "gate_promote": 0,
    "gate_hold": 0,
    "gate_reject": 0,
    "materialized": 0,
    "flash_calls_attempted": 0,
    "flash_calls_billed": 0,
    "mode_counts": { "fake": 0, "flash": 0 },
    "prompt_version_triage": "agentic.triage/v2",
    "prompt_version_extract": "agentic.extract/v2",
    "policy_version": "…",
    "effective_view_digest": "…"
  }
}
```

### QD8 — Spend interaction (honest)

| Drop point | Saves |
| --- | --- |
| Empty signal / admit drop | triage + extract |
| Triage drop / need_context | extract only |
| Post-extract quality filter | **no** Flash spend (precision only) |

Contracts:

- `need_context` does not extract.
- **Per-row budgets (authoritative on corpus):** triage-kept ≤ **2** billed Flash
  calls; triage-dropped ≤ **1**; **no row > 2**.  
  Blended per-admitted-row average and cost-per-promote are **reported**, not
  gate-failing, unless a separate weighted workload corpus is defined.
- Counter for gates: **billed** (`flash.ts` spend), not attempts.
- Day caps (500 calls / $5 from 6.6.4) remain.

### QD9 — Live mode: zero fake side effects + retry

When `allow_network` is true:

- Do **not** run a proposal-writing fake pipeline before Flash.
- Transient Flash failure: **zero** fake proposals, **zero** materializations;
  leave feed row **retryable** with bounded attempt metadata (today only
  `done`/`skipped` — extend carefully).
- Permanent / exhausted failure: terminal with explicit reason.
- Successful retry: at most one proposal/materialization set.

### QD10 — Rollback includes already-promoted bad units (ADR 0018 D4b)

- Flag `CARPEOS_AGENTIC_QUALITY_FILTERS=off` disables post-extract ban only.
- Prompt/input changes need version pins + patch rollback.
- **Bulk retract** is **new work** on top of single-event `agentic retract`
  (`--human-confirmed` required).  
  Selection is **not** “all `agentic_v1`” — that freezes every unit together.
  Require: **policy_version bump in Q1′** (or formation generation marker),
  dry-run manifest of proposal/event IDs, matching reason, human-confirmed apply,
  idempotent, refuse ambiguous rows, regression that good units survive.
  Operator **maintenance capability**, not happy-path step.

---

## 8. PR plan (implementation order — v2.1)

Safe work lands under current defaults; each PR green under `make preflight`.
Q2′ lands **green characterization** (baselines + non-gating expected failures),
then converts to release gates as fixes land — not a permanently red suite.

| PR | Title | Scope | Notes |
| --- | --- | --- | --- |
| **Q0** | `docs(plan): agentic quality ultragoal + dual reviews` | plan v2.1 + reviews + synthesis | after owner OK |
| **Q1′** | `fix(agentic): prepared pack + effective Flash views` | prepare once; scrub; empty drop; fetch-body assert; policy_version bump | H0b / H0e / QD0 |
| **Q1.5′** | `fix(agentic): redact report/CLI/timer statements` | default redaction; `--verbose`; timer log safe | **before Q3′** (B-v2-1) |
| **Q7′** | `fix(agentic): no fake side effects in live mode` | QD9; retryable transient fail | move early (H0d) |
| **Q2′** | `test(agentic): quality corpus + recorded-Flash harness` | exact expect; promote-capable runner; counters; **baseline #1** | B-v2-6 |
| **Q2.5′** | `fix(agentic): line/segment admit noise + SECRETISH` | was optional Q10; H7/H8 | **before Q3′** |
| **Q3′** | `feat(local-store): agentic transcript recovery` | QD5 agentic mode; structured segments; no JSON.stringify body | H0 |
| **Q4′** | `fix(agentic): CJK grounding + NFC` | tokenize + NFD fixtures + paraphrase; **baseline #2** | H0c |
| **Q4.5′** | `feat(agentic): pack prose/metadata segmentation` | real segment ids; raise field_count; re-pin goldens | blocks Q5′ |
| **Q5′** | `feat(agentic): provenance quality filter` | QD2 + authenticated offsets | after Q4.5′ |
| **Q6′** | `feat(agentic): triage/extract v2 + parser clamps` | QD3/QD4; need_context; fake title fix | — |
| **Q8′** | `feat(agentic): bulk retract with dry-run manifest` | QD10 candidate/event selection | — |
| **Q9′** | `docs: quality ultragoal DoD + architecture note` | agentic-layer.md, product-6 DoD, README | last |

Optional after DoD: near-dup hold; denser host adapters; residual scrub broaden.

---

## 9. Test plan

### Unit

- Flash body equals scrubbed pack_text (paths/URIs scrubbed).
- `transcript_path` resolves to prose; empty envelope → `""`.
- Metadata segment citation dropped; prose decision cite kept.
- Korean + mixed decision grounds and can promote.
- Metadata restatement filter (secondary) kills synthetic “session id is …”.
- Live-mode network fail → **no** promote of fake candidates.
- Parser clamps max candidates / kinds / reason_codes.

### Integration

- `processAgenticOnce` synthetic SessionEnd decision envelope → promote disposition.
- Synthetic metadata-only SessionEnd → zero active Observation.
- Seeded corpus: default search top-k returns decision unit, **zero** metadata units.
- Recorded-Flash replay parity with fake on shared corpus cases (document intentional deltas).

### Dogfood (maintainer private; advisory smoke — not CI release gate)

```sh
carpeos agentic feed
carpeos agentic flush --limit 10
carpeos agentic status
# expect: aggregate counters only in receipts; higher true promote density when sessions have decisions
```

### Regression

- Existing golden / licensing-promote still green (note: inherited suite uses weak
  `hold_or_promote` — quality corpus is the strong gate).
- Hard fences: no AcceptanceDecision from runner; Flash-only; no capture LLM.

---

## 10. Success criteria (quality ultragoal — measurable)

| ID | Criterion |
| --- | --- |
| Q-S1 | Quality corpus green under production promote defaults (fake + recorded-Flash); harness promote-capable |
| Q-S2 | Zero promotes from all `must_not_promote` fixtures (manifest field); negatives reach intended stage |
| Q-S3 | **Per-kind** recall ≥ 80% for decision, constraint, preference; ≥10 fixtures/kind; failures enumerated |
| Q-S4 | Versioned counters; default flush/**run**/status redact statements/quotes |
| Q-S5 | **Advisory** dogfood: N≥30 promoted / ≥7 days; aggregate counters only; metadata among promoted ≤ **0** |
| Q-S6 | No capture LLM; Flash-only model id; no runner-created AcceptanceDecision; no load-bearing HITL |
| Q-S7 | Per-row: triage-kept ≤2 billed Flash calls; triage-dropped ≤1; no row >2 |
| Q-S8 | Korean + mixed fixtures promote; include **paraphrase** and **NFD** cases |
| Q-S9 | Retrieval: pinned queries, **k=5**, expected event IDs present, zero metadata IDs |
| Q-S10 | Baseline #1 (Q2′) and #2 (post-Q4′); PR deltas vs nearest preceding baseline |
| Q-S11 | Live transient fail: zero fake proposals/materializations; retryable; ≤1 eventual materialize |
| Q-S12 | No statement/quote in default CLI or timer log (serialization test) |
| Q-S13 | Corpus `signal_source_counts` match fixture shapes (`transcript_path` / `none` / …) |
| Q-S14 | Zero incidental whole-signal admit drops on mixed decision+tool/secret fixtures |

**Definition of done:** Q-S1–Q-S4, Q-S6–Q-S14 green in automated checks.  
Q-S5 is **advisory smoke**, not a private human gate on release.

---

## 11. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Over-filtering drops real short decisions | Provenance primary; recall floor Q-S3; short-decision fixtures |
| Prompt change increases spend | Stronger triage drop; need_context no extract; bound triage input |
| Transcript preference loses context | Fallback chain documented; multi-field payload tests |
| Hosts differ in payload shape | Q3′ + optional Q12; counters `signal_source` |
| Regex secondary false positives | Keep regex thin; never sole control |
| Whole-session tool_noise after H0 | Q10 line-scope before heavy dogfood |
| Near-dup flood degrades retrieval | Q11 / corpus documented known gap in v1 |

---

## 12. Rollback

| Layer | Mechanism |
| --- | --- |
| Post-extract filters | `CARPEOS_AGENTIC_QUALITY_FILTERS=off` |
| Prompt v2 | pin/version rollback via patch |
| Input boundary (pack_text / transcript_path) | patch revert; regression tests keep fence |
| Already-promoted bad units | bulk retract by policy/formation marker (QD10) — **required**, not optional |
| Schema | no migration required for v1 quality path |

---

## 13. Resolved open questions

| # | Question | Resolution |
| --- | --- | --- |
| 1 | procedure auto-promote later? | **Hold forever in v1**; revisit only with new ADR minor |
| 2 | fact_candidate in Flash extract? | **Out of promote path**; diagnostic visibility only until future ADR |
| 3 | need_context? | **No extract; listable hold without promote; never “review queue”** |
| 4 | EN/KO mixed? | **Must work** — B3 CJK grounding is a code blocker, not a policy shrug |

---

## 14. Why this planning pass exists

Previous “ultragoal complete” claims optimized for suite green, CLI surface, and loop liveness.  
Owner criterion is **compound knowledge quality**.  

v1 of this plan optimized for noise suppression. Dual external review correctly rejected
that as insufficient. **v2 makes substrate + measurement load-bearing**, then tunes model
behavior — so that success criteria measure what the next agent actually retrieves.

---

## 15. Review status and owner gate

Dual external review of **v2** is complete (see review history table).  
Conditions are incorporated as **v2.1** in this document + synthesis.

| Step | Status |
| --- | --- |
| Plan v2 written | done |
| Claude Opus 5 xhigh review | done — Accept with conditions |
| Codex gpt-5.6-sol xhigh review | done — Accept with conditions |
| Synthesis | done |
| Plan v2.1 absorbs conditions | done (this file) |
| **Owner OK to implement** | **awaiting** |
| Q0 PR (docs only) | after owner OK |
| Q1′ first code PR | after owner OK + Q0 |

**Do not start Q3′ until Q1.5′ + Q2.5′ are green.**  
**Do not start Q5′ until Q4.5′ is green.**
