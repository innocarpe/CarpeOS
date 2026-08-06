# Changelog

All notable changes to the public package **`@innocarpe/carpeos`** are documented
in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versioning policy: [docs/maintainers/versioning-and-releases.md](docs/maintainers/versioning-and-releases.md).

## [Unreleased]

### Added

- **P4 link / graph density** (Product 6.2 path):
  - E6 deterministic structure/link: `derived_from` + `about` edge proposals (optional
    `supports` to sibling units); no free `related` spam.
  - Materialize writes structured provenance + subject so `graph_v2` rebuild densifies
    `meaning_unit` nodes (required lineage).
  - `computeGraphDensityMetrics` / uplift gate; CLI `carpeos agentic graph-metrics`.
  - Product path `agentic run --materialize` invokes E9 retrieval+graph rebuild hook.
  - Still never auto-creates `AcceptanceDecision`; graph remains projection-only.

## [6.1.0] - 2026-08-07

### Added

- **P3 narrow auto-promote precision suite** (offline, fake stages):
  - Precision ≥ 0.90 with zero `must_not_promote` leaks over golden-12.
  - `carpeos agentic precision` for suite receipt.
  - Gate: allowlist kinds + E5 + confidence floor when `--allow-auto-promote`.
  - Default product path remains **hold-first**; auto-promote is explicit opt-in only.
  - Still never creates automatic `AcceptanceDecision`.

### Notes

- Does not claim full Product 6 thesis (P4–P6 residual: links density, draft Claims, GraphRAG).


## [6.0.0] - 2026-08-07

### Added

- **Product 6.0.0 Agentic Layer (hold-first brain)** — post-capture write-time knowledge plane
  under ADR 0017, without LLM in capture and without automatic `AcceptanceDecision`:
  - `@carpeos/agentic`: durable jobs (lease state machine), stage digests, E1 rule admit,
    E2 redact/EvidencePack (reuses `@carpeos/v5`), E3/E4 triage+extract (offline **fake**
    default; live **`deepseek-v4-flash`** via DeepSeek Direct when explicitly allowed),
    E5 deterministic verify, `agentic_v1` gate (hold-first), proposal records
    (`canonical_effect: none` until materialize), materialize draft Observation +
    disposition, golden-12 offline suite.
  - Local-store **`agentic_capture_feed`**: post-commit feed insert only (fail-open;
    no network/LLM/await inside capture).
  - Runner: `processAgenticOnce` drains feed → pipeline → optional materialize; job
    lease audit trail; E6 `derived_from` lineage markers; optional E9 project hook.
  - CLI: `carpeos agentic status|run|golden|list-held|materialize`
    - Product path: `carpeos agentic run --once --materialize`
    - Live Flash: `--allow-network` requires `DEEPSEEK_API_KEY` + spend cap (network
      off by default)
    - Kill switch: `CARPEOS_AGENTIC=0|off` (skips feed + runner)

### Safety

- Capture path never calls LLM or awaits agentic jobs.
- Real model id freeze: **`deepseek-v4-flash` only** (no multi-model escalation).
- No automatic `AcceptanceDecision`; no LLM-only Supersession.
- V5 remains draft cortex (`canonical_effect: "none"`); promotion bridge is `agentic_v1`.
- Public fixtures synthetic only.

### Notes / residuals (honest hold-first major)

- **Not claimed:** full Product 6 thesis (“knowledge product finished”) or GraphRAG ranking.
- **P3 pending (target 6.1.x):** narrow auto-promote + precision suite ≥ 0.90.
- **P4–P6 pending (later minors):** denser links/graph metrics, draft Claims product path,
  GraphRAG ranking on typed promoted units.
- **E10** periodic reconcile deferred.
- Live Flash quality depends on operator credentials and spend caps; CI stays offline/fake.

## [5.0.1] - 2026-08-06

### Added

