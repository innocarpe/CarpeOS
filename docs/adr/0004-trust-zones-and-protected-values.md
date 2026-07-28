# ADR 0004: Trust Zones and Protected Values

Status: Accepted for planned v1 design

## Context

CarpeOS source code is public, but runtime knowledge is private. Evidence can be
large, sensitive, or subject to erasure. Storing plaintext directly in canonical
events would make projection and sync boundaries unsafe.

## Decision

CarpeOS will model `TrustZone` as a physical isolation boundary with only
`local_device`, `user_cloud`, and `managed_service` isolation classes. Public
network reachability is external-reference access metadata, not a trust zone.
Sensitive or large evidence will use `ProtectedValueRef` to external encrypted
blobs. A DEK encrypts blob content, and a `KeyProvider` protects the DEK.
`ErasureLedger` records tombstone, crypto-shred, and projection-delete actions
with method-compatible targets. Each protected reference carries the same
`protected_value_id` used by encrypted storage and protected-value erasure
targets.

## Consequences

- Canonical events can preserve metadata without storing plaintext.
- Runtime authorization must evaluate trust-zone access.
- Projection builders must consume erasure records.
- Key provider implementations can vary without changing canonical event
  semantics.
