# Product 4.0.0 — release and activation receipt

Status: **Package plane released and activated.** Published as npm
`@innocarpe/carpeos@4.0.0`, annotated tag `v4.0.0`, non-draft
[GitHub Release](https://github.com/innocarpe/CarpeOS/releases/tag/v4.0.0).
Local global install reports `4.0.0` and real-home `carpeos setup doctor` passes.

This receipt does **not** claim live independent release authority, App/settings
ownership, or human-approved correction **apply** writers. Those remain out of
band / fail-closed by design for this cut.

Related: [PRD-v4](../PRD-v4.md) · [PRD index](../PRD.md) ·
[versioning](versioning-and-releases.md) ·
[major release surface](major-release-surface.md) ·
[CHANGELOG 4.0.0](../../CHANGELOG.md)

## Product claim (honest)

| Plane | Claim |
| --- | --- |
| Public package | **Shipped** — trust/evidence plane contracts and scripts on `@innocarpe/carpeos@4.0.0` |
| Product 4 thesis (full governed correction lifecycle with live authority) | **Partial** — evidence/evaluator/publisher contracts landed; apply authority and live credentials not invented |
| Hosted deployment | **Not claimed** |

Major product claim (CHANGELOG Notes): **Product 4 trust/evidence plane** on the
public package. Residual stricter sandbox work may follow in 4.0.1 / 4.1.0.

## What shipped in the package

- Frozen `P4_0` policy identity, candidate intent/state, migration read-oracle,
  six-command loop fixtures (synthetic, public-safe).
- Truthful P02 double-replay and fail-closed no-analog diagnosis.
- Unprivileged raw producer + base-owned evaluator with sealed trusted evidence
  (caller-supplied protocol authority refused).
- Exact-C GitHub evidence API guards (pagination, identity, duplicate/lost
  reconciliation, path/HTTP refusal).
- Publisher binding + release-authority freshness schemas (fail-closed without
  independent live authority).
- Observed bubblewrap sandbox probe/receipt + host isolation on the evaluate
  trust-plane workflow (**workflow_dispatch-only** until ownership activation).
- Local preflight gate (`make preflight` / `pnpm preflight`).

## Explicit non-claims

| Item | Status |
| --- | --- |
| Independent live release-authority receipt | Out of band; gate may **defer** while package publishes |
| Human approval / App / ruleset ownership as runtime authority | Not invented by this package cut |
| B1 apply/writer / Supersession auto-apply | Deferred (3.2 boundary preserved) |
| Automatic Claim or AcceptanceDecision creation | Still off |
| Every-PR Product 4 bubblewrap | Not default; trust plane is dispatch-only |
| Product 5 draft lane as this major | Unreleased / separate cut |

## Release and activation evidence (public-safe)

| Gate | Evidence |
| --- | --- |
| Version identity | `packages/carpeos/package.json` → `4.0.0`; CHANGELOG `## [4.0.0] - 2026-08-06` |
| Tag | annotated `v4.0.0` on main after gate-defer exit fix (#252) and artifact upload fix (#253) |
| Release workflow | green — gate job + Publish npm + GitHub Release |
| npm | `@innocarpe/carpeos@4.0.0` |
| GitHub Release | https://github.com/innocarpe/CarpeOS/releases/tag/v4.0.0 |
| Local activation | `npm i -g @innocarpe/carpeos@4.0.0`; `carpeos --version` → 4.0.0; real-home doctor PASS |

## Gate notes

- Product 4 release gate `defer` is a **successful evaluation** of missing live
  authority (exit 0 for packaging after #252). Do not treat defer as “failed
  product” or invent ready receipts.
- `actions/upload-artifact@v4` requires `include-hidden-files: true` for
  `.release-artifact` (#253).

## Follow-ups

- 4.0.1 / 4.1.0: residual sandbox hardening if needed.
- Live authority activation remains a separate ownership track.
- Product 5.0.0 draft-lane cut is independent (see [product-5.0.0.md](product-5.0.0.md)).