- **Multi-host setup** for capture hooks and MCP beyond Claude / Codex / Grok:
  - GJC (Gajae Code): `~/.gjc/agent/hooks/carpeos-capture.ts` + `gjc mcp add`
  - Deep Code: `mcpServers.carpeos` in `~/.deepcode/settings.json` (secrets preserved)
  - Reasonix: `reasonix mcp add carpeos`
  - DeepSeek Build (`dsb`): `~/.deepseek-build/hooks.json` prepared (MCP CLI deferred)
  - `capture-hook --provider` accepts `gjc`, `deepcode`, `reasonix`, `deepseek_build`
    (aliases: `gajae`, `dsb`)
  - `carpeos setup run --register-mcp auto --register-hooks auto` detects hosts on PATH

## [5.0.0] - 2026-08-06

### Added

- **Product 5.0 draft lane (opt-in)** behind `@carpeos/v5` and `carpeos v5`:
  - Offline contracts M0–M7: redaction, EvidencePack, reducer oracle, attempts/review
    sidecar, local TELEMETRY_DB store + SQL migration, frozen all-200 evaluation.
  - End-to-end draft pipeline (`runDraftPipeline` / `carpeos v5 draft`):
    redact → pack → extract → draft reduce → eval.
  - **DeepSeek Direct primary** extract route (`deepseek-v4-flash` @
    `https://api.deepseek.com`); network **off by default**; OpenRouter optional and
    **not required**.
  - Operator CLI: `carpeos v5 status|readiness|eval-all200|draft|m8`.
  - Live cost experiment runner (`packages/v5/scripts/live-cost-experiment.mjs`) with
    spend cap; credentials only via env / `~/.carpeos/v5-provider.env`.
  - M8 seam scan + final decision receipt
    (`artifacts/v5/m8/final-decision-receipt.json`): release seam **deferred** without
    inventing Product 4 release-authority acceptance; draft lane remains shippable.
  - ADR 0016 (draft-only + DeepSeek primary), PRD-v5, product-5.0.0 DoD.

### Safety

- Every V5 record remains `canonical_effect: "none"`.
- Capture hot path is **not** wired to LLM/network.
- schema-v1, adj_v3, and canonical migrations are unchanged.
- PRD-v4 / Product 4 remains independently releasable; V5 does not gate 4.0.0.
- V5-off is a valid fallback (disable opt-in; capture/canonical continue).

### Notes

- This major is the **draft-lane** product cut. It does not claim hosted Cloudflare
  Worker telemetry deploy or a completed Product 4 release-authority seam.
- Public package base is **4.0.0** (Product 4 shipped: tag + npm + GitHub Release).
  Intended SemVer cut for this major is **4.0.0 → 5.0.0** when maintainer authorizes.

## [4.0.0] - 2026-08-06

### Added

- **Product 4.0 governed evidence plane** (PRD-v4 / trust-plane scripts and contracts):
  - Frozen P4_0 evaluator policy identity, candidate intent/state, migration
    read-oracle, and six-command loop receipts (synthetic, public-safe fixtures).
  - Truthful P02 double-replay with deterministic equality, zero-write mutation
    probes, and fail-closed no-analog diagnosis.
  - Unprivileged raw candidate report producer and base-owned evaluator runner
    with sealed trusted-evidence envelopes (caller-supplied protocol authority
    refused).
  - Exact-C GitHub evidence API guards: suite/run pagination, identity binding,
    duplicate refusal, lost POST/PATCH reconciliation, path/HTTP error refusal.
  - Publisher C/artifact/run binding and release-authority freshness schemas
    (fail-closed without independent live authority).
  - Observed bubblewrap sandbox probe/receipt contract (measured controls; not
    claim-only static digests).
  - Host isolation for candidate install/build/init inside the sandbox boundary
    on the Product 4 evaluate trust-plane workflow.
- Local **preflight** gate (`make preflight` / `pnpm preflight`) mirroring PR lean
  checks in parallel before `gh pr create`.
- Maintainer docs: Product 4 cold-start handoff and remaining checklist.

### Changed

- Product 4 live trust-plane workflows (`product-4-candidate-*`) are
  **workflow_dispatch-only** until ownership/App activation; PR quality stays on
  unit/contract tests and preflight (not every-PR bubblewrap).
