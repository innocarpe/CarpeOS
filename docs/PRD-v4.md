# PRD v4 — CarpeOS 4.0.0

Status: **Package plane shipped** as `@innocarpe/carpeos@4.0.0` / `v4.0.0` — governed
evidence / trust-plane contracts, evaluator, publisher, and dispatch-only workflows
are in the public package. **Full thesis residual:** independent live release
authority, App/settings ownership, and human-approved correction **apply** remain
out of band / fail-closed (not invented by the package cut). Receipt:
[product-4.0.0.md](maintainers/product-4.0.0.md).
Policy contract: immutable evaluator/intent policy `P4_0`; active required-check context `Product 4 Candidate Evidence`
Series: [PRD-v1](PRD-v1.md) · [PRD-v2](PRD-v2.md) · [PRD-v3](PRD-v3.md) · [PRD-v5](PRD-v5.md)

This document is the **product requirements snapshot for major version 4**. It records the agreed thesis, problem, scope, safety boundaries, and success criteria. Implementation of the **trust/evidence plane** is released on npm; do not read this as live authority or automatic correction apply.

---

## Version thesis

> **Can knowledge correction remain append-only, reversible, provenance-carrying, and human-governed without widening canonical authority?**

CarpeOS 4.0 is a governed knowledge-maintenance major. It adds the contracts needed to detect correction debt, review proposed changes, preserve bitemporal meaning, and issue auditable receipts for accepted corrections or reversals. It does not turn an evaluator, workflow, candidate branch, or release controller into an autonomous source of truth.

| | 1.0 | 2.0 | 3.0 | **4.0** |
| --- | --- | --- | --- | --- |
| Question | Does the loop run? | Is this worth remembering? | Can it be found and used? | **Can correction be governed safely?** |
| Core engine | capture + store | adjudication | retrieval projection + graph | **correction maintenance + evidence receipts** |
| Success signal | product smoke | knowledge quality | bounded neighborhood retrieval | **reversible, independently verified, human-approved maintenance** |
| Failure if skipped | no data | dump pollution | unusable brain | **silent mutation or untraceable authority** |

The existing v3.2 loop remains the foundation:

```text
local capture
  → canonical append
  → adjudication
  → promoted retrieval / OKF
```

4.0 adds a controlled maintenance path around that loop; it does not replace the canonical event stream or change promoted-only defaults.

---

## Problem

Product 3.2 establishes deterministic adjudication, promoted-knowledge review, correction metadata, and a bounded B0 policy-reconciliation preview. The next product problem is not “make the system autonomous.” It is “make a human-approved correction safe to reason about, audit, reverse, and release.”

The agreed problem statement is:

1. **Correction debt is observable but not automatically applicable.** The shipped B0 reconciliation path is metadata-only and zero-write. It has no supported apply writer or immutable state transition for P02, so a transition or digest delta must not be invented.
2. **Correction needs explicit lifecycle evidence.** A proposed Claim, AcceptanceDecision, Supersession, correction, or reversal must have a named actor, source event, predecessor, policy identity, and receipt. No workflow may silently create authority.
3. **Candidate output is not trusted evidence.** A pull-request branch can emit self-consistent bytes or hashes while violating semantic predicates. Privileged evaluation and publication therefore have to be base-owned and independently recomputed.
4. **Policy rotation is not safely representable by the current required-check selector.** A same-name required context can accept an old result after a policy change. 4.0 must freeze one policy and one context instead of pretending that invalidation exists.
5. **Activation and release authority are separate ownership problems.** Existing repository and release state cannot be treated as Product 4 authority without actual App, settings, ruleset, controller, and credential-ownership receipts.

These requirements drove the 4.0 package plane. The public package now ships
evidence/evaluator/publisher contracts and fail-closed authority schemas; it
still does not invent live independent authority or B1 apply writers.

---

## Goals

