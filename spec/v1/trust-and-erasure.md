# CarpeOS v1 Trust Zones and Erasure

Status: planned normative design for the v1 runtime.

This document defines the privacy and erasure semantics for protected values.

## TrustZone

`TrustZone` is a physical and operational isolation boundary. It is not only a
tag.

Examples of isolation classes:

- `local_device`;
- `user_cloud`;
- `managed_service`.

These are the only v1 `TrustZone.isolation` values. Public network endpoints,
URLs, and other internet reachability facts are external-reference access
metadata, not a trust-zone isolation class.

Implementations MUST evaluate access by trust zone before returning canonical
events, protected-value metadata, decrypted blobs, or projection output.

## ProtectedValueRef

`ProtectedValueRef` points to an encrypted blob instead of storing plaintext in
the canonical event.

The event may store:

- vault reference;
- key reference;
- encryption algorithm;
- nonce reference;
- authentication tag reference;
- digest;
- size.

The event MUST NOT store plaintext protected content.

## DEK and KeyProvider

A DEK encrypts protected blob content. A `KeyProvider` protects the DEK.

The v1 runtime SHOULD support pluggable key providers, such as local keychain,
user-managed cloud KMS, or future self-hosted providers. Provider choice MUST NOT
change canonical event semantics.

If a key cannot be unwrapped, queries MAY return redacted lineage and metadata.
They MUST NOT substitute guessed plaintext.

## ErasureLedger

`ErasureLedger` records erasure actions. Supported planned methods are:

- `tombstone`;
- `crypto_shred`;
- `projection_delete`.

Erasure records MUST preserve enough audit metadata to prove the action happened
without preserving the erased plaintext.

Each erasure record MUST include an `erasureTargetRef` compatible with the
method:

| Method | Allowed target |
| --- | --- |
| `crypto_shred` | `protected_value` or `key` only. |
| `projection_delete` | `projection` only. |
| `tombstone` | Canonical metadata record: `event` or `artifact` only. |

A claim or observation tombstone MUST address its canonical event envelope.
`claim` and `observation` MUST NOT be modeled as separate erasure target kinds.

Implementations MUST reject erasure records whose method and target category do
not match these rules.

Projection builders MUST consume `ErasureLedger` records and remove, redact, or
mark affected projection output according to the erasure method.

## Failure Modes

| Failure mode | Required behavior |
| --- | --- |
| Missing encrypted blob | Keep canonical metadata, return missing-content lineage. |
| Digest mismatch | Treat blob as corrupted and do not decrypt. |
| Key unavailable | Return redacted protected-value reference. |
| Erasure incomplete | Keep erasure record pending until completion evidence exists. |
| Projection still contains erased content | Treat as projection bug and rebuild or delete projection output. |

## Synthetic Example

An `EvidenceArtifact` for Example Alpha points to `vault:synthetic_local` with
`key_ref = key:example_local_dek_001`. A later `ErasureLedger` record uses
`crypto_shred` against that protected value or its key. The canonical event
remains as audit metadata, but the DEK is destroyed and projections must remove
plaintext.
