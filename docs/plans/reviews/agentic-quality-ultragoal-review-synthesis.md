# Agentic quality ultragoal — dual-review synthesis (v2)

Date: 2026-08-07  
Inputs:

| Reviewer | Artifact | Model | Verdict |
| --- | --- | --- | --- |
| Claude Opus 5 xhigh | [agentic-quality-ultragoal-review-claude-opus.md](./agentic-quality-ultragoal-review-claude-opus.md) | Claude Opus 5 | **Accept with conditions** (B-v2-1 … B-v2-6) |
| Codex gpt-5.6-sol xhigh | [agentic-quality-ultragoal-review-gpt56-sol.md](./agentic-quality-ultragoal-review-gpt56-sol.md) | **gpt-5.6-sol** (exact; no substitute) | **Accept with conditions** (7 plan-text blockers) |

Plan under review: [agentic-quality-ultragoal.md](../agentic-quality-ultragoal.md) **v2** (substrate-first).  
v1 of the same plan was rejected / accepted-with-conditions as a *noise* plan; v2 was rewritten before this review pass.

---

## 1. Consensus

### 1.1 Shared acceptances

Both reviewers agree:

1. **North star is correct.** Ultragoal = true meaning promoted (failure B), not cleaner held garbage (failure A).
2. **H0 / H0b / H0c / H0d are real P0 substrate defects** (code-verified).
3. **v2 correctly elevated substrate** over prompt-only noise work.
4. **ADR 0018 epistemic fences hold** in the plan text: no capture LLM, Flash-only, no auto `AcceptanceDecision`, no load-bearing HITL for the happy path.
5. **Recorded-Flash licensing is mandatory** (not optional later cleanup).
6. **Gate remains authority** (QD1 OK).
7. **Do not implement the full stack until plan text absorbs residual conditions.**
8. **Q0 (docs) may proceed after owner OK** once synthesis + v2.1 plan land.

### 1.2 Shared blockers (must land in plan before source work beyond Q0)

| Theme | Claude | Codex | Synthesis action |
| --- | --- | --- | --- |
| **Effective model-visible text ≠ full pack** | N2: `flash.ts` slices to 12k | QD0 Change: define `triage_view` / `extract_view`; assert **fetch body** | **QD0 rewrite** — prepared pack + bounded views + verifier bind |
| **Report/timer plaintext leak** | **B-v2-1** (blocks Q3′) | QD7 + privacy fence incomplete | **Q1.5′ redaction PR** before transcript recovery |
| **Provenance substrate missing** | **B-v2-2** (blocks Q5′) | QD2/QD4 Change — segments, offsets, classes | **Q4.5′ pack segmentation** before provenance filter |
| **Blind reuse of scoring transcript primitive** | **B-v2-3** (drops “we will”) | QD5 Change — agentic mode | **QD5 agentic extraction mode** |
| **Whole-signal admit noise/secret** | **B-v2-4** + H8; promote former Q10 | H7 reject deferral; move before Q3′ | **Q2.5′ required** before Q3′ |
| **Live fake promote / fake side effects** | Move Q7′ after Q1′ | Move Q7′ after Q1′ / merge | **Q7′ immediately after Q1′** |
| **Q-S7 ≤1.2 unsatisfiable** | **B-v2-5** | **Reject as written** | **Per-stage budgets** (≤2 keep, ≤1 drop) |
| **Bulk retract selection** | policy_version frozen; bulk is new work | candidate/event-level dry-run | **QD10 + policy_version bump in Q1′** |
| **Recorded-Flash harness is new infra** | **B-v2-6** | Q2′ Change | **Name harness in Q2′** |

### 1.3 Disagreement (resolved in synthesis)

| Topic | Claude | Codex | Resolution |
| --- | --- | --- | --- |
| **Q1′ safe after owner OK?** | Yes with N1 (pack_text plumbing) | **No** until QD0 rewritten for fetch-body / prepared pack | **Adopt Codex:** revise QD0/Q1′ text first; then Q1′ is first code PR |
| **pack_text plumbing detail** | Return pack_text after redaction, or recompute | Prepare/execute boundary; views + digests | **Prepare once; expose views on internal API; never default-serialize prose** |

---

## 2. Agreed PR order (v2.1)

```text
Q0     docs: plan v2.1 + dual reviews + this synthesis
Q1′    prepared pack / effective Flash view + scrub + empty drop
       (+ policy_version bump for later QD10 selection)
Q1.5′  redact statements/quotes from default report/CLI/timer log
Q7′    no fake pipeline writes / no fake promote in live mode + retry
Q2′    quality corpus + recorded-Flash harness + counters + baseline #1
Q2.5′  admit/fake line-or-segment noise + SECRETISH scoping (was Q10)
Q3′    transcript recovery (agentic extraction mode, structured segments)
Q4′    CJK grounding + NFC + paraphrase fixtures → baseline #2
Q4.5′  pack segmentation (prose vs metadata records; real segment ids)
Q5′    provenance-primary quality filter + authenticated offsets
Q6′    triage/extract v2 + parser clamps + need_context no-extract
Q8′    bulk retract (dry-run manifest, candidate/event ids, human confirm)
Q9′    architecture + DoD docs
```

Optional after DoD: near-dup hold; denser host adapters; broader scrub residual (`/opt`, hostnames, …) if not absorbed in Q1′.

---

## 3. Success criteria adjustments (consensus)

| ID | Change |
| --- | --- |
| Q-S3 | **Per-kind** ≥80% recall; min N fixtures per kind (e.g. ≥10); state exact pass count |
| Q-S5 | Advisory; **pick integer threshold** (recommend 0); aggregate counters only |
| Q-S7 | **Reject 1.2 average.** Replace: triage-kept ≤2 calls; triage-dropped ≤1; no row >2; optional weighted workload corpus for mean |
| Q-S9 | Pin `k` (e.g. 5), query set, expected IDs |
| Q-S11 | Zero fake proposals **and** materializations; retryable row on transient fail |
| **Q-S12** (new) | No statement/quote in default CLI or timer log |
| **Q-S13** (new) | Corpus `signal_source` map matches fixture shape |
| **Q-S14** (new) | Zero incidental whole-signal admit drops on mixed fixtures |

---

## 4. Fence check (synthesis)

| Fence | Status |
| --- | --- |
| HITL load-bearing | **Pass** — Q-S5 advisory; bulk retract is maintenance with human confirm |
| Multi-model | **Pass** — Flash-only |
| Auto AcceptanceDecision | **Pass** |
| Privacy scrub | **Not yet proven** — B-v2-1 + scrub residual + 12k body; must pass Q1′/Q1.5′ tests |

---

## 5. Verdict for implementation start

| Action | Status |
| --- | --- |
| Land **Q0** (plan v2.1 + reviews + synthesis) | **OK after owner OK** |
| Start **Q1′ code** | **Only after** plan v2.1 incorporates QD0 effective-view contract |
| Start **Q3′ transcript recovery** | **Blocked** until Q1.5′ + Q2.5′ green |
| Start **Q5′ provenance filter** | **Blocked** until Q4.5′ pack segmentation |
| Claim quality ultragoal complete | **Only** when Q-S1–Q-S4, Q-S6–Q-S14 automated (Q-S5 advisory) |

**Owner decision requested:** accept plan **v2.1** (substrate-first + dual-review conditions) as the implementation SSOT, then open Q0 PR and proceed Q1′ onward in the agreed order.

---

## 6. What was *not* reopened

- HITL-as-happy-path
- Multi-model shopping
- Auto `AcceptanceDecision`
- Promoting `fact_candidate` into default search in v1
- Hosted embeddings / entity ER
