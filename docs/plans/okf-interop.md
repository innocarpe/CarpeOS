# OKF interop implementation plan (product 3.1)

Status: **release approved through K7** — K8 release execution for **3.1.0**
remains pending.

Related:

- [ADR 0014](../adr/0014-okf-export-projection.md)
- [Product 3.1.0 DoD](../maintainers/product-3.1.0.md)
- Pattern references: Obsidian projection (`packages/obsidian-projection`),
  ADR 0008, ADR 0001

---

## Why design before code

OKF touches product meaning (what leaves the brain), safety (public boundary),
and projection architecture (third markdown surface). Implementing a CLI first
locks bad mappings and import fantasies. CarpeOS already learned this ordering
on 2.0 (adjudication ADR) and 3.0 (retrieval-first ADR + DoD gates).

```text
K0 design freeze  →  K1 mapping fixtures  →  K2 package API
                  →  K3 conformance       →  K4 CLI
                  →  K5 safety            →  K6 docs
                  →  K7 Approve           →  K8 3.1.0 release
```

---

## Phase 0 — Design freeze

**Deliverables**

- [x] ADR 0014 **Accepted** (Phase 0 decisions locked)
- [x] product-3.1.0.md DoD draft (CLI + policies aligned)
- [x] this plan
- [x] Open questions resolved (see Decision log below)
- [x] OKF listed under planned projections in
      `docs/architecture/projections.md`

**Exit:** K0 green — scope locked, non-goals explicit. K1–K6 implementation is
complete.

---

## Phase 1 — Mapping + fixtures (K1)

**Status: done** on branch `okf-interop-3.1` (mapper package + goldens).

**Deliverables**

1. Normative mapping table — `packages/okf-projection/MAPPING.md`
2. Pure API `mapEventsToOkf` + `renderOkfConcept` (no disk I/O)
3. Synthetic golden fixtures under `packages/okf-projection/test/fixtures/`:
   - `minimal-accepted/` — accepted decision + observation + evidence + index/log
   - `held-include/drafts/` — draft observation only when `includeHeld`
   - `supersession/lineage/` — supersession concept when target exported
4. Tests: default held-off, rejected omit, erasure, wrong zone, orphan evidence,
   determinism, protected-plaintext refuse
5. Extension keys: `carpeos_event_id`, `carpeos_event_type`,
   `carpeos_trust_zone_id`, `carpeos_projection`, `canonical_effect`, plus
   unit id keys

**Exit:** `pnpm --filter @carpeos/okf-projection test` green.

---

## Phase 2 — Package rebuild API (K2)

**Status: done** — `buildOkfProjectionPlan` and `rebuildOkfProjection` provide
the typed-snapshot, manifest-aware rebuild boundary.

- [x] Package `@carpeos/okf-projection`:
  - input: typed local-store snapshot + export config
  - output: file plan `{ path, content }[]` + manifest
  - no ad hoc SQL; no absolute paths in content
- [x] Rebuild semantics mirror Obsidian:
  - `pathPolicy: delete_missing | tombstone_missing`
  - managed-only deletes via manifest
- [x] Deterministic path scheme from concept id / event id (stable across rebuilds)

**Suggested layout**

```text
packages/okf-projection/
  src/
    index.ts
    map.ts          # CarpeOS → OKF frontmatter/body
    render.ts       # YAML + markdown
    manifest.ts
    rebuild.ts      # write to disk
    paths.ts
  test/
    fixtures/
    map.test.ts
    rebuild.test.ts
    conformance.test.ts
```

**Exit:** integrated `@carpeos/okf-projection` tests: 28 passed.

---

## Phase 3 — Conformance (K3)

**Status: done** — `checkOkfConformance` validates OKF v0.2 bundle output.

- [x] Conformance checker:
  - frontmatter parse + required `type`
  - reserved `index.md` / `log.md` shapes
  - internal links resolve or soft-fail per OKF (broken links allowed; we still
    prefer no broken links for managed files)
- [x] Pin target **OKF v0.2** in docs and require `okf_version` on root index
- [x] Record projection version string `okf-export/v1` in manifest