1. Preserve schema v1, append-only events, trust zones, promoted-only retrieval, and the shipped 3.2 B0 read-only contract.
2. Detect correction debt deterministically with bounded, metadata-only previews before any mutation is considered.
3. Define an explicit, human-gated Claim/Acceptance lifecycle without automatic Claim or AcceptanceDecision creation.
4. Represent accepted correction and reversal as append-forward, bitemporal events with predecessor and provenance links.
5. Produce canonical, reversible, privacy-safe receipts for classification, evidence, ownership, activation, rollback, and release decisions.
6. Freeze one evaluator/intent policy digest `P4_0` and one active required-check context, `Product 4 Candidate Evidence`, for the entire 4.0 lifecycle.
7. Keep candidate execution unprivileged; make a base-owned evaluator independently compute strict, non-executable attestations.
8. Make API pagination, exact-C lookup, duplicate handling, lost-response reconciliation, and failure behavior deterministic and fail-closed.
9. Require real ownership evidence before activating a ruleset context, issuing credentials, creating a protected tag, publishing, or claiming technical release blocking.
10. Provide a bounded migration, dogfood, recovery, install, and release path that can be stopped and rolled back with receipts.

---

## Non-goals

| Non-goal | Boundary |
| --- | --- |
| Autonomous truth judgment | Evaluators may verify fixed predicates; humans retain authority over meaning and acceptance. |
| Self-granted authority | No candidate, workflow, evaluator, publisher, or release controller may create its own authority. |
| Automatic Claim, AcceptanceDecision, or Supersession creation | These remain human-gated and receipt-backed. |
| B1 apply/writer behavior | 4.0 does not invent an apply analogue where 3.2 exposes none. |
| Mutating hooks or background daemons | Maintenance remains explicit, bounded, and reviewable. |
| Provider/device synchronization | Hosted sync and provider-specific authority are outside the major. |
| Hosted canonical storage | Private runtime event stores remain the knowledge source of truth. |
| Online learning or adaptive ranking | No feedback loop may mutate acceptance or retrieval authority. |
| Policy rotation or old-policy invalidation | `P4_0` is frozen for 4.0; generation-sensitive migration is a 4.1 prerequisite. |
| Stale-policy mergeability rehearsal | It is removed from the 4.0 DoD and deferred to 4.1. |
| Candidate privileged credentials | Candidate code never receives Checks-write, settings, npm, signing, or equivalent secrets. |
| Production or private data | Fixtures, dogfood, and public receipts use synthetic or privacy-safe data only. |
| A new hosted Product runtime | Any transport service requires a separate contract and ownership review. |
| Release claims without receipts | Missing or ambiguous proof means blocked, not inferred success. |

---

## Users and primary jobs

| User | Job to be done |
| --- | --- |
| Operator across repositories and worktrees | See which knowledge needs correction and submit a bounded, reviewable maintenance decision. |
| Maintainer or human reviewer | Accept, reject, reverse, or defer a correction while preserving lineage and policy identity. |
| Agent at session start | Continue to retrieve promoted knowledge without treating maintenance evidence as automatic authority. |
| Evaluator owner | Independently recompute fixed predicates from unprivileged candidate evidence. |
| Security/settings administrator | Verify actual App, ruleset, and ownership receipts before activation. |
| Release authority | Decide whether an exact candidate may receive tag or publish capability, independently of the candidate workflow. |

---

## Product requirements

### Functional

