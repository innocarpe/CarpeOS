# CarpeOS 4.0.0 Product 4 — Grok Build Cold-Start Handoff

**Status:** implementation handoff; Product 4 is not release-complete.
**Prepared:** 2026-08-06
**Current baseline at preparation:** `origin/main` `d255264cdf00b3384038bc13b245c7104c291e6d`
**Baseline parent containing the latest Product 4 stack:** `13478c880fa4723df1bbb8f8fbbda5956a848209` (PR #225)
**Package version at baseline:** `3.2.0`

This document is self-contained for a fresh Grok Build session. It records what has already landed, what remains, the non-negotiable trust boundaries, the semantic PR/atomic commit policy, and the evidence required before any release decision.

## 1. Executive status

The original implementation sequence G001–G008 is complete in the durable ultragoal ledger. The later release and trust-boundary goals are not complete:

- **G009 — Merge and release Product 4.0.0:** blocked/deferred because independent authority, approval, credentials, version/changelog identity, and live release receipts are absent.
- **G010 — Resolve Product 4 boundary blockers:** previously reviewed as blocked.
- **G011 — Resolve final Product 4 boundary blockers:** active in the durable plan; its final cohort has not passed.

Product 4 semantic PRs through #225 are merged. There is no open Product 4 PR at the time this handoff was prepared. That means the next changes must be created as new semantic PRs; they must not be silently edited into `main` or folded into an old merged PR.

The current unit/test green state is not sufficient for completion. Existing tests are predominantly synthetic/unit coverage and do not prove that the real GitHub Actions workflow can execute an untrusted candidate only inside the intended sandbox and then produce a trusted attestation from independent evidence.

## 2. What is already complete

### G001 — Isolated implementation bootstrap

- Product 4 work was developed from freshly fetched `origin/main` in isolated worktrees.
- The existing checkout was not used as the Product 4 implementation worktree.
- Exact base/head/status receipts were recorded in the local durable goal ledger.

### G002 — M0 contracts and frozen identity

Landed contract surface includes:

- Product 4 candidate report, evaluator attestation, candidate intent, migration, ownership, ruleset, promotion, release-authority, and release-identity schemas.
- Frozen P4_0 evaluator policy identity.
- Synthetic public-safe maintenance-study fixture.
- Strict unknown-key, unsafe-key, private-path, SHA, inactive-policy, and executable-field rejection.

The frozen policy/fixture identity must not be silently rotated by runtime code. Any source-drift result is a refusal, not a new accepted identity.

### G003 — M1 migration/read-oracle plane

Landed behavior includes additive/idempotent migration planning, protected-free/action-complete/old-writer/read-oracle/trust-zone checks, append-only protection, receipt-backed rollback, and refusal of destructive or executable migration plans.

### G004 — M2 command loop and M3 truthful P02

Landed behavior includes:

- Exact command loop `1 → 2 → 3 → 4 → 6 → 7`.
- Template 5 remains recovery-only.
- Deterministic bounded P02 replay.
- `diagnosis=no_analog`, `outcome=blocked_no_apply`, `analog_available=false`, `state_transition=none_supported`.
- No fabricated delta or transition.
- Zero-write/high-water and replay identity checks.

Later P02 hardening PR #222 added full replay equality and ambiguous mutation refusal; it still needs final production-path verification against the current workflow.

### G005 — M4 candidate evidence and promotion planes

Landed components include:

- Unprivileged raw producer.
- Immutable C/tree/P4_0/frozen-fixture intent and state.
- Base evaluator and sealed evaluator evidence boundary.
- Non-executable attestation data.
- Exact-C GitHub evidence API guards.
- Independent suite/run pagination, App/C/name/external identity checks, suite cap, duplicate refusal, terminal-success checks, and fresh lost-PATCH reconciliation.
- Ownership/ruleset rehearsal, append-only promotion ledger, and trust-separated workflows.
- Publisher C/artifact/run binding in PR #221.

### G006 — M5 release verifier and pre-credential gate

Landed components include:

- Release identity and release-authority schemas.
- Read-only release verifier.
- Ancestry/release-only-diff/pack-once/install-smoke/approval/ownership/ruleset/authority gates.
- Release workflow ordering that keeps package registry credentials and publish steps behind the gate.
- Authority freshness verification in PR #220.

This is a fail-closed release gate, not live authority. It must not be described as independent authority merely because a local digest validates.

### G007 — Synthetic dogfood/recovery verification

Synthetic public-safe dogfood covers the planned M1–M5 scenarios, including forged reports, sentinel writes, inactive policy, moved heads, duplicate API results, response loss, gate deletion/bypass, and missing ownership. These receipts prove the synthetic refusal behavior only; they are not live authority or release approval.

### G008 — Exact install and release-readiness receipts

Existing artifacts:

- `artifacts/g008/product4-exact-install-receipt.json`
- `artifacts/g008/product4-release-gate-defer-receipt.json`

They record exact install/readiness and a fail-closed Defer decision. They do not satisfy independent authority or approval. There are no Product 4 live authority receipts in `artifacts/receipts` at the current baseline.

## 3. Merged semantic PR history

The following Product 4/harness sequence is already merged into `main`:

- #195 — shared agent harness policy alignment.
- #196 — Product 4 foundation contracts and truthful loop.
- #197 — governed evidence plane.
- #198 — release authority receipt.
- #199 — pre-credential release verifier.
- #200 — release workflow gate.
- #201 — adversarial dogfood receipt.
- #202 — release readiness receipts.
- #204 — frozen identity and truthful P02 replay.
- #205 — evaluator evidence bound to immutable C.
- #206 — independent release authority.
- #207 — Product 4 workflow runner environment fix.
- #208/#209 — CI policy and PR-lean/main-full harness work.
- #210 — exact evidence reconciliation.
- #211 — external release authority proof.
- #212 — evaluator trust boundary.
- #213 — evaluator attestation bound to base evidence.
- #214 — semantic PR/atomic commit rules across harnesses.
- #219 — offline sandbox dependency/store mounting.
- #220 — release-authority freshness.
- #221 — publisher C/artifact/run binding.
- #222 — P02 replay truth/equality and mutation hardening.
- #224 — GitHub evidence pagination/identity/lost-PATCH hardening and downstream fixture alignment.
- #225 — sealed evaluator base evidence and downstream fixture sealing.

PRs #215–#218, #223, #226, and #227 are 5.0.0/V5 work. Do not mix V5 work into Product 4 remediation or release PRs.

## 4. Confirmed remaining blockers

These are the blockers that must be resolved or explicitly documented as a fail-closed human blocker. Do not infer success from a focused unit test.

### B1 — Raw candidate workflow executes C on the host

Current file:

- `.github/workflows/product-4-candidate-evaluate.yml`

The raw-evidence job currently performs candidate checkout followed by host-side `pnpm install`, candidate build, and CLI initialization before the bubblewrap execution. Candidate-controlled build/lifecycle code can therefore run with access to workflow state and can influence environment/control files before the sandbox starts.

Required result:

- No candidate install, build, CLI initialization, or candidate lifecycle executes outside the sandbox.
- Host steps only prepare trusted tooling, immutable input, and disposable mount roots.
- Candidate code runs only in the bounded no-network/no-capability namespace.
- Candidate cannot write `GITHUB_ENV`, `GITHUB_PATH`, workflow control files, trusted evaluator inputs, or credentials.
- The workflow test asserts the absence of the old host-execution path.

### B2 — Production evaluator has no independent protocol-evidence source

Current files:

- `scripts/product4/evaluator-runner.mjs`
- `.github/workflows/product-4-candidate-attest.yml`

The public evaluator path correctly rejects caller-supplied protocol inputs. The current default base-owned provider then fails closed with `protocol_evidence_missing`; the workflow supplies no independent protocol receipt/provider input that can produce a trusted result. This is safer than synthetic authority but means the production attestation path cannot succeed.

Required result:

- Either implement a real base-owned read-only provider that obtains and validates actual module/API observations, or keep the workflow explicitly blocked with a documented refusal and do not claim Product 4 release readiness.
- Never add a static synthetic provider, caller-supplied JSON trust path, self-generated signature, or test fixture as production authority.
- The sealed evaluator envelope must be created only after actual C/tree/P4_0/fixture/context-bound observations and must remain module-private/sealed.
- The final attestation must carry enough provenance to distinguish independent evidence from a self-digested fixture.

### B3 — Sandbox receipt overclaims unobserved controls

Current files:

- `scripts/product4/p02-runner.mjs`
- `.github/workflows/product-4-candidate-evaluate.yml`
- `.github/workflows/product-4-candidate-attest.yml`

The workflow probe genuinely checks only a narrow property such as `NoNewPrivs`, while the emitted JSON claims network namespace, mount properties, capabilities, writable paths, process limits, and memory limits. A digest of a static JSON is not an independent observation.

Required result:

- Probe each claimed property inside the actual sandbox, or remove the unsupported claim.
- Enforce the claimed process/memory/file limits, not merely stamp them.
- Bind the receipt to exact C/base/tree/fixture/policy/context and the actual candidate/work/home/output roots.
- Reject self-minted caller probe hashes and path overlaps.
- Treat inability to observe a property as refusal, not success.

### B4 — Strict P02 predicate is inverted in evaluator-runner

Current file:

- `scripts/product4/evaluator-runner.mjs`

`trustedStrictAttestation()` currently returns success when the two command evidence digests differ. The truthful P02 contract requires deterministic byte-identical replay evidence (with distinct replay IDs).

Required result:

- Require equality of the full replay evidence: invocation, tool version, environment, exit code, stdout, stderr, plan, rows, high-water, IDs, and provenance.
- Require distinct run IDs without requiring different evidence bytes.
- Add an actual regression test through the evaluator path, not only a low-level fixture test.

### B5 — Exact C/tree/workspace/CLI binding is incomplete

The evaluator checks candidate identity but must also prove that the workspace and CLI roots executed by P02 contain exactly the intended C/tree and no dirty/untracked/unbound content.

Required result:

- Validate candidate root, workspace root, and CLI root as regular non-symlink directories.
- Reject root overlap with trusted evaluator, home, output, and each other.
- Compute and compare the intended tree/content digest for every executed root, including dirty/untracked content where applicable.
- Reject a clean `candidateRoot` paired with a modified or unrelated workspace/CLI root.
- Keep output outside all candidate-controlled roots.

### B6 — Timestamp and provenance consistency

The raw producer stamps `evaluated_at`; the evaluator must reuse the raw timestamp for the source digest or receive the exact persisted timestamp. Rebuilding a new timestamp at evaluation time causes a valid raw report to fail or permits ambiguous rewrapping.

Required result:

- One immutable `evaluated_at` is used from raw producer through evaluator, attestation, publisher, and release verifier.
- Provenance binds evaluator workflow/source tree, base, C, tree, policy, fixture, context, and evidence digest.
- Rewrapped/mutated issuer/provenance/workflow identities refuse.

### B7 — Exact GitHub response evidence must be re-adversarially verified

PR #224 tightened the API, but the final cohort must prove on the current baseline that the following all refuse:

- HTTP 401/403/404/409/422 responses.
- Missing returned repository/App/head/name/external identity.
- Nonterminal or unsuccessful check runs.
- More than one exact C/name/App match.
- Partial pagination with `total_count` greater than collected items and no Link continuation.
- Suite/run identity mismatch or missing independent suite enumeration.
- Lost PATCH retry without an exact fresh pending-run GET.
- Unsafe/traversal repository paths.

Do not accept a prebuilt self-digested API receipt without builder-origin/response evidence binding.

### B8 — Release remains a hard human/authority gate

Current release facts:

- Package version is `3.2.0`, not `4.0.0`.
- Only synthetic/G008 readiness and Defer receipts are present.
- No independent authority/approval/credential/live settings receipt is present.

Under the approved plan, missing human-owned authority, approval, credentials, or live receipts means **Defer**. Do not create `v4.0.0`, publish to npm, request credentials, activate GitHub settings, or claim release completion. Code remediation can proceed, but the final release action remains blocked until the required external authority and approval are actually supplied.

## 5. Work breakdown for Grok Build

Use fresh worktrees from the latest fetched `origin/main`. Do not reuse stale Product4 worktrees or merge their old commits blindly.

### PR-A — Workflow sandbox isolation

**Suggested title:** `fix(product4): isolate raw candidate execution`

**Files:**

- `.github/workflows/product-4-candidate-evaluate.yml`
- `scripts/test/product4-workflows.test.mjs`

**Acceptance:** B1 and the workflow portions of B3 are resolved; static workflow assertions reject host candidate execution and require the actual sandbox boundary.

### PR-B — Evaluator production entrypoint and exact C binding

**Suggested title:** `fix(product4): bind evaluator to executable C evidence`

**Files:**

- `scripts/product4/evaluator-runner.mjs`
- `scripts/test/product4-evaluator.test.mjs`

**Acceptance:** B2, B4, B5, and B6 are resolved or fail closed with explicit evidence; no synthetic provider is introduced.

### PR-C — Sandbox receipt proof

**Suggested title:** `fix(product4): require observed sandbox controls`

**Files:**

- `scripts/product4/p02-runner.mjs`
- `scripts/test/product4-loop-p02.test.mjs`

**Acceptance:** B3 is resolved; the public/test boundary cannot mint a trusted receipt from a static or arbitrary probe JSON.

### PR-D — API/release follow-up only if current adversarial probes still fail

Do not create this PR preemptively. Run the B7 probe matrix against the latest baseline first. If a gap remains, isolate the smallest affected source/test files and create one semantic PR. Do not mix API changes with workflow/evaluator changes.

### Final release boundary

After all Product4 code PRs are merged and a fresh cohort is green, prepare a separate release/version PR only when the approved authority/approval gate permits it. Version/changelog edits are not evidence of authority. Tag/publish remains a separate explicitly authorized action.

## 6. Atomic commit and semantic PR rules

These rules are mandatory:

1. Start each semantic slice from freshly fetched `origin/main` in a new worktree/branch.
2. One atomic commit must represent one independently understandable change.
3. A semantic PR may contain multiple atomic commits when they form one reviewable boundary.
4. Never create one PR per commit merely because commits are atomic.
5. Never mix unrelated V5 work, release preparation, `.gjc` state, formatting churn, or private artifacts into a Product4 PR.
6. Before opening a PR, inspect:
   - `git log --oneline <base>..<head>`
   - `git diff --stat <base>...<head>`
   - `git diff --check`
   - changed-file ownership and public/private boundary.
7. Use the full repository PR template and exactly one kind label (`feat`, `fix`, `docs`, `spec`, or `chore`) plus an optional area label.
8. Validation tables must contain the actual command and result. A skipped check must say `Not run — <reason>`.
9. Do not claim a PR or merge is complete until GitHub labels, CI, and merge state are verified.
10. Merge semantic PRs in dependency order, then refetch `origin/main` before the next branch.

## 7. Cold-start command sequence

Run this before touching Product4 code:

```sh
git fetch origin main
git show --no-patch --oneline origin/main
git status --short --branch
git worktree list --porcelain
```

Read these files before planning changes:

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
scripts/product4/evaluator-runner.mjs
scripts/product4/evaluator.mjs
scripts/product4/p02-runner.mjs
scripts/product4/p02-replay.mjs
scripts/product4/raw-producer.mjs
scripts/product4/github-evidence-api.mjs
scripts/product4/release-authority.mjs
scripts/verify-4.0-gates.mjs
```

Run the existing baseline checks before changing code:

```sh
node --test scripts/test/product4-*.test.mjs
pnpm --dir packages/schema test --run
pnpm --dir packages/schema typecheck
node scripts/check-public-boundary.mjs
git diff --check
pnpm check
```

Then run the production-path checks that existing unit tests do not cover:

```sh
# Verify workflow YAML and action syntax using the repository's approved CI tooling.
actionlint .github/workflows/product-4-candidate-evaluate.yml
actionlint .github/workflows/product-4-candidate-attest.yml
actionlint .github/workflows/product-4-candidate-publish.yml

# Exercise the public CLI with missing evidence and confirm fail-closed refusal.
node scripts/product4/evaluator-runner.mjs --help  # only if the CLI supports help; otherwise use the documented arg parser

# Run the synthetic dogfood only as synthetic evidence.
node scripts/product4/dogfood.mjs

# Verify the release gate refuses missing real receipts.
node scripts/verify-4.0-gates.mjs --receipt-dir <empty-temporary-receipt-dir> ...
```

Do not suppress warnings or replace a failing production-path check with a narrower unit test.

## 8. Final completion matrix

Do not mark G011 or G009 complete until every row has current evidence tied to one final source hash:

| Requirement | Required evidence | Current state |
| --- | --- | --- |
| C never executes on host | Workflow source + sandbox execution trace/static test | Blocked until B1 is fixed |
| Sandbox claims are observed/enforced | Probe fields, limits, mounts, namespace evidence | Blocked until B3 is fixed |
| Exact C/tree/workspace/CLI | Current content/tree/dirtiness checks and adversarial tests | Re-audit required |
| Deterministic P02 | Equal full replay evidence with distinct IDs | Re-audit evaluator path; B4 known blocker |
| Independent protocol evidence | Base-owned real module/API observations | Missing; current default refuses |
| Exact GitHub API | Complete suites/runs, terminal success, one exact run, fresh PATCH GET | Re-run B7 matrix |
| Canonical attestation provenance | Sealed envelope, issuer/provenance/source/evidence binding | Re-audit after B2/B6 |
| Publisher C/artifact/run binding | Current workflow and publisher tests | Landed in #221; reverify |
| Authority freshness/schema | External receipt, current-time freshness, schema alignment | Code landed; live authority absent |
| Install/release readiness | Exact artifact receipt and release-gate Defer/ready evidence | G008 Defer only |
| Package identity | `4.0.0` version/changelog identity | Current package is `3.2.0` |
| Human approval/authority | Independent authority and approval receipts | Missing |
| Final cohort | Fresh architect + red-team + cleaner + critic, all current hash | Not run on post-fix source |

## 9. Hard stop conditions

Stop and report `BLOCKED`/`DEFER`, rather than inventing evidence, when any of these occurs:

- No independent authority/approval/credential/live receipt.
- Any candidate code runs outside the sandbox.
- Any claimed sandbox control is not actually observed.
- Any trusted predicate comes from a caller-supplied object, static fixture, or self-digest.
- Any API response is incomplete, nonterminal, non-success, duplicate, identity-incomplete, or lacks fresh lost-response reconciliation.
- Any source/tree/C/workspace/attestation identity is ambiguous.
- Any release gate is bypassed, deleted, self-asserted, or not independently verified.

A green synthetic test suite cannot override a hard stop.

## 10. Handoff completion receipt

At the end of the Grok session, record:

- Baseline SHA and final SHA.
- Every semantic PR number, title, base/head, labels, merge SHA, and validation results.
- The final filtered Product4 source diff SHA-256.
- Full test/CI commands and results.
- Fresh architect/red-team/cleaner/critic verdicts.
- Release-gate decision (`ready` or `defer`) and the exact reason.
- Whether any human-owned receipt remains missing.

Update the local durable ultragoal ledger only through the goal workflow. Do not copy ignored `.gjc` state, private paths, credentials, runtime database exports, or private transcripts into this document or any PR.
