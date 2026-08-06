# Product 4.0.0 — remaining checklist (post-#234 / preflight)

**Updated:** 2026-08-06  
**Purpose:** Parallel handoff while isolation / residual sandbox PRs finish.  
**Not a release approval.** Release remains fail-closed without human authority.

## Already on `main` (code plane)

| Item | Evidence |
| --- | --- |
| Evaluator C binding (strict P02, `evaluated_at`, roots) | #232 |
| Observed sandbox probe + receipt requires probe object | #234 (+ follow-up fixes) |
| GitHub path/HTTP adversarial residual | #235 |
| Local parallel preflight gate | #239 (`make preflight` / `pnpm preflight`) |

Package identity remains **`3.2.0`** (`packages/carpeos`). G008 readiness stays **Defer** unless a new ready receipt exists.

## Open / in flight

| PR | Role | Action |
| --- | --- | --- |
| **#231** isolate raw candidate execution | **B1** host isolation | Rebased onto main with observed probe + `CI=true` / `confirmModulesPurge=false`. Wait for GHA Checks **and** raw-evidence green, then merge. |
| **#238** require observed sandbox proof | Stricter residual vs #234 | Conflicting; overlaps #234. Prefer **close or restack after #231** — do not merge as-is. |

## After #231 merges (code plane “done enough” for 5.0 waiters)

1. `git fetch origin main && make preflight` on a clean checkout.  
2. Path-gated Product 4 workflows green on a product4-touching PR (or re-run).  
3. Optionally close #238 or open a slim residual PR only for identity/root extras not in #234.  
4. Record final Product4 source hash for any cohort review.

**This is still not `v4.0.0` release.**

## Release plane (G009) — separate from open code PRs

Do **not** claim 4.0.0 complete until:

| Gate | Status |
| --- | --- |
| Version / changelog identity `4.0.0` | Missing (still 3.2.0) |
| Independent authority receipt | Missing |
| Human approval | Missing |
| Live credentials / settings (if required by plan) | Missing |
| Production base-owned protocol evidence (or explicit Defer) | Default provider still fails closed |
| Fresh architect / red-team / cleaner / critic on final hash | Not run |
| Release-gate decision `ready` | Currently Defer-class without receipts |

Tag / npm publish require **explicit maintainer authorization** after the above.

## Agent rules while PRs are blocked

1. Run `make preflight` (or `pnpm preflight:pr`) before every push/PR update.  
2. One owner per branch for force-push; no parallel force-push wars on #231/#238.  
3. Prefer fixing **#231** first; treat #238 as optional residual.  
4. Linux-only failures (`bwrap`, pnpm-in-sandbox) are not proven by macOS preflight — always re-check raw-evidence job.

## Suggested merge order

```text
#231 green → merge
→ close or restack #238
→ (optional) release-prep PR only with authority
→ 5.0.0 release work unblocked for “4.0 code plane”
```

## Release packaging status

- Package version target for this cut: **4.0.0** (`packages/carpeos/package.json`, `CHANGELOG.md`).
- Live independent authority / approval may still be **Defer** for operational
  activation; package SemVer 4.0.0 ships the Product 4 **code plane**.
- Residual #238-style hardening may land in **4.0.1** / **4.1.0**.
