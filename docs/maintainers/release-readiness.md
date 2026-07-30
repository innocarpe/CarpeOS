# Release Readiness

Status: G008 release-readiness checklist. Public repository only.

This checklist is for maintainers preparing a CarpeOS release or milestone PR.
It prevents local proofs, CI proofs, and hosted deployment proofs from being
collapsed into one claim.

For **npm + Git tag SemVer**, see
[Versioning and Releases](versioning-and-releases.md).

For the **first stable `1.0.0` product + contract** milestone, see:

- **[Product 1.0.0 DoD](product-1.0.0.md)** — core product loop (source of truth)
- [v1 Readiness](v1-readiness.md) — public contract freeze packaging gates
- [v1 Freeze Decision](v1-freeze-decision.md) — human Approve / Defer

## G008 Verified Evidence

The G008 documentation slice may cite only this already-proven local evidence:

- `pnpm check` passes on Node 22.22.0;
- the opt-in synthetic local Worker+D1+R2 gate passes locally:

```sh
mise exec node@22.22.0 -- pnpm check
mise exec node@22.22.0 -- pnpm --filter @carpeos/sync-worker test:e2e
```

This evidence proves a synthetic local path only. It does not prove hosted
Cloudflare resources or cross-Mac live operation.

GitHub CI is configured to run this named gate as a separate step after
`pnpm check`. Until the PR workflow reports success for that step, describe it
as a configured CI gate and locally verified command, not completed remote CI
evidence.

## Required Local Checks

Run and record exact results before a release-ready PR is marked ready:

| Command | Required before release-ready claim |
| --- | --- |
| `pnpm format:check` | Yes |
| `pnpm lint` | Yes |
| `pnpm build` | Yes |
| `pnpm typecheck` | Yes |
| `pnpm test` | Yes |
| `pnpm public-boundary` | Yes |
| `pnpm check` | Preferred aggregate check |
| `pnpm smoke:mcp` | Yes for G5 MCP smoke (tool list / search / context-pack); CI step “Run MCP smoke (G5)” |
| `pnpm --filter @carpeos/sync-worker test:e2e` | Yes for G008 local end-to-end evidence and configured CI gate evidence |

If a command is skipped, the PR must say why and must not claim that evidence.

Label verification is manual. Use `.github/labels.json` and
[GitHub Label Policy](github-labels.md); this repository does not define a
`labels:check` script or required label CI contract.

## CI Evidence

Future CI evidence must include:

- commit SHA under test;
- workflow name;
- check conclusion;
- Node and pnpm versions;
- whether the opt-in G008 local e2e test ran in CI or only locally.

Green local checks are not CI proof.

## Deployment Evidence

The public repository currently states **NOT DEPLOYED** for hosted operation.
Before claiming deployment, maintainers need private operator evidence for:

- Worker URL;
- D1 database binding and applied migrations;
- R2 bucket binding;
- authorization hash seeded in D1;
- no raw bearer credential committed or printed;
- bounded `sync once` success against the hosted Worker;
- read-only verification that synced metadata and encrypted blob receipts exist;
- rollback or disable procedure.

Without that evidence, the release notes must say:

```text
NOT DEPLOYED: no hosted Worker, D1/R2 production resources, package publish,
private vault adoption, hosted MCP, or cross-Mac live deployment is proven.
```

## Public-Data Hygiene

Before release:

- run `pnpm public-boundary`;
- scan new docs and fixtures for local absolute paths, private project names,
  credentials, real deployment IDs, runtime exports, private repository URLs,
  and production logs;
- keep all examples fictional and generic;
- keep private bug reports reduced to synthetic reproductions.

## README Parity

When `README.md` changes, update `README.ko.md` with equivalent substance.
Equivalent substance means matching:

- implementation status;
- NOT DEPLOYED boundaries;
- verification claims;
- guide links;
- source inspiration attribution.

The Korean README does not need line-for-line translation, but it must not
claim more or less than the English README.

## Release Stop Conditions

Do not mark a release or PR as ready when:

- public-boundary fails;
- generated docs mention a real private path, project, token, deployment ID, or
  runtime export;
- CI has not run but the PR claims CI proof;
- local synthetic e2e is presented as hosted deployment proof;
- deployment status is ambiguous;
- README EN/KO status claims diverge;
- an implementation/test/schema change lacks matching docs or tests.
