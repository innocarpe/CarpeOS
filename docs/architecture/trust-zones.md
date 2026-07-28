# Trust Zones and Protected Values

Status: planned architecture for the v1 MVP.

CarpeOS stores public implementation in Git, but private knowledge in runtime
stores. Trust zones enforce that boundary at runtime.

## TrustZone Isolation

A `TrustZone` is a physical and operational isolation boundary. Examples:

- `local_device`: local device storage;
- `user_cloud`: user-controlled cloud storage;
- `managed_service`: managed service storage.

These are the only v1 isolation classes. Public network references are modeled
as external-reference reachability or access metadata, not as a trust-zone
isolation class.

Authorization, projection generation, and MCP retrieval MUST evaluate trust-zone
visibility before returning content.

## Protected Values

Protected values hold large or sensitive content outside the canonical event.
Canonical events hold `ProtectedValueRef` metadata.

```text
CanonicalEvent
  -> EvidenceArtifact
  -> ProtectedValueRef
  -> encrypted blob
  -> DEK
  -> KeyProvider
```

The canonical event stores enough metadata to verify and locate content. It does
not store plaintext.

## Erasure

`ErasureLedger` records erasure actions. Projection builders consume erasure
records and remove or redact affected output.

Crypto-shredding destroys or makes unavailable the DEK. Tombstoning preserves a
marker while hiding content. Projection deletion removes derived plaintext from
non-authoritative read models.

Erasure targets are method-specific: `crypto_shred` targets a protected value or
key, `projection_delete` targets a projection, and `tombstone` targets canonical
metadata for an event or artifact only. A claim or observation tombstone
addresses its canonical event envelope; claim and observation are not separate
erasure target kinds.

## Security Invariants

1. Public repository artifacts MUST NOT contain private runtime data.
2. Protected plaintext MUST NOT be stored in canonical events.
3. MCP tools MUST enforce trust-zone and protected-value authorization.
4. Projection builders MUST consume erasure records.
5. Key-provider changes MUST NOT change canonical event semantics.