- CI policy documents PR-lean / main-full / trust-release / local preflight lanes.

### Safety

- Production base-owned protocol evidence still fails closed without a trusted
  read-only provider/token; synthetic fixtures are not live authority.
- Independent release authority, human approval, and live settings receipts remain
  **out of band**; this package cut does not invent them.
- Refuse self-asserted release-authority evidence and require builder-origin binding
  for GitHub evidence adapter pages (fail closed).
- Residual stricter sandbox residual work (if any) may follow in 4.0.1 / 4.1.0
  without blocking this major.

### Notes

- Major product claim is **Product 4 trust/evidence plane** on the public package.
- Product 5 draft-lane work remains under **[Unreleased]** for a later 5.0 cut;
  V5 stays opt-in with `canonical_effect: "none"` and does not gate this release.

## [3.2.0] - 2026-08-04

### Added

- Product 3.2 pre-tag work: deterministic `adj_v3` adjudication and knowledge-form
  evaluators, policy-aware held review, retrieval-quality evaluation, and synthetic
  dogfood coverage.
- B0 bounded, metadata-only, zero-write policy-reconciliation preview with
  deterministic digest evidence and fail-closed over-limit availability advisory.

### Changed

- Preserve chronology and corrected reassertions; use exact-normalized deduplication
  and observed retrieval evaluation branches.
- Pack-once release proofs bind one manifest-backed tarball to its approved release
  SHA without publishing it.

### Safety

- B0 is preview-only. B1 apply/writer/receipt remains absent and deferred; unsafe
  entries remain unchanged.
- Automatic Claim and AcceptanceDecision writes remain disabled; unsupported apply
  flags fail before reconciliation writes.

## [3.1.0] - 2026-08-01

### Added

- OKF v0.2 export projection: mapper, rebuild handling, conformance checks,
  `carpeos okf export|rebuild` CLI, filesystem and manifest safety behavior,
  and operator guide ([ADR 0014](docs/adr/0014-okf-export-projection.md);
  [product 3.1.0 DoD](docs/maintainers/product-3.1.0.md)).

## [3.0.2] - 2026-08-01

### Fixed

- Report current `adj_v2` disposition counts from `carpeos doctor` instead of stale
  `adj_v1` counts after upgrading from 3.0.0

## [3.0.1] - 2026-07-31

### Notes

- Patch release on the 3.0 line. Fixes live-home observation quality where most
  statements were metadata shells (`Captured … SessionEnd evidence`). Does **not**
  retag or unpublish `1.0.0` / `2.0.0` / `3.0.0`.

### Fixed

- Recover knowledge candidate prose from host transcript tails (Claude-style JSONL
  under allowed local roots) when envelopes only carry `transcript_path`
- Normalize host hook aliases (`user_prompt_submit` / `stop` / …) to product
  lifecycle names so Grok/Codex captures are adjudication-eligible
- Read camelCase host payload fields (`prompt`, `transcriptPath`, …) during
  candidate/scoring extraction
- Bump adjudication policy identity to `adj_v2` so prior metadata-only dispositions
  can be re-evaluated append-only without rewriting history

### Added

- Docs-only OKF export projection design track for a future 3.1 minor (ADR 0014,
  product-3.1.0 DoD, PRD index row). Not a runtime feature in this patch.

## [3.0.0] - 2026-07-31

### Notes

- Product-meaning **MAJOR**: retrieval-first knowledge graph on top of shipped 2.0
  adjudication. Canonical events remain SSOT; graph/vector indexes are rebuildable
  projections only. Default search stays promoted/active only. Freeze packet was
  Defer, then maintainer chat **Approve** unlocked packaging. Does **not** retag
  or unpublish `1.0.0` / `2.0.0`.

### Added

- Capture identity: `project_id` partition plus worktree facet (`worktree_id` /
  `worktree_name` / `git_branch` / linked flag); absolute paths stay local-only
