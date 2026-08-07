# Agentic quality plane (ultragoal)

Status: **DoD automated criteria closed at package `@innocarpe/carpeos@6.7.4+`**  
Date: 2026-08-07  
SSOT plan: [../plans/agentic-quality-ultragoal.md](../plans/agentic-quality-ultragoal.md)

## North star

After normal agent sessions, without human review, the next agent’s default
search returns typed, cited decision/constraint/preference meaning — not session
plumbing metadata.

**Path proof (maintainer dogfood, synthetic SessionEnd):** capture → Flash/local
extract with cite clamp → gate promote (`agentic_v1.1`) → Observation materialize →
`carpeos retrieval rebuild` → `memory search` top hits are pure decision/constraint
prose (metadata ratio 0 among top promoted-class hits).

## Substrate contracts (shipped)

| ID | Contract |
| --- | --- |
| QD0 | Prepare pack once; Flash sees only `triage_view_text` / `extract_view_text`; verify binds to extract view |
| Q1.5′ | Default CLI/timer JSON redacts statements, quotes, pack views (`--verbose` opt-in) |
| QD9 / Q7′ | Live mode: no fake proposal pipeline before Flash; transient fail requeues feed; Flash HTTP timeout |
| Q2.5′ | Admit TOOL_NOISE / SECRETISH are **line-scoped** (mixed sessions admit residual prose) |
| QD5 / Q3′ | Agentic transcript recovery: no `JSON.stringify` envelope body; agentic JSONL mode keeps “we will” |
| Q4′ | CJK-safe tokenize + NFC normalize for statement grounding |
| QD2 / Q5′ | Provenance-primary quality filter (quote ⊆ extract view; metadata restatement belt) |
| Q2′ / baseline #2 | Quality corpus under `fixtures/agentic/v1/quality-ultragoal/` (exact expect + recorded-Flash inject) |
| Q6′ | Triage/extract v2 + decision override belt + extract cite clamp / pack-meta skip |
| QD10 / Q8′ | Bulk retract by explicit event ids + dry-run; policy_version `agentic_v1.1` selection marker |

## Success criteria status (plan §10)

| ID | Criterion | Status |
| --- | --- | --- |
| Q-S1 | Quality corpus green (fake + recorded-Flash inject) | **green** — `packages/agentic/test/quality-corpus.test.ts` |
| Q-S2 | Zero promotes from `must_not_promote` | **green** |
| Q-S3 | Per-kind recall ≥80%, ≥10 fixtures/kind (decision/constraint/preference) | **green** — report `per_kind_recall` |
| Q-S4 | Versioned counters; default flush/run redact | **green** |
| Q-S5 | Advisory dogfood N≥30 / ≥7d; meta among promoted ≤0 | **advisory pass** — N≥30 + meta 0 (see qs5 receipt + `scripts/quality-qs5-metrics.mjs`) |
| Q-S6 | No capture LLM; Flash-only; no auto AcceptanceDecision | **green** |
| Q-S7 | Triage keep ≤2 Flash calls; drop ≤1 | **green** — `packages/agentic/test/flash-budget.test.ts` + runner design |
| Q-S8 | Korean + mixed + NFC/NFD grounding | **green** — KO fixtures + CJK unit tests |
| Q-S9 | Retrieval k=5 style: promoted statements non-metadata | **green** — corpus assertion + dogfood receipt |
| Q-S10 | Baseline #1 → #2 | **green** — baseline id `quality-baseline-2` in manifest |
| Q-S11 | Live transient: no fake materialize; requeue | **green** |
| Q-S12 | Default CLI/timer no statement leakage | **green** |
| Q-S13 | `signal_source_counts` on corpus report | **green** |
| Q-S14 | Mixed decision+tool not whole-signal admit drop | **green** — line-scoped admit |

**Definition of done (automated):** Q-S1–Q-S4, Q-S6–Q-S14 green in unit/corpus suites.  
**Q-S5** is advisory maintainer smoke (not a release blocker); numeric floor N≥30 + meta 0
is recorded in [../maintainers/quality-ultragoal-qs5-receipt.md](../maintainers/quality-ultragoal-qs5-receipt.md).

## Residual closeout (post-DoD)

| Item | Status |
| --- | --- |
| Privacy scrub: emails / IPs / DNS hostnames | **shipped** (`scrubAgenticPackText`) |
| Near-dup promote hold (within pack) | **shipped** (`near_duplicate_statement`) |
| Near-dup promote hold (recent zone promotes) | **shipped** (`near_duplicate_statement_recent`) |
| Denser host adapters (nested prose keys + more transcript roots) | **shipped** (`extractSignalTextFromCapturePayload` dig + `~/.cursor`/`~/.gajae`/`~/.agents`) |
| Retrieval rebuild must not fail-close materialize | **shipped** (`project_hook_failed` soft path) |
| Q-S5 metric helper | **shipped** (`scripts/quality-qs5-metrics.mjs`) |

### What “optional polish” meant

Plan §8 listed three optional items **after** DoD:

1. **near-dup hold** — stop promoting the same decision text over and over (now within-pack + recent promotes in the trust zone).
2. **denser host adapters** — more Claude/Codex/Cursor/Grok/Gajae envelope shapes yield agentic prose (nested `payload.message.content`, `final_message`, content-block arrays, extra transcript roots) without `JSON.stringify` of the whole envelope.
3. **residual scrub broaden** — emails/IPs/hostnames (already shipped in 6.7.6).

## Fences (unchanged)

- No capture LLM
- Flash-only model id
- No auto `AcceptanceDecision`
- Gate remains authority for promote

## Operator notes

```sh
carpeos agentic flush --limit 10          # redacted JSON by default
carpeos agentic flush --limit 10 --verbose
CARPEOS_AGENTIC_QUALITY_FILTERS=off      # disable post-extract quality filter only
CARPEOS_AGENTIC_FLASH_TIMEOUT_MS=25000   # Flash HTTP abort (5s–180s)
carpeos retrieval rebuild --trust-zone tz_local_default
```

If a long flush is killed mid-batch, re-run flush (requeue/timeout safe) and
`carpeos retrieval rebuild` before relying on `memory search` for new Observations.

## Baselines

| Baseline | Manifest | Notes |
| --- | --- | --- |
| #1 `quality-baseline-1` | 11 cases (early characterization) | Superseded |
| #2 `quality-baseline-2` | ≥40 cases; per-kind ≥10; recorded-Flash inject | Current DoD gate |

## Definition of done pointers

- Plan: [../plans/agentic-quality-ultragoal.md](../plans/agentic-quality-ultragoal.md) §10
- Corpus: `fixtures/agentic/v1/quality-ultragoal/manifest.json`
- Tests: `packages/agentic/test/quality-corpus.test.ts`, `flash-budget.test.ts`
- Local: `make preflight` before each work-unit PR