**Exit:** integrated `@carpeos/okf-projection` tests: 28 passed.

---

## Phase 4 — CLI (K4)

**Status: done** — `carpeos okf export` and `carpeos okf rebuild` are wired
into the CLI with help coverage.

- [x] Wire into `@innocarpe/carpeos` CLI:
  - preferred: `carpeos okf export` / `carpeos okf rebuild`
  - avoid stealing unrelated namespaces
- [x] Flags:
  - `--out <dir>`
  - `--visible-trust-zone <id>` (repeatable or CSV — match existing CLI style)
  - `--include-held` (default off)
  - dry-run / JSON summary if cheap and consistent with other commands
- [x] Help text states: projection only; no canonical mutation; OKF v0.2

**Exit:** CLI tests: 42 passed; npm package build/packaging test and packaged
`help okf` smoke passed.

---

## Phase 5 — Safety (K5)

**Status: done** — redaction, path safety, held-default-off, and fail-closed
zone behavior are covered.

- [x] Redaction asserts (reuse Obsidian/`assertNoProtectedPlaintext` patterns)
- [x] Path traversal, absolute managed-path, symlink, and bundle-escape rejection
- [x] Default held-off regression test
- [x] Missing trust zone fail-closed test
- [x] Public-boundary scan on new fixtures (`pnpm public-boundary`)

**Exit:** integrated `@carpeos/okf-projection` tests: 28 passed; public
boundary: 290 files passed.

---

## Phase 6 — Docs + honesty (K6)

**Status: done** — operator guidance and product documentation reflect export
projection scope without release claims.

- [x] `docs/guides/okf-export.md` operator guide
- [x] Update `docs/architecture/projections.md` implemented list
- [x] README EN/KO short “OKF export” mention (not hero rewrite)
- [x] CHANGELOG `[Unreleased]` → fold at release
- [x] Cross-link ADR 0014 / product-3.1.0

**Exit:** `pnpm check` passed; documentation remains explicit that CarpeOS
exports OKF rather than becoming OKF.

---

## Phase 7–8 — Freeze approved; release pending

1. [x] Freeze packet filled in `product-3.1.0.md`.
2. [x] Maintainer **Approve** recorded from chat on 2026-08-01.
3. [ ] Run carpeos-release for **3.1.0** (MINOR).
4. [x] Release notes exclude incomplete import stories.

---

## Decision log (taste / product)

| Topic | Decision | Rationale |
| --- | --- | --- |
| Export vs import first | Export only in 3.1 | Precision-first; import is adjudication risk |
| New package vs extend Obsidian | New `okf-projection` package | Different include policy, manifest, audience |
| Default include held? | No | Align 2.0/3.0 promoted-only defaults |
| MCP tool in 3.1? | No (unless free) | Filesystem bundle is the interop unit |
| Attested Computation | Defer | High cost, low personal-OS value now |
| Version number | 3.1.0 | Additive interop after 3.0.0 retrieval major |
| CLI noun | `carpeos okf export` / `rebuild` | Short domain noun; OKF is the interop brand |
| OKF `type` strings | Human-readable phrases | Agent-friendly; schema names via `carpeos_event_type` |
| Evidence body | Metadata only | Public-boundary + no dump pollution |
| Root `log.md` | Each export run | OKF §9; progressive history for consumers |
| Import (incl. held-only) | Not in 3.1; needs new ADR later | Do not half-ship a second write path |

---

## Open questions

**None remaining for K0.** Implementation decisions have been resolved without
reopening the export-only / promoted-default / no-import locks above.

---

## Suggested delivery slices (completed through K6; K7–K8 pending)

| PR | Scope | Gates |
| --- | --- | --- |
| 1 | docs only: ADR + DoD + plan (+ projections.md planned) | K0 |
| 2 | mapping + fixtures + pure mapper | K1 |
| 3 | package rebuild + conformance tests | K2–K3 |
| 4 | CLI + safety + guide | K4–K6 |
| 5 | release 3.1.0 | K7–K8 |

Prefer small reviewable PRs over one mega-diff.
