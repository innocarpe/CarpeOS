# ADR 0014: Open Knowledge Format (OKF) as an export projection

Status: **Accepted** for product 3.1 design (maintainer direction 2026-07-31)

Date: 2026-07-31

## Context

CarpeOS already has a private, opinionated knowledge model:

- append-only `CanonicalEvent` stream as source of truth (ADR 0001);
- immutable epistemic types: Observation / Claim / AcceptanceDecision /
  Supersession / Erasure (ADR 0002);
- knowledge adjudication (`promote` | `hold` | `reject`) before meaning lands
  on the default retrieval surface (ADR 0012);
- rebuildable projections for retrieval, graph, MCP, and Obsidian (ADR 0008,
  ADR 0013).

In June 2026 Google Cloud published the **Open Knowledge Format (OKF)** — an
open, vendor-neutral specification that represents curated knowledge as a
directory of Markdown files with YAML frontmatter. OKF formalizes the
“LLM-wiki” pattern so producers and consumers can exchange agent-usable context
without a proprietary catalog SDK. As of OKF v0.2 the format also carries
optional provenance, trust, lifecycle, and attestation vocabulary.

Without an interoperability surface, CarpeOS knowledge remains useful only to
CarpeOS MCP/CLI/Obsidian consumers. External agents, data catalogs, and other
markdown-first tools cannot consume adjudicated CarpeOS knowledge without a
CarpeOS-specific integration.

Risks of naive adoption:

1. Treating OKF as a second source of truth (users edit exported files and expect
   mutation of memory).
2. Replacing the canonical store with a markdown tree (loses adjudication,
   bitemporality, trust zones, protected values, rebuildability).
3. Importing foreign OKF bundles as promoted meaning without adjudication
   (reintroduces dump pollution that 2.0 removed).
4. Leaking absolute paths, protected plaintext, private remotes, or unpromoted
   held content into portable bundles.

## Decision

**OKF is a rebuildable, non-authoritative export projection of already-visible
CarpeOS knowledge. It is not canonical storage, not an import authority, and not
a replacement for Obsidian or MCP.**

### 1. Projection, not platform

- Canonical authority remains the local event stream and adjudication
  dispositions (ADR 0001, ADR 0012).
- OKF bundles are derived views, same class as Obsidian notes and retrieval
  indexes: rebuildable, deletable, and never required for CarpeOS to function.
- Generated concept files MUST mark non-authority explicitly in body and/or
  CarpeOS extension keys (for example `carpeos_projection: true`,
  `canonical_effect: "none"`), analogous to ADR 0008 Obsidian notes.
- Editing an OKF file has no canonical effect unless a future, explicit capture
  flow records a new event.

### 2. Export-first scope for 3.1

Product 3.1 ships **export only**:

| Direction | 3.1 | Later |
| --- | --- | --- |
| Export promoted/active (and optionally held with flag) knowledge to OKF v0.2 | yes | refine types |
| Round-trip import as automatic promote | no | **never** as default |
| Import as **held** candidates for operator review | no | only via a **new ADR** if pursued; not promised |
| Attested Computation runtime | no | optional B2B/team path |
| Google Knowledge Catalog / cloud catalog integration | no | optional adapter |

**Import stance (locked):** personal-OS default path does not include OKF
import. A future held-only import is not part of the 3.1 contract and must not
be half-implemented as a side effect of export.

### 3. Conformant OKF v0.2 surface

Produced bundles MUST satisfy OKF v0.2 conformance at minimum:

1. every concept `.md` has parseable YAML frontmatter;
2. every concept has non-empty `type`;
3. reserved filenames `index.md` and `log.md` (when present) follow OKF
   structure.

CarpeOS uses OKF’s **minimally opinionated** type model: we define a closed set
of **CarpeOS producer types** for export stability, but consumers must tolerate
unknown types. Suggested initial type map (normative for the exporter, not a
global ontology registry):

| CarpeOS unit | OKF `type` (initial) | Default path prefix |
| --- | --- | --- |
| Accepted fact (Claim + visible AcceptanceDecision) | `Accepted Decision` | `decisions/` |
| Promoted Observation (`lifecycle_status: active`) | `Observation` | `observations/` |
| Draft / held Observation | `Draft Observation` | `drafts/` (export only with explicit flag) |
| Evidence summary (safe metadata only) | `Evidence Summary` | `evidence/` |
| Supersession note | `Supersession` | `lineage/` |
| Erasure tombstone (redacted) | `Erasure` | `lineage/` |
| Bundle root / directory listing | `index.md` (reserved) | `/`, subdirs |
| Export run history | `log.md` (reserved) | bundle root |

**Type string policy (locked):** use short **human-readable English phrases** as
OKF `type` values (table above). Do **not** emit raw schema event-type tokens
(`Claim`, `AcceptanceDecision`) as the primary `type` — those stay in extension
key `carpeos_event_type` when useful for CarpeOS-aware consumers. OKF has no
central type registry; stability of *our* producer types is a CarpeOS contract.

**Evidence policy (locked for 3.1):** export **safe metadata only** (ids,
media/type labels already public-safe, lineage links). No evidence body
excerpts, no protected plaintext, no raw hook payloads.

**log.md policy (locked):** write/update bundle-root `log.md` on each export run
(newest-first date sections per OKF §9). Omit subdirectory logs unless a later
minor needs them.

Rejected content is **not** exported by default.

### 4. Trust and lifecycle mapping

Map CarpeOS epistemic state onto OKF v0.2 optional families without inventing a
score:

