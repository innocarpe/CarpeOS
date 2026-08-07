# Changelog

All notable changes to the public package **`@innocarpe/carpeos`** are documented
in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versioning policy: [docs/maintainers/versioning-and-releases.md](docs/maintainers/versioning-and-releases.md).

## [Unreleased]

### Added

- (none yet — fold entries here before the next release)

## [6.7.7] - 2026-08-08

### Added

- Cross-session **near-dup promote hold** for recent zone promotes (`near_duplicate_statement_recent`).
- **Denser host adapters** for agentic signal extract (nested Cursor/Codex/Grok fields, content arrays,
  extra transcript roots under `~/.cursor` / `~/.gajae` / `~/.agents`).

## [6.7.6] - 2026-08-07

### Added

- Q-S5 advisory metrics helper (`scripts/quality-qs5-metrics.mjs`) and dogfood receipt.
- Within-pack **near-duplicate promote hold** (`near_duplicate_statement`).

### Fixed

- Pack privacy scrub residual: emails, IPv4/IPv6, common DNS hostnames → `[EMAIL]`/`[IP]`/`[HOST]`.
- Retrieval rebuild failures no longer fail-close a successful materialize drain
  (`project_hook_failed`).

## [6.7.5] - 2026-08-07

### Added

- Quality ultragoal **baseline #2** corpus (≥40 cases, ≥10 per decision/constraint/preference)
  with recorded-Flash inject cases and DoD gates (Q-S1–S3, S7–S9, S13).
- Quality report metrics: `per_kind_recall`, `signal_source_counts`.
- Architecture DoD status + baseline #2 receipt docs.

### Fixed

- Triage load-bearing signal match includes **prefer** (preference-class packs no longer
  false-drop when they say "we prefer" without the noun "preference").

## [6.7.4] - 2026-08-07

### Fixed

- Flash extract **cite grounding belt**: clamp paraphrased statements to cited quotes
  (or drop) so `cite_ok` can pass gate promote instead of
  `statement_longer_than_cited_span` / `statement_not_grounded_in_citations` rejections.
- Reject pack-meta quotes such as **`agentic.evidence`** in extract parse and local
  `pickQuote`; prefer decision/constraint/preference lines over pack titles.
- Local extract fallback when Flash leaves zero cite-ok candidates on decision packs.
- Vitest `beforeAll` tsc hookTimeout raised to 60s for CLI/MCP suites under monorepo
  preflight load (avoids flaky 10s hook timeouts).

## [6.7.3] - 2026-08-07

### Added

- Agentic **triage/extract v2** prompts (`agentic.triage/v2`, `agentic.extract/v2`).
- Deterministic **decision override belt**: Flash triage drop is upgraded to keep when
  the pack has explicit decision/constraint/preference language (fixes live
  `tool_noise` drops on real decisions).
- Extract parser clamps (max 3 candidates, emittable kinds) + local extract fallback
  when Flash returns empty or non-emittable kinds on decision packs.

### Fixed

- Runner extract gating uses stage parser so `need_context` never spends extract and
  local overrides apply before Flash extract is skipped.

## [6.7.2] - 2026-08-07

### Fixed

- Flash HTTP calls abort after **45s** (`CARPEOS_AGENTIC_FLASH_TIMEOUT_MS`, 5s–180s);
  timeouts requeue the feed row instead of hanging flush indefinitely.
- `agentic flush --limit N` scans past `empty_signal` lifecycle rows (up to 5×N)
  so Stop/PreCompact emptiness does not starve SessionEnd work.

## [6.7.1] - 2026-08-07

### Fixed

- Agentic job lease accepts legacy durable `agentic_v1` policy stamps so homes
  upgraded from 6.6.x can `agentic flush` without `invalid policy_version` crashes.
  New jobs still stamp `agentic_v1.1`.

## [6.7.0] - 2026-08-07

### Added

- **Agentic quality ultragoal substrate** (plan v2.1): prepared pack + bounded Flash
  `triage_view_text` / `extract_view_text` (never raw capture signal).
