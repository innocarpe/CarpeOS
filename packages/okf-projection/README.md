# `@carpeos/okf-projection`

OKF v0.2 export projection for CarpeOS. It is rebuildable and
non-authoritative: canonical events remain the source of truth
([ADR 0014](../../docs/adr/0014-okf-export-projection.md)). It does not import
content or mutate canonical knowledge.

## Capabilities

- Pure mapping with `mapEventsToOkf` and deterministic Markdown rendering.
- Deterministic, filesystem-independent bundles from `buildOkfProjectionPlan`.
- Manifest-owned disk rebuilds with `delete_missing` (default) and
  `tombstone_missing` policies through `rebuildOkfProjection`.
- OKF v0.2 bundle conformance checks with `checkOkfConformance`.
- Field mapping details: [MAPPING.md](./MAPPING.md).

## Usage (library)

```ts
import {
  buildOkfProjectionPlan,
  checkOkfConformance,
  rebuildOkfProjection,
  type OkfMapInput,
  type OkfProjectionConfig,
} from "@carpeos/okf-projection";

const snapshot: OkfMapInput = { events: [] };
const config: OkfProjectionConfig = {
  outputRoot: "./synthetic-okf-bundle",
  visibleTrustZoneIds: ["tz_local_default"],
  generatedAt: "2026-07-31T12:00:00Z",
};

const plan = buildOkfProjectionPlan({ snapshot, config });
const conformance = checkOkfConformance({
  files: plan.files,
  manifest: plan.manifest,
});
if (!conformance.valid) throw new Error("Planned bundle is not conformant");
rebuildOkfProjection({ snapshot, config });
```

`buildOkfProjectionPlan` and `checkOkfConformance` do not touch the filesystem.
`rebuildOkfProjection` creates planned files and rewrites or deletes only paths
owned by a valid prior manifest.

## Defaults and safety

- Only promoted/active meaning is included; `includeHeld` opts in to draft
  observations.
- Referenced evidence metadata is included by default.
- `visibleTrustZoneIds` is required and must not be empty.
- Existing unmanaged paths, unsafe paths, and corrupt manifests fail closed.
- There is no import path.

## Test

```bash
pnpm --filter @carpeos/okf-projection test
```