| CarpeOS signal | OKF field | Notes |
| --- | --- | --- |
| Capture / extract producer | `generated.by` | actor form `carpeos/<package-version>` or `process:adj_v1` |
| Event `recorded_time` or disposition time | `generated.at` | ISO-8601 |
| Human held-review promote | `verified[]` with `human:<id>` when known | else omit |
| Policy / process re-check | `verified[]` with `process:adj_v1` | machine-confirmed tier |
| `lifecycle_status: active` + promote | `status: stable` | |
| draft / hold | `status: draft` | only if export-held enabled |
| superseded / deprecated meaning | `status: deprecated` | keep for link stability when exported |
| Optional operator policy | `stale_after` | not invented silently |
| Evidence / prior events | `sources[]` | bundle-relative or event-id keyed; no absolute local paths |
| Canonical event id | extension `carpeos_event_id` | preserved by consumers that round-trip |
| Trust zone id | extension `carpeos_trust_zone_id` | never invent a global zone |

Trust tiers remain **advisory** (OKF semantics). They never bypass CarpeOS
trust-zone visibility or protected-value policy at export time.

### 5. Safety and public boundary

Export MUST:

- require explicit visible trust-zone selection (fail closed if missing);
- default to **promoted/active only** (align with 2.0/3.0 retrieval defaults);
- redaction-check body and frontmatter (no protected plaintext, credentials,
  absolute local paths, private remote URLs, raw hook dumps);
- write only under a configured output root with a ownership manifest
  (`.carpeos-okf-projection-manifest.json` or equivalent);
- delete previously managed files only when the manifest proves ownership
  (mirror Obsidian projection path policy).

### 6. Package and CLI shape

- Prefer a dedicated package `@carpeos/okf-projection` (or a clearly named
  module under an existing projection package) that consumes **typed local-store
  snapshots**, not ad hoc SQL — same boundary as ADR 0008.
- Operator surface (locked for 3.1):
  - `carpeos okf export` — write/refresh an OKF bundle under `--out`
  - `carpeos okf rebuild` — alias or explicit rebuild path with the same
    manifest ownership rules (implementation may make one call the other)
- Flags (minimum contract): `--out`, `--visible-trust-zone` (fail closed if
  missing), `--include-held` (default off). Match existing multi-zone CLI style.
- MCP tools are **not** required for 3.1; agents that need OKF can read the
  exported filesystem bundle. A future `memory_export_okf` tool is optional and
  out of 3.1 unless free with the CLI work.

### 7. Relationship to Obsidian projection

Obsidian projection remains the human vault view. OKF projection is the
**portable agent/catalog exchange view**.

- Do **not** force Obsidian notes to become the only OKF producer in 3.1.
- Shared helpers (YAML frontmatter render, path safety, redaction asserts) may
  be extracted, but the two projections keep separate manifests, version
  strings, and default include policies.
- A later minor may offer “Obsidian output is OKF-conformant enough to open as a
  bundle”; that is an optimization, not the 3.1 definition of done.

### 8. Versioning

- Product packaging target: **`@innocarpe/carpeos@3.1.0`** (MINOR: additive
  interop feature after 3.0 retrieval major).
- No new major: OKF does not change default CLI/MCP contracts or force
  migration of existing stores.
- OKF `okf_version: "0.2"` may be declared on bundle-root `index.md` per OKF
  §12; CarpeOS projection version is recorded separately in the manifest.

## Consequences

Positive:

- Adjudicated CarpeOS knowledge becomes portable to any OKF consumer without
  embedding CarpeOS.
- Product story gains an industry lingua franca without abandoning epistemic
  control.
- Projection architecture (ADR 0001) gains a clean third interface class:
  retrieval / human notes / portable exchange.

Tradeoffs:

- Two markdown projections (Obsidian + OKF) increase maintenance surface.
- OKF type strings are producer conventions; external tools may not understand
  CarpeOS-specific types until documentation lands.
- Export without import may feel incomplete to some operators; that is
  intentional precision-first posture.
- OKF v0.x may evolve; exporter must tolerate forward-compatible frontmatter
  and pin tested target version in docs/tests.

## Non-goals (this ADR)

- Replacing SQLite / local-store with a markdown directory.
- Defining a universal enterprise ontology.
- Using OKF as a search ranking or SEO signal.
- Shipping Attested Computation executors/attesters.
- Hosted Knowledge Catalog product integration.
- OKF import of any kind in 3.1 (including held-only).

## Decision log (Phase 0 review)

| # | Question | Decision |
| --- | --- | --- |
| 1 | CLI noun | `carpeos okf export` / `carpeos okf rebuild` |
| 2 | OKF `type` strings | Human-readable phrases (`Accepted Decision`, …); schema names in `carpeos_event_type` |
| 3 | Evidence body | Safe metadata only; no excerpts in 3.1 |
| 4 | `log.md` | Yes — update root log each export run |
| 5 | Import | Out of 3.1 and not promised; future needs new ADR |

## References

- OKF announcement (2026-06-12): Google Cloud “Introducing the Open Knowledge Format”
- OKF v0.2 spec: `GoogleCloudPlatform/knowledge-catalog` → `okf/SPEC.md`
- ADR 0001 Canonical store and projections
- ADR 0008 MCP and Obsidian interfaces
- ADR 0012 Knowledge adjudication
- ADR 0013 Retrieval-first projection layer
- Product DoD: [product-3.1.0.md](../maintainers/product-3.1.0.md)
- Implementation plan: [okf-interop.md](../plans/okf-interop.md)
