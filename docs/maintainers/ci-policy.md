# CarpeOS CI Policy

**Audience:** maintainers and every agent harness (Claude Code, Codex CLI,
Grok Build, Gajae Code/GJC).  
**Skill:** [`skills/carpeos-ci/SKILL.md`](../../skills/carpeos-ci/SKILL.md)  
**Install:** `./scripts/install-ci-skill.sh`

This document is the **source of truth** for how GitHub Actions and local
check scripts are designed, budgeted, and extended. Implementation files
(`.github/workflows/*`, `package.json` scripts) must follow this policy; do not
grow CI ad hoc from a single PR’s convenience.

---

## 1. Context and goals

CarpeOS is a **solo-maintained**, local-first public monorepo. Most changes are
made by AI agents in short loops. CI exists to:

1. **Fail closed** on quality, public-boundary, and secret leaks.
2. Stay **fast enough** that PR feedback does not dominate iteration.
3. Keep **deep / expensive** validation available without taxing every push.

CI does **not** exist to:

- re-run the same monorepo build under a new step name;
- simulate Product 4 live trust activation before ownership/App receipts exist;
- turn every milestone experiment into a required green check.

---

## 2. Lanes

| Lane | When | Purpose | Default budget (wall clock, ubuntu-latest, warm cache) |
| --- | --- | --- | --- |
| **PR lean** | every `pull_request` | merge-blocking quality | **target ≤ 2 min**, review required if **> 3 min** |
| **Main full** | `push` to `main` (and optional scheduled) | deeper integration / smoke / e2e | **target ≤ 5 min**, review if **> 8 min** |
| **Trust / release plane** | explicit product activation or release paths | Product 4 evidence, release authority | **not** default PR required; cost justified by the plane |
| **Local** | agent / human **before push / PR** | parallel PR-lean preflight (`make preflight`) | target ≤ PR lean; fail closed locally |

PR lean and Main full may share job definitions with `if:` conditions, or use
separate jobs. Prefer **one workflow file with clear lanes** over copy-pasted
workflows.

### 2.1 Local preflight (mandatory before PR)

Agents and humans **must** run the local preflight gate before opening or
updating a PR. GitHub Actions is not a free formatter.

| Entry | Command | Notes |
| --- | --- | --- |
| Default | `make preflight` / `pnpm preflight` / `pnpm preflight:pr` | Parallel PR-lean: format∥lint∥public-boundary → build → typecheck∥test; merge-tree conflict probe vs `origin/main` |
| Fix format drift | `make preflight-fix` | `biome format --write` then preflight |
| Fast loop only | `make preflight-quick` | Not sufficient alone to open a PR |
| Sequential CI twin | `pnpm check` | Exact CI Checks step order; slower than preflight |

Implementation: `scripts/preflight.mjs`. Skills: `carpeos-pr` (hard gate),
`carpeos-ci` (local verification). Preflight does **not** claim Linux-only
parity (Product 4 bubblewrap sandbox, Gitleaks).

---

## 3. What belongs in each lane

### 3.1 PR lean (required by default)

Keep this set small and non-duplicative:

| Check | How | Notes |
| --- | --- | --- |
| Format | `pnpm format:check` (Biome) | cheap |
| Lint | `pnpm lint` | cheap |
| Build | `pnpm build` | monorepo once |
| Typecheck | `pnpm typecheck` | monorepo once |
| Unit / contract tests | `pnpm test` | includes package tests + `scripts/test/*.test.mjs` |
| Public boundary | `pnpm public-boundary` | public repo invariant |
| Secret scan | `secret-scan.yml` (Gitleaks) | separate workflow OK |

`pnpm check` is an acceptable **single** PR step when it equals the above and
does not pull smokes/e2e.

### 3.2 Main full (deeper, not every PR)

Examples that belong here (or on schedule), **not** on every PR by default:

- capture / retrieval **eval** scripts that re-build already-built packages;
- `pnpm smoke:dogfood`, `smoke:mcp`, `smoke:product`, `smoke:knowledge`;
- `@carpeos/sync-worker` E2E;
- any multi-minute integration that needs network or long process trees.

### 3.3 Trust / release plane (gated)

Product 4 workflows (`product-4-candidate-*.yml`) and release credential paths:

- implement **PRD trust separation** (unprivileged raw → base-owned attest →
  data-only publish);
- are **not** a substitute for PR lean;
- must not become required merge checks until ownership / App / ruleset
  activation receipts exist and the plane is intentionally turned on;
- until then prefer **unit/contract tests** of the same logic over live GHA cost;
- may be disabled, path-filtered, or `workflow_dispatch`-only without abandoning
  the Product 4 design (scripts + schemas remain the contract).

Release publish (`release.yml`) stays **tag / explicit release** only. Never
wire live npm or signing credentials into PR workflows.

---

## 4. Non-negotiable design rules

1. **No duplicate work after a successful full build/test.**  
   If `pnpm check` (or build+test) already built package X, do not rebuild X in
   the next step solely to run a short eval—fold the eval into the package test
   graph or run it only on main full.

2. **Job-level `env` must not use the `runner` context.**  
   `${{ runner.temp }}` is valid in step `with:` / `run:`, or via a setup step
   writing `GITHUB_ENV`. Job-level `runner.*` makes the workflow file **invalid**
   and floods Actions with 0s failures.

3. **Invalid workflow file = P0.**  
   Parse/validation failures (0 jobs, path-as-name, “workflow file issue”) block
   trust in the Actions UI and must be fixed or the workflow removed—do not leave
   them as permanent red noise.

