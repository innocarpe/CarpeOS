# PRD v5 — CarpeOS 5.0.0

Status: **In progress** — offline contract freeze (V5-M0) is independently recomputed; implementation of draft-only lanes is underway. Provider network, Worker/D1 deployment, and canonical materialization remain disabled until their gates pass.

Series: [PRD-v1](PRD-v1.md) · [PRD-v2](PRD-v2.md) · [PRD-v3](PRD-v3.md) · [PRD-v4](PRD-v4.md)

This document is the **product requirements snapshot for major version 5**. It does not claim that adapters, MCP tools, hosted telemetry, or provider integrations are complete unless implementation and tests exist.

---

## Version thesis

> **Can optional LLM-assisted extraction stay draft-only, privacy-safe, and fully reversible without ever becoming canonical authority?**

CarpeOS 5.0 is an **opt-in, local-first, draft-only** major. It adds offline redaction, bounded EvidencePack views, a deterministic proposal reducer, fake-first provider boundaries, local attempt/review/rollback sidecars, signed telemetry admission (TELEMETRY_DB only), and evaluation/rollback gates.

It does **not** turn LLM output into CanonicalEvents, KnowledgeCandidates, outbox rows, sequence allocations, or retrieval authority.

| | 4.0 | **5.0** |
| --- | --- | --- |
| Question | Can correction be governed safely? | **Can optional LLM drafts stay non-canonical and private?** |
| Core engine | correction maintenance + evidence receipts | **draft extraction + redaction + reducer + telemetry admission** |
| Success signal | reversible, independently verified maintenance | **reproducible offline contracts + V5-off fallback** |
| Failure if skipped | silent mutation | **privacy leak or false canonical authority** |

---

## Relationship to PRD-v4

- **PRD-v4 M0–M5 remains independently releasable.**
- **No V5 milestone is a prerequisite for 4.0.0.**
- V5-M8 may integrate **at most one** body-free, accepted 4.0 evidence seam.
- schema-v1 remains authoritative; adj_v3 remains unchanged and comparison-only.
- Existing local migrations 001–006 and canonical `0001_initial.sql` are immutable for V5 work.

---

## Goals

1. Keep single-user / local-first architecture; V5 is opt-in.
2. Treat every LLM output as untrusted draft material (`canonical_effect: "none"`).
3. Freeze and independently recompute redact_v1, proposal_reduce_v1, and telemetry workload digests/signatures (V5-M0).
4. Implement offline redaction, EvidencePack, and reducer oracles with fixture-backed tests.
5. Bound providers behind OpenRouter-first adapters with DeepSeek Flash default extract and rare predeclared GPT-5.6 Luna escalation; no-network fakes first.
6. Keep capture transactions free of LLM/network work; provider failure must never block EvidenceArtifact capture.
7. Admit telemetry only with signed snapshots; TELEMETRY_DB only; no pre-admission D1/revocation probes.
8. Evaluate with a frozen ledger, circuit breakers, and V5-off rollback.
9. Integrate with 4.0 only via body-free accepted receipt references when available.

---

## Non-goals

| Non-goal | Boundary |
| --- | --- |
| Canonical authority from LLM output | No CanonicalEvent, KnowledgeCandidate, disposition, outbox, sequence, or retrieval promotion from drafts. |
| Implicit provider fallback | Exact route/profile/consent/preflight/budget or fail closed. |
| Network-inside-capture | Capture commits without LLM/network. |
| Telemetry in canonical DB | TELEMETRY_DB only; no body/padding in D1. |
| Claiming provider ZDR/no-collection prevents remote bytes | Never claim endpoint/region/flags prevent remote retention. |
| Gating 4.0.0 on V5 | PRD-v4 graph stays independent. |
| schema-v1 / adj_v3 mutation | Forbidden in V5 work. |

---

## Privacy fences

Must **not** enter ordinary telemetry, D1, canonical data, logs, receipts, fixtures, or public artifacts:

- raw/protected values, prompt/completion bodies, paths/URIs, credentials
- tool payloads, reasoning, request bodies, padding, segment bodies, provider bodies

Operator Cloudflare configuration boundary: **CARPEOS_CF_CONFIG** only.

---

## Milestones (summary)

| ID | Name | Status |
| --- | --- | --- |
| V5-M0 | Contract freeze + independent computation receipts | **Pass** (see `artifacts/v5/m0/*-computation-receipt.json`) |
| V5-M1 | Offline redaction vectors | In progress / implemented in `@carpeos/v5` |
| V5-M2 | EvidencePack + provider boundary fakes | In progress / implemented in `@carpeos/v5` |
| V5-M3 | Reducer oracle | In progress / fixture-validated in `@carpeos/v5` |
| V5-M4 | Provider schema boundary (fake-first) | In progress / implemented fakes |
| V5-M5 | Attempts, review, incident, rollback sidecar | In progress / implemented sidecar |
| V5-M6 | Telemetry admission (offline model) | In progress / offline admission + generator |
| V5-M7 | Evaluation + rollback gates | In progress / ledger + circuit breaker |
| V5-M8 | Body-free 4.0 seam + final opt-in decision | **Deferred** until accepted 4.0 evidence exists |

Detailed checklist: [maintainers/v5-milestones.md](maintainers/v5-milestones.md).

---

## V5-off fallback

At any time operators may:

1. Disable V5 opt-in.
2. Kill provider and escalation switches.
3. Continue capture/canonical/retrieval paths without draft authority.
4. Leave TELEMETRY_DB unused or disabled after post-first-statement failure semantics.

V5-off is a **valid release path**. Incomplete V5 evidence is `blocked`/`deferred`, never silently downgraded to a warning.

---

## Package surface

Offline implementation lives in monorepo package `@carpeos/v5`:

- fixtures: `fixtures/v5/m0/`
- receipts: `artifacts/v5/m0/`
- recompute: `node packages/v5/scripts/m0-recompute.mjs`

Real provider calls, Worker deployment, and canonical migrations are **not** part of the current offline delivery.
