# Threat Model

Status: G008 local release-readiness model. Public examples only.

This document describes the security boundaries CarpeOS relies on for a
local-first private knowledge system. It is not a claim that a hosted deployment
exists.

## Assets

| Asset | Why it matters |
| --- | --- |
| Local SQLite store | Holds canonical metadata, outbox state, pull cursors, and protected-value references. |
| Local protected-value key | Decrypts local protected payloads. Loss can make local encrypted values unrecoverable. |
| Trust-zone sync key | Lets enrolled devices unwrap protected values for the same trust zone. |
| Sync bearer credential | Authorizes a client to the private sync Worker. |
| D1 metadata | Stores sync requests, canonical metadata, sequence state, authorization hashes, and pull state. |
| R2 protected blobs | Stores encrypted protected-value ciphertext only. |
| MCP stdio server | Lets local MCP clients read or write bounded memory tools. |
| Retrieval and Obsidian projections | Rebuildable derived views over canonical records. |
| Public repository | Contains implementation, specs, docs, and synthetic fixtures only. |

## Trust Boundaries

CarpeOS keeps these boundaries separate:

- public repository vs private runtime data;
- local device filesystem vs optional private Cloudflare resources;
- canonical events vs rebuildable projections;
- metadata stored in canonical events vs protected plaintext stored as encrypted
  values;
- bearer authorization for the Worker vs decrypting authority from local keys;
- MCP client process vs local store authorization and visibility checks.

The public repository may include placeholder configuration, but it must not
contain live resource IDs, credentials, private vault exports, runtime database
exports, private project names, real transcripts, or production logs.

## Adversaries

The G008 model considers:

- a public repository reader looking for accidentally committed private data;
- a local process with access to generated projection files;
- an MCP client requesting a hidden trust zone or protected value;
- a network attacker trying to call the sync Worker without authorization;
- an operator mistake that points public placeholder config at live resources;
- an enrolled device that loses local key material;
- a stale projection that keeps data after canonical erasure.

## Controls

Implemented or documented controls include:

- synthetic-only public examples and `pnpm public-boundary`;
- local runtime files kept outside the repository;
- `0600` local credential and sync-key file expectations;
- encrypted protected values instead of plaintext canonical event bodies;
- trust-zone IDs on canonical records and retrieval filters;
- bearer credentials stored locally and only hashed in D1;
- trust-zone sync key never sent to Cloudflare;
- R2 stores encrypted ciphertext, not plaintext;
- sync push uses idempotency and replay/conflict handling;
- sync pull advances local cursors only after applying a page;
- MCP tools require explicit visibility and fail closed on unauthorized zones;
- MCP writes draft claims only and never create accepted facts;
- retrieval candidates are rechecked against canonical visibility;
- Obsidian notes and retrieval chunks are projections and can be rebuilt;
- erasure records drive projection cleanup instead of mutating canonical events.

## Residual Risks

These risks remain for private operators:

- Losing the only local protected-value key can make local encrypted payloads
  unrecoverable.
- Losing the trust-zone sync key can prevent a second device from decrypting
  pulled protected values for that trust zone.
- A compromised enrolled device can read data available to that device.
- A leaked bearer credential can call the Worker until the operator rotates or
  removes the authorization hash.
- Cloudflare resource limits, billing state, or account policy can interrupt
  sync even when local canonical data remains intact.
- Generated projections may leak if copied outside their private vault or
  directory.
- G008 proves a synthetic local Worker/D1/R2 path only; it does not prove a live
  hosted deployment.

## Non-Goals

G008 does not provide:

- hosted production deployment evidence;
- managed key custody or escrow;
- hardware-backed key storage;
- automated credential rotation;
- multi-user authorization;
- public hosted MCP;
- production Workers AI, Vectorize, GraphRAG, or dashboard operation;
- recovery of encrypted private data after all decrypting local keys are lost.
