# Product 3.2.0 — execution and freeze source of truth

Status: **active minor; K0 and K1 complete; all runtime, audit, release, and activation gates pending.**

Related: [PRD index](../PRD.md), [policy reconciliation decision](../adr/0015-policy-version-reconciliation.md), [versioning policy](versioning-and-releases.md), and [Product 3.1.0 DoD](product-3.1.0.md).

## Thesis

**CarpeOS 3.2 makes promoted knowledge measurably cleaner and easier to review or correct, without widening what counts as accepted or changing canonical authority.**

Schema v1, event types, required CLI/MCP contracts/defaults, setup/environment semantics, trust zones, fail-open hooks, append-only/bitemporal history, and promoted-active-only retrieval remain compatible.

## Goals and non-goals

| Goals | Non-goals / prohibitions |
| --- | --- |
| Planned chronology, exact-normalized deduplication, and correction handling improve promoted-session precision. | Automatic/adjudicated Claim drafting, runtime form selector/materializer, or AcceptanceDecision. `allow_auto_claim` remains `false`; `memory_propose_claim` remains draft-only. |
| Planned deterministic, public-safe disposition, form/support, and retrieval evaluation supplies evidence—not authority. | Authority inferred from form, score, support, graph, recency, feedback, or Supersession. |
| Planned policy-aware held review and complete reconciliation preview target safe correction. | LLM scoring, online feedback, learned ranking, hosted graph/vector, OKF import, schema v2, new event types, fuzzy dedup, PostToolUse/recall widening, private/real corpus, protected plaintext, automatic reconciliation, cleanup UPDATE/DELETE, partial transactions, hidden skip, or Supersession cancellation. |
| Conditional B1 atomically applies all independently eligible entries while isolated unsafe entries stay unchanged and explicit. | Best-effort or per-item continuation. |
| Planned pack-once release proves that the same `.tgz` is installed, smoked, and published from the approved release SHA. | Repacking after test or claiming release/install completion before its gate is evidenced. |

## Current evidence

- K0 is immutable: **done** by PR #140, merge SHA `f92e8ddfb489011126ff415848bc00aba4f7c418`.
- K1 is immutable: **done** by PR #141, merge SHA `6bcc1572616a7cacab00218336c3f37f62933e96`.
- K2–K12 are pending; all evaluator, CLI, store, CI, release, and activation descriptions below are planned requirements, not observed implementation.
- Any future evaluator, dogfood, release, and activation evidence is public-safe, deterministic, offline where evaluation is concerned, and disposable/synthetic. Reports and receipts omit bodies.

## Gate ledger

| ID | Required receipt | Status |
| --- | --- | --- |
| K0 | Product 1.0 P11 corrected independently | **done** — PR #140; `f92e8ddfb489011126ff415848bc00aba4f7c418` |
| K1 | DoD/index/decision with exact v2 preimage | **done** — PR #141; `6bcc1572616a7cacab00218336c3f37f62933e96` |
| K2 | Chronology and `adj_v3` green | pending |
| K3 | Disposition evaluator green | pending |
| K4 | Evidence-only form evaluator green; auto Claim off | pending |
| K5 | Policy-aware held review green | pending |
| K6 | Complete preview/global taint and byte-identical digest interoperability green | pending |
| K7 | B1 acknowledgement, unsafe preservation, global-taint, and eligible atomic proof; **or B0 selected** | pending |
| K8 | Retrieval evaluator green | pending |
| K9 | Dogfood, docs, and pack green | pending |
| K10 | Audit and separate Approve merged | pending |
| K11 | Exact SHA, tarball, npm, and GitHub match | pending |
| K12 | Activation complete | pending |

## Planned evaluator and safety gates

| Gate | Required contract |
| --- | --- |
| Disposition | accuracy `1.00`; false promotion `0`. |
| Form/support | `knowledge-form-support/v1`; at least four synthetic fixtures in each class; accuracy, Claim precision/recall, and Observation preservation each `1.00`; false candidates and support/provenance/safety/reason failures `0`; unexported/store-free only; automatic Claim and AcceptanceDecision writes `0`. |
| Invalid denominators | Every reported class/metric denominator is positive and derived from the required class fixtures. A zero or undefined denominator is invalid corpus: exit `2`, never a normalized `1.00`. |
| Session | obsolete, generic, and secret leakage `0`; global chronology, correction/retraction barrier, latest explicit durable meaning, exact-normalized dedup only. |
| Held review | exact policy/count; replay stable; opposite terminal decision fails; no AcceptanceDecision. |
| Preview | `classified_count = total_candidate_count <= limit`, nontruncated, every entry digested; zero writes. |
| Digest | Store, CLI, and fixture have exact UTF-8 preimage bytes and actual SHA-256 equality; `plan_digest` is excluded. |
| B1 | exact acknowledgement; no global taint; exact high-water/digest/category pins; eligible written equals eligible-write count; unsafe written `0`; any eligible failure writes `0`. |
| Retrieval | macro recall@3 `1.00`, MRR `>= .90`, leakage/budget/false acceptance `0`, eight canonical branches, stable rebuild digest; offline only. |
| Release/install | Planned same-artifact proof: pack once, install/smoke and publish the identical `.tgz`; manifest SHA-512/integrity and registry `gitHead` equal the approved release SHA. |

