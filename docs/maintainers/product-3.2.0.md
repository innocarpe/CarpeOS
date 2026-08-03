# Product 3.2.0 — execution and freeze source of truth

Status: **active minor; K0/K1 complete; B0 selected; K2–K12 pending (K7 decision selected, runtime/no-apply receipt pending).**

Related: [PRD index](../PRD.md), [policy reconciliation decision](../adr/0015-policy-version-reconciliation.md), [versioning policy](versioning-and-releases.md), and [Product 3.1.0 DoD](product-3.1.0.md).

## Thesis

**CarpeOS 3.2 makes promoted knowledge measurably cleaner and easier to review or correct, without widening what counts as accepted or changing canonical authority.**

Schema v1, event types, required CLI/MCP contracts/defaults, trust zones, fail-open hooks, append-only/bitemporal history, and promoted-active-only retrieval remain compatible.

## Goals and non-goals

| Goals | Non-goals / prohibitions |
| --- | --- |
| Planned chronology, exact-normalized deduplication, correction handling, deterministic evaluators, and policy-aware held review improve precision without granting authority. | Automatic/adjudicated Claim drafting, runtime form selector/materializer, or AcceptanceDecision. `allow_auto_claim=false`; `memory_propose_claim` remains draft-only. |
| **B0:** deterministic bounded, metadata-only, zero-write reconciliation preview makes emitted eligible, noop, unsafe, component, taint, and digest evidence reviewable without claiming completeness when over limit. | B1 safe-subset apply, Supersession construction, event/protected/canonical/outbox writer, apply command, apply receipt, best-effort skip, cleanup UPDATE/DELETE, fuzzy dedup, authority inferred from scores/forms/support/graph/feedback. |
| Planned pack-once release proves the same `.tgz` is installed, smoked, and published from the approved release SHA. | Repacking after test or claiming runtime/release/install completion before its gate is evidenced. |

## Current evidence

- K0 is immutable: **done** by PR #140, merge SHA `f92e8ddfb489011126ff415848bc00aba4f7c418`.
- K1 is immutable: **done** by PR #141, merge SHA `6bcc1572616a7cacab00218336c3f37f62933e96`.
- B0 is selected because B1 failed safety admission. K2–K12 remain pending; K7 records the selected decision while its runtime/no-apply receipt remains pending. Evaluator, CLI, store, CI, release, and activation descriptions are planned requirements, not observed implementation.
- Future evidence is public-safe, deterministic, offline where evaluation is concerned, and synthetic/disposable. Reports/receipts omit bodies.

## Gate ledger

| ID | Required receipt | Status |
| --- | --- | --- |
| K0 | Product 1.0 P11 corrected independently | **done** — PR #140; `f92e8ddfb489011126ff415848bc00aba4f7c418` |
| K1 | DoD/index/decision with exact v2 preimage | **done** — PR #141; `6bcc1572616a7cacab00218336c3f37f62933e96` |
| K2 | Chronology and `adj_v3` green | pending |
| K3 | Disposition evaluator green | pending |
| K4 | Evidence-only form evaluator green; auto Claim off | pending |
| K5 | Policy-aware held review green | pending |
| K6 | Bounded preview/global taint and byte-identical digest interoperability green | pending |
| K7 | **B0 selected; runtime/no-apply receipt pending** | pending |
| K8 | Retrieval evaluator green | pending |
| K9 | Dogfood, docs, and pack green | pending |
| K10 | Audit and separate Approve merged | pending |
| K11 | Exact SHA, tarball, npm, and GitHub match | pending |
| K12 | Activation complete | pending |

## Planned evaluator and safety gates

| Gate | Required contract |
| --- | --- |
| Disposition | accuracy `1.00`; false promotion `0`. |
| Form/support | `knowledge-form-support/v1`; at least four synthetic fixtures per class; accuracy, Claim precision/recall, Observation preservation `1.00`; false candidates/support/provenance/safety/reason failures `0`; automatic Claim/AcceptanceDecision writes `0`. |
| Invalid denominators | A zero or undefined reported denominator is invalid corpus: exit `2`, never normalized to `1.00`. |
| Session and held review | Session obsolete/generic/secret leakage `0`; exact-normalized dedup only. Held policy/count exact, replay stable, opposite terminal fails, no AcceptanceDecision. |
| B0 preview | Exact bounded plan-v2 preview: deterministic emitted prefix/digest, full classification only when total is within limit, `incomplete_enumeration_global_taint` and inadmissibility when over limit, and zero writes. |
| B0 no-apply | No writer, apply command, or apply receipt; reconciliation creates no new Supersession, protected, canonical, or outbox rows and does not widen authority. Apply/pin/acknowledgement flags fail exit `2` before reconciliation writes. |
| Retrieval | macro recall@3 `1.00`, MRR `>= .90`, leakage/budget/false acceptance `0`, eight canonical branches, stable rebuild digest; offline only. |
| Release/install | Planned pack-once proof: install/smoke and publish identical `.tgz`; manifest SHA-512/integrity and registry `gitHead` equal approved release SHA. |

