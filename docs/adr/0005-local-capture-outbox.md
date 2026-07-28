# ADR 0005: Local Capture Store and Outbox

Status: Accepted for G004 local runtime

## Context

CarpeOS needs a provider-neutral local capture layer before remote sync and
retrieval exist. Hooks from Codex, Claude Code, and Grok Build must be able to
record raw lifecycle payloads without blocking normal agent work, leaking raw
transcripts into the public repository, or assigning server-owned ordering
metadata.

The first runtime also needs to stay practical for a local Node monorepo. Adding
a native SQLite addon would increase install and build friction at the exact
stage where the project needs small, portable tests.

## Decision

G004 uses Node 22.22+ built-in `node:sqlite` behind a narrow local-store adapter.
This avoids a native addon dependency. The tradeoff is explicit: Node 22.22
prints an `ExperimentalWarning`, and `node:sqlite` remains a Stability 1.1 API
surface in this runtime.

The local store records provider hook payloads with one atomic transaction:

1. insert a `capture_requests` row;
2. encrypt the raw normalized envelope as an AES-256-GCM protected value;
3. insert a metadata-only `EvidenceArtifact` canonical event;
4. insert a durable outbox row containing a non-empty sync push request.

Raw payloads are always encrypted before storage. The AES-256-GCM key is kept in
local key material outside the SQLite database. The canonical event stores a
`ProtectedValueRef`, not plaintext.

The local database uses `local_sequence` for device-local ordering. It does not
assign canonical `zone_sequence`; remote sync will assign zone-scoped server
sequence values in G005+.

Provider event time and CarpeOS ingestion time remain separate. A valid provider
timestamp becomes `valid_time.start`; the local store clock determines
`recorded_time.start` and the database creation timestamps. A delayed or replayed
provider payload therefore cannot rewrite when CarpeOS actually recorded the
first accepted event.

Source-valid capture time is part of the request fingerprint and derived
idempotency identity because it is part of the event's domain semantics. The
append-only `capture_requests` row stores both `captured_at` and `recorded_at`
instead of overloading one timestamp.

`capture_requests` and `canonical_events` are append-only. SQLite triggers reject
updates and deletes. The `outbox` table is mutable because delivery state must
move through `pending`, `leased`, and `delivered`, and failed delivery attempts
must return to `pending`.

Idempotency identity remains `(trust_zone_id, idempotency_key)`. Replaying the
same fingerprint returns the existing event and outbox row. Reusing the same
idempotency key with different logical content raises an idempotency conflict.
The same idempotency key in a different trust zone is a distinct request.

## Consequences

- Local capture can run without a remote server.
- Hook failures can fail open so AI agent work is not blocked by CarpeOS.
- Raw provider JSON does not appear in canonical events or command output.
- Source-valid time stays distinct from CarpeOS recorded time.
- Canonical references, encrypted rows, leased metadata, and protected-value
  erasure targets share one `protected_value_id`.
- Device-local ordering is available before remote sequence assignment.
- G004 can verify idempotency, encryption, append-only behavior, and outbox lease
  state entirely with synthetic fixtures.
- The runtime accepts the current `node:sqlite` warning rather than adding a
  native addon dependency.

## Non-Goals

G004 does not implement:

- remote sync or cross-Mac sharing;
- server-assigned `zone_sequence`;
- Cloudflare Workers, D1, R2, Workers AI, Vectorize, or Pages adapters;
- MCP retrieval tools;
- Obsidian, vector, graph, dashboard, or context-pack projections;
- extraction into `Observation`, `Claim`, `AcceptanceDecision`, or
  `Supersession`;
- packaged CLI installation beyond the repository-local implementation and
  public hook templates.
- protected-value blob upload; the G004 outbox leases metadata requests and the
  local protected value ID, while G005 must define a vault upload or encrypted
  blob transfer phase.
