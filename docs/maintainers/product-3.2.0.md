# Product 3.2.0 — execution and freeze source of truth

Status: **active minor; design contract merged pending runtime gates.**

Related: [PRD index](../PRD.md), [policy reconciliation decision](../adr/0015-policy-version-reconciliation.md), [versioning policy](versioning-and-releases.md), and [Product 3.1.0 DoD](product-3.1.0.md).

## Thesis

**CarpeOS 3.2 makes promoted knowledge measurably cleaner and easier to review or correct, without widening what counts as accepted or changing canonical authority.**

This is a backward-compatible MINOR. Schema v1, event types, required CLI/MCP contracts and defaults, setup/environment semantics, trust zones, fail-open hooks, and promoted-active-only retrieval remain compatible.

## Goals and non-goals

| Goals | Non-goals / prohibitions |
| --- | --- |
| Preserve precision while suppressing exact duplicates, generic task text, obsolete prose, and corrected session prose. | Automatic/adjudicated Claim drafting or runtime form selector/materializer; `allow_auto_claim` remains `false`, and `memory_propose_claim` remains draft-only. |
| Produce deterministic public-safe disposition, form/support, and retrieval evidence. | Automatic `AcceptanceDecision`, or authority inferred from form, scores, support, graph, recency, or feedback. |
| Make held review policy-aware and reconcile old policy materializations safely. | LLM scoring, online feedback, learned ranking, hosted graph/vector, OKF import, schema v2, or new event type. |
| Target B1: atomically apply every independently eligible reconciliation entry; leave isolated unsafe entries unchanged and explicit. | Fuzzy dedup, PostToolUse/recall widening, private corpus, protected plaintext, real sessions, automatic reconciliation, UPDATE/DELETE cleanup, per-item continuation, partial transaction, hidden skip, or Supersession cancellation. |
| Test, publish, and activate the same packed artifact from the approved release SHA. | Repacking after test or claiming runtime work before its gate is evidenced. |

## Current evidence

- K0 is **done** independently by PR #140; merge SHA: `f92e8ddfb489011126ff415848bc00aba4f7c418`.
- All later runtime, audit, release, and activation gates are **pending**. No current status below is implementation evidence.
- Evaluator evidence is public-safe, deterministic, offline, and synthetic/disposable for CI and release only. Reports and receipts omit bodies.

## Gate ledger

| ID | Required receipt | Status |
| --- | --- | --- |
| K0 | Product 1.0 P11 corrected independently | **done** — PR #140; `f92e8ddfb489011126ff415848bc00aba4f7c418` |
| K1 | This DoD/index/decision with exact v2 preimage merged | pending |
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

## Evaluator and safety gates

| Gate | Contract |
| --- | --- |
| Disposition | accuracy `1.00`; false promotion `0`. |
| Form/support | corpus `knowledge-form-support/v1`, at least four synthetic cases per class; accuracy, Claim precision/recall, and Observation preservation each `1.00`; false candidates and support/provenance/safety/reason failures `0`; `allow_auto_claim=false`, `evaluation_only=true`, automatic Claim writes `0`, automatic AcceptanceDecision writes `0`. Claim-vs-Observation evaluation is unexported and store-free. |
| Session | obsolete, generic, and secret leakage `0`; global chronology, correction/retraction barrier, latest explicit durable meaning, and exact-normalized dedup only. |
| Held review | exact policy/count; replay stable; opposite terminal decision fails; no AcceptanceDecision. |
| Reconciliation preview | `classified_count = total_candidate_count <= limit`, nontruncated, all entries digested. Preview writes zero. |
| Digest interoperability | store, CLI, and golden preimage bytes and SHA-256 identical; `plan_digest` excluded from the preimage. |
| B1 | exact safe-subset acknowledgement; no global taint; exact high-water/digest/category-count pins; eligible written equals eligible-write count; unsafe written `0`; an eligible failure writes `0`. |
| Retrieval | macro recall@3 `1.00`, MRR `>= .90`, leakage/budget/false acceptance `0`, eight canonical branches, stable rebuild digest. Offline evaluation only. |
| Release | exact release SHA passes all evaluators, smokes, and check; tested artifact is published artifact; integrity matches and `gitHead` equals release SHA. |

## Reconciliation decision: conditional B1, executable B0 fallback

B1 is the target only when complete enumeration, stable classification, isolated eligible/unsafe component independence, graph safety, canonical digest identity, pinned recomputation, conformance, and one-transaction atomicity are proved. It applies all eligible entries atomically and leaves isolated unsafe entries conspicuously unchanged.

Select B0—safe runtime work plus deterministic zero-write preview—when any B1 proof is absent. Do not merge the apply work in that case. A global taint always aborts; acknowledgement cannot override it. Neither option permits silent/best-effort skips.

The normative safe-subset, global-taint, digest, preview/apply pin, transaction, and permanence contract is in the [policy reconciliation decision](../adr/0015-policy-version-reconciliation.md).

## PR, worktree, and dependency map
Each branch is executed in a separate worktree; the worktree name/path is operational evidence, not a release receipt, and is never recorded in public-facing documentation.

