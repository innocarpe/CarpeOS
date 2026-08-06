# PRD v5 — CarpeOS 5.0.0

Status: **Draft-lane package shipped** as `@innocarpe/carpeos@5.0.0` / `v5.0.0` on npm —
offline M0–M7, end-to-end draft pipeline, local TELEMETRY_DB store, CLI, M8 decision
receipt, and opt-in live cost experiment are in the public package. Real network remains
**off by default**. M8 full accept stays **deferred** (no invented Product 4
release-authority acceptance). See [product-5.0.0.md](maintainers/product-5.0.0.md).

Series: [PRD-v1](PRD-v1.md) · [PRD-v2](PRD-v2.md) · [PRD-v3](PRD-v3.md) · [PRD-v4](PRD-v4.md)

This document is the **product requirements snapshot for major version 5**.

---

## Version thesis

> **Can optional LLM-assisted extraction stay draft-only, privacy-safe, and fully reversible without ever becoming canonical authority?**

CarpeOS 5.0 is an **opt-in, local-first, draft-only** major. It adds offline redaction, bounded EvidencePack views, a deterministic proposal reducer, a **DeepSeek Direct–primary** provider boundary (OpenRouter optional and not required), local attempt/review/rollback sidecars, local TELEMETRY_DB admission, evaluation/rollback gates, and an end-to-end draft pipeline.

It does **not** turn LLM output into CanonicalEvents, KnowledgeCandidates, outbox rows, sequence allocations, or retrieval authority.

| | 4.0 | **5.0** |
| --- | --- | --- |
| Question | Can correction be governed safely? | **Can optional LLM drafts stay non-canonical and private?** |
| Core engine | correction maintenance + evidence receipts | **draft extraction + redaction + reducer + telemetry admission** |
| Success signal | reversible, independently verified maintenance | **reproducible offline contracts + DeepSeek Direct path + V5-off fallback** |
| Failure if skipped | silent mutation | **privacy leak or false canonical authority** |

---

## Relationship to PRD-v4

- **PRD-v4 M0–M5 remains independently releasable.**
- **No V5 milestone is a prerequisite for 4.0.0.**
- V5-M8 may integrate **at most one** body-free, accepted 4.0 evidence seam when it exists.
- schema-v1 remains authoritative; adj_v3 remains unchanged and comparison-only.
- Existing local migrations 001–006 and canonical `0001_initial.sql` are immutable for V5 work.

---

## Goals

1. Keep single-user / local-first architecture; V5 is opt-in.
2. Treat every LLM output as untrusted draft material (`canonical_effect: "none"`).
3. Freeze and independently recompute redact_v1, proposal_reduce_v1, and telemetry workload digests/signatures (V5-M0).
4. Implement offline redaction, EvidencePack, and reducer oracles with fixture-backed tests.
5. Bound providers behind a **provider-neutral** adapter with **DeepSeek Direct** as the primary real extract route (`deepseek-v4-flash`); OpenRouter remains optional and unused for the default product path.
6. Keep capture transactions free of LLM/network work; provider failure must never block EvidenceArtifact capture.
7. Admit telemetry only with signed snapshots; TELEMETRY_DB only (local store + migration SQL); no pre-admission D1/revocation probes.
8. Evaluate with a frozen ledger, circuit breakers, and V5-off rollback.
9. Integrate with 4.0 only via body-free accepted receipt references when available (otherwise defer M8 honestly).

---

## Non-goals

| Non-goal | Boundary |
| --- | --- |
| Canonical authority from LLM output | No CanonicalEvent, KnowledgeCandidate, disposition, outbox, sequence, or retrieval promotion from drafts. |
| Implicit provider fallback | Exact route/profile/consent/preflight/budget or fail closed. No silent OpenRouter fallback from DeepSeek. |
| Network-inside-capture | Capture commits without LLM/network. |
| Telemetry in canonical DB | TELEMETRY_DB only; no body/padding in D1/local telemetry rows. |
| Claiming provider ZDR/no-collection prevents remote bytes | Never claim endpoint/region/flags prevent remote retention. |
| Gating 4.0.0 on V5 | PRD-v4 graph stays independent. |
| schema-v1 / adj_v3 mutation | Forbidden in V5 work. |
| Requiring OpenRouter for 5.0.0 | OpenRouter is optional; DeepSeek Direct is sufficient for the product path. |