## B0 selected; B1 deferred

3.2 is planned to provide deterministic bounded zero-write preview only. B1 failed admission because truthful recorded time cannot be backdated for offline byte convergence; the current outbox uploads linked protected values; remote replay does not compare canonical bytes; and candidate null normalization/calendar validation were not ready. These proof failures select B0 without reducing the bounded-preview contract.

B1 safe-subset apply, Supersession construction, protected transfer/lifecycle, and sync convergence are deferred outside 3.2. Unsafe entries remain unchanged. The exact preview contract, digest, classifications, component/global-taint rules, and B0 usage contract are in the [policy reconciliation decision](../adr/0015-policy-version-reconciliation.md).

## PR ownership and serialized dependencies

PR00/K0 and PR01/K1 are immutable history. New runtime work begins at PR02. Branches execute in separate worktrees; worktree paths/names never enter public receipts.

| PR | Branch | Planned owned files and symbols | Dependency |
| --- | --- | --- | --- |
| 02 | `fix/3.2-session-chronology` | planned changes to existing `packages/capture/src/transcript-signals.ts`, `packages/capture/src/adjudication.ts`, `packages/capture/test/transcript-signals.test.ts`, `packages/capture/test/adjudication.test.ts`, `scripts/lib/install-core.mjs`, and `scripts/test/install-core.test.mjs`; planned `adj_v3` selector | K1 |
| 03 | `test/3.2-adjudication-quality` | planned `packages/capture/src/adjudication-evaluation.ts`, matching test, `packages/capture/test/fixtures/adjudication-quality-v1.json`, and `packages/capture/package.json` | 02 |
| 04 | `test/3.2-knowledge-form-evidence` | planned `packages/capture/src/knowledge-form-evaluation.ts`, matching test, `packages/capture/test/fixtures/knowledge-form-support-v1.json`, and `packages/capture/package.json`; planned `applyKnowledgeFormEvaluationRubric` remains unexported/store-free | 03 |
| 05 | `fix/3.2-held-policy-review` | `packages/local-store/src/store.ts`, `packages/local-store/test/store.test.ts`, `apps/carpeos-cli/src/index.ts`, `apps/carpeos-cli/test/cli.test.ts`; planned policy-aware held operations | K1 |
| 06 | `feat/3.2-policy-reconciliation-preview` | planned `packages/local-store/src/policy-reconciliation.ts`, `packages/local-store/src/store.ts`, `packages/local-store/test/store.test.ts`, `apps/carpeos-cli/src/index.ts`, and `apps/carpeos-cli/test/cli.test.ts`; preview builders/classifier only | strictly after 05 |
| 07 | — | **Deferred; not opened or merged for 3.2.** No branch, runtime ownership, apply writer, command, fixture, receipt, or event construction. | B0 selected |
| 08 | `test/3.2-retrieval-quality` | planned `packages/retrieval/src/retrieval-evaluation.ts`, `packages/retrieval/test/retrieval-evaluation.test.ts`, `packages/retrieval/test/fixtures/retrieval-quality-v1.json`, and `packages/retrieval/package.json` | K1 |
| 09 | `test/3.2-pack-once-release` | planned `scripts/pack-once.mjs`, `scripts/test/pack-once.test.mjs`, existing `packages/carpeos/test/packaging.test.mjs` and `scripts/test/release.test.mjs`, planned `scripts/test/release-artifact.test.mjs`, and `.github/workflows/release.yml` | K1 |
| 10 | `docs/3.2-runtime-truth-audit` | `docs/architecture/overview.md`, `docs/architecture/provider-neutral-capture.md`, `docs/architecture/projections.md`, `docs/architecture/memory-capacity.md`, `docs/plans/graphrag-roadmap.md` | K1 |
| 11 | `test/3.2-public-knowledge-dogfood` | existing `scripts/smoke-dogfood.mjs`, `scripts/smoke-knowledge.mjs`, `.github/workflows/ci.yml`; planned synthetic fixtures/tests for evaluators, **B0 preview-only** smoke, no fake apply, and unsupported-flag zero-write proof | evaluators, held/preview/retrieval |
| 12 | `docs/3.2-operator-knowledge-quality` | `README.md`, `README.ko.md`, `docs/guides/retrieval.md`, `packages/carpeos/README.md`, `docs/maintainers/versioning-and-releases.md`; records B0 honestly | runtime/docs |
| 13 | `docs/3.2-freeze-audit` | `docs/maintainers/product-3.2.0.md`, `CHANGELOG.md`; records B0 selection | 02–12 |
| 14 | `docs/3.2-approve` | `docs/maintainers/product-3.2.0.md` pre-tag Approve receipt records B0 | 13 |
| 15 | `docs/3.2-release-receipt` | `docs/maintainers/product-3.2.0.md`, `README.md`, `README.ko.md`; public-safe **preview-only** activation receipt | release after 14 |

PR06 owns preview and no writer. PR07 is absent from the shared store/CLI chain. Session/disposition/form, held, retrieval, pack, and truth-doc lanes can proceed after K1; PR11 follows selected B0 preview state; then PR12, PR13 freeze, PR14 Approve, release, and PR15 preview-only activation.

### Planned reconciliation implementation ownership

PR06 adds only planned `classifyPolicyReconciliationEntry`, `partitionReconciliationComponents`, `buildPolicyReconciliationPlanV2`, `policyReconciliationDigestPreimageV2`, and `digestPolicyReconciliationPlanV2` in `packages/local-store/src/policy-reconciliation.ts`, with preview wiring in `store.ts` and `apps/carpeos-cli/src/index.ts`. There is no planned apply method, apply fixture, or apply receipt for 3.2. Planned fixtures prove exact UTF-8 plan/preimage bytes and SHA-256 across store and CLI, including deterministic emitted prefixes and the required incomplete-enumeration taint/inadmissibility for over-limit totals.

## Planned test matrix and receipts

| Layer | Required proof |
| --- | --- |
| Unit | chronology/correction/exact dedup/future/Korean/malformed/secret; evaluator denominator/formula/digest/redaction/exits; held policy/replay/conflict; deterministic bounded preview prefixes, emitted-entry reasons/components/taint, and no false completeness when over limit; every included preimage-field mutation and excluded-field invariance; preview zero writes; unsupported apply flags exit `2`/zero writes; retrieval branches/digest/exits; pack identity. |
| Integration | `adj_v3` transcript; Claim-shaped automatic capture remains Observation/disposition only; held workflow; store/CLI exact bounded-preview bytes/hash; over-limit taint/inadmissibility and zero writes; unsupported flags zero-write; retrieval index/graph/recheck; installed tarball behavior. |
| End-to-end | disposable synthetic session/form/held/older-policy/foreign cases; B0 bounded preview-only with unsafe/global-taint visibility, deterministic over-limit prefix, and no fake apply; OKF safety smoke; exact release SHA repetition. |
| Observability | aggregate reports; metadata-only preview exposes counts, IDs, reasons, components, admissibility, and digest—not bodies. |

Freeze records each gate PR SHA, command/result, metric/digest, compatibility/risk/boundary, **B0 selection**, preview golden proof, unsafe/global-taint inventory, and explicit B1 defer. Pre-tag Approve records B0 and quality receipts. PR15 records public-safe preview-only activation. Exact artifact install/release proof remains required and pending.

## Residuals and explicit defers

| Item | Decision |
| --- | --- |
| B1 safe-subset apply, Supersession construction, protected transfer/lifecycle, sync convergence | Deferred outside 3.2; future ADR/version and approval required. |
| Unsafe repair/mutation | Deferred; unsafe remains unchanged. |
| Automatic/adjudicated Claims, AcceptanceDecision, online feedback, adaptive ranking, LLM | Deferred or forbidden; offline deterministic evidence only. |
| PostToolUse/recall widening, fuzzy dedup, silent/best-effort/per-item reconciliation | Rejected. |
| Schema v2/new event/Supersession cancellation; private corpus/real sessions; hosted graph/vector; OKF import | Deferred, prohibited, or out of scope. |

Unsafe residuals are never described as cleaned.
