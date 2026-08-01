# Product 3.1.0 — Definition of Done (OKF interop export)

Status: **release approved (K7)** — `@innocarpe/carpeos@3.1.0` release execution
remains at K8.

Related:

- [Product 3.0.0 DoD](product-3.0.0.md) — retrieval-first graph (shipped)
- [Product 2.0.0 DoD](product-2.0.0.md) — adjudication (shipped)
- [ADR 0014](../adr/0014-okf-export-projection.md) — OKF is an export projection
- [OKF interop plan](../plans/okf-interop.md) — gated implementation sequence
- [Versioning policy](versioning-and-releases.md) — MINOR = additive feature
- Public package: `@innocarpe/carpeos` (currently `3.0.2` on main)

---

## What 3.1.0 means (SOURCE OF TRUTH)

**`3.1.0` means an operator can export a trust-zone-scoped, promoted-by-default
slice of CarpeOS knowledge as an OKF v0.2-conformant Markdown bundle that an
external agent or tool can read without CarpeOS installed — without weakening
adjudication, canonical authority, or public-boundary safety.**

| | 3.0.0 | **3.1.0** |
| --- | --- | --- |
| Question | Can it be found and used *inside* CarpeOS? | Can accepted knowledge **leave** CarpeOS safely? |
| Core engine | retrieval projection + graph | **OKF export projection** |
| Success signal | multi-hop recall + latency | **conformant bundle + mapping fidelity + redaction** |
| Failure if skipped | unusable brain | brain stays **siloed** to CarpeOS-only consumers |

This is a **MINOR** product step, not a new major thesis. Defaults and contracts
from 2.0/3.0 stay: promoted-only meaning surface, rebuildable projections,
canonical events remain SSOT.

---

## Thesis in one sentence

CarpeOS keeps its own epistemic OS; OKF is how that OS **speaks** to the rest of
the agent ecosystem.

```text
canonical events + dispositions  (authority)
        |
        +--> retrieval / graph / MCP     (in-process use)
        +--> Obsidian projection         (human vault)
        +--> OKF export projection       (portable exchange)  <- 3.1
```

---

## Non-negotiable invariants

1. **ADR 0001:** OKF files are projections. Rebuild/delete does not mutate
   canonical events.
2. **ADR 0012:** Default export is **promoted/active only**. Held/draft require
   an explicit flag. Rejected never exports by default.
3. **No silent import authority:** 3.1 does not auto-promote foreign OKF into
   meaning.
4. **Trust zones fail closed:** export requires explicit visible zones.
5. **Public boundary:** no absolute paths, credentials, protected plaintext,
   private remotes, or raw session dumps in exported bodies/frontmatter.
6. **Manifest ownership:** only managed files may be rewritten/deleted on
   rebuild.
7. **Determinism:** same snapshot + config ⇒ same bundle paths and stable
   concept IDs (tests must pin this).

---

## Product gates (living) — 3.1

