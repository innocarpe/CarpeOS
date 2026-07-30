# v1.0.0 Readiness

Status: **tracking checklist** for the first stable **public contract** freeze
(`1.0.0` packaging layer).

**Product completion** is defined separately. Contract freeze alone is **not**
enough to ship `1.0.0`.

Related:

- **[Product 1.0.0 DoD](product-1.0.0.md)** — **source of truth** for the core
  product loop (capture → evidence → meaningful units → search) before freeze
- [Versioning and Releases](versioning-and-releases.md) — SemVer rules + freeze surfaces
- [Release Readiness](release-readiness.md) — per-release CI/local evidence (G008, etc.)
- [v1 Freeze Decision](v1-freeze-decision.md) — human Approve / Defer for the tag
- Public package: `@innocarpe/carpeos`

## What 1.0.0 means

**Product meaning (SSOT):** see **[product-1.0.0.md](product-1.0.0.md)**. In short:
the core loop (setup installs capture, evidence lands, Observation/Claim are
derived, search/context-pack return those units, migrations safe, product E2E +
scenarios pass) must work **before** packaging freeze and tag.

**Contract meaning (this doc):** once the product loop is green, `1.0.0` also
freezes the **public contract**. After that tag, breaking changes on frozen
surfaces require a **MAJOR** bump.

Contract freeze is **necessary packaging at the end**, not sufficient product
completion. GraphRAG, multi-Mac polish, hosted public edge, and production
embeddings remain non-goals; **capture install + meaningful-unit extraction +
retrieval of those units** are **in** the product DoD (not optional UX fluff).

## Contract surfaces (must freeze)

| Surface | Freeze commitment |
| --- | --- |
| CLI commands + flags | Documented commands keep behavior or get deprecation windows |
| MCP tool names + JSON | Agent-facing tools do not rename/reshape without MAJOR |
| Setup / env / home layout | `carpeos setup *`, `CARPEOS_*`, `~/.carpeos` stay compatible |
| Local store / events | Existing homes upgrade via migrations; no silent wipe |
| Trust-zone + visibility | `tz_*` ids and `--visible-trust-zone` semantics hold |

## Gate checklist

Update the **Status** column as work lands. Status values: `done` · `partial` ·
`todo` · `n/a`.

| # | Gate | Status (as of G8 inventory PR) | Evidence / notes |
| --- | --- | --- | --- |
| G1 | Clean-machine install: `npm i -g @innocarpe/carpeos` + `carpeos setup plan` + `run --apply` + `doctor` | **done** | Clean-profile recheck on **0.2.1** recorded in [v1-freeze-decision.md](v1-freeze-decision.md) (2026-07-30) |
| G2 | CLI + setup expose complete `--help`; README matches reality | **done** | Root/command help (0.1.2+), setup help, README install paths aligned |
| G3 | `carpeos version` reports published package version | **done** | `carpeos version` / `-V`; npm build embeds package version (`0.2.1` verified) |
| G4 | Exit codes documented (help + this doc) | **done** | Root `--help` + table below |
| G5 | MCP smoke (list / search / context-pack) documented + CI or scripted gate | **done** | `pnpm smoke:mcp` (`scripts/smoke-mcp.mjs`) + CI step “Run MCP smoke (G5)” |
| G6 | Local store migration story written; no silent wipe of existing homes | **done** | [`docs/architecture/local-store-migrations.md`](../architecture/local-store-migrations.md) + preserve-events test |
| G7 | MCP tool contract inventory (names + schema versions) frozen in docs | **done** | [`docs/contracts/mcp-tools-v1.md`](../contracts/mcp-tools-v1.md) + JSON + `tool-inventory.test.ts` |
| G8 | No open “will rename soon” breaks in CHANGELOG / known issues | **done** | [`compatibility-and-deprecations.md`](compatibility-and-deprecations.md) — planned breaks empty |
| G9 | Maintainer decision recorded (PR or release notes) to cut `v1.0.0` | **partial** | [v1-freeze-decision.md](v1-freeze-decision.md): **Defer** recorded 2026-07-30; Approve when soak criteria met |

## Explicit non-goals for 1.0

These may remain incomplete at `1.0.0` and ship later as `1.x` MINOR.
Canonical list + rationale: **[product-1.0.0.md](product-1.0.0.md)**.

- GraphRAG / multi-hop recall completeness
- Hosted Cloudflare as a **public** product edge
- Cross-Mac sync “just works” polish
- Production embedding providers (beyond deterministic local-dev)
- Logging every PostToolUse by default

**Not** non-goals for product 1.0 (required by product DoD):

- Capture hooks installable via official product setup path
- Evidence → Observation/Claim extraction (MVP heuristics OK)
- Search / context-pack returning meaningful units first-class

## Exit codes (public CLI)

Documented for automation. JSON errors still go to stderr when applicable.

| Code | Meaning |
| --- | --- |
| `0` | Success; also help/version plain success paths |
| `1` | Retryable operational failure (e.g. some sync retries) or internal error |
| `2` | Invalid usage / validation / missing required flags |
| `3` | Idempotency conflict (explicit key reused with different content) |
| `4` | Non-retryable sync / remote block |

`capture-hook --fail-open` may return `0` with a JSON **warning** on stderr when
capture fails, so the host agent can continue.

## How to advance this checklist

1. Prefer small PRs that flip one row `todo` → `done` with linked tests/docs.
2. When cutting any `0.y.z` release that improves a gate, update the Status column
   in the same PR (or the release PR).
3. Tag `v1.0.0` only when **product DoD** on
   [product-1.0.0.md](product-1.0.0.md) is green (or consciously waived),
   **G1–G9** here are `done` (or consciously `n/a` with written rationale),
   **and** a maintainer records **Approve** in
   [v1-freeze-decision.md](v1-freeze-decision.md).

## G1 recheck procedure (each public release)

On a machine with Node ≥ 22.22 (or a clean temp profile):

```sh
npm install -g @innocarpe/carpeos@<version>
carpeos version
carpeos setup plan
carpeos setup run --apply
carpeos setup doctor
pnpm smoke:mcp   # from a git checkout of the same tag (monorepo gate)
```



### Maintainer helper (optional)

From a monorepo checkout (after `pnpm install` / build as needed):

```sh
npm install -g @innocarpe/carpeos@<version>
pnpm g1:recheck -- --version <version>
# or: node scripts/g1-recheck.mjs --version <version>
# monorepo smoke is included; use --skip-smoke for install-only
```

Record version, OS, and pass/fail in the release PR or freeze decision.

## G2 doc sync checklist

When changing CLI/setup/MCP surfaces:

- [ ] `carpeos --help` / `carpeos setup --help` match behavior
- [ ] Root README EN/KO install snippets
- [ ] `packages/carpeos/README.md`
- [ ] Relevant `docs/guides/*` and contracts if MCP-shaped

## Suggested 1.0 CHANGELOG shape

```markdown
## [1.0.0] - YYYY-MM-DD

### Notes

- First stable public contract for CLI, setup, MCP tools, and local store layout.
- Breaking changes after this release require a MAJOR bump.
```

## Current recommendation

Stay on **`0.y.z`** (current public line: **`0.2.2`**). Contract gates G1–G8 are
largely done; G9 remains **Defer**. **Product loop gates** on
[product-1.0.0.md](product-1.0.0.md) are still open (capture-as-setup, extraction,
meaningful retrieval, product E2E). Do **not** cut `1.0.0` until product DoD +
contract freeze + explicit maintainer **Approve**.
