# Design: Thin remote knowledge sync (meaningful-only CF / multi-Mac)

Status: **Child plane (v0.1)** — of [deterministic-front-ultragoal.md](./deterministic-front-ultragoal.md)  
Date: 2026-08-09  
Parent ultragoal: **deterministic front-end first**, then thin remote (P3).  
Depends on: local-first store, G005/G008 sync client + Worker, adjudication
`promoted` dispositions, optional private Cloudflare edge  
Related: [cloudflare-sync.md](../guides/cloudflare-sync.md),
[private-cloudflare-operator-config.md](../guides/private-cloudflare-operator-config.md),
[agentic-quality-ultragoal.md](./agentic-quality-ultragoal.md)

**Owner gate:** implement only after owner OK on §3–§6 and default policy in §5.

---

## 1. Problem statement

CarpeOS today is **local-first and capture-rich**:

```text
host hooks → EvidenceArtifact (+ extract Observation/Claim)
  → every new canonical event enqueued on local outbox (pending)
  → carpeos sync push/once drains outbox FIFO to Worker/D1/R2
```

That design is correct for **“full event log multi-Mac mirror”**.

It is the **wrong default** for the operator goal that is now explicit:

> **Cloudflare and a company Mac should carry meaningful knowledge only.**  
> Session noise, dogfood hooks, and raw Evidence floods must not be required on remote.

Evidence from a real private home (2026-08):

| Signal | Observation |
| --- | --- |
| Outbox pending | ~4.5×10⁴ rows, mostly `EvidenceArtifact` |
| Attempts on backlog | 0 until edge reconnected — backlog = “never pushed”, not “failed push” |
| Adjudication | promote ≪ hold/reject; default search is already promote-biased |
| Sync CLI | `push`/`once` only bound by `--limit`; **no admission filter** |
| Outbox CLI | status/lease/ack/retry only; **no skip/drop/purge-by-policy** |

So:

- **Local** can stay full (archive + re-extract).
- **Remote** must become **thin by policy**, not by hoping the operator never runs drain.

Infrastructure (private Worker URL, credentials, auth seed) can be live while this
product gap remains. **Ops “do not drain” is not the product solution.**

---

## 2. North star

> After normal use, **without uploading the raw capture firehose**, a second enrolled
> device (or a fresh company Mac) can **pull or import a thin knowledge set** such that
> default `memory_search` / context-pack returns **promoted, citable decisions /
> constraints / preferences** — not SessionEnd plumbing or dogfood Evidence.

**Local-full / remote-thin** is the durable model:

| Plane | Contents | Purpose |
| --- | --- | --- |
| Local store | Full canonical + outbox history (optional archive) | Capture fidelity, re-extract, forensics |
| Remote (CF) | **Admitted** knowledge only (default: promoted units + minimum support refs if required) | Continuity, backup of *meaning*, not log dump |
| Company Mac | Thin set only (pull thin remote and/or knowledge bundle import) | Work-useful memory without personal dogfood |

---

## 3. Goals

1. **Sync admission policy (SSOT)**  
   Config-driven rule decides whether a local event (or knowledge unit) is eligible for
   remote push. Default must be **thin**, not full-log.

2. **Backlog hygiene**  
   Operator can mark existing outbox `pending` rows as **sync-skipped** (or drop from
   queue) when they fail admission — **without deleting local canonical events**.

3. **Thin push path**  
   `sync push|once|cycle` only leases/pushes admitted work. Proof: empty/noise-heavy
   local store does not inflate remote event count under default policy.

4. **Thin pull / enroll path**  
   Second machine with same trust-zone keys pulls thin remote and gets usable default
   search. Document company-Mac enroll (client auth seed, keys, URL).

5. **Knowledge bundle escape hatch**  
   Export **promoted-only** portable bundle (build on OKF or a dedicated package) and
   import on a device that should **not** join personal CF (e.g. corporate laptop policy).

6. **Operator visibility**  
   `sync status` reports admission mode, admitted-pending vs skipped counts, remote
   thinness health (no secrets). Doctor warns if policy is `full` or backlog is huge.

7. **Hard fences**  
   No plaintext secrets in CLI JSON; no credential in git; private Wrangler stays ignored;
   public docs stay placeholder-only for CF IDs.

---

## 4. Non-goals

| Non-goal | Why |
| --- | --- |
| Silent rewrite of already-delivered remote history | Immutability / fail-closed sync; cleanup is a later operator erase story |
| Auto HITL or auto AcceptanceDecision | Unchanged epistemic fences |
| Hosted multi-tenant SaaS CF | Still private operator edge |
| Perfect online garbage classification of every Evidence | Thin = **disposition / type policy first**; quality ultragoal stays separate |
| Mandatory CF for all users | Local-only remains valid; thin sync is opt-in |
| Launchd/cron productization in v1 of this goal | Document manual/helper; scheduler later |
| Full GraphRAG / Vectorize on Worker | Separate roadmap |

---

## 5. Default policy (v1 proposal)

**Name:** `remote_thin_promoted_v1` (default when sync URL is configured)

| Admit to remote | Rule |
| --- | --- |
| **Yes** | Knowledge units with disposition **promoted** + lifecycle **active** (Claims/Observations that default search already surfaces) |
| **Yes (optional flag)** | Explicit operator allowlist project_ids |
| **No (default)** | Raw `EvidenceArtifact` capture rows |
| **No (default)** | `hold` / `reject` / draft-only units |
| **No (default)** | Synthetic trust zones / test fixtures |

**Open design choice (owner decides before implement):**