| ID | Gate | Status |
| --- | --- | --- |
| K0 | ADR 0014 + this DoD + plan merged (design freeze for scope) | **done** (PR #124) |
| K1 | Field mapping table locked (disposition → OKF frontmatter) + golden fixtures | **done** (`@carpeos/okf-projection` mapper + fixtures) |
| K2 | `@carpeos/okf-projection` rebuild API from typed snapshots (disk + manifest) | **done** (`buildOkfProjectionPlan` / `rebuildOkfProjection`; integrated projection tests: 28 passed) |
| K3 | OKF v0.2 conformance checks (type, frontmatter, reserved names, links) | **done** (`checkOkfConformance`; integrated projection tests: 28 passed) |
| K4 | CLI export command + doctor/help discoverability | **done** (`carpeos okf export` / `carpeos okf rebuild`; CLI tests: 42 passed; npm package build/packaging test and packaged `help okf` smoke passed) |
| K5 | Safety suite: redaction, path escape, held-default-off, zone fail-closed | **done** (integrated projection tests: 28 passed; public boundary: 290 files passed) |
| K6 | Docs: guide + README/CHANGELOG honesty; architecture/projections updated | **done** (`pnpm check` passed) |
| K7 | Freeze packet + maintainer **Approve** | **done** (maintainer end-to-end release authorization in chat, 2026-08-01) |
| K8 | SemVer **3.1.0** release (`carpeos-release` skill path) | pending — execute the approved release |

---

## Operator experience

CLI names are **implemented and locked**; do not rename without deprecation:

```bash
# Export promoted/active knowledge for declared zones into an OKF bundle
carpeos okf export --out ./okf-bundle --visible-trust-zone tz_local_default

# Rebuild / refresh managed bundle (manifest-aware)
carpeos okf rebuild --out ./okf-bundle --visible-trust-zone tz_local_default

# Optional: include held/draft (never default)
carpeos okf export --out ./okf-bundle --visible-trust-zone tz_local_default --include-held
```

Also locked for 3.1:

- Evidence concepts: **safe metadata only** (no body excerpts).
- Root `log.md` updated each export run.
- No import command or import path.

Success criteria for the operator:

1. Bundle root is openable as plain files (no SDK).
2. Root `index.md` lists concepts with titles/descriptions.
3. Frontmatter carries `type` + trust/lifecycle signals where known.
4. External agent can answer “what did we decide?” from the bundle alone for
   exported accepted decisions.
5. `carpeos doctor` (or equivalent) can report last export health if cheap;
   otherwise docs-only for 3.1 is acceptable if CLI exit codes are clear.

---

## Mapping requirements (must be documented + tested)

Minimum mapping coverage for K1:

| Input | Exported? (default) | OKF highlights |
| --- | --- | --- |
| Claim + visible AcceptanceDecision | yes | `type: Accepted Decision`, `status: stable`, sources to support |
| Promoted Observation | yes | `type: Observation`, `status: stable` |
| Held Observation | no (yes with `--include-held`) | `status: draft` |
| Rejected | no | — |
| Evidence (safe summary only) | optional, linked | `type: Evidence Summary` |
| Supersession | yes when endpoint exported | `status: deprecated` on superseded concept when present |
| Erasure | tombstone or omit per policy | never re-materialize erased plaintext |

Actor convention for `generated.by` / `verified.by` must follow OKF §7 and ADR
0014.

---

## Explicit non-goals for 3.1.0

| Non-goal | Why |
| --- | --- |
| OKF as canonical store | Breaks ADR 0001 / 0012 |
| Auto-import → promote | Reintroduces dump pollution |
| Full OKF Attested Computation runtime | Out of personal-OS MVP; large surface |
| Replacing Obsidian projection | Different audience (human vault vs portable exchange) |
| Cloud Knowledge Catalog product glue | Adapter later; not packaging-critical |
| New PRD major file | Minors use this DoD + ADR; PRD series stays per major |

---

## Freeze and release

Same discipline as 3.0:

1. K0–K6 green with evidence (tests, smoke, docs links).
2. Freeze packet in this file (fill at freeze time): open risks, deferred items,
   contract impact (CLI additions only — no breaks).
3. Maintainer **Approve** in chat or freeze note.
4. Cut `3.1.0` via [carpeos-release](../../.agents/skills/carpeos-release/SKILL.md)
   / `scripts/release.mjs` — never retag 3.0.0.

### Freeze packet

| Item | Value |
| --- | --- |
| Decision | **Approve 3.1.0 (MINOR)** — 3.0.0 is already released; no 4.0 breaking thesis is introduced |
| CLI contract delta | Additive `carpeos okf export` / `carpeos okf rebuild` commands with `--out`, repeatable `--visible-trust-zone`, and opt-in `--include-held` |
| Known residuals | No OKF import, full Attested Computation runtime, or cloud catalog glue; all are explicit non-goals and none are release-blocking |
| Approve | Maintainer end-to-end release authorization in chat, 2026-08-01 |

---

## Success quote (product honesty)

> 3.1 does **not** mean “CarpeOS became OKF.”  
> It means “what CarpeOS already judged worth remembering can leave the house
> in a language other agents already speak.”