- Retrieval filters and ranking: `project_ids` / `worktree_ids`, same-worktree boost
- Pluggable embedding provider with offline default `local-lexical-hash`
- Rebuildable graph projection (`graph_nodes` / `graph_edges`) with lineage edges
- Deterministic entity resolution: `subject` and `decision_thread` nodes
- Bounded neighborhood walk API (`walkGraphNeighborhood`) with budgets/omissions
- MCP `memory_neighborhood` tool and inventory/contract updates
- Graph-aware hybrid ranking (seed expansion + hop-decay boost)
- Offline retrieval evaluation harness (multi-hop, isolation, false-acceptance)
- Product 3.0 DoD, ADR 0013, PRD v1–v3 series, freeze packet

### Changed

- `memory_search` semantic leg uses non-synthetic local lexical embeddings by default
- Hybrid search expands seeds through the local graph neighborhood before ranking
- CLI `retrieval embed` default provider is `local-lexical-hash`
- GraphRAG roadmap status: scheduled/executed under product 3.0 gates

### Fixed

- Sibling worktrees of one repository share project knowledge while retaining
  checkout provenance
- Unknown-origin (pre-identity) chunks are not excluded by project/worktree filters

## [2.0.0] - 2026-07-30

### Breaking

- Product meaning major: default knowledge path is **adjudicated** promote | hold | reject (`adj_v1`), not “every eligible SessionEnd becomes searchable meaning.”
- Default `memory search` / MCP retrieval surfaces **active/promoted** units only; draft/held require explicit opt-in (`--include-held` / `include_held`).
- Local store dispositions are keyed by `(source_event_id, trust_zone_id, policy_version)` with append-only history and held-review audit tables (migrations `003`–`005`).

### Added

- Knowledge adjudication MVP (`adj_v1`): candidate spans, precision-first dispositions, golden suite, and `pnpm smoke:knowledge`
- Operator held queue: `carpeos adjudicate list-held|promote-held|reject-held` (append-only, no auto-`AcceptanceDecision`)
- Policy-version re-adjudication and `carpeos adjudicate history` / `--policy-version`
- Setup/install doctor adjudication health (policy version, promote/hold/reject counts, promoted-only default search)
- Explicit held search opt-in: CLI `--include-held`, MCP `include_held`
- Public-safe multi-hook dogfood: `pnpm smoke:dogfood`
- Maintainer product-2.0 gates, freeze packet, and Claim-form defer notes

### Changed

- Capture/extract path runs post-capture adjudication; hooks stay fail-open and fast
- Doctor and EN/KO honesty: 1.0 remains pipeline infrastructure; 2.0 is operator-real adjudication MVP packaging

### Fixed

- Smoke fixtures and promoted-only search regressions after adjudication defaults
- Public-boundary-safe synthetic secret fixtures in dogfood smoke

## [1.0.0] - 2026-07-30

### Notes

- First stable **product** release for `@innocarpe/carpeos`: setup installs
  capture hooks, session evidence lands in local SQLite (encrypted raw +
  EvidenceArtifact), Observations are derived from eligible lifecycle events,
  and memory search / context-pack return meaningful units first-class on the
  local path (see `docs/maintainers/product-1.0.0.md`).
- First stable **public contract**: CLI commands/flags, setup/env/`~/.carpeos`
  layout, MCP tool names + JSON shapes (`docs/contracts/mcp-tools-v1.md`), local
  store migration policy, and trust-zone / visibility semantics (including
  documented default resolution order: flag → env → config → device default).
- Breaking changes on those surfaces after this release require a **MAJOR** bump
  (see `docs/maintainers/versioning-and-releases.md`).
- Hosted Cloudflare edge, GraphRAG, multi-Mac polish, and production embeddings
  remain **non-goals** of 1.0 and may ship later as additive `1.x` MINOR work.

### Added

- Product setup: `carpeos setup hooks plan|install|uninstall|doctor` (merge-safe
  capture hooks; absolute `~/.local/bin/carpeos` commands)
- Setup doctor: hook status, recent capture, Observation/Claim counts
  (`--require-hooks` / `--require-capture` / `--require-units`)