| PR | Branch | Scope / dependency |
| --- | --- | --- |
| 00 | `docs/3.2-p11-release-ledger` | P11 only; precedes this contract. |
| 01 | `docs/3.2-knowledge-quality-contract` | This DoD, PRD index, and decision; follows 00. |
| 02 | `fix/3.2-session-chronology` | `adj_v3` chronology; follows contract. |
| 03 | `test/3.2-adjudication-quality` | disposition evaluator; follows 02. |
| 04 | `test/3.2-knowledge-form-evidence` | form/support evaluator; follows 03 for capture-package edits. |
| 05 | `fix/3.2-held-policy-review` | policy-aware held review; follows contract. |
| 06 | `feat/3.2-policy-reconciliation-preview` | complete preview; strictly after 05. |
| 07 | `feat/3.2-policy-reconciliation-apply` | conditional B1 apply; strictly after 06 and separate Architect approval; otherwise B0. |
| 08 | `test/3.2-retrieval-quality` | retrieval evaluator; follows contract. |
| 09 | `test/3.2-pack-once-release` | pack-once release proof; follows contract. |
| 10 | `docs/3.2-runtime-truth-audit` | truth-aligned docs; follows contract. |
| 11 | `test/3.2-public-knowledge-dogfood` | evaluators, selected reconciliation state, synthetic dogfood. |
| 12 | `docs/3.2-operator-knowledge-quality` | operator/package docs; follows runtime/docs. |
| 13 | `docs/3.2-freeze-audit` | completion audit/freeze; deferred until prior gates. |
| 14 | `docs/3.2-approve` | pre-tag human Approve; after freeze. |
| 15 | `docs/3.2-release-receipt` | activation receipt after release. |

Parallel lanes after PR 01 are session/disposition/form, held, retrieval, pack, and truth docs; store/CLI remains strictly `05 -> 06 -> 07`. PR 11 follows evaluators, held/preview/retrieval, and the selected B0/B1 state. PR 12 follows runtime/docs; then `13 -> 14 -> release -> 15`.

## Test matrix

| Layer | Required proof |
| --- | --- |
| Unit | chronology/correction/exact dedup/future/Korean/malformed/secret; evaluator matrices, formulas, digests, redaction, exits, and invariants; held policy/replay/conflict; preview reasons/components/taint; preimage mutation and excluded-field tests; apply drift, conformance, rollback, and unsafe-zero-row tests; retrieval branches/digest/exits; pack identity. |
| Integration | evidence to ordered `adj_v3` transcript; automatic Claim-shaped capture remains Observation/disposition only; held workflow; store/CLI mixed-plan byte-identical preimage and exact atomic apply; taint and preimage drift zero-write; retrieval index/graph/recheck; installed tarball behavior. |
| End-to-end | disposable synthetic session/form/held/older-policy/foreign cases; B1 mixed subset and tainted zero-write, or B0 preview-only; OKF export/rebuild/zone/manifest/unmanaged/sentinel; main CI and exact release SHA repeated. |
| Observability | aggregate reports only; receipts expose safe/unsafe counts, IDs, reasons, components, admissibility, digest, acknowledgement, and permanence—not bodies. |

Focused commands are the package typecheck/test/evaluator commands for capture, local-store, CLI, and retrieval, plus install/packaging/release tests. Freeze and release run `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm smoke:mcp`, `pnpm smoke:product`, `pnpm smoke:knowledge`, `pnpm smoke:dogfood`, all three evaluator commands, `pnpm public-boundary`, and `pnpm check`.

## Freeze, Approve, and activation receipts

| Receipt | Required contents | Initial state |
| --- | --- | --- |
| Freeze audit (PR 13) | gate/PR SHA/command-result/metric-or-digest/compatibility/risk/boundary for P11, session, evaluators, held, reconciliation, retrieval, dogfood, docs, and release; selected B0/B1; B1 residual unsafe IDs/reasons/components and digest golden proof, or B0 apply defer. | pending |
| Pre-tag Approve (PR 14) | freeze SHA, selected option, three quality receipts, reconciliation schema/digest/golden result, residual unsafe inventory, risks, and maintainer authorization. | pending |
| Release | exact release SHA; one packed tarball installed/smoked/published; package/tag/version `3.2.0`; manifest SHA-512/integrity; registry integrity and `gitHead` equal release SHA before GitHub Release. | pending |
| Activation (PR 15) | public-safe npm version, doctor/help, disposable capture→held→preview; B1 no-ack failure and exact acknowledged atomic apply with safe exclusion/unsafe preservation/fresh replay, or B0 preview-only; retrieval/OKF smoke; cleanup; complete or published/local activation incomplete. | pending |

## Residuals and explicit defers

| Item | Decision |
| --- | --- |
| Automatic/adjudicated Claims and runtime form selector | Deferred; future ADR required. |
| Automatic AcceptanceDecision | Forbidden. |
| Online feedback, adaptive ranking, LLM | Deferred; offline deterministic only. |
| PostToolUse/recall widening and fuzzy dedup | Rejected absent precision proof. |
| Truncated, silent, best-effort, or per-item reconciliation | Rejected. |
| Unsafe-entry repair/mutation | Deferred; unsafe remains unchanged. |
| Supersession cancellation, schema v2, new event | Deferred. |
| Private corpus or real sessions | Prohibited. |
| Hosted graph/vector and OKF import | Out of bounded scope. |

Committed eligible Supersessions permanently grow audit history. Unsafe residuals are never described as cleaned.