## B1 target and B0 fallback

B1 is conditional on complete enumeration, stable classification/component partition, eligible/unsafe independence, graph safety, canonical-digest identity, pinned recomputation, conformance, and one `BEGIN IMMEDIATE` all-eligible-or-zero transaction. It never widens authority. Isolated unsafe entries remain conspicuously unchanged.

B0 is the executable fallback: safe runtime work plus deterministic zero-write preview only. Any missing B1 proof selects B0; global taint always aborts and acknowledgement cannot override it. The normative wire, receipt, apply-path, and permanence rules are in the [policy reconciliation decision](../adr/0015-policy-version-reconciliation.md).

## PR ownership and serialized dependencies

PR00/K0 and PR01/K1 are completed immutable history. New runtime work begins at PR02. Branches execute in separate worktrees; worktree paths/names never enter public receipts.

| PR | Branch | Planned owned files and symbols | Dependency |
| --- | --- | --- | --- |
| 02 | `fix/3.2-session-chronology` | planned changes to existing `packages/capture/src/transcript-signals.ts`, `packages/capture/src/adjudication.ts`, `packages/capture/test/transcript-signals.test.ts`, `packages/capture/test/adjudication.test.ts`, `scripts/lib/install-core.mjs`, and `scripts/test/install-core.test.mjs`; planned `adj_v3` selector | K1 |
| 03 | `test/3.2-adjudication-quality` | planned `packages/capture/src/adjudication-evaluation.ts`, `packages/capture/test/adjudication-evaluation.test.ts`, `packages/capture/test/fixtures/adjudication-quality-v1.json`, and capture package command | 02 |
| 04 | `test/3.2-knowledge-form-evidence` | planned `packages/capture/src/knowledge-form-evaluation.ts`, `packages/capture/test/knowledge-form-evaluation.test.ts`, `packages/capture/test/fixtures/knowledge-form-support-v1.json`, and capture package command; planned `applyKnowledgeFormEvaluationRubric` remains unexported/store-free | 03 for capture-package edits |
| 05 | `fix/3.2-held-policy-review` | `packages/local-store/src/store.ts`, `packages/local-store/test/store.test.ts`, `apps/carpeos-cli/src/index.ts`, `apps/carpeos-cli/test/cli.test.ts`; planned policy-aware held operations | K1 |
| 06 | `feat/3.2-policy-reconciliation-preview` | planned `packages/local-store/src/policy-reconciliation.ts`; `packages/local-store/src/store.ts`, `packages/local-store/test/store.test.ts`, `apps/carpeos-cli/src/index.ts`, `apps/carpeos-cli/test/cli.test.ts`; planned preview builders/classifier only | strictly after 05 |
| 07 | `feat/3.2-policy-reconciliation-apply` | same five PR06 paths; planned `LocalCaptureStore.applyPolicyReconciliationPlanV2` only; no preview-builder/type redefinition | strictly after 06 and separate Architect approval; otherwise B0 |
| 08 | `test/3.2-retrieval-quality` | planned `packages/retrieval/src/retrieval-evaluation.ts`, `packages/retrieval/test/retrieval-evaluation.test.ts`, `packages/retrieval/test/fixtures/retrieval-quality-v1.json`, and retrieval package command | K1 |
| 09 | `test/3.2-pack-once-release` | planned `scripts/pack-once.mjs`, `scripts/test/pack-once.test.mjs`, `packages/carpeos/test/packaging.test.mjs`, `scripts/test/release.test.mjs`, `scripts/test/release-artifact.test.mjs`, `.github/workflows/release.yml` | K1 |
| 10 | `docs/3.2-runtime-truth-audit` | `docs/architecture/overview.md`, `docs/architecture/provider-neutral-capture.md`, `docs/architecture/projections.md`, `docs/architecture/memory-capacity.md`, `docs/plans/graphrag-roadmap.md` | K1 |
| 11 | `test/3.2-public-knowledge-dogfood` | existing `scripts/smoke-dogfood.mjs`, `scripts/smoke-knowledge.mjs`, and `.github/workflows/ci.yml`; planned focused synthetic fixtures/tests for all evaluators, selected B0/B1 reconciliation smoke, and public-boundary receipts | evaluators, held/preview/retrieval, selected B0/B1 |
| 12 | `docs/3.2-operator-knowledge-quality` | `README.md`, `README.ko.md`, `docs/guides/retrieval.md`, `packages/carpeos/README.md`, and `docs/maintainers/versioning-and-releases.md` | runtime/docs |
| 13 | `docs/3.2-freeze-audit` | `docs/maintainers/product-3.2.0.md` and `CHANGELOG.md` freeze audit | 02–12 |
| 14 | `docs/3.2-approve` | `docs/maintainers/product-3.2.0.md` pre-tag Approve receipt | 13 |
| 15 | `docs/3.2-release-receipt` | `docs/maintainers/product-3.2.0.md`, `README.md`, and `README.ko.md` planned public-safe release/activation receipt | release after 14 |

