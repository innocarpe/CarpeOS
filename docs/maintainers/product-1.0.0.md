# Product 1.0.0 — Definition of Done

Status: **shipped baseline** for SemVer `1.0.0` — local **pipeline + public
contract freeze**.  

**Honest product reframe (post-ship):** 1.0 is **not** “brain-worthy knowledge
judgment complete.” Lifecycle allowlist + metadata Observation is **not** full
knowledge adjudication. That thesis is SSOT under
**[product-2.0.0.md](product-2.0.0.md)**. Do **not** untag `v1.0.0`; do not market
1.0 as a finished memory brain.

Related:

- [PRD v1](../PRD-v1.md) — major-version product requirements snapshot

- **[Product 2.0.0 DoD](product-2.0.0.md)** — knowledge adjudication (next major product)
- [v1 Readiness](v1-readiness.md) — contract freeze gates G1–G9 (necessary packaging)
- [v1 Freeze Decision](v1-freeze-decision.md) — Approve recorded; tag cut
- [Versioning and Releases](versioning-and-releases.md) — SemVer + release process
- [Release Readiness](release-readiness.md) — per-release CI/local evidence
- Public package: `@innocarpe/carpeos@1.0.0`

Historical note: cutting `1.0.0` required this loop green + freeze Approve. That
bar was **pipeline completeness**, not the original “only store what a brain
would keep” thesis.

---

## What 1.0.0 means

**`1.0.0` means the local capture → evidence → extract shell → search loop works
end-to-end**, and we freeze the public CLI/MCP/setup/store contract.

It does **not** mean CarpeOS can reliably judge which session content is
durable knowledge. Contract freeze is packaging; **knowledge OS completeness is
2.0**.

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
| P1 | Capture install is an official product path (`carpeos setup …` and/or documented one-shot) with verify + uninstall/disable; does not wipe user host hooks | **done** | `setup hooks install|uninstall|doctor` (G002) |
| P2 | Session lifecycle capture writes encrypted raw + EvidenceArtifact into local store | **done** | capture-hook + smoke:product (G004/G006) |
| P3 | Extraction policy documented + implemented (lifecycle defaults; PostToolUse off by default; privacy rules) | **done** | ADR 0011 + `meaningful-unit-policy.ts` (G003) |
| P4 | Extraction pipeline MVP: Evidence → Observation and/or Claim (idempotent, trust-zone aware) | **done** | extract pipeline + CLI (G004); Claim auto policy-gated off |
| P5 | Search + context-pack (CLI + MCP) rank meaningful units first-class; evidence metadata secondary | **done** | Kind priority + diversity (G005) |
| P6 | Named product E2E script in CI (capture fixture → extract → rebuild → search/context-pack) | **done** | `pnpm smoke:product` + CI (G006) |
| P7 | Doctor reports hooks + recent capture + meaningful units; README EN/KO path matches reality; no false “1.0 shipped” claims | **done** | doctor store probe + README product path (G007) |
| P8 | Scenario checklist below ticked (public-safe notes); critical bugs fixed | **done** | S1–S5 notes (G008) |
| P9 | Product gate decision doc + draft CHANGELOG `## [1.0.0]` Notes; Decision remains Defer until human Approve | **done** | Gate doc + **Approve** 2026-07-30 (G009/G010) |
| P10 | Contract freeze G1–G9 still green on [v1-readiness.md](v1-readiness.md) | **done** | G1–G8 done; G9 **Approve** |
| P11 | Maintainer Approve + release (`node scripts/release.mjs 1.0.0`, tag, npm) | **in progress** | G010 after chat **Approve** |

**Product loop (P1–P9): green.** Decision **Approve** recorded — cut `1.0.0`.

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
| **Status** | ☑ **pass (automated)** — unit tests `install-hooks` (merge/uninstall/idempotent absolute path) + `setup hooks` product path (G002); doctor reports `*_hooks` status (G007). Live multi-host install on day-to-day home optional for operators. |

### S2 — Session lifecycle evidence is stored

| Field | Value |
| --- | --- |
| **Setup** | Hooks installed (S1) |
| **Actions** | Start/stop a short host session (or synthetic capture fixture equivalent) |
| **Expect** | Local store has capture/evidence rows (encrypted raw + EvidenceArtifact); counts increase |
| **Status** | ☑ **pass (automated)** — `pnpm smoke:product` capture-hook SessionEnd → EvidenceArtifact + encrypted protected value (temp home, synthetic payload only). |

### S3 — Meaningful units appear after extract

| Field | Value |
| --- | --- |
| **Setup** | Store with evidence from S2 or synthetic fixture |
| **Actions** | Automatic post-capture extract and/or explicit extract CLI |
| **Expect** | At least Observation and/or Claim events/chunks exist; re-run is idempotent |
| **Status** | ☑ **pass (automated)** — smoke: auto extract on SessionEnd; `extract --event-id` → `replay`; PostToolUse extract `skipped` (policy). |

### S4 — Search and context-pack return meaning first

| Field | Value |
| --- | --- |
| **Setup** | Rebuilt retrieval index over extracted units |
| **Actions** | CLI search + context-pack; MCP equivalents if registered |
| **Expect** | Query over synthetic extracted text returns those units; evidence metadata is secondary |
| **Status** | ☑ **pass (automated)** — smoke search `Captured SessionEnd` hits Observation/summary; context-pack `observations.length ≥ 1`; G005 kind ranking demotes evidence_excerpt. |

### S5 — Existing home upgrades safely

| Field | Value |
| --- | --- |
| **Setup** | Pre-1.0 local home (or fixture) with prior events |
| **Actions** | Upgrade binary/schema; run doctor / open store |
| **Expect** | Migrations apply; no silent wipe; prior events still readable under trust-zone rules |
| **Status** | ☑ **pass (existing tests)** — local-store migration/preserve-events coverage (G6 contract gate); doctor opens existing sqlite read-only without wipe (G007). |

### Dogfood notes (2026-07-30, public-safe)

| Gate | Result |
| --- | --- |
| `pnpm smoke:product` | **PASS** (monorepo at G008) |
| Critical bugs found this cycle | **None** |
| Host soak (Claude/Codex/Grok real sessions) | **Not required for G008 close** — synthetic CLI path covers S2–S4; optional operator follow-up |

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