| ID | Requirement | Priority |
| --- | --- | --- |
| F1 | Emit a deterministic, bounded correction-debt preview from canonical metadata without writing canonical, review, disposition, or outbox rows. | P0 |
| F2 | Replay the exact P02 command and fixture twice; report actual equality and `diagnosis=no_analog`, `outcome=blocked_no_apply`, `analog_available=false`, and `state_transition=none_supported` when no supported transition exists. | P0 |
| F3 | Preserve the six-command loop `1 → 2 → 3 → 4 → 6 → 7`; keep template 5 recovery-only and require human review at the authority boundary. | P0 |
| F4 | Represent a correction or reversal as a new append-forward event with source, actor, predecessor, policy, bitemporal timestamps, and an immutable receipt. | P0 |
| F5 | Provide additive, idempotent migration and a read-oracle that proves old writers, protected-free state, action-complete state, and rollback behavior before promotion. | P0 |
| F6 | Bind Product 4 Candidate Evidence identity to immutable repository, candidate head `C`, fixture digest, `P4_0`, and the exact context name. | P0 |
| F7 | Classify from immutable `C`/tree/`P4_0` only; mutable labels, titles, comments, and candidate-reported status cannot change intent. | P0 |
| F8 | Keep the raw pull-request producer unprivileged, run the evaluator from the protected base, and make the publisher consume data-only strict attestations without checking out or executing candidate content. | P0 |
| F9 | Validate strict attestation schemas, fixed predicate IDs, bounded values, policy pinning, provenance, and independently recomputed zero-write/high-water observations. | P0 |
| F10 | Use exact-C/name lookup with `filter=all`, `per_page=100`, complete Link traversal, App identity verification, suite enumeration, a fail-closed cap, duplicate refusal, and explicit lost-response reconciliation. | P0 |
| F11 | Activate at most one fixed required context through a semantic, guarded ruleset projection that preserves all unrelated rules and records preimage, post-image, approval, drift, retry, and rollback receipts. | P0 |
| F12 | Reconcile actual App, installation, settings administrator, artifact owner, release controller, and credential authority before activation or release claims. | P0 |
| F13 | Run an independent pre-credential release verifier that binds exact evidence, approval, ancestry, release-only diff, tag identity, pack-once artifact, and install/smoke receipts. | P0 |
| F14 | Prove through adversarial dogfood that a candidate or release workflow cannot bypass the evaluator, delete the gate, create a protected tag, or obtain publish credentials. | P0 |
| F15 | Record privacy-safe observability for refusals, conflicts, retries, drift, rollback, moved heads, inactive policies, duplicate responses, and release-gate decisions. | P1 |

### Non-functional

| ID | Requirement | Priority |
| --- | --- | --- |
| N1 | The canonical event stream remains the sole authority; retrieval, graph, OKF, reports, and attestations are rebuildable or evidentiary projections. | P0 |
| N2 | Every accepted correction and reversal is append-only, bitemporal, provenance-carrying, and independently reversible. | P0 |
| N3 | Ambiguity, missing ownership, duplicate identity, policy mismatch, API cap, response loss, or authority drift fails closed. | P0 |
| N4 | Trust planes are disjoint: candidate execution, evaluator, publisher, settings administration, and release authority do not share privileged credentials. | P0 |
| N5 | Canonical JSON, SHA bindings, exact external IDs, and immutable fixture/policy identity make every decision reproducible. | P0 |
| N6 | `P4_0` and `Product 4 Candidate Evidence` remain immutable for 4.0; `P != P4_0` is `policy_not_active` and has no check, mergeability, ruleset, release, tag, or credential effect. | P0 |
| N7 | No receipt, log, report, or metric contains tokens, npm credentials, private paths, protected plaintext, production data, or executable payloads. | P0 |
| N8 | Hooks remain fail-open where the 3.2 contract requires it; maintenance and projection work stay off the hook hot path. | P0 |
| N9 | Public claims are limited to observed evidence. An unknown owner, setting, controller, or activation state is recorded as blocked/unknown. | P0 |
| N10 | Rollback is separately authorized, semantic, and receipt-backed; it is never an implicit retry or a byte-replayed settings write. | P0 |

---

## Frozen policy contract

4.0 deliberately chooses a **policy freeze**, not policy rotation.

| Policy state | Required behavior |
| --- | --- |
| `P = P4_0` | The frozen evaluator, classifier, attestation, ownership, activation, and release-verifier identity may be used after the corresponding receipts exist. |
| `P != P4_0` | Mark `policy_not_active`; do not post or patch checks, transition state, satisfy mergeability, activate rules, release, create tags, or issue credentials. |
| Missing or mismatched `P4_0` receipt | Remain pending or fail closed; do not infer that the current policy is active. |
| Proposed 4.1 policy | Requires a separately versioned required context, ownership/activation receipt, guarded add-new/verify/remove-old ruleset migration, and stale-policy mergeability rehearsal. |

The active check name is exactly `Product 4 Candidate Evidence`. 4.0 does not claim that the platform required-check selector is policy-generation-aware. The policy digest must be generated, recorded, and verified as part of implementation receipts; this PRD intentionally does not fabricate a digest value.

---

## Architecture snapshot

### Existing authority and maintenance path

