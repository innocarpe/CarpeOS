# CarpeOS 4.0.0 Product 4 — Grok Build Cold-Start Plan (v2)

**Status:** Product 4 is not release-complete. This document supersedes `product4-4.0.0-grok-cold-start.md` for a fresh session.

**Baseline:** `origin/main` at `acbc0bb4b0513b9b51bf4640077a44b85cae2dfd` (PR #243 merge).

**Package identity:** `@innocarpe/carpeos` remains `3.2.0`; no `v4.0.0` tag, publish, credential request, or live settings mutation is authorized.

**Durable plan:** G001–G008 are complete. G009 and G010 remain `review_blocked`; G011 remains active. The required outcome is a verified, fail-closed implementation and an explicit release `Defer` when independent authority or approval is absent—not a green synthetic suite and not an invented release.

## 1. What has landed

The merged baseline contains the M0–M5 contract, migration, truthful P02, candidate evidence, promotion, release-gate, dogfood, and exact-install planes. The later Product 4 trust-boundary stack is also present through these semantic PRs:

- #204–#206: frozen identity, evaluator evidence, independent authority boundary.
- #207–#214: workflow runner environment, CI policy, exact evidence, authority proof, evaluator boundary, and PR/atomic-commit harness rules.
- #219–#222: offline sandbox store, authority freshness, publisher C/artifact/run binding, and P02 replay/mutation hardening.
- #224–#225: GitHub response reconciliation, sealed base evidence, and downstream fixture sealing.
- #243: identity-bound observed sandbox proof and candidate workflow isolation. CI passed, including the 99 Product 4 test cohort, actionlint, Biome, and diff checks. Linux bubblewrap end-to-end execution was not available on the Darwin development host.

The existing synthetic receipts in `artifacts/g008/` remain procedural evidence only. They do not prove external authority, human approval, credentials, live settings, or a releasable `4.0.0` package.

## 2. Current truth boundary

Do not infer any of the following from unit tests, self-digested JSON, or local hashes:

- independent GitHub authority or App ownership;
- protected-controller authority, tag protection, credential issuance, or approval;
- a successful production attestation;
- a real workflow-run artifact binding;
- a published package or live release.

The release gate must remain fail-closed and return `Defer`/blocked when any such evidence is absent.

## 3. Remaining blockers, ordered by dependency

### B1 — Production protocol evidence source is still absent (highest priority)

`evaluator-runner.mjs` rejects caller-supplied protocol objects. Its default base-owned provider requires a trusted read-only GitHub token and then refuses because no independent protocol receipts are available. The normal CLI/workflow path therefore fails with `protocol_evidence_missing` rather than minting a false attestation.

Required result:

1. Add a real base-owned provider, or keep the production path explicitly blocked.
2. The provider must obtain actual module/API observations, validate response status and complete pagination, and bind every observation to C, tree, base, frozen fixture, P4_0 policy, context, and evaluator source.
3. Never accept candidate JSON, a caller callback, a self-generated fixture, or a self-digested receipt as independent authority.
4. Seal trusted evidence only after the observations are independently obtained and validated. Re-audit the `@internal` sealer and its export boundary.

A successful-looking synthetic provider is a failure, not a solution.

### B2 — Exact executable C binding needs a production-path proof

The runner validates identity and sandbox roots, but the final cohort must prove that candidate root, workspace root, and CLI root contain exactly the intended C/tree and no dirty or untracked executable content.

Required adversarial cases:

- clean C root paired with modified workspace;
- clean C root paired with unrelated CLI root;
- untracked file added after the trusted tree digest;
- symlink/root overlap with evaluator, home, output, or another candidate-controlled root;
- output written inside a candidate-controlled root.

The proof must cover the actual roots passed to P02, not only the identity fields in a receipt.

### B3 — Sandbox proof is merged but Linux runtime evidence is still required

#243 moved candidate install/build/init into bubblewrap, uses trusted-base probe code, mounts the candidate read-only, mounts the dependency store read-only, applies no-network/no-capability/no-new-privilege/resource-limit controls, and binds the receipt to C/base/tree/fixture/policy/context and separated roots.

The remaining acceptance gap is environment-specific: run the actual workflow on Linux and inspect the produced probe/receipt. A static test on Darwin cannot prove namespace, mount, capability, or rlimit behavior. If a claimed fact cannot be observed in CI, refuse the receipt or remove the claim.

### B4 — P02/evaluator success path must be exercised end to end

The strict replay predicate now requires equal replay evidence with distinct replay IDs. Verify the full command/tool/environment/exit/stdout/stderr/plan/rows/high-water/provenance equality through the evaluator, not only a helper test. Reuse the raw producer's immutable `evaluated_at`; do not rebuild it at T1.

The production attestation workflow must either produce a real trusted result or visibly fail closed with its refusal code. A test that passes handcrafted all-true predicates is not evidence.

### B5 — GitHub evidence matrix must be rerun on the current main

Run current-source adversarial checks for:

- HTTP 401/403/404/409/422;
- missing repository, App, head, check name, or external ID fields;
- nonterminal or unsuccessful runs;
- more than one exact C/name/App match;
- incomplete `total_count` pagination without a continuation link;
- independent suite/run enumeration and suite/run identity mismatch;
- traversal/unsafe repository paths;
- lost PATCH retry without a fresh exact pending-run GET;
- forged prebuilt API receipt without builder-origin response evidence.

Record refusal codes and source SHA. Do not replace this matrix with the existing synthetic dogfood result.

### B6 — Release authority remains a human/external gate

There are no independent authority, approval, credential, or live settings receipts in the repository. Current package identity is `3.2.0`. Keep the release verifier at `blocked`/`Defer`; do not create `v4.0.0`, publish, request credentials, activate settings, or claim release completion.

Only a real externally verifiable authority receipt and explicit approval can move this boundary. Local `sha256` values, local callbacks, self-authored protected receipts, and denied constants are not substitutes.

## 4. Execution plan for a fresh Grok session

### Step 0 — Establish baseline

```sh
git fetch origin main
git show --no-patch --oneline origin/main
git status --short --branch
git worktree list --porcelain
```

Use a new worktree from the fetched `origin/main`. Do not reuse stale Product4 worktrees, do not copy `.gjc` state, and do not edit the existing checkout.

### Step 1 — Read the contracts and policy

Read:

```text
AGENTS.md
docs/PRD-v4.md
docs/maintainers/ci-policy.md
docs/maintainers/versioning-and-releases.md
skills/carpeos-pr/SKILL.md
skills/carpeos-ci/SKILL.md
spec/product4/evaluator-policy-v1.json
schemas/product4-*.json
.github/workflows/product-4-candidate-*.yml
scripts/product4/evaluator.mjs
scripts/product4/evaluator-runner.mjs
scripts/product4/p02-runner.mjs
scripts/product4/p02-replay.mjs
scripts/product4/raw-producer.mjs
scripts/product4/github-evidence-api.mjs
scripts/product4/release-authority.mjs
scripts/verify-4.0-gates.mjs
```

### Step 2 — Split semantic PRs, not arbitrary commits

Use fresh branches and one atomic commit per independently understandable change. Keep PRs semantically grouped:

- **PR-A — executable C/protocol evidence:** evaluator-runner plus focused evaluator tests; no static provider, no caller-supplied protocol input.
- **PR-B — current-source GitHub adversarial matrix:** only API source/tests if Step 3 finds a current gap.
- **PR-C — Linux sandbox proof follow-up:** only workflow/P02 source/tests if Linux CI identifies an actual observation/enforcement gap.
- **PR-D — release audit/defer:** only after code PRs are merged; never use it to bypass missing human authority.

Do not create one PR for every commit. Before each PR:

```sh
git log origin/main..HEAD --oneline
git diff origin/main...HEAD --stat
git diff --check
```

Every PR uses the full repository template, exactly one kind label, and an optional area label. Verify labels, CI, and merge state before reporting it complete. Refetch `origin/main` before starting the next dependent branch.

### Step 3 — Run baseline and production-path verification

```sh
node --test scripts/test/product4-*.test.mjs
pnpm --dir packages/schema test --run
pnpm --dir packages/schema typecheck
node scripts/check-public-boundary.mjs
actionlint .github/workflows/product-4-candidate-evaluate.yml
actionlint .github/workflows/product-4-candidate-attest.yml
actionlint .github/workflows/product-4-candidate-publish.yml
pnpm check
git diff --check
```

Then run:

```sh
node scripts/product4/dogfood.mjs
node scripts/verify-4.0-gates.mjs --receipt-dir <empty-temporary-receipt-dir> ...
```

The first proves synthetic refusal behavior only. The second must remain blocked when receipts are absent.

For the actual workflow, use Linux CI and inspect the artifact/receipt contents. Darwin-only syntax and unit tests are insufficient for bubblewrap claims.

## 5. Completion matrix

Do not mark G011 or G009 complete until every row has current evidence tied to one final source hash:

| Requirement | Direct evidence required | Current state |
| --- | --- | --- |
| Candidate never executes on host | Workflow source plus Linux execution trace | #243 source hardened; Linux trace pending |
| Sandbox claims are observed/enforced | Probe record, namespace/mount/capability/rlimit evidence | Code/test landed; Linux runtime proof pending |
| Exact C/tree/workspace/CLI | Content/tree/dirtiness checks on every executed root | Re-audit pending |
| Deterministic P02 | Full equal replay evidence through evaluator | Helper/unit evidence; production path pending |
| Independent protocol evidence | Base-owned real module/API observations | Missing; default refuses |
| Exact GitHub API | Current adversarial matrix and complete response evidence | Re-run on current main |
| Canonical attestation provenance | Sealed envelope bound to source/evidence | Code present; production source proof pending |
| Publisher C/artifact/run binding | Current workflow and publisher tests | Landed; reverify after final merge |
| Authority freshness/schema | External receipt and current-time freshness | Validator hardened; live receipt absent |
| Install/release readiness | Exact artifact plus release-gate receipt | G008 Defer only |
| Package identity | Version/changelog for `4.0.0` | Current package is `3.2.0` |
| Human approval/authority | Independent approval and authority receipts | Missing |
| Final cohort | Fresh architect, red-team, cleaner, critic on final hash | Not run |

## 6. Hard stops

Return `BLOCKED`/`DEFER`, not success, when:

- independent authority, approval, credentials, or live receipts are missing;
- candidate code executes outside the sandbox;
- a sandbox fact is stamped rather than observed or enforced;
- trusted predicates come from caller input, static fixtures, or self-digests;
- an API response is incomplete, nonterminal, unsuccessful, duplicate, identity-incomplete, or lacks fresh PATCH reconciliation;
- C/tree/workspace/attestation provenance is ambiguous;
- a release gate is bypassed, deleted, self-asserted, or unverified.

## 7. Required final receipt

Record, using the durable goal workflow rather than editing `.gjc` manually:

- baseline and final source SHA;
- every semantic PR number, title, base/head, labels, merge SHA, and actual checks;
- filtered Product4 diff SHA-256;
- full test/CI commands and results, including Linux sandbox evidence or the explicit gap;
- fresh architect/red-team/cleaner/critic verdicts;
- release-gate decision and exact reason;
- any remaining human-owned receipt blocker.

Never copy private paths, credentials, runtime stores, transcripts, or ignored `.gjc` state into the handoff or a PR.
