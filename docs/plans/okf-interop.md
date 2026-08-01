# OKF interop implementation plan (product 3.1)

Status: **design** — execute only after ADR 0014 + product-3.1.0 scope are
accepted. Branch/worktree: `okf-interop-3.1`.

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

## Phase 0 — Design freeze (current)

**Deliverables**

- [x] ADR 0014 **Accepted** (Phase 0 decisions locked)
- [x] product-3.1.0.md DoD draft (CLI + policies aligned)
- [x] this plan
- [x] Open questions resolved (see Decision log below)
- [x] OKF listed under planned projections in
      `docs/architecture/projections.md`

**Exit:** K0 green after docs PR merges — scope locked, non-goals explicit.
Implementation starts at Phase 1 (mapping fixtures), not before.

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

**Deliverables**

- Package `@carpeos/okf-projection` (preferred) OR submodule with same boundary:
  - input: typed local-store snapshot + export config
  - output: file plan `{ path, content }[]` + manifest
  - no ad hoc SQL; no absolute paths in content
- Rebuild semantics mirror Obsidian:
  - `pathPolicy: delete_missing | tombstone_missing`
  - managed-only deletes via manifest
- Deterministic path scheme from concept id / event id (stable across rebuilds)

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

**Exit:** unit tests rebuild from fixture snapshots to expected tree.

---

## Phase 3 — Conformance (K3)

**Deliverables**

- Conformance checker (test helper first; optional CLI later):
  - frontmatter parse + required `type`
  - reserved `index.md` / `log.md` shapes
  - internal links resolve or soft-fail per OKF (broken links allowed; we still
    prefer no broken links for managed files)
- Pin target **OKF v0.2** in docs and `okf_version` on root index when present
- Record projection version string e.g. `okf-export/v1` in manifest

**Exit:** conformance tests green on goldens + negative cases.

---

## Phase 4 — CLI (K4)

**Deliverables**

- Wire into `@innocarpe/carpeos` CLI (names to lock):
  - preferred: `carpeos okf export` / `carpeos okf rebuild`
  - avoid stealing unrelated namespaces
- Flags (minimum):
  - `--out <dir>`
  - `--visible-trust-zone <id>` (repeatable or CSV — match existing CLI style)
  - `--include-held` (default off)
  - dry-run / JSON summary if cheap and consistent with other commands
- Help text states: projection only; no canonical mutation; OKF v0.2

**Exit:** CLI integration test with temp store + temp out dir.

---

## Phase 5 — Safety (K5)

**Deliverables**

- Redaction asserts (reuse Obsidian/`assertNoProtectedPlaintext` patterns)
- Path traversal rejection (`../`, absolute out escapes)
- Default held-off regression test
- Missing trust zone fail-closed test
- Public-boundary scan on new fixtures (`pnpm public-boundary`)

**Exit:** safety tests green; no new public-boundary exceptions.

---

## Phase 6 — Docs + honesty (K6)

**Deliverables**

- `docs/guides/okf-export.md` operator guide
- Update `docs/architecture/projections.md` implemented list
- README EN/KO short “OKF export” mention (not hero rewrite)
- CHANGELOG `[Unreleased]` → fold at release
- Cross-link ADR 0014 / product-3.1.0

**Exit:** docs-only review; no overclaim (“we are OKF” vs “we export OKF”).

---

## Phase 7–8 — Freeze + release (K7–K8)

1. Fill freeze packet in product-3.1.0.md
2. Maintainer Approve
3. Run carpeos-release for **3.1.0** (MINOR)
4. Do not include incomplete import stories in release notes

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

**None remaining for K0.** Implementation questions (path slug algorithm, exact
YAML key order, dry-run flag) are deferred to K1–K4 and must not reopen the
export-only / promoted-default / no-import locks above.

---

## Suggested PR slices (after design accept)

| PR | Scope | Gates |
| --- | --- | --- |
| 1 | docs only: ADR + DoD + plan (+ projections.md planned) | K0 |
| 2 | mapping + fixtures + pure mapper | K1 |
| 3 | package rebuild + conformance tests | K2–K3 |
| 4 | CLI + safety + guide | K4–K6 |
| 5 | release 3.1.0 | K7–K8 |

Prefer small reviewable PRs over one mega-diff.