The shared store/CLI chain is serialized `05 -> 06 -> 07`; PR06 owns preview and no writer, PR07 owns apply and cannot redefine preview types/builders. Session/disposition/form, retrieval, pack, and truth-doc lanes can otherwise proceed after K1. PR11 follows evaluators, held/preview/retrieval, and selected B0/B1; PR12 follows runtime/docs; then PR13 freeze, PR14 human Approve, release, and PR15 activation.

### Planned reconciliation implementation ownership

PR06 adds planned `classifyPolicyReconciliationEntry`, `partitionReconciliationComponents`, `buildPolicyReconciliationPlanV2`, `policyReconciliationDigestPreimageV2`, and `digestPolicyReconciliationPlanV2` in `packages/local-store/src/policy-reconciliation.ts`. PR07 alone adds planned `LocalCaptureStore.applyPolicyReconciliationPlanV2(input)` in `packages/local-store/src/store.ts` and calls it from the planned `adjudicate reconcile-policy` path in `apps/carpeos-cli/src/index.ts`. The existing CLI has adjudication commands but no reconciliation command; documentation names these additions as planned.

Future golden fixtures are `packages/local-store/test/fixtures/policy-reconciliation-plan-v2.json`, `packages/local-store/test/fixtures/policy-reconciliation-plan-v2.preimage.json`, `apps/carpeos-cli/test/fixtures/policy-reconciliation-plan-v2.json`, and `apps/carpeos-cli/test/fixtures/policy-reconciliation-apply-v2.json`. Tests must compare exact UTF-8 bytes and actual SHA-256 across store, CLI, and fixture round trips, including the apply receipt fixture.

## Planned test matrix and receipts

| Layer | Required proof |
| --- | --- |
| Unit | chronology/correction/exact dedup/future/Korean/malformed/secret; evaluator denominators/formulas/digests/redaction/exits; held policy/replay/conflict; preview reasons/components/taint; every included preimage-field mutation and excluded-field invariance; apply drift/conformance/rollback/unsafe-zero rows; retrieval branches/digest/exits; pack identity. |
| Integration | `adj_v3` ordered transcript; Claim-shaped automatic capture remains Observation/disposition only; held workflow; store/CLI/fixture exact preimage bytes/hash; exact apply; taint/preimage drift zero-write; retrieval index/graph/recheck; installed tarball behavior. |
| End-to-end | disposable synthetic session/form/held/older-policy/foreign cases; B1 mixed subset plus tainted zero-write or B0 preview-only; OKF safety smoke; exact release SHA repetition. |
| Observability | aggregate reports only; metadata-only receipts expose counts, IDs, reasons, components, admissibility, digest, acknowledgement, and permanence. |

Freeze (PR13) must record each gate’s PR SHA, command/result, metric/digest, compatibility/risk/boundary, selected B0/B1, B1 golden proof and residual unsafe inventory, or B0 apply defer. Pre-tag Approve (PR14) records freeze SHA, selection, three quality receipts, reconciliation schema/digest/golden result, residuals, risks, and authorization. PR15 records only public-safe activation evidence; all remain pending until their gates are actually met.

## Residuals and explicit defers

| Item | Decision |
| --- | --- |
| Automatic/adjudicated Claims and runtime form selector | Deferred; future ADR required. |
| Automatic AcceptanceDecision | Forbidden. |
| Online feedback, adaptive ranking, LLM | Deferred; offline deterministic only. |
| PostToolUse/recall widening and fuzzy dedup | Rejected absent precision proof. |
| Truncated, silent, best-effort, or per-item reconciliation | Rejected. |
| Unsafe repair/mutation | Deferred; unsafe remains unchanged. |
| Supersession cancellation, schema v2, new event | Deferred. |
| Private corpus/real sessions; hosted graph/vector; OKF import | Prohibited or out of bounded scope. |

Committed eligible Supersessions permanently grow audit history. Unsafe residuals are never described as cleaned.