```text
local capture
  → EvidenceArtifact
  → adjudication (3.2 semantics)
  → canonical append-only events (authority)
  → promoted retrieval / OKF projections

canonical metadata
  → bounded correction-debt preview (zero write)
  → human review and explicit lifecycle decision
  → append-forward correction or reversal event
  → receipt-backed rebuild of projections
```

The maintenance path may propose work and preserve evidence. It may not silently promote a Claim, create an AcceptanceDecision, or mutate canonical authority without the required human and receipt boundaries.

### Candidate evidence planes

```text
unprivileged pull_request producer
  → raw report only
  → base-owned evaluator in disposable no-secret sandbox
  → strict non-executable attestation
  → protected publisher with Checks App authority
```

The publisher treats reports and attestations as data. It never checks out, imports, executes, or trusts a candidate script, module, command, URL, or executable payload.

### Activation and release planes

```text
ownership receipt
  → semantic ruleset guard and one-context activation
  → exact-C trusted evidence
  → independent pre-credential release verifier
  → protected release authority
  → tag / publish only after approval and receipts
```

The release authority must be independent of the workflow being evaluated. A release workflow that deletes or bypasses its own gate must receive neither protected tag authority nor npm/publish credentials.

### Candidate state machine

The legal evidence order is:

```text
classification_pending
  → pending_evidence
  → exactly one bc-preflip
```

A non-candidate may receive exactly one `not_applicable` result. A changed candidate head, tree, base, dispatch expectation, or conflicting receipt creates a new identity or remains blocked; it does not silently repair the old identity. Same-C metadata changes cannot flip a green non-candidate into a candidate.

---

## P02 contract

All P02 cards use the synthetic fixture `scripts/fixtures/maintenance-study-v2.json` and the exact command:

```text
carpeos adjudicate reconcile-policy --from-policy adj_v1 --to-policy adj_v3 --trust-zone tz_synthetic --limit 100
```

Run A twice against one unchanged disposable store and fixture. Record command bytes, environment/tool version, exit code, stdout/stderr bytes, plan digest, rows/counts, all five high-water fields, IDs, provenance/freshness, and zero-write probes. The two runs must be byte-identical and must not mutate canonical, review, disposition, or outbox state.

Because 3.2 exposes no supported apply writer or immutable state transition for this case, the honest result is:

```text
diagnosis=no_analog
outcome=blocked_no_apply
analog_available=false
state_transition=none_supported
```

No digest suffix, row delta, or transition is fabricated. A transition probe is admissible only when a real supported immutable transition exists and its before/after preimages and delta are measured.

---

## Trust and API contracts

### Trust separation

- The candidate may execute only with read-only contents/dependencies and ordinary `GITHUB_TOKEN` access.
- Fork and Dependabot secret absence produces pending/failure, never success.
- The base-owned evaluator runs the candidate harness without Checks-write, settings, npm, signing, or equivalent privileged credentials.
- The evaluator independently recomputes hashes, zero-write/high-water observations, and fixed predicates.
- The protected publisher consumes only a strict attestation and never executes candidate code or report content.
- Candidate-reported `success` is ignored; any missing or false trusted predicate refuses promotion.

### Exact external API behavior

- `pull_request` uses the actual head `C`, not merge `M`; trusted base `B` and release `R` remain separate identities.
- Dispatch includes the expected candidate SHA and refuses moved, closed, or mismatched heads.
- Every lookup uses exact C/name identity, `filter=all`, `per_page=100`, complete RFC 5988 Link traversal, and verified repository, name, C, external ID, fixture, and App identity.
- Independent suite enumeration uses the same pagination and a fail-closed cap.
- Zero exact non-conflicting matches permit one POST; exactly one App-owned matching identity permits only that run’s PATCH/verification.
- More than one match, foreign App, conflicting tuple, ambiguous same-C/name run, or any same-name run not bound to `P4_0` is `duplicate_refusal`.
- A lost POST is exhaustively reconciled; zero or multiple matches become indeterminate/human reconciliation, never a blind second POST.
- A lost PATCH allows one identical retry only while the same pending identity remains valid.
- 401/403/404/409/422, malformed responses, incomplete pagination/App proof, cap exhaustion, and rate-limit exhaustion fail closed.

---

