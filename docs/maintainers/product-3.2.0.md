# Product 3.2.0 — release and activation receipt

Status: **Released and activated.** Product 3.2.0 is published as npm `@innocarpe/carpeos@3.2.0`, tagged `v3.2.0`, and has a non-draft, non-prerelease [GitHub Release](https://github.com/innocarpe/CarpeOS/releases/tag/v3.2.0). The pre-tag approval below remains historical evidence; this receipt records the completed release and public-safe activation.

Related: [PRD index](../PRD.md), [policy reconciliation decision](../adr/0015-policy-version-reconciliation.md), [versioning policy](versioning-and-releases.md), and [Product 3.1.0 DoD](product-3.1.0.md).

## Scope and immutable implementation boundary

Earlier implementation-gate evidence is bound to `42b974947b3e713acd0ca394d473583a05d50017`. The immutable approved implementation freeze is commit `ed700072858c1b0062aabe136c807fd379e5698a`, tree `347163bc4093d697c3b7d8bbf7f9e10fab1a54ad`, and `sourceHash` `sha256:1a5172860215e99ad110fb18fcc9585b5c2c481588d6ccd12c6feb36fb67ef79`.

CarpeOS 3.2 improves promoted-knowledge review and correction without widening accepted authority. Schema v1, event types, required CLI/MCP contracts and defaults, trust zones, fail-open hooks, append-only/bitemporal history, and promoted-active-only retrieval remain compatible. The public-boundary check passed for 305 public files.

**B0 is the selected 3.2 boundary:** deterministic, bounded, metadata-only, zero-write reconciliation preview, supporting only `--from-policy`, `--to-policy`, `--trust-zone`, and `--limit`. **B1 remains deferred and absent:** there is no safe-subset apply, writer, apply command, apply receipt, Supersession construction, protected/canonical/outbox mutation, or authority widening. Unsafe entries are unchanged.

The fixed-201-row availability advisory is fail-closed and non-blocking: it does not claim exhaustive enumeration or availability beyond the bounded preview contract.

## Gate ledger

| ID | Observed evidence | Status |
| --- | --- | --- |
| K0 | Product 1.0 P11 correction, PR #140 | **complete** |
| K1 | 3.2 DoD/index/decision preimage, PR #141 | **complete** |
| K2 | Chronology, correction, exact-normalized deduplication, and `adj_v3`, PRs #147, #160, #164 | **complete** |
| K3 | Deterministic adjudication evaluator, PR #150 | **complete** |
| K4 | Evidence-only knowledge-form evaluator with automatic Claim creation off, PR #152 | **complete** |
| K5 | Policy-aware held review and terminal protection, PR #151 | **complete** |
| K6 | Bounded B0 preview, global taint, and digest proof, PRs #153, #162, #166, #170, #171 | **complete** |
| K7 | B0 selected; unsupported apply flags fail before reconciliation writes; B1 deferred/absent | **complete** |
| K8 | Retrieval evaluator and observed graph branches, PRs #148, #161, #167, #169 | **complete** |
| K9 | Synthetic dogfood, documentation truth, pack-once/release proofs, and CI evaluator build, PRs #149, #154–#159, #163, #165, #168 | **complete** |
| K10 | Pre-tag approval receipt authorized the release cutter | **complete / Approve** |
| K11 | Exact tagged SHA, tarball, registry, provenance recovery, and GitHub Release identity | **complete** |
| K12 | Public-safe activation receipt | **complete** |

## Observed verification evidence

Earlier implementation-gate evidence remains bound to `42b974947b3e713acd0ca394d473583a05d50017`: `pnpm check` exited `0`; `pnpm --filter @carpeos/capture eval:adjudication`, `pnpm --filter @carpeos/capture eval:knowledge-form`, and `pnpm --filter @carpeos/retrieval eval:retrieval` each exited `0`; `pnpm smoke:mcp`, `pnpm smoke:product`, `pnpm smoke:knowledge`, and `pnpm smoke:dogfood` each exited `0`; sync E2E exited `0`; and `node --test scripts/test/*.test.mjs` completed all seven pack/release tests with exit `0`. The public-boundary check passed for 305 public files. PR #172 retains durable CI references: [Checks run](https://github.com/innocarpe/CarpeOS/actions/runs/30877973348) and [Gitleaks](https://github.com/innocarpe/CarpeOS/actions/runs/30877973329). This is earlier implementation-gate evidence, not the final approved freeze or publication, installation, deployment, or activation evidence.

| Area | Observed result |
| --- | --- |
| Adjudication | `adj_v3`; digest `sha256:cf19f02d226e4cf8313394b0675c3a68379c421b50a4faa5b99f710b799bf626`; accuracy `1`; zero false promotions, assertion failures, and authority writes |
| Knowledge form | digest `sha256:a6a94b6e306c21a9b091cd7bfaf86773c49cd367c587ba9eb296cef59ded50fc`; accuracy, Claim precision/recall, and Observation preservation `1`; zero false candidates, failures, and automatic writes |
| Retrieval | corpus `sha-256:b829314559282d228b2bdd50964a9e6f2f8bdd84f7367b0c67f519c291518c5e`; rebuild `sha-256:e3edf25562ee8a6deb731ea524ef38a94c010dd78dd5039cd2d2005b4c8e95de`; 8/8 canonical branches; recall@3 and MRR `1`; zero failures or mutation |
| Smokes and sync | `pnpm smoke:mcp`, `pnpm smoke:product`, `pnpm smoke:knowledge`, `pnpm smoke:dogfood`, and sync E2E each exited `0` |
| Pack/release | Seven pack/release tests exited `0`, including pack-once and release-artifact workflow proofs |
| Public boundary | Passed for 305 public files |
| Implementation-gate source | `sourceHash` `sha256:3d5c79211c4619f85858a9ce8344ea44f6c73c8d634e1514ed752b92a5135b63` |

## Pre-tag approval receipt

The pre-tag **Approve** decision is historical evidence bound to approved implementation freeze `ed700072858c1b0062aabe136c807fd379e5698a`, tree `347163bc4093d697c3b7d8bbf7f9e10fab1a54ad`, and `sourceHash` `sha256:1a5172860215e99ad110fb18fcc9585b5c2c481588d6ccd12c6feb36fb67ef79`. Cleaner: **PASS**. Architect: **CLEAR / CLEAR / CLEAR — APPROVE**. Executor QA: **passed**. Critic: **OKAY**. Current-source leader gates were `pnpm check`; the three Product 3.2 evaluators; four smokes; sync E2E; seven pack/release tests; public boundary 305; and clean status. Push CI for this SHA: [Checks run](https://github.com/innocarpe/CarpeOS/actions/runs/30880949088) and [Gitleaks](https://github.com/innocarpe/CarpeOS/actions/runs/30880949113). It authorized the release cutter but did not itself publish, tag, install, deploy, or activate Product 3.2.

## Release and activation receipt

**K11 — release identity.** Release commit SHA: `59328c0eb28096a8921ae5c7c8af4b06aa32dbc5`; annotated tag: `v3.2.0`; npm package: `@innocarpe/carpeos@3.2.0`; npm integrity: `sha512-oYDa+cEOp6LrStkoWOK5KHZDJU90QT2Sry+umNxIMi2gfSrfMSLPq5g4AdIBBe8askaSlt7VCcPaY1THAeHAww==`; release run: [30884802193](https://github.com/innocarpe/CarpeOS/actions/runs/30884802193); GitHub Release: <https://github.com/innocarpe/CarpeOS/releases/tag/v3.2.0>.

The original release workflow published and installed/smoked the exact tarball, then remained red because its immutable tag-SHA code required missing npm `gitHead`. It did not become green. Recovery PR [#180](https://github.com/innocarpe/CarpeOS/pull/180), merged as `89fb488b7d06a2f1b86c6cbf631e305c94254a63`, added fail-closed exact SLSA provenance verification on main; live verification passed, and the missing GitHub Release was created without moving the tag or republishing.

**K12 — public-safe Mac activation.** The following disposable, synthetic-only receipt records global activation; `<temporary-home>` denotes a disposable location and no local path, username, production data, or runtime record is retained.

| Command | Result |
| --- | --- |
| `npm install -g @innocarpe/carpeos@3.2.0` | installed `@innocarpe/carpeos@3.2.0` |
| `carpeos --version` | `3.2.0` |
| `npm list -g @innocarpe/carpeos --depth=0 --json` | `@innocarpe/carpeos` `3.2.0` |
| `npm view @innocarpe/carpeos@3.2.0 version dist.integrity --json` | returned version `3.2.0` and integrity `sha512-oYDa+cEOp6LrStkoWOK5KHZDJU90QT2Sry+umNxIMi2gfSrfMSLPq5g4AdIBBe8askaSlt7VCcPaY1THAeHAww==`, equal to the installed package identity |
| `command -v carpeos` | resolved the global package executable; the installed CLI was used, with no repository `dist` or source fallback |
| `carpeos setup run --apply --home <temporary-home>` then `carpeos setup doctor --home <temporary-home>` | `PASS` |
| `node scripts/smoke-dogfood.mjs --cli "$(command -v carpeos)"` | `PASS` for synthetic capture, adjudication, held review, B0 preview, retrieval, sentinel, and cleanup |
| `carpeos okf export --out <temporary-bundle> --visible-trust-zone tz_synthetic_activation` | exited `0` with four files, two concepts, and zero conformance warnings |
| `carpeos okf rebuild --out <temporary-bundle> --visible-trust-zone tz_synthetic_activation` | exited `0` with four files, two concepts, and zero conformance warnings; sentinel absent and temporary home/bundle removed |
This activation evidence uses only synthetic, disposable inputs. B0 was preview-only; B1 was not exercised because it remains deferred and absent. Automatic Claim creation remains off and no `AcceptanceDecision` is created.

## B0 canonical preview evidence

The implemented-and-tested B0 wire schema is `carpeos.policy-reconciliation-plan/v2`. Its public-safe all-zero canonical result has zero high-water values, zero primary and reason counts, no entries or taints, `plan_admissible=true`, and digest `sha256:131f346f95646f32abb1ee39b30df40970b75c15d2466ff96c353cbb204204e6`.

The populated synthetic golden result has digest `sha256:3f25159769480ee4cce2740146b7c2e5faacf4edbdace5e6190ef0f2d50039f8`; `eligible_write=1`, `eligible_noop=1`, `unsafe_unchanged=1`, `replace=1`, `invalidate=0`, and `already_applied=1`; its reason counts include `missing_unsafe=1`. It is inadmissible under `unproved_conformance_global_taint` and `unproved_zero_write_global_taint`. Its exact public-safe taint inventory is `global_taint_component_ids`: `cmp:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` and `cmp:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`, and `global_taint_entry_ids`: `evt_source0001` and `evt_source0002`. The unsafe `evt_source0003` / `cmp:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc` is isolated and not globally tainted. Its synthetic metadata-only entry IDs are `evt_source0001`, `evt_source0002`, and `evt_source0003`, with targets `evt_target0001` and `evt_target0002` and replacement `evt_replace001`; no protected or canonical bodies are present.

The observed B0 preview is deterministic and metadata-only: bounded emitted prefixes and digest evidence are reviewable, over-limit totals receive `incomplete_enumeration_global_taint` and are inadmissible, and preview writes zero rows. Apply, pin, and acknowledgement flags fail with exit `2` before reconciliation writes. Automatic/adjudicated Claim creation remains off (`allow_auto_claim=false`), no AcceptanceDecision is created, and retrieval remains offline with no online-feedback or adaptive-ranking mutation.

## Merge ledger

| PR | Merge SHA | Branch | Subject |
| --- | --- | --- | --- |
| #140 | `f92e8ddfb489011126ff415848bc00aba4f7c418` | `docs/3.2-p11-release-ledger` | docs: close Product 1.0 release ledger |
| #141 | `6bcc1572616a7cacab00218336c3f37f62933e96` | `docs/3.2-knowledge-quality-contract` | docs: define Product 3.2 knowledge quality |
| #142 | `fd679508fa923e0ae8c413d24af88b6b0cfe5171` | `docs/3.2-contract-hardening` | docs: harden Product 3.2 contract |
| #143 | `8c0679d17532322a1d888ad981aa59d209f810c8` | `docs/3.2-contract-convergence` | docs: freeze reconciliation event identity |
| #144 | `ebb48f9823111b4a08a4f54e8579c5c4fae3ef1c` | `docs/3.2-b0-selection` | docs: select Product 3.2 preview-only reconciliation |
| #145 | `027c94c6543c3fc4d72df97b61a11034b740c452` | `docs/3.2-preview-completeness` | docs: define bounded reconciliation preview |
| #146 | `ce7fee6b5738ab33efefe474e85c4cfc7882e10c` | `docs/3.2-runtime-truth-audit` | docs: audit runtime architecture truth |
| #147 | `5b78a0b0835af5fdbed3303fbcdbc8103ad95656` | `fix/3.2-session-chronology` | fix: preserve adjudication chronology |
| #148 | `d4b39017d5d67565f9f4d21649d9a9b89c705455` | `test/3.2-retrieval-quality` | test: add retrieval quality evaluator |
| #149 | `13dad885dfc45208759885893b6072af45cc8a0d` | `test/3.2-pack-once-release` | test: enforce pack-once releases |
| #150 | `d06da04faf793924a877fac0d7b3a77712c4a7db` | `test/3.2-adjudication-quality` | test: add adjudication quality evaluator |
| #151 | `04d183d4fe998decdf499c00efeb4ead1ae7d906` | `fix/3.2-held-policy-review` | fix: scope held review by policy |
| #152 | `0b41215d19ee01a9807040d76b3b533da97c2435` | `test/3.2-knowledge-form-evidence` | test: add knowledge form evaluator |
| #153 | `56f2ee5c62c2c7c46434a551c24c0854e2a17c3b` | `feat/3.2-policy-reconciliation-preview` | feat: add policy reconciliation preview |
| #154 | `9fd204c39ad2d1b0d2bebe3e7c4a5b6eeea94bd2` | `test/3.2-public-knowledge-dogfood` | test: add Product 3.2 public knowledge dogfood |
| #155 | `b24f69ddf6409795ec3d9a3570e39b38ed7b3e6b` | `docs/3.2-operator-knowledge-quality` | docs: document Product 3.2 knowledge quality |
| #156 | `7b685be08f1e0379c88b179ebd426b9c9ec364ca` | `fix/3.2-installed-release-proof` | fix(release): dogfood the installed tarball |
| #157 | `1c9ef3765fbe5517053abac99c39c3d0a4433fab` | `docs/3.2-architecture-truth` | docs: align Product 3.2 architecture truth |
| #158 | `c13ba6198a9e2e51cca54dc682838cd0dc704549` | `docs/3.2-session-wording` | docs: qualify session noise reduction |
| #159 | `5f9b80ff1d8ff0d089f72c0df147f68a9aa5b4bb` | `chore/3.2-ci-evaluator-build` | chore(ci): reuse the capture evaluator build |
| #160 | `bde5da4bf658f673653a89544d4a1b4c84ee7c30` | `fix/3.2-correction-semantics` | fix(capture): preserve post-correction reassertions |
| #161 | `a141838f9a8ce05aa943bce59d0ede7139b6e513` | `fix/3.2-retrieval-observed-eval` | fix(retrieval): derive quality evidence from execution |
| #162 | `555b42bed0e8a47932559255d4aa8c6c94f30e5d` | `fix/3.2-policy-preview-proof` | fix(local-store): harden policy preview evidence |
| #163 | `de407dd1bc2bdebb8568455bbc5dabe6c348312a` | `docs/3.2-gen3-prerelease-truth` | docs: correct 3.2 prerelease status |
| #164 | `9d2cbb4e887a9b86ebb777a741d27f4065692278` | `fix/3.2-gen3-correction-dedup` | fix(capture): suppress duplicate corrections |
| #165 | `6a9720adcf7a9ac45486d949c123df34581f22d3` | `fix/3.2-gen3-release-doctor` | fix(release): initialize installed doctor smoke |
| #166 | `bb2794e914516bfae4abe89d3bb248d07f0b32c4` | `fix/3.2-gen3-policy-preview` | fix(local-store): close preview evidence gaps |
| #167 | `e431bf9cf16d815926a9c04d05e1ae704462c4ed` | `fix/3.2-gen3-retrieval-evidence` | fix(retrieval): exercise observed evaluation branches |
| #168 | `1177cd7cfa441344868cbe9a276220375de9cdf8` | `docs/3.2-gen4-release-truth` | docs: remove remaining 3.2 release overclaims |
| #169 | `b8e906eacfe26d65c130ec255308e8546137dbae` | `fix/3.2-gen4-retrieval-graph` | fix(retrieval): prove graph branch semantics |
| #170 | `1caa4a61d56e0e93d67a2093240ea6fa963f20eb` | `fix/3.2-gen4-policy-proof` | fix(local-store): prove production preview digest |
| #171 | `42b974947b3e713acd0ca394d473583a05d50017` | `fix/3.2-gen5-digest-proof` | test(policy): close digest proof masking |
| #172 | `7dc180547afac27fafdf290eae138692021b6813` | `docs/3.2-freeze-audit` | docs: freeze Product 3.2 audit |
| #173 | `75ab281024624ec1b487e59ad9df0d34820a1369` | `fix/3.2-held-cli-compat` | fix(cli): preserve held review defaults |
| #174 | `b77f29b7ddfb0a0ed7956cfe518770af3ff3e741` | `docs/3.2-freeze-evidence-fix` | docs: correct Product 3.2 freeze evidence |
| #175 | `ed700072858c1b0062aabe136c807fd379e5698a` | `docs/3.2-freeze-sha-fix` | docs: correct Product 3.2 PR159 SHA |
| #176 | `a8e4c9eb6198a0b5df8f0cb4c32738695cf24d8b` | `docs/3.2-pretag-approval` | docs: approve Product 3.2 release |
| #177 | `2dcebb2b72dd7e9a9fb4ec04697af15f461c206c` | `fix/pack-once-version-agnostic` | test: make pack-once fixtures version agnostic |
| #178 | `085685bfd76546514e0a7a4155c124700b90afe8` | `fix/pack-once-npm-json` | fix(release): parse npm pack lifecycle output |
| #179 | `8d98162d88ebf5ac815a968c41b41231d90f0897` | `release/3.2.0-final2` | chore(release): @innocarpe/carpeos v3.2.0 |
| #180 | `89fb488b7d06a2f1b86c6cbf631e305c94254a63` | `fix/release-provenance-verification` | fix(release): verify npm provenance without gitHead |

## Residuals and next decision

B1 safe-subset apply, Supersession construction, protected transfer/lifecycle, sync convergence, automatic/adjudicated Claims, AcceptanceDecision, online feedback, adaptive ranking, fuzzy deduplication, and any unsafe repair or mutation remain deferred or prohibited. Unsafe entries remain unchanged.

The rejected PR13 snapshot `sourceHash` `sha256:e96b0e639867956ca1e9deae66694755df8102c53bf5d804be7f58cd760b5090` is superseded by the approved freeze recorded above. The historical pre-tag receipt authorized the release cutter; K11 and K12 are completed by the release and public-safe activation receipt above.
