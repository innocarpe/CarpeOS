# `@carpeos/okf-projection`

OKF v0.2 **export projection** for CarpeOS. Rebuildable, non-authoritative.
Canonical events remain SSOT ([ADR 0014](../../docs/adr/0014-okf-export-projection.md)).

## K1 status

Shipped here:

- Pure mapper `mapEventsToOkf` (events → concepts + `index.md` / `log.md` strings)
- Deterministic `renderOkfConcept` markdown renderer
- Field mapping table: [MAPPING.md](./MAPPING.md)
- Golden fixtures + vitest suite

Not yet (K2+):

- Disk rebuild + ownership manifest
- CLI `carpeos okf export` / `rebuild`
- Full OKF conformance CLI checker

## Usage (library)

```ts
import { mapEventsToOkf, renderOkfConcept } from "@carpeos/okf-projection";

const result = mapEventsToOkf(
  { events: [/* OkfMapInputEvent rows */] },
  {
    visibleTrustZoneIds: ["tz_local_default"],
    generatedAt: "2026-07-31T12:00:00Z",
  },
);

for (const concept of result.concepts) {
  const markdown = renderOkfConcept(concept);
  // write concept.path later in K2
}
```

## Defaults

- Promoted / active meaning only (`includeHeld` opt-in for draft observations)
- Evidence: referenced + metadata only
- No import path

## Test

```bash
pnpm --filter @carpeos/okf-projection test
```
