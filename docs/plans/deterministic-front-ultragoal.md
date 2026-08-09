# Ultragoal: Deterministic front-end → meaningful knowledge (local + thin remote)

Status: **Active ultragoal (v1.0)** — implement in stacked PRs  
Date: 2026-08-09  
Supersedes in part: [thin-remote-knowledge-sync.md](./thin-remote-knowledge-sync.md)  
(thin remote remains a **downstream plane** of this goal, not the primary wedge)  
Related: [agentic-quality-ultragoal.md](./agentic-quality-ultragoal.md) (Flash quality / promote density),
ADR 0017/0018, G005 sync

---

## 1. Problem

CarpeOS runs a multi-stage pipeline from raw host hooks to searchable knowledge:

```text
hooks → Evidence (local always)
     → agentic_capture_feed (lifecycle subset)
     → [Flash triage/extract]  ← LLM cost
     → gate / promote
     → default retrieval
     → (optional) outbox → Cloudflare
```

Today:

| Layer | Deterministic? | Gap |
| --- | --- | --- |
| Capture store | Yes — stores almost everything | Correct for archive; fills disk/outbox |
| Feed enqueue | Hook allowlist only | Empty/noise SessionEnd still becomes `pending` feed |
| E1 admit | Yes — rule admit | Good start; must stay SSOT and grow without LLM |
| Flash triage | LLM | Still sees work that front should have dropped |
| Outbox/sync | FIFO full log | Remote gets capture firehose if drained |

Operator goal (dogfood + company Mac):

> **Garbage should die as early as possible in deterministic code.**  
> LLM should only see residual that might be real meaning.  
> Local promote plane and CF/company Mac should accumulate **brain-worthy** units, not hook telemetry.

Front-end quality is the highest leverage: it cuts Flash spend, feed backlog, outbox noise, and remote thinness at once.

---

## 2. North star

> **Deterministic front-end first:** before any Flash call, drop empty, telemetry-only, tool-noise-only, secretish-only, and non-lifecycle signals.  
> **LLM middle only on residual.**  
> **Local knowledge plane** (default search) and **remote thin sync** only advance **promoted / brain-worthy** meaning — not raw Evidence dumps.

Success is measured by:

1. **Pre-LLM drop rate** on known noise fixtures (exact, offline).  
2. **Flash calls avoided** vs baseline on the same corpus.  
3. **Promote precision** not regressed (quality ultragoal corpus still green).  
4. **Remote admission** under default thin policy never pushes pure Evidence capture rows.

---

## 3. Planes (priority order)

### P0 — Deterministic front-end (this ultragoal’s primary wedge)

| Stage | Name | LLM? | Job |
| --- | --- | --- | --- |
| F0 | Hook class gate | No | Lifecycle only for brain feed (`SessionEnd`/`Stop`/`PreCompact`) |
| F1 | Signal presence | No | Empty / too-short / noise-only drop |
| F2 | Line-scoped strip | No | Tool noise + secretish lines stripped; residual prose kept |
| F3 | Feed enqueue policy | No | Insert `skipped` with reason when F0–F2 fail (metrics) |
| F4 | E1 admit (flush path) | No | Same SSOT as F1–F2; never call Flash on drop |

**SSOT requirement:** one module in `@carpeos/capture` (or shared) used by feed insert **and** agentic admit. No forked regex lists.

### P1 — LLM middle (constrained)

- Flash triage/extract only after F4 admit.  
- Existing quality-filter (post-extract, still deterministic) stays.  
- Quality ultragoal continues to improve *what* promote means — orthogonal but complementary.

### P2 — Local brain plane

- Default search: promoted active only (already).  
- Front-end reduces garbage held/extract attempts so promote density is not drowned.

### P3 — Thin remote (downstream)

- Default sync admission: promoted knowledge (and optional support stubs later).  
- No full outbox drain of Evidence firehose.  
- Backlog skip/purge for non-admitted pending.  
- Company Mac: thin pull and/or promoted bundle import.

