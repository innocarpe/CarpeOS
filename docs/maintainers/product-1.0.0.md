# Product 1.0.0 — Definition of Done

Status: **source of truth** for what SemVer `1.0.0` means for CarpeOS as a
**product**, not only a frozen CLI/MCP contract.

Related:

- [v1 Readiness](v1-readiness.md) — contract freeze gates G1–G9 (necessary packaging)
- [v1 Freeze Decision](v1-freeze-decision.md) — human Approve / Defer for the tag
- [Versioning and Releases](versioning-and-releases.md) — SemVer + release process
- [Release Readiness](release-readiness.md) — per-release CI/local evidence
- Public package: `@innocarpe/carpeos`

**Do not cut** git tag `v1.0.0` or publish npm `1.0.0` until:

1. This product loop DoD is green (or consciously waived in writing),
2. Contract gates on [v1-readiness.md](v1-readiness.md) remain satisfied,
3. [v1-freeze-decision.md](v1-freeze-decision.md) is flipped to **Approve** by a
   maintainer (explicit chat/PR decision — never automatic).

---

## What 1.0.0 means

**`1.0.0` means the original CarpeOS core product loop works end-to-end**, then we
freeze the public contract.

Contract freeze (CLI/MCP/setup/store surfaces) is **necessary packaging at the
end**, not sufficient product completion. Older docs that treated GraphRAG,
capture UX, and Evidence→meaning extraction as non-goals while still cutting
`1.0.0` are **superseded by this document** for product judgment.

### Core product loop (all must be true)

| Step | Requirement |
| --- | --- |
| 1. Host work | Developer works in Claude / Codex / Grok |
| 2. Capture install | Capture is installed as part of **product setup** (not a forgotten second step) |
| 3. Evidence land | Session lifecycle evidence lands in local SQLite (encrypted raw + EvidenceArtifact) |
| 4. Meaningful units | Meaningful units are derived (**Observation** and/or **Claim** at minimum) |
| 5. Retrieval surface | Memory search + context-pack return those meaningful units (not only artifact metadata) |
| 6. Safe upgrades | Existing homes upgrade safely (migrations, no silent wipe) |
| 7. Gates | Automated product E2E gate + a few manual scenarios pass |
| 8. Freeze + ship | Then public contract freeze + CHANGELOG Notes + tag `v1.0.0` + npm publish |

### Relationship to contract checklist (G1–G9)

| Layer | Doc | Role for 1.0.0 |
| --- | --- | --- |
| **Product loop** | This file | Sufficient product completion criteria |
| **Contract freeze** | [v1-readiness.md](v1-readiness.md) | Necessary packaging; freezes public surfaces once product loop is real |
| **Human gate** | [v1-freeze-decision.md](v1-freeze-decision.md) | Explicit Approve before tag/publish |

---

## Explicit non-goals for 1.0.0

These stay **post-1.0** unless a later story explicitly pulls them in:

| Non-goal | Why out of 1.0 |
| --- | --- |
| GraphRAG / multi-hop completeness | Projection quality, not the core loop |
| Multi-Mac “just works” | Private CF sync may already work for operators; not a public 1.0 requirement |
| Hosted Cloudflare as a **public** product | Edge remains private/operator territory |
| Production embedding providers | Deterministic local-dev embeddings are OK for 1.0 |
| Logging every PostToolUse by default | Noise; lifecycle-heavy extraction preferred |
| Cutting `v1.0.0` without maintainer **Approve** after product gate | Hard stop |

Private Cloudflare sync should **keep working** if already configured; it must not
block or define 1.0.0.

---

## Product gate checklist (living)

Status values: `done` · `partial` · `todo` · `blocked`. Update as stories land.

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| P1 | Capture install is an official product path (`carpeos setup …` and/or documented one-shot) with verify + uninstall/disable; does not wipe user host hooks | **todo** | Ultragoal G002 |
| P2 | Session lifecycle capture writes encrypted raw + EvidenceArtifact into local store | **partial** | Capture-hook + dogfood already land evidence; install path still G002 |
| P3 | Extraction policy documented + implemented (lifecycle defaults; PostToolUse off by default; privacy rules) | **done** | ADR 0011 + `packages/capture/src/meaningful-unit-policy.ts` (G003) |
| P4 | Extraction pipeline MVP: Evidence → Observation and/or Claim (idempotent, trust-zone aware) | **done** | `extractFromEvidenceArtifact` + CLI (G004); Claim auto still policy-gated off |
| P5 | Search + context-pack (CLI + MCP) rank meaningful units first-class; evidence metadata secondary | **done** | Kind priority + diversity (G005); smoke asserts Observation |
| P6 | Named product E2E script in CI (capture fixture → extract → rebuild → search/context-pack) | **todo** | Ultragoal G006 |
| P7 | Doctor reports hooks + recent capture + meaningful units; README EN/KO path matches reality; no false “1.0 shipped” claims | **todo** | Ultragoal G007 |
| P8 | Scenario checklist below ticked (public-safe notes); critical bugs fixed | **todo** | Ultragoal G008 |
| P9 | Product gate decision doc + draft CHANGELOG `## [1.0.0]` Notes; Decision remains Defer until human Approve | **todo** | Ultragoal G009 |
| P10 | Contract freeze G1–G9 still green on [v1-readiness.md](v1-readiness.md) | **partial** | G1–G8 done; G9 Defer |
| P11 | Maintainer Approve + release (`node scripts/release.mjs 1.0.0`, tag, npm) | **blocked** | Ultragoal G010 — only after explicit Approve |