| Option | Meaning | Tradeoff |
| --- | --- | --- |
| **A. Unit-sync** | Push promote records (+ minimal provenance stubs), not full Evidence stream | Thinnest remote; may need new remote schema or packing |
| **B. Event-sync filtered** | Keep event-level sync but only enqueue/push events that *are* or *directly materialize* promotes | Fits current outbox shape; may still pull some support Evidence |
| **C. Bundle-only for company** | CF full-or-nothing still discouraged; company Mac uses export/import only | Fastest company path; weaker multi-Mac continuous sync |

**Recommendation for v1:** **B for continuous personal multi-Mac**, plus **C as company path**.  
Move to **A** if B still ships too much Evidence support graph.

Capture path stays **local-full** regardless: hooks do not become remote.

---

## 6. Work units (implementation ladder)

### TR0 — Spec freeze (docs only)

- This plan + short architecture note: local-full / remote-thin.
- Decision record: default policy name + Options A/B/C choice.
- **Exit:** owner OK.

### TR1 — Admission engine (library)

- Pure function: `(event | knowledge unit, policy) → admit | skip` with reason codes.
- Unit tests: promote admit; Evidence skip; hold skip; zone fixtures skip.
- **Exit:** package tests green; no CLI yet required.

### TR2 — Enqueue + push integration

- Apply admission at **outbox enqueue** and/or **lease/push** (fail-closed dual check).
- Config surface (e.g. `sync.admission = remote_thin_promoted_v1 | full_log | off`).
- `full_log` preserved for operators who want historical mirror.
- **Exit:** sync once under thin policy pushes 0 pure Evidence-only rows in fixture store.

### TR3 — Backlog CLI

- `carpeos outbox skip-non-admitted` / `outbox purge-pending --policy …`  
  (names TBD; must not delete `canonical_events`).
- Dry-run + apply; JSON counts by reason.
- **Exit:** dogfood-scale pending can be reduced without store wipe; documented.

### TR4 — Status / doctor

- `sync status`: `admission_policy`, `pending_admitted`, `pending_skipped`, `delivered`.
- Doctor: warn on `full_log` + huge pending; warn URL missing when keys present.
- **Exit:** operator can see thin vs full without opening SQLite.

### TR5 — Thin enroll proof

- Scripted or documented: machine A thin-push → machine B empty home pull →
  `memory_search` finds promoted fixture; does not require 10k Evidence.
- Private evidence only under ignored `.carpeos/`.
- **Exit:** redacted proof in maintainer note or private log.

### TR6 — Knowledge bundle (company Mac)

- `carpeos knowledge export --promoted-only --out …`  
  (OKF-based or dedicated; projection-first preferred).
- `carpeos knowledge import --from …` into empty/local zone.
- **Exit:** company Mac usable **without** personal CF join.

### TR7 — Docs + setup

- README / KO: local-full remote-thin; do not recommend full drain of capture backlog.
- Cloudflare guide: admission defaults; backlog purge before first production drain.
- Setup does not claim multi-Mac “just works” without thin policy + keys.

---

## 7. Success criteria (DoD)

| ID | Criterion |
| --- | --- |
| D1 | Default admission is thin; `full_log` is explicit opt-in |
| D2 | Automated tests prove Evidence-heavy fixture does not remote-admit under default |
| D3 | Backlog tool can clear non-admitted pending without deleting local canonical |
| D4 | Thin push/pull path documented and proven once (private) |
| D5 | Company path: promoted bundle export/import works offline |
| D6 | Public boundary: no real CF IDs/tokens in git |
| D7 | Preflight/tests green for touched packages |

**Not DoD:** draining historical 4×10⁴ rows to CF; zero local noise; quality ultragoal promote density (separate plan).

---

## 8. Operator interim (until TR1–TR3 ship)

1. **Do not** full-drain capture backlog to CF.
2. Keep private Worker alive (URL + keys) for later thin push.
3. Company Mac: prefer **empty setup**; wait for TR6 or manual promote export.
4. Local home remains source of truth archive.

This interim is **risk control**, not completion of the goal.

---

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| Thin remote cannot re-extract without Evidence | Accept for v1; optional later “support Evidence pack” flag |
| Already-delivered noise on CF from early drain | Document; optional later erasure/compaction story (non-goal v1) |
| Policy too thin → empty second Mac | Fixture + dogfood checklist of min promote set before cutover |
| Policy too thick → Evidence returns via “support” | Prefer unit-sync (A) in v1.1 if B fails density budget |
| Company policy forbids personal CF | TR6 bundle path mandatory |

---

## 10. Suggested sequencing vs other goals

| Priority | Work |
| --- | --- |
| Now | TR0 owner OK |
| Next product slice | TR1 → TR2 → TR3 (admission + backlog) |
| Then | TR4 status, TR5 proof |
| Company week | TR6 if corporate Mac must not use personal CF |
| Parallel | Agentic quality promote density (improves *what* is worth syncing) |

Quality ultragoal **increases** value of thin remote (more real promotes).  
Thin remote **does not wait** for perfect quality; it stops shipping garbage either way.

---

## 11. Open questions for owner

1. Confirm default policy: **B (filtered event-sync)** + **C (bundle for company)** as v1?
2. Company Mac: **allowed to use personal CF thin pull**, or **bundle-only**?
3. Historical CF rows already delivered in early drain: **ignore** for v1 or schedule purge story?
4. Should new captures **stop enqueuing** Evidence to outbox under thin policy, or enqueue-then-skip at push (auditability vs queue size)?

---

## 12. One-line summary

**Build local-full / remote-thin: admit only meaningful (default promoted) knowledge to CF and company devices; give backlog purge and a promoted bundle path; stop treating full outbox drain as the multi-Mac product.**