---

## 4. Goals

1. Single **deterministic front evaluation** API with stable reason codes.  
2. Feed insert uses it: noise never sits as `pending` waiting for Flash.  
3. Admit reuses the same API (delete duplicate logic in agentic).  
4. Expand front patterns from real dogfood reason codes (telemetry SessionEnd, stop-only, ok/done, parse-error fuels) **without** LLM.  
5. Counters: `front_drop_*` on flush/status (no private text).  
6. Thin remote admission + outbox skip for non-admitted (default thin).  
7. Docs: local-full archive vs brain plane vs remote thin.  
8. Tests offline; no network; public-safe fixtures only.

---

## 5. Non-goals

| Non-goal | Why |
| --- | --- |
| Stop capturing Evidence locally | Archive/forensics still useful |
| LLM at admit | Cost + non-determinism |
| Auto AcceptanceDecision | Epistemic fence |
| Perfect semantic understanding pre-LLM | Front is precision-first drop of *obvious* garbage |
| Full historical CF purge of early drain | Later erase story |
| Hosted multi-tenant CF | Private operator only |

---

## 6. Work units (PR ladder)

| ID | PR theme | Deliverable |
| --- | --- | --- |
| **DF0** | docs/spec | This ultragoal; thin-remote as child plane |
| **DF1** | feat(capture): front SSOT | `evaluateDeterministicFront` + tests; admit imports it |
| **DF2** | feat(local-store): feed skip | Enqueue `skipped` + reason when front drops; tests |
| **DF3** | feat(agentic): flush metrics | Surface front_drop counters on run/status |
| **DF4** | feat(sync): thin admission | Push only admitted; config `remote_thin_promoted_v1` default when URL set |
| **DF5** | feat(cli): outbox hygiene | `outbox skip-non-admitted` dry-run/apply |
| **DF6** | docs + doctor | Operator model; doctor warnings |
| **DF7** | (optional) knowledge bundle | Company Mac offline import |

Ship **DF0→DF2** first (front-end). DF4–DF5 next (remote). DF7 if company path needs it.

---

## 7. Default policies

### Front-end (`front_v1`)

**Drop** when any of:

- empty / whitespace signal  
- injection/exfil patterns  
- non-lifecycle hook for feed  
- residual prose after line-strip length &lt; 8  
- residual empty after tool/secret line strip  
- whole-signal noise-only (`ok`, `done`, `pong`, …)

**Pass** with optional residual_text for mixed decision+noise sessions (line-scoped).

### Remote (`remote_thin_promoted_v1`)

- Admit: promoted+active knowledge units (event types / dispositions as implemented).  
- Deny: raw EvidenceArtifact capture rows by default.  
- Opt-in: `full_log` for operators who want mirrors.

---

## 8. Success criteria (DoD)

| ID | Criterion |
| --- | --- |
| D1 | One SSOT front evaluator; admit + feed use it |
| D2 | Offline tests: noise SessionEnd never reaches Flash in pipeline unit tests |
| D3 | Feed insert records `skipped` + reason for front drops |
| D4 | Quality corpus / existing agentic tests green (no precision regression) |
| D5 | Thin sync default: Evidence-only fixtures not pushed |
| D6 | Backlog skip tool available for non-admitted outbox |
| D7 | Preflight green; public boundary intact |

---

## 9. Relationship to prior work

| Prior | Relationship |
| --- | --- |
| Agentic quality ultragoal | Improves extract/promote quality **after** front; keep green |
| E1 admit + feed lifecycle | Substrate — this goal **hardens and unifies** it |
| Thin-remote plan | Child of P3; do not full-drain capture backlog |

---

## 10. One-line summary

**Kill garbage in deterministic front-end before Flash; keep local archive if needed; promote and thin-sync only brain-worthy knowledge.**