## Activation and release requirements

### Fixed-context ruleset activation

Before activation, live state remains the observed Checks-only baseline. Activation requires an ownership receipt proving the actual repository, ruleset, App ID/installation/slug, `checks:write`, key-rotation owner, settings-admin permission, artifact owner, release-controller/credential owner, `P4_0`, and approval. Receipts contain no secrets.

A semantic activation guard must:

1. authenticate the settings administrator;
2. canonicalize and record the ruleset preimage;
3. obtain one-context approval;
4. immediately re-fetch and verify the preimage under the same authority;
5. add only `Product 4 Candidate Evidence` with the verified App integration;
6. preserve all existing rules, bypass actors, conditions, enforcement, name, and target;
7. record post-image, drift, response-loss, retry, rollback, and approval evidence.

Until that receipt exists, no Product 4 required/release-blocking claim is allowed. Once activated, the context and `P4_0` remain frozen for 4.0.

### Independent release authority

A pre-credential release verifier must validate active ownership/ruleset receipts, exact-C trusted `P4_0` evidence, artifact/manifest/decision digests, approval, C-to-R ancestry, release-only diff, version/tag identity, pack-once tarball, and install/smoke evidence before registry configuration or credential request.

An independently owned protected release App/controller or equivalent protected environment owns protected tag creation and publish capability. The evaluated release workflow cannot edit its own code, actors, settings, credentials, environment policy, approved workflow/policy SHAs, or `P4_0` receipt. Missing or ambiguous authority means no tag, credential, publish, or technical release-blocking claim.

---

## Milestones and dependency graph

| Milestone | Planned exit work |
| --- | --- |
| M0 | Contracts, thesis, artifact identity, synthetic/public boundary, frozen `P4_0`; no shipped claim. |
| M1 | Additive/idempotent migration, protected-free/action-complete sync, old-writer/read-oracle, trust-zone, and rollback gates. |
| M2 | Exact six-command loop, recovery-only template 5, CLI/MCP/sync gates, and human review; no automatic authority. |
| M3 | Deterministic bounded B0 replay, zero writes, actual equality, `no_analog`/`blocked_no_apply`. |
| M4 | Candidate evaluator/publisher/intent/API under `P4_0`, ownership reconciliation, fixed-context rehearsal, and receipt-backed promotion. |
| M5 | Pre-credential verifier, independent release authority, release workflow gate, dogfood/recovery, exact install, and release approval. |

```text
M0
 ├─→ M1 migration/read oracle ─→ M2 loop/authority ─→ M3 P02
 ├─→ M4 candidate evidence and fixed-context ownership
 └─→ M5 verifier → independent release authority → release workflow

M3 + M4 + M5 → dogfood/recovery → exact install/release approval

4.1 (not a 4.0 dependency): generation-sensitive context,
 guarded policy migration, and stale-policy mergeability rehearsal.
```

Implementation work must use atomic worktrees/PRs, disjoint primary ownership, explicit dependency edges, and incoming receipts before any settings, tag, credential, publish, or release action.

---

## Success criteria

4.0.0 is successful only when all of the following are observed and receipt-backed:

1. M0 exact-artifact comparison and the daily-value gate pass. If they do not, 4.0 does not start and 3.x remains the active improvement path.
2. The unchanged P02 replay is deterministic, zero-write, and truthfully reported as `no_analog`/`blocked_no_apply` when no supported transition exists.
3. The six-command loop, migration/read-oracle, recovery template, synthetic/public boundary, and no-auto-authority rules remain intact.
4. Every candidate identity is bound to exact C/tree/fixture/`P4_0` evidence; mutable metadata and candidate status cannot alter intent.
5. Candidate execution has no privileged secrets; the base evaluator independently recomputes a strict non-executable attestation; forged or semantically wrong reports produce no POST/PATCH.
6. Exact-C API pagination, App verification, suite cap, duplicate refusal, and lost-response behavior pass their negative tests.
7. Activation is backed by real ownership and semantic ruleset receipts; otherwise the product remains Checks-only/Option A.
8. An independent release authority proves that gate deletion or bypass cannot create a protected tag or obtain publish credentials.
9. Dogfood, recovery, exact tarball install, and smoke evidence use synthetic/disposable inputs and contain no private or production data.
10. No 4.0 claim depends on policy rotation, stale-policy invalidation, generation-sensitive ruleset migration, or stale-P mergeability rehearsal.