- README EN/KO product path: install → hooks → doctor → rebuild/search/context-pack
- Meaningful-unit extraction policy (ADR 0011; PostToolUse off by default)
- Evidence → Observation extraction MVP; CLI `capture-hook` extract default +
  `carpeos extract --event-id` (idempotent)
- Retrieval ranks Observation/Claim/decision above `evidence_excerpt`; CLI
  lifecycle filters align with MCP (`active`+`draft`)
- Product E2E gate: `pnpm smoke:product` (CI)
- Product 1.0 DoD + scenario checklist + freeze Approve gate docs

## [0.2.2] - 2026-07-30

### Added

- Retrieval: project `EvidenceArtifact` events as metadata-only
  `evidence_excerpt` chunks (kind / media_type / artifact_id / subject / event
  id — never protected raw payload), so capture → rebuild → `memory search`
  works on day-to-day homes that only have hook evidence

### Fixed

- Retrieval freshness: advance `last_indexed_zone_sequence` from scanned events
  as well as produced chunks (capture-only stores no longer stuck
  `stale:behind_sync_cursor` after a clean rebuild)
- CLI `memory search`: default `epistemic_authority` filter includes `imported`
  (and the rest of the authority set), matching MCP `memory_search` so imported
  capture evidence is not silently filtered out

## [0.2.1] - 2026-07-29

Post-`0.2.0` local/sync completeness from private dogfood (hosted Cloudflare remains
operator-private; not required for `1.0.0` per v1 readiness non-goals).

### Added

- `carpeos project identify` / `carpeos sync status`: `trust_zone_source`
  (`flag` | `env` | `config` | `device_default`) so operators can see how the
  active zone was resolved
- `carpeos outbox status` → `errors[]` and `carpeos sync status` →
  `local.outbox_errors[]` for pending/leased rows with `last_error`
- Shared PR authoring skill `skills/carpeos-pr` + `./scripts/install-pr-skill.sh`
  (Claude Code / Codex / Grok); expanded `.github/PULL_REQUEST_TEMPLATE.md`
- Cloudflare sync guide: trust-zone resolution order, status diagnosis fields,
  same-device push→pull as sequence-only replay

### Fixed

- Sync Worker: rebind `protected_value_uploads` on conflict when re-uploading
  under a different trust zone (stale wrong-zone row no longer blocks push)
- Sync client: fail closed **before network** when outbox trust zone ≠ store
  zone; release blocked leases (delay 0) instead of leaving rows stuck `leased`
- Sync client: transport failures include `HTTP {status}` in the message (no
  response bodies)
- Local store: same-origin pull treats remote-only `zone_sequence` as idempotent
  **replay** (content divergence still fails closed)
- CLI: default trust zone prefers `--trust-zone` → `CARPEOS_TRUST_ZONE` /
  `CARPEOS_MCP_TRUST_ZONE` → `config.json` `trust_zone_id` before device-derived
  `tz_local_<client>` (aligns with installer `tz_local_default`)

### Changed

- `carpeos sync status` reports `outbox_trust_zone_ids`,
  `outbox_trust_zone_mismatch`, and structured `warnings` when outbox zones
  disagree with the active store zone

## [0.2.0] - 2026-07-30

Dogfood milestone on the road to a deliberate `1.0.0` local-contract freeze.
Cloudflare/hosted sync remains a **post-local** track (not required for 1.0 per
[v1 readiness](docs/maintainers/v1-readiness.md) non-goals).

### Added

- Named G5 MCP smoke gate: `pnpm smoke:mcp` (`scripts/smoke-mcp.mjs`) covering
  MCP tool list, `memory search`, and `memory context-pack`, wired into CI
- G7 MCP tool contract inventory:
  [`docs/contracts/mcp-tools-v1.md`](docs/contracts/mcp-tools-v1.md) +
  [`docs/contracts/mcp-tools-v1.json`](docs/contracts/mcp-tools-v1.json) with
  drift test against `CARPEOS_MCP_TOOLS`
- G6 local store migration policy:
  [`docs/architecture/local-store-migrations.md`](docs/architecture/local-store-migrations.md);
  export migration IDs; test that events survive reopen (no silent wipe)