---

## Privacy fences

Must **not** enter ordinary telemetry, D1, canonical data, logs, receipts, fixtures, or public artifacts:

- raw/protected values, prompt/completion bodies, paths/URIs, credentials
- tool payloads, reasoning, request bodies, padding, segment bodies, provider bodies

Operator Cloudflare configuration boundary: **CARPEOS_CF_CONFIG** only (hosted operator paths). Local V5 draft lane does not require Cloudflare.

---

## Milestones (summary)

| ID | Name | Status |
| --- | --- | --- |
| V5-M0 | Contract freeze + independent computation receipts | **Pass** |
| V5-M1 | Offline redaction vectors | **Complete** |
| V5-M2 | EvidencePack + provider boundary fakes | **Complete** |
| V5-M3 | Reducer oracle | **Complete** |
| V5-M4 | Provider boundary (DeepSeek Direct primary) | **Complete** (network off by default; live cost experiment available) |
| V5-M5 | Attempts, review, incident, rollback sidecar | **Complete** |
| V5-M6 | Telemetry admission + local TELEMETRY_DB | **Complete** (local store + SQL migration; CF Worker deploy optional/operator) |
| V5-M7 | Evaluation + rollback gates | **Complete** |
| V5-M8 | Body-free 4.0 seam + final opt-in decision | **Deferred** (no accepted 4.0 seam; draft lane readiness does not require M8) |
| E2E | Draft pipeline (redact→pack→extract→reduce→eval) | **Complete** (offline; DeepSeek when network explicitly enabled) |

Detailed checklist: [maintainers/v5-milestones.md](maintainers/v5-milestones.md).

---

## Provider routing

```text
ProviderAdapter
  ├─ fake                 (default when network disabled)
  ├─ deepseek_direct      ← PRIMARY product path (deepseek-v4-flash)
  └─ openrouter           (optional; not required for 5.0.0)
```

| Profile | Provider | Model ID | Auth env | Default network |
| --- | --- | --- | --- | --- |
| `deepseek_direct_extract_v1` | DeepSeek Direct | `deepseek-v4-flash` | `DEEPSEEK_API_KEY` | **off** |
| `fake_extract_v1` | fake | `fake-extract-v1` | none | n/a |
| `openrouter_*` | OpenRouter | optional | `OPENROUTER_API_KEY` | **off** |

Keys: `~/.carpeos/v5-provider.env` (mode 0600), env-only. Never commit.

Live cost experiment: [maintainers/v5-cost-experiment.md](maintainers/v5-cost-experiment.md).

---

## Draft pipeline

Package entry: `runDraftPipeline` in `@carpeos/v5`.

```text
raw envelope
  → redact_v1
  → EvidencePack (canonical_effect: none)
  → attempt (one-dispatch)
  → extract (DeepSeek Direct if network on, else fake)
  → draft reduce (canonical_effect: none)
  → evaluation ledger
```

Capture hot path is **not** invoked.

---

## V5-off fallback

At any time operators may:

1. Disable V5 opt-in.
2. Kill provider and escalation switches.
3. Continue capture/canonical/retrieval paths without draft authority.
4. Leave TELEMETRY_DB unused or disabled after post-first-statement failure semantics.

V5-off is a **valid release path**. Incomplete evidence is `blocked`/`deferred`, never silently downgraded to a warning.

---

## Package surface

- fixtures: `fixtures/v5/m0/`
- receipts: `artifacts/v5/m0/`
- recompute: `node packages/v5/scripts/m0-recompute.mjs`
- cost experiment: `node packages/v5/scripts/live-cost-experiment.mjs`
- telemetry SQL: `packages/v5/migrations/telemetry/`
- API: `@carpeos/v5` (`pipeline`, `provider`, `telemetry-store`, …)

**Release tag `@innocarpe/carpeos@5.0.0`:** still a separate release process (changelog, versioning skill). Draft-lane code completeness ≠ published npm major until maintainers cut a release.
