# v1.0.0 Freeze Decision (template)

Status: **G9 template** — fill and merge (or attach to the `v1.0.0` release PR)
when maintainers deliberately cut the first stable contract.

Do **not** treat `node scripts/release.mjs major` as the decision. The decision
comes first; the tag follows.

## Decision

| Field | Value |
| --- | --- |
| Decision | ☐ Approve `1.0.0` contract freeze · ☐ Defer |
| Date (UTC) | YYYY-MM-DD |
| Decider(s) | |
| Package version to ship | `1.0.0` |
| Git tag | `v1.0.0` |
| Based on commit SHA | |

## Gate sign-off

Copy status from [v1-readiness.md](v1-readiness.md) at decision time:

| Gate | Status | Notes / evidence link |
| --- | --- | --- |
| G1 install | | |
| G2 help/docs | | |
| G3 version | | |
| G4 exit codes | | |
| G5 MCP smoke | | |
| G6 migrations | | |
| G7 MCP inventory | | |
| G8 deprecations clear | | [compatibility-and-deprecations.md](compatibility-and-deprecations.md) |
| G9 this document | **done** when merged/approved | |

## Freeze commitment (what we will not break without MAJOR)

- CLI commands/flags documented in `carpeos --help` and setup help
- MCP tools in [mcp-tools-v1](../contracts/mcp-tools-v1.md)
- Setup/env/`~/.carpeos` layout and migration policy
- Trust-zone + visibility semantics

## Known deprecations retained at 1.0

List from compatibility inventory (e.g. `--yes` alias). Confirm each has a
preferred replacement and post-1.0 removal policy.

|

## Explicit non-goals still open after 1.0

(GraphRAG, hosted edge, production embeddings, full capture hooks, …)

|

## Release actions after approval

```sh
# after main is green at the freeze commit
node scripts/release.mjs 1.0.0
# PR + merge if required by branch protection
git push origin v1.0.0   # triggers npm publish + GitHub Release
```

CHANGELOG must include a `## [1.0.0]` section with a **Notes** bullet that this
is the first stable public contract.

## Signatures / ack

| Name | Ack |
| --- | --- |
| | ☐ |