- G8 compatibility inventory:
  [`docs/maintainers/compatibility-and-deprecations.md`](docs/maintainers/compatibility-and-deprecations.md)
  (active deprecations + empty “planned breaks before 1.0”)
- G9 freeze decision template:
  [`docs/maintainers/v1-freeze-decision.md`](docs/maintainers/v1-freeze-decision.md)

### Changed

- v1 readiness G1–G8 marked **done**; only G9 (freeze decision) remains

## [0.1.3] - 2026-07-29

### Added

- `carpeos version` / `--version` / `-V` (JSON: package name, version, Node)
- Maintainer tracker: [docs/maintainers/v1-readiness.md](docs/maintainers/v1-readiness.md)
  for the `1.0.0` contract-freeze checklist (gates G1–G9, exit codes, non-goals)

### Changed

- Root CLI help documents exit codes `0|1|2|3|4`

## [0.1.2] - 2026-07-29

### Added

- `carpeos --help` / `carpeos help [command]` human-readable CLI help for all
  commands (init, project, capture-hook, outbox, sync, retrieval, memory, setup)

## [0.1.1] - 2026-07-29

### Fixed

- npm `carpeos setup` wrappers now point at package `bin/carpeos.js` so
  `carpeos setup` keeps working when `~/.local/bin` shadows the global npm bin

## [0.1.0] - 2026-07-29

Initial public distribution of the CarpeOS CLI and local MCP server.

### Added

- npm package `@innocarpe/carpeos` with bins `carpeos` and `carpeos-mcp-server`
- `carpeos setup` CLI surface: commands `plan | run | doctor | show | help`,
  options `--home`, `--bin-dir`, `--workspace-root`, `--trust-zone`,
  `--register-mcp`, and `--apply` safety gate for per-machine runtime + agent
  MCP registration (legacy `--yes` / `-y` still accepted as a deprecated alias)
- curl installer: `scripts/install.sh`
- git-checkout installer: `scripts/install-local.mjs` (same command surface)
- Local capture, retrieval, memory search/get/context-pack, and MCP tools (bundled)
- Maintainer SemVer + tag + GitHub Release / npm publish pipeline

### Notes

- Pre-1.0: CLI/MCP contracts may still evolve; breaking changes will be called out
  under `### Breaking` on MINOR bumps while on `0.y.z`.

[Unreleased]: https://github.com/innocarpe/carpeos/compare/v5.0.1...HEAD
[4.0.0]: https://github.com/innocarpe/carpeos/compare/v3.2.0...v4.0.0
[0.1.0]: https://github.com/innocarpe/carpeos/releases/tag/v0.1.0
[0.1.1]: https://github.com/innocarpe/carpeos/releases/tag/v0.1.1
[0.1.2]: https://github.com/innocarpe/carpeos/releases/tag/v0.1.2
[0.1.3]: https://github.com/innocarpe/carpeos/releases/tag/v0.1.3
[0.2.0]: https://github.com/innocarpe/carpeos/releases/tag/v0.2.0
[0.2.1]: https://github.com/innocarpe/carpeos/releases/tag/v0.2.1
[0.2.2]: https://github.com/innocarpe/carpeos/releases/tag/v0.2.2
[1.0.0]: https://github.com/innocarpe/carpeos/releases/tag/v1.0.0
[2.0.0]: https://github.com/innocarpe/carpeos/releases/tag/v2.0.0
[3.0.0]: https://github.com/innocarpe/carpeos/releases/tag/v3.0.0
[3.0.1]: https://github.com/innocarpe/carpeos/releases/tag/v3.0.1
[3.0.2]: https://github.com/innocarpe/carpeos/releases/tag/v3.0.2
[3.1.0]: https://github.com/innocarpe/carpeos/releases/tag/v3.1.0
[3.2.0]: https://github.com/innocarpe/carpeos/releases/tag/v3.2.0
[5.0.0]: https://github.com/innocarpe/carpeos/releases/tag/v5.0.0
[5.0.1]: https://github.com/innocarpe/carpeos/releases/tag/v5.0.1
