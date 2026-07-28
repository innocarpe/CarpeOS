# Retrieval Guide

Status: G006 local implementation and synthetic tests. Not deployed.

This guide describes the local retrieval path for a private CarpeOS runtime. It
uses synthetic placeholders only. Do not copy real transcripts, protected
values, provider payloads, credentials, local paths, production logs, or private
project names into this repository.

## Boundary

G006 retrieval is a local projection over canonical events and erasure records.
It is not the source of truth. The canonical event stream, erasure ledger,
trust-zone policy, and projection freshness metadata remain authoritative.

The local CLI supports:

- rebuilding retrieval chunks from canonical events;
- creating deterministic local development embeddings;
- searching visible memory with structured, full-text, recency, and vector
  candidate signals;
- fetching a single visible chunk by `chunk_id`.

The CLI does not expose a public hosted retrieval route. Workers AI and
Vectorize adapters are not live in this repository, and no network retrieval
test is claimed.

## Projection Rebuild

Rebuild the local retrieval projection from visible canonical records:

```sh
carpeos retrieval rebuild \
  --trust-zone tz_synthetic_example
```

The command is idempotent. Rebuilding replaces derived retrieval chunks and
freshness metadata from canonical inputs. It does not mutate canonical events.

Retrieval chunks are meaningful units, not raw hook dumps. Current chunk sources
include claims, observations, acceptance decisions, and selected evidence
metadata. Raw protected values, encrypted ciphertext, provider payloads, local
database paths, and credential locations must not be projected into result text.

## Development Embeddings

Create local deterministic development embeddings:

```sh
carpeos retrieval embed \
  --provider deterministic-local-dev \
  --trust-zone tz_synthetic_example \
  --limit 10
```

`deterministic-local-dev` is synthetic and development-only. It gives tests and
local smoke checks a stable vector shape without claiming semantic quality.

The CLI fails closed for production providers:

```sh
carpeos retrieval embed --provider workers-ai
```

Hosted embedding requires later operator configuration, quotas, credentials,
deployment evidence, and tests. Do not treat the deterministic provider as a
semantic search benchmark.

## Search

Search requires explicit trust-zone visibility:

```sh
carpeos memory search \
  --query "Alpha deterministic" \
  --visible-trust-zone tz_synthetic_example \
  --trust-zone tz_synthetic_example \
  --limit 10
```

Results include:

- score components for structured, full-text, semantic, and recency candidates;
- source record lineage;
- redaction/exclusion reasons;
- projection freshness;
- filters applied at query time.

Every result is rechecked against canonical state before it is returned. A
vector or full-text hit can be excluded if trust-zone visibility, lifecycle
state, epistemic authority, supersession, erasure, or stale projection metadata
does not permit visibility.

## Get

Fetch one visible chunk by ID:

```sh
carpeos memory get \
  --chunk-id chk_synthetic_example \
  --visible-trust-zone tz_synthetic_example \
  --trust-zone tz_synthetic_example
```

`memory get` still applies visibility and freshness checks. A stored chunk row
is not returned just because its ID exists locally.

## Output Safety

Retrieval output must not print:

- raw hook JSON;
- encrypted protected-value ciphertext;
- credentials, tokens, cookies, private keys, or secret file contents;
- local absolute paths;
- provider request/response payloads;
- private project names or private repository URLs.

Synthetic tests should use public-safe fixture strings and assert that protected
sentinels do not leak into CLI output.

## Freshness and Lineage

Projection freshness can be current or stale. Stale projections should surface
the stale reason instead of silently presenting a polished fact.

Superseded, rejected, erased, or hidden records may still appear as excluded
lineage when that helps explain why a result is not visible. The retrieval layer
must not collapse this metadata into a single accepted answer.

## LLM Use

G006 exposes retrieval through CLI commands only. MCP tools such as
`memory_search`, `memory_get`, `memory_context_pack`, `memory_trace`, and
`memory_timeline` remain planned interfaces. Until those tools exist, an LLM can
only use this retrieval path when an operator or local integration runs the CLI
and passes the bounded output into the model context.