- Default operator JSON redaction for statements, citation quotes, and pack views on
  `agentic flush` / `run` / `list-held` / `list-claims`; opt-in with **`--verbose`**.
  Timer path stays non-verbose so `agentic-timer.log` does not log private prose.
- Live-mode **zero fake side effects**: no proposal-writing fake pipeline before Flash;
  transient Flash failure requeues the feed row (retryable).
- Line-scoped admit for tool-noise and secret-like lines so mixed decision+noise
  SessionEnds keep residual prose (H7/H8).
- Agentic transcript recovery mode: prose fields + `transcript_path` without durability
  lexicon / future-intent filters; no `JSON.stringify` of the full envelope as body.
- CJK-safe statement grounding (NFC both sides; Hangul/CJK bigrams).
- Post-extract provenance-primary quality filter (quote ⊆ extract view; metadata
  restatement belt); kill switch `CARPEOS_AGENTIC_QUALITY_FILTERS=off`.
- Quality corpus fixtures under `fixtures/agentic/v1/quality-ultragoal/` (baseline #1).
- Bulk retract dry-run / apply by explicit event ids (`humanBulkRetractAgenticUnits`).
- Architecture note: `docs/architecture/agentic-quality.md`.

### Changed

- Formation / disposition policy stamp **`agentic_v1.1`** (was `agentic_v1`) so quality-era
  units can be selected without freezing all historical agentic_v1 rows together.
- Live Flash path: `need_context` does not call extract.
- Soft-scrub path roots broadened (`/opt`, `/private`, `/Volumes`, `/mnt`, `/srv`).

### Fixed

- Pack/Flash text mismatch (H0b/H0e): E5 verify binds to the same extract view Flash saw.
- Empty capture no longer invents an admit-worthy `(empty capture …)` placeholder.
- Live network failure no longer promotes fake offline candidates (H0d).

### Operator notes

- Inspect private statements in CLI output only with `--verbose`.
- Historical held units under `agentic_v1` still addressable by explicit policy version
  on human-review paths.
- Residual: denser multi-record pack segment classes; recorded-Flash JSON expansion;
  dogfood promote density remains the product success measure (Q-S5 advisory).

## [6.6.4] - 2026-08-07

### Fixed

- Day Flash call cap raised (16 → **500**) and spend default **\$5/day** so dogfood/timer is not disabled after a few SessionEnds.
- Per-run Flash budget no longer starved by seeding day call totals into the in-process counter.
- Agentic pack limits raised for real SessionEnd transcript sizes (`redact_segment_scalars`).

## [6.6.3] - 2026-08-07

### Added

- Lifecycle-only agentic feed policy: only SessionEnd / Stop / PreCompact enqueue for Flash.
- `skipIneligibleAgenticFeed` + flush default `--skip-ineligible` to clear legacy PostToolUse flood.
- Claim order prefers SessionEnd → Stop → PreCompact.

### Fixed

- Dogfood FIFO starvation: noise no longer blocks meaning-bearing hooks on the product path.

## [6.6.2] - 2026-08-07

### Fixed

- **Agentic pack soft-scrubs paths/URIs** before V5 redact so SessionEnd transcripts with absolute paths can reach Flash extract instead of hard-failing with `redact_path_or_uri`.
- Do not call Flash when pack fails (`pack_digest` required) — avoids spend with zero materializations.
- Pack failure now sets pipeline `ok: false`.

## [6.6.1] - 2026-08-07

### Fixed

- **Agentic product path uses deepseek-v4-flash by default** (was network-off / fake on timer and default `run`).
- Flash replies that only fill `reasoning_content` no longer fail as `empty_model_response`.
- Timer install always passes `--allow-network` and loads credentials from `~/.carpeos/v5-provider.env` (never embeds secrets in the unit).

### Added

- **`carpeos agentic feed`** — inspect capture queue (pending/leased/done/skipped).
- **`carpeos agentic flush`** (alias `drain`) — process the queue immediately for test/debug; same Flash path as the 30m timer.
- `agentic status` now reports feed counts and `next` hints.

### Changed

- Offline escape is explicit: `CARPEOS_AGENTIC_NETWORK=off`.

## [6.6.0] - 2026-08-07

### Added

- **HITL-free Agentic compound loop (ADR 0018 promote-when-verified)**:
  - E5 **statement grounding** (quote ⊆ pack is not enough; statement must ground in cited spans)
  - Offline **licensing-promote** corpus without `hint_kind` positives
  - Gate default flips to **promote** for verified `decision` | `constraint` | `preference`
  - `procedure` and `fact_candidate` remain hold-biased (not v1 usable allowlist)
  - Human **retract** via append-only Supersession (`carpeos agentic retract … --human-confirmed`)
  - Persistent **day spend** caps in agentic DB; extract gated on triage keep
  - Capture feed **lease** mutual exclusion for concurrent / always-on runners
  - **30-minute** always-on batch: `carpeos agentic timer install` / `scripts/install-agentic-timer.sh`
  - Decision materialize remains Observation-primary + optional draft Claim; never auto `AcceptanceDecision`

### Changed

- CLI `agentic run --allow-auto-promote` defaults **true**; staging escape:
  `--hold-first` or `CARPEOS_AGENTIC_HOLD_FIRST=1`
- Human `promote-held` / `accept-claim` documented as **correction-only**, not the happy path

### Notes

- Success criteria: ADR 0018 S1–S7 (usable meaning without load-bearing HITL; S3 via timer).
- Network remains off by default; live Flash still requires explicit `--allow-network` + key.

## [6.5.0] - 2026-08-07

### Added

- **Complete Agentic topology residuals (E10 + human review + backfill)**:
  - E10 deterministic reconcile (dedupe/contradict proposals; human hold path only)
  - Human `promote-held` for agentic_v1 held Observations
  - Human `accept-claim` → `AcceptanceDecision` only with `--human-confirmed` + human actor
  - Historical `backfill` of EvidenceArtifact → agentic capture feed (no LLM)
  - Still never auto-creates AcceptanceDecision from runner/LLM paths

### Notes

- Completes ADR 0017 E0–E10 operator surface under hard fences.
- Hosted graph/vector and free-form related edges remain non-goals.

## [6.4.0] - 2026-08-07

### Added

- **P6 GraphRAG ranking** (Product 6.4):
  - Typed promoted unit boosts in hybrid ranking (active claim/summary/decision > draft > evidence)
  - Graph hop proximity remains non-authoritative (projection only)
  - Offline query set `fixtures/agentic/v1/graphrag-query-set/` with hit_rate ≥ 0.90
  - CLI `carpeos agentic graphrag` for suite receipt

### Notes

- Completes V6-P0–P6 delivery path for Product 6 Agentic Layer thesis slices.
- Hosted graph/vector services remain non-goals.

## [6.3.0] - 2026-08-07

### Added

- **P5 draft Claims** (Product 6.3):
  - `fact_candidate` → draft Claim only (`claim_type: factual`)
  - `decision` → Observation + draft Claim (`claim_type: decision`) with supports edges
  - Always `lifecycle_status: draft`; **never** auto-creates `AcceptanceDecision`
  - CLI `carpeos agentic list-claims` for operator review of claim materializations

### Notes

- Residual P6 GraphRAG ranking remains for a later minor.

## [6.2.0] - 2026-08-07

### Added

- **P4 link / graph density** (Product 6.2):
  - E6 deterministic structure/link: `derived_from` + `about` edge proposals (optional
    `supports` to sibling units); no free `related` spam.
  - Materialize writes structured provenance + subject so `graph_v2` rebuild densifies
    `meaning_unit` nodes (required lineage).
  - `computeGraphDensityMetrics` / uplift gate; CLI `carpeos agentic graph-metrics`.
  - Product path `agentic run --materialize` invokes E9 retrieval+graph rebuild hook.
  - Still never auto-creates `AcceptanceDecision`; graph remains projection-only.

### Notes

- Does not claim full Product 6 thesis (P5–P6 residual: draft Claims, GraphRAG ranking).

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