Baseline note (2026-07-30, do not re-litigate): public package `0.2.2`; local
contract gates largely done; capture-hook exists for codex|claude|grok; retrieval
can project metadata-only excerpts. **Gaps:** setup does not install hooks; no
automatic Evidence→Observation/Claim extraction; search is not yet “meaningful
knowledge first”; no product E2E gate for the full loop.

---

## Scenario checklist (dogfood / G008)

Plain-language scenarios. Tick with **public-safe** notes only (no real project
names, private Worker URLs, production logs, or home dumps). Prefer one cycle per
host (Claude / Codex / Grok) when feasible — not a multi-day soak.

### S1 — Fresh product install lands capture

| Field | Value |
| --- | --- |
| **Setup** | Clean or documented profile; install published or monorepo-built `carpeos` |
| **Actions** | Official setup path that installs Claude/Codex/Grok capture hooks; doctor |
| **Expect** | Hooks present; doctor reports hook status; no wipe of pre-existing user hooks |
| **Status** | ☐ |

### S2 — Session lifecycle evidence is stored

| Field | Value |
| --- | --- |
| **Setup** | Hooks installed (S1) |
| **Actions** | Start/stop a short host session (or synthetic capture fixture equivalent) |
| **Expect** | Local store has capture/evidence rows (encrypted raw + EvidenceArtifact); counts increase |
| **Status** | ☐ |

### S3 — Meaningful units appear after extract

| Field | Value |
| --- | --- |
| **Setup** | Store with evidence from S2 or synthetic fixture |
| **Actions** | Automatic post-capture extract and/or explicit extract CLI |
| **Expect** | At least Observation and/or Claim events/chunks exist; re-run is idempotent |
| **Status** | ☐ |

### S4 — Search and context-pack return meaning first

| Field | Value |
| --- | --- |
| **Setup** | Rebuilt retrieval index over extracted units |
| **Actions** | CLI search + context-pack; MCP equivalents if registered |
| **Expect** | Query over synthetic extracted text returns those units; evidence metadata is secondary |
| **Status** | ☐ |

### S5 — Existing home upgrades safely

| Field | Value |
| --- | --- |
| **Setup** | Pre-1.0 local home (or fixture) with prior events |
| **Actions** | Upgrade binary/schema; run doctor / open store |
| **Expect** | Migrations apply; no silent wipe; prior events still readable under trust-zone rules |
| **Status** | ☐ |

---

## Delivery order (ultragoal stories)

Tracked as plan id `carpeos-product-100` (repo-local ultragoal). One small PR per
story when possible.

| Story | Title |
| --- | --- |
| G001 | Spec: this document |
| G002 | Capture install as product surface |
| G003 | Meaningful-unit policy |
| G004 | Extraction pipeline MVP |
| G005 | Retrieval + MCP surface meaningful units |
| G006 | Product E2E gate script + CI |
| G007 | Doctor, README, operator path |
| G008 | Scenario dogfood + fixes |
| G009 | Product gate decision (no tag) |
| G010 | SemVer 1.0.0 release (**only** after explicit Approve) |

---

## Suggested CHANGELOG shape (draft only in G009)

```markdown
## [1.0.0] - YYYY-MM-DD

### Notes

- First stable **product** release: capture → evidence → meaningful units →
  search/context-pack works end-to-end on the local path.
- First stable **public contract** for CLI, setup, MCP tools, and local store
  layout; breaking changes after this release require a MAJOR bump.
```

Do not paste or publish this section until G009/G010.

---

## Current recommendation

Stay on **`0.y.z`** until product gates **P1–P9** are green (or waived) **and** a
maintainer records **Approve** in [v1-freeze-decision.md](v1-freeze-decision.md).
Contract-only readiness is **not** enough to ship `1.0.0`.
