# Provider-Neutral Capture and MCP

Status: current-main audit. The documented local capture adapters and local MCP
server are implemented and tested repository surfaces; they are not hosted or
production deployment. Product 3.2 B0 shipped in `@innocarpe/carpeos@3.2.0` and is
verified on current main and global activation.

Provider-specific lifecycle payloads are normalized at the boundary and captured
as local evidence. The adapter boundary prevents a provider's field names,
availability, or output from becoming canonical authority.

## Implemented and tested local capture path

```text
documented provider hook JSON
  -> local adapter
  -> protected value
  -> metadata-only EvidenceArtifact + local append-only rows
  -> local retrieval/projection consumers
```

`carpeos capture-hook` supports the documented Codex, Claude Code, and Grok
templates in [`adapters/`](../../adapters/), including stdin/argv handling and
`--fail-open`. The source and synthetic coverage are
[`packages/capture`](../../packages/capture/src/) and
[`packages/capture/test`](../../packages/capture/test/). The local store keeps
the protected value outside the canonical event; the event stores its
`ProtectedValueRef`, provenance, idempotency metadata, and fingerprint rather
than raw hook JSON.

A valid source timestamp supplies `valid_time.start`; local recording sets
`recorded_time.start`. Workspace paths and recording time are not logical
identity. By default, eligible `capture-hook` input captures an
`EvidenceArtifact` and then applies policy-bounded extraction to append an
`Observation`; `--no-extract` disables that extraction. Capture never
automatically creates a Claim, AcceptanceDecision, or Supersession.

## Responsibilities and limits

Adapters preserve non-empty provenance, attach idempotency metadata, keep
provider details behind the boundary, and may fail open when capture failure
would interrupt host work. They must not expose protected values, assign a
canonical `zone_sequence`, mutate a claim into a fact, or treat provider output
as authoritative.

The implemented and tested local MCP implementation is source-backed by
[`apps/carpeos-mcp-server`](../../apps/carpeos-mcp-server/src/) and is limited
to its implemented, tested tool inventory. It resolves local, explicitly visible
trust zones and returns projections rather than canonical mutations. A template,
a roadmap mention, or an adapter-shaped interface does not ship a new provider
integration or MCP tool.

## Planned and deferred work

Remote sync, hosted capture or retrieval, unimplemented provider adapters, and
unimplemented MCP tools remain planned. Local sync transfer/import is implemented
and tested in the repository, but does not establish hosted or production
deployment. Product 3.2 does not change this boundary: B0 shipped in
`@innocarpe/carpeos@3.2.0` as an explicit local reconciliation preview and is
verified on current main and global activation, never a hook or MCP side effect. It
is metadata-only and zero-write. The [Product 3.2 release and activation
receipt](../maintainers/product-3.2.0.md) records release, publication, global
installation, activation, and K0--K12 completion; none establishes hosted
deployment. B1 apply, writer and receipt construction, Supersession construction,
automatic Claim/AcceptanceDecision creation, and sync convergence are deferred.
See [ADR 0015](../adr/0015-policy-version-reconciliation.md).

All examples and fixtures must remain synthetic and body-free at public
boundaries.
