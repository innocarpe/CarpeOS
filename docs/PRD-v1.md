# PRD v1 — CarpeOS 1.0

Status: **Shipped** as `@innocarpe/carpeos@1.0.0`  
DoD SSOT: [maintainers/product-1.0.0.md](maintainers/product-1.0.0.md)  
Series: [PRD-v2](PRD-v2.md) · [PRD-v3](PRD-v3.md)

This document is the **product requirements snapshot for major version 1**.
It captures the thesis, problem, scope, and success criteria that defined the
1.0 release. Implementation detail and living gates live in the DoD linked above.
When a new major ships, add `PRD-vN.md` rather than rewriting this file.

---

## Version thesis

> **Does the loop run?**

CarpeOS 1.0 proves that private agent work can be captured, stored, and searched
**end-to-end on a local machine**, with a frozen public contract for CLI, MCP,
setup, and store.

| | 1.0 |
| --- | --- |
| Question | Does the capture → store → search loop work? |
| Core engine | Capture adapters + local canonical store + hybrid search shell |
| Success signal | `smoke:product` and a usable local install path |
| Failure if skipped | No durable personal trail at all |

---

## Problem

Operators run many LLM coding sessions across hosts and repositories. Without a
shared local pipeline:

- session context dies when the chat ends;
- there is no common envelope across Claude / Codex / Grok hooks;
- “memory” products either stay cloud-only or treat raw dumps as knowledge.

1.0 does **not** yet decide what is brain-worthy. It establishes the pipe so
later majors can judge and retrieve.

---

## Goals

1. **Local-first capture** from provider hooks (fail-open, fast).
2. **Canonical local store** (append-only events, protected values, outbox).
3. **Public package surface** (`@innocarpe/carpeos`) with CLI / MCP / setup doctor.
4. **Search shell** over stored units (hybrid retrieval projection v1).
5. **Contract freeze** so adapters and operators can depend on 1.x behavior.

---

## Non-goals (1.0)

- Knowledge adjudication (what is worth remembering) — **2.0**
- Cross-repo / worktree-aware retrieval and graph neighborhood — **3.0**
- Multi-tenant SaaS brain or hosted canonical graph
- Automatic acceptance of claims
- Replacing the user’s git / IDE workflow

---

## Users and primary jobs

| User | Job to be done |
| --- | --- |
| Solo operator / maintainer | Install hooks, capture sessions, search later on the same machine |
| Agent (via MCP) | Call memory search / get / context-pack against the local home |
| Package consumer | Depend on a versioned npm CLI without private monorepo paths |

---

## Product requirements

### Functional

| ID | Requirement | Priority |
| --- | --- | --- |
| F1 | Provider hooks emit a common capture envelope | P0 |
| F2 | Hooks fail open so host tools never block on CarpeOS errors | P0 |
| F3 | Local store persists EvidenceArtifact (+ extract shell units) idempotently | P0 |
| F4 | Protected / secret material stays out of plaintext event statements | P0 |
| F5 | CLI can capture, setup hooks, doctor, and search | P0 |
| F6 | MCP exposes a minimal memory tool surface (search / get / pack family) | P0 |
| F7 | Public install path works from the published package | P0 |

### Non-functional

| ID | Requirement | Priority |
| --- | --- | --- |
| N1 | Local-first: core loop works offline | P0 |
| N2 | Deterministic tests and public-safe fixtures in CI | P0 |
| N3 | No absolute home paths in public package artifacts | P0 |
| N4 | SemVer: 1.0 freezes the pipeline contract; do not untag after cut | P0 |

---

## Architecture snapshot (1.0)

```text
provider hook (fail-open)
  → capture envelope
  → local canonical store (SQLite)
  → retrieval projection (chunks + FTS + early vectors)
  → CLI / MCP search
```

Canonical event stream is SSOT. Projections are rebuildable (ADR 0001 lineage).

---

## Success criteria

1. A clean machine can install `@innocarpe/carpeos@1.0.0`, attach hooks, capture a
   synthetic session, and search it back.
2. `smoke:product` (or equivalent pipeline smoke) is green on `main` at tag.
3. Public boundary check passes (no private paths/secrets in published tree).
4. DoD gates for 1.0 are recorded as shipped in `product-1.0.0.md`.

---

## Out of scope residuals carried to later majors

- Judgment of brain-worthy content → **PRD v2**
- Meaningful, structured, cross-checkout retrieval → **PRD v3**

---

## Related

- [Product 1.0.0 DoD](maintainers/product-1.0.0.md)
- [Architecture overview](architecture/overview.md)
- ADR 0001 (canonical store), 0005 (capture outbox), 0007 (hybrid retrieval), 0008 (MCP/Obsidian)
