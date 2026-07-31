# PRD v2 — CarpeOS 2.0

Status: **Shipped** as `@innocarpe/carpeos@2.0.0`  
DoD SSOT: [maintainers/product-2.0.0.md](maintainers/product-2.0.0.md)  
Series: [PRD-v1](PRD-v1.md) · [PRD-v3](PRD-v3.md)

This document is the **product requirements snapshot for major version 2**.
It captures the thesis, problem, scope, and success criteria that defined the
2.0 release. Living gates and freeze evidence live in the DoD linked above.
When a new major ships, add `PRD-vN.md` rather than rewriting this file.

---

## Version thesis

> **Is this worth remembering?**

CarpeOS 2.0 turns the 1.0 pipeline from “encrypted session dump + search” into a
**knowledge adjudication** product: explicit policy decides promote / hold /
reject, and default retrieval surfaces only promoted meaning.

| | 1.0 | **2.0** |
| --- | --- | --- |
| Question | Does the loop run? | **Is this worth remembering?** |
| Core engine | capture + store | **adjudication (`adj_v1`)** |
| Success signal | `smoke:product` | `smoke:knowledge` / `smoke:dogfood` |
| Failure if skipped | no data | **dump pollution called “memory”** |

---

## Problem

With 1.0 alone, everything capturable can land on the meaning surface. That
breaks the original thesis of a private knowledge OS:

- noise, secrets, and chatter pollute search;
- agents cannot trust “memory” results as brain-worthy;
- there is no operator path to hold ambiguous units for review;
- replaying policy changes has no disposition history.

2.0 does **not** yet solve deep multi-hop retrieve. It makes the write path
honest so later retrieval majors have something worth finding.

---

## Goals

1. **Post-capture adjudication** with explicit policy version (`adj_v1`).
2. **Dispositions:** promote → durable Observation; hold → draft/held queue;
   reject → disposition only (off meaning index).
3. **Default search = promoted/active only**; held via explicit opt-in.
4. **Operator workflow** for held review (list / promote-held / reject-held).
5. **Doctor / stats** for adjudication health.
6. **Precision over recall**; no automatic `AcceptanceDecision`.
7. **SemVer major** reflecting product-meaning break (not packaging only).

---

## Non-goals (2.0)

- Graph materialization / GraphRAG neighborhood — **3.0**
- Project/worktree retrieval facets and real embedding default — **3.0**
- Adjudicated automatic Claim drafting (deferred with evidence in 2.0 freeze)
- Widening recall to make dump search “feel full”
- Hosted multi-tenant knowledge cloud as canonical store
- Untagging or unpublishing 1.0.0

---

## Users and primary jobs

| User | Job to be done |
| --- | --- |
| Operator | Review held units; keep default memory clean |
| Agent (MCP) | Search promoted meaning without opting into draft/held |
| Maintainer | Ship a major that freezes adjudication contracts after Approve |

---

## Product requirements

### Functional

| ID | Requirement | Priority |
| --- | --- | --- |
| F1 | Pure adjudication function maps candidates → promote \| hold \| reject | P0 |
| F2 | Safe-span / secret / noise gates fail closed on promote | P0 |
| F3 | Promote writes Observation (active); hold writes draft path; reject does not | P0 |
| F4 | Disposition identity includes policy version; replay is auditable | P0 |
| F5 | Held review CLI: list / promote-held / reject-held (append-only reviews) | P0 |
| F6 | Default retrieval lifecycle = active/promoted; `--include-held` / `include_held` opt-in | P0 |
| F7 | Doctor reports adjudication counts for current product policy | P0 |
| F8 | Public-safe dogfood smoke proves decisions found and noise absent | P0 |
| F9 | No automatic AcceptanceDecision from adjudication or ranking | P0 |

### Non-functional

| ID | Requirement | Priority |
| --- | --- | --- |
| N1 | Hooks remain fail-open and fast; judgment is post-capture | P0 |
| N2 | Offline deterministic golden fixtures for adjudication | P0 |
| N3 | Precision-first: do not weaken gates to fix fixture/smoke failures | P0 |
| N4 | Freeze packet + maintainer Approve before tag `v2.0.0` | P0 |
| N5 | Never retag/unpublish `v1.0.0` | P0 |

---

## Architecture snapshot (2.0)

```text
provider hook (fail-open)
  → EvidenceArtifact
  → adjudicate (adj_v1)
       ├─ promote → Observation (active) → meaning surface
       ├─ hold    → draft + held queue
       └─ reject  → disposition only
  → retrieval default: active/promoted only
```

Epistemic model unchanged: Observation / Claim / AcceptanceDecision remain
distinct (ADR 0002, ADR 0012).

---

## Success criteria

1. Maintainer-recorded **Approve** after freeze packet.
2. `@innocarpe/carpeos@2.0.0` published; `1.0.0` still present.
3. `smoke:knowledge` and `smoke:dogfood` green; default search free of
   noise/secret/chatter pollution on fixtures.
4. Held workflow operable without rewriting dispositions.
5. Residual risks (calibration, claim-form defer) stated honestly in DoD.

---

## Residuals explicitly deferred after 2.0

- Claim-form golden path / auto claim drafts (`allow_auto_claim: false`)
- Deep calibration of lexical rules vs real operator corpora
- Retrieval-first graph and identity facets → **PRD v3**

---

## Related

- [Product 2.0.0 DoD](maintainers/product-2.0.0.md)
- [Product 1.0.0 DoD](maintainers/product-1.0.0.md)
- ADR 0011 (meaningful unit policy), ADR 0012 (knowledge adjudication)
- [PRD v3](PRD-v3.md) — retrieval-first major