A release decision remains **Defer** until the implementation gates and maintainer approval are complete. This PRD does not authorize implementation, activation, tag creation, credentials, publishing, or release by itself.

---

## Verification plan

The future implementation must verify, at minimum:

### Contract and unit verification

- Canonical schemas reject unknown, executable, unsafe, private-path, invalid-SHA, invalid-integer, and inactive-policy fields.
- P02 serialization, preimage, equality, zero-write, and `no_analog` behavior are deterministic.
- Frozen-policy validation accepts only `P4_0` and preserves the fixed context.
- C/tree/`P4_0` intent is write-once, conflict-aware, moved-head safe, and immune to mutable metadata.
- Attestation predicates are independently recomputed; candidate booleans and executable report fields are ignored.
- State transitions, pagination, App verification, caps, duplicate refusal, lost POST/PATCH, and API failure paths fail closed.
- Ruleset projection, preservation, drift, response-loss, rollback, ownership, release-authority, and C-to-R decisions are receipt-backed.

### Integration and adversarial verification

- Same-repository, fork, and Dependabot jobs prove the absence of privileged candidate secrets.
- Forged/hash-consistent reports, sentinel writes, early upgrades, wrong P02 claims, candidate success, and inactive-policy proposals are refused.
- Migration/open-reopen, old-writer, protected-free, action-complete, and read-oracle scenarios preserve append-only semantics and idempotency.
- Fixed-context activation, response loss, drift, rollback, release-controller bypass, and gate deletion are tested without unapproved live mutation.
- Exact install and release rehearsal use the approved tarball only after all incoming receipts and approval exist.

### Observability and public boundary

Events and metrics may identify a run, C, external ID, fixture, `P4_0`, artifact, or receipt, but must not contain tokens, credentials, private paths, protected plaintext, or production output. Missing telemetry is a failed gate. Public documentation and receipts must use synthetic or generic examples.

---

## Deferred 4.1 work

The following are explicit 4.1 entry conditions, not 4.0 implementation shortcuts:

1. Create a genuinely policy-generation-sensitive required context whose identity includes the complete policy generation.
2. Add and verify the new context before removing the old context through a guarded semantic ruleset migration.
3. Produce ownership and activation receipts for the new context.
4. Run stale-policy platform mergeability rehearsal before any policy rotation or old-policy invalidation.
5. Define the migration and rollback contract for policy-sensitive historical evidence.

Until that work is separately approved and evidenced, a proposed policy other than `P4_0` remains inactive and 4.0 stays on the frozen policy or Checks-only/Option A fallback.

---

## Residual risk

| Risk | Mitigation |
| --- | --- |
| A policy needs to change during 4.0 | Do not rotate; retain `P4_0` or remain Checks-only. Open 4.1 for generation-sensitive migration. |
| Historical same-name runs create ambiguity | Exhaustive exact-C/name/App/suite enumeration and duplicate refusal. |
| Candidate report is forged | No-secret base evaluator recomputes semantics; publisher consumes only strict attestation. |
| App/settings/controller ownership is unknown | Require real ownership receipts; placeholders keep the product inactive. |
| Release workflow removes its own gate | Independent protected controller/tag/credential authority and adversarial bypass rehearsal. |
| API or settings response is lost | Exhaustive reconciliation and bounded, identity-preserving retry; otherwise fail closed. |
| B0 has no transition analogue | Preserve observed equality and `blocked_no_apply`/`no_analog`; never fabricate a delta. |
| Maintenance evidence is mistaken for authority | Keep canonical events authoritative and require explicit human lifecycle decisions. |

---

## Related

- [PRD index](PRD.md)
- [Product 3.2.0 DoD](maintainers/product-3.2.0.md)
- [Policy version reconciliation](adr/0015-policy-version-reconciliation.md)
- [Versioning and releases](maintainers/versioning-and-releases.md)
- [PRD v1](PRD-v1.md) · [PRD v2](PRD-v2.md) · [PRD v3](PRD-v3.md)