4. **Prefer tests over new workflows.**  
   New policy should land first as `node:test` / package tests. A new
   `.github/workflows/*.yml` needs a written lane assignment and budget impact.

5. **Fail closed, stay public-safe.**  
   No secrets in logs, no private paths, no production dumps. Public-boundary and
   secret scan stay in the default PR lane.

6. **Required checks are intentional.**  
   Do not add branch-protection required contexts casually. Product 4 check names
   are frozen contracts only after activation policy says so.

7. **Same commands locally and in CI.**  
   Agents verify with the same `pnpm` / `node --test` entrypoints CI uses. Do not
   invent CI-only bash that cannot be run from a checkout.

8. **Harness-neutral.**  
   Policy lives in-repo. Claude Code, Codex CLI, Grok Build, and Gajae Code all
   load `skills/carpeos-ci` and this doc—no tool-specific CI rules.

---

## 5. Adding or changing CI (change gate)

Before editing `.github/workflows/*` or expanding `pnpm check` / CI steps, answer
in the PR body (or stop and ask):

| # | Question | Fail closed if… |
| --- | --- | --- |
| 1 | Which **lane**? (`pr-lean` / `main-full` / `trust-release` / `local-only`) | unclear |
| 2 | What **failure mode** does this catch that existing tests miss? | “nice to have” only on PR lean |
| 3 | **Duplicate** of build/typecheck/test already in the lane? | yes → do not add |
| 4 | Expected **added wall time** (order of magnitude)? | PR lean would exceed 3 min without explicit approval |
| 5 | Can this be a **package or `scripts/test` test** instead? | yes and cheaper → prefer tests |
| 6 | Does it need **secrets, network, or privileged tokens**? | yes on PR lean without isolation story |
| 7 | Workflow YAML: any **job-level `runner.*`** or invalid context? | yes → reject |
| 8 | Trust plane: is **activation** complete enough for required checks? | no → keep non-required / off |

### Allowed PR titles / kinds for CI work

- Kind label: usually `chore` (tooling) or `fix` (broken CI).
- Area: `infra` when it helps discovery.
- Conventional subjects: `chore(ci): …`, `fix(ci): …`.

---

## 6. Current vs target shape

**Target (policy):**

```text
PR:     secret-scan + Checks(pnpm check ≈ format/lint/build/typecheck/test/boundary)
main:   PR set + smoke/* + selected e2e/evals (no redundant rebuilds)
trust:  Product 4 evaluate/attest/publish only when plane is intentionally active
```

**Historical problem (2026-08 investigation):**

- PR `ci.yml` ran `pnpm check` (~90s) **plus** rebuild/eval steps **plus** four
  smokes **plus** sync-worker e2e → ~3–4 minutes on every PR.
- Product 4 candidate workflows were invalid (job-level `runner.temp`) and
  produced large numbers of 0s “workflow file issue” failures without providing
  merge protection.
- Unit/contract tests already covered most Product 4 logic; live GHA plane was
  scaffolding ahead of activation.

Migrations that reduce PR time or remove invalid workflows are **in policy**, not
“dropping quality.” Quality moves to the correct lane.

---

## 7. Workflow authoring checklist

When writing or reviewing workflow YAML:

- [ ] `on:` matches the lane (PR vs main vs `workflow_run` vs dispatch).
- [ ] Permissions are least privilege (`contents: read` default).
- [ ] No job-level `${{ runner.* }}`.
- [ ] Action majors exist and match peers where practical (do not invent tags).
- [ ] After `pnpm check` / full build, no gratuitous rebuild of the same packages.
- [ ] Artifacts named without leaking private data; retention short for temp evidence.
- [ ] Trust workflows: candidate code never receives privileged credentials;
  publisher never executes candidate payloads.
- [ ] Contract tests updated when workflow shape is load-bearing
  (`scripts/test/product4-workflows.test.mjs` or successors).

---

## 8. Operating rhythms

| Event | Action |
| --- | --- |
| PR opened / pushed | PR lean must be green before merge when protection is enabled; agents fix lean failures first |
| Merge to main | Main full may run longer; failures are high priority but do not imply every check belongs on PR |
| New product plane (e.g. Product N) | Land tests first; add GHA only with lane + budget table in the PR |
| CI wall time creeps up | Open a `chore(ci):` PR to re-home steps to main-full or tests; do not only “optimize YAML comments” |
| Invalid workflow red noise | Fix or disable the workflow the same day; do not ignore |

---

## 9. Related artifacts

| Artifact | Role |
| --- | --- |
| `.github/workflows/ci.yml` | Primary Checks job (must match lanes) |
| `.github/workflows/secret-scan.yml` | PR/main secret scan |
| `.github/workflows/product-4-candidate-*.yml` | Trust plane (gated) |
| `.github/workflows/release.yml` | Release only |
| `package.json` `scripts.check` / `test` / `smoke:*` | Local and CI entrypoints |
| `skills/carpeos-ci/SKILL.md` | Agent operating procedure |
| `skills/carpeos-pr/SKILL.md` | PR body must list real CI commands |
| `skills/carpeos-release/SKILL.md` | Release path (not PR CI) |

---

## 10. Change control for this policy

- Edit this file and the skill together when lane budgets or defaults change.
- Say so explicitly in the PR Why section.
- Do not silently move smoke/e2e back onto every PR “just this once.”
