# OKF Export Guide

Status: local CLI implementation for the 3.1.0 product increment; this does
not claim that 3.1.0 is released. This guide uses synthetic examples only.

CarpeOS exports selected knowledge as an **OKF v0.2 projection**. It is a
portable Markdown bundle for an OKF consumer; it is not CarpeOS's canonical
store, an import format, or a claim that CarpeOS itself is OKF. Canonical
authority remains the local event stream and adjudication dispositions. See
[ADR 0014](../adr/0014-okf-export-projection.md) and the
[product 3.1.0 Definition of Done](../maintainers/product-3.1.0.md).

## Prerequisites

Before exporting, use a local CarpeOS store that has knowledge in the intended
trust zone and choose an output directory that is safe to manage. The command
reads the visible, authorization-shaped local snapshot; it does not query a
foreign bundle or mutate canonical events.

An operator may choose an absolute output root or a relative one. Generated
paths are constrained beneath that root and cannot escape it. The command
fails when a generated target or a required path component is a symlink, or
when an unmanaged file collides with a planned generated path. Keep unrelated
files outside managed concept paths, and never edit a managed file expecting
that edit to enter CarpeOS.

## Export a visible trust zone

Pass an output directory and every trust zone that may be visible. The
`--visible-trust-zone` flag is repeatable.

```bash
carpeos okf export \
  --out ./synthetic-okf-bundle \
  --visible-trust-zone tz_synthetic_example
```

Visibility is deliberately fail-closed. The command requires at least one
explicit `--visible-trust-zone`, validates each supplied ID, and requires the
active store zone to be included. It does not infer a visible zone from the
current directory, an output path, or an omitted flag. Correct a missing or
invalid zone selection rather than retrying with a broader zone.

By default, export includes only promoted/active knowledge visible in the
selected zones. Held or draft observations are excluded. Include them only for
a deliberate review or exchange use case:

```bash
carpeos okf export \
  --out ./synthetic-okf-bundle \
  --visible-trust-zone tz_synthetic_example \
  --include-held
```

`--include-held` does not promote anything. Included held observations render
as draft material; rejected content is not part of the normal export surface.

## Bundle layout

An exported directory is an OKF v0.2 bundle. Its root reserves these files:

```text
synthetic-okf-bundle/
  index.md
  log.md
  .carpeos-okf-projection-manifest.json
  decisions/
  observations/
  drafts/                 # only when --include-held produces draft concepts
  evidence/
  lineage/
```

`index.md` declares `okf_version: "0.2"` and lists concepts. `log.md` records
the current export run. Concept directories reflect the exported concept kind:
accepted decisions, promoted observations, opted-in draft observations, safe
evidence summaries, and lineage such as supersessions. A bundle can omit
directories with no generated concepts.

Concept Markdown has OKF frontmatter including a non-empty human-readable
`type`. CarpeOS writes `status`, trust and lifecycle signals, and CarpeOS
extension keys where known. Evidence is safe metadata only: it never exports
evidence-body excerpts or raw capture payloads.

The manifest is CarpeOS metadata, not an OKF concept. It records its schema and
manifest types, projection and OKF versions, visible trust-zone IDs, the path
policy (currently `delete_missing`), and each managed path with its content
digest and tombstone marker.

## Refresh or rebuild

Use the same visibility selection to refresh the managed bundle:

```bash
carpeos okf rebuild \
  --out ./synthetic-okf-bundle \
  --visible-trust-zone tz_synthetic_example
```

`rebuild` uses the same inclusion defaults and `--include-held` opt-in as
`export`. Both commands write a projection only; neither command imports a
bundle, records a new event, changes adjudication, or changes canonical
knowledge.

Cleanup is manifest-bounded. A valid prior manifest establishes ownership for
rewrites and deletes. A corrupt manifest fails closed; a missing manifest plus
a collision at a planned path also fails closed. Unmanaged files are preserved.
Do not delete or corrupt the manifest to force cleanup. Individual file writes
are made safely, but an operational failure is not promised to leave the whole
bundle without partial writes.

## Output and exit behavior

On success, either command exits `0` and writes exactly one JSON object to
stdout. The `okf export` and `okf rebuild` summaries
include `ok`, `command`, `projection: "okf-export/v1"`,
`okf_version: "0.2"`, `output_root`, `visible_trust_zone_ids`,
`include_held`, `concept_count`, `file_count`, `manifest_status`,
`manifest_path`, `written`, `deleted`,
`preserved_deletion_because_manifest_corrupt`, and
`conformance_warning_count`.

On failure, no success JSON is emitted. The existing public JSON error boundary
writes one error object to stderr. Usage validation exits `2`; operational,
OKF-conformance, and filesystem-safety failures exit `1`. A failure is not a
partial-success result.

## Safety and authority boundary

Treat an OKF bundle as portable output. Before sharing it, review it as you
would any public artifact. The exporter rejects unsafe generated paths and
checks body and frontmatter for protected plaintext. Do not place credentials,
absolute local paths, private remote URLs, raw session dumps, or real private
knowledge in synthetic examples or published bundles.

Editing `index.md`, `log.md`, or a concept file has no canonical effect. There
is **no OKF import command or import path in 3.1.0**. A future capture or import
workflow would require an explicit design and adjudication path; it is not
implied by this export projection.