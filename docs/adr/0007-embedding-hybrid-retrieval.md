# ADR 0007: Embedding and Hybrid Retrieval Boundary

Status: accepted

Date: 2026-07-29

## Context

CarpeOS needs retrieval that is useful to humans and LLMs without flattening the
canonical knowledge model into plain text. The system must preserve data
lineage, trust-zone visibility, epistemic authority, supersession, erasure, and
projection freshness.

Semantic retrieval is useful for recall, but it is not an authority model. A
nearest-neighbor vector hit can find a relevant chunk; it cannot decide that a
claim is accepted, current, visible, or safe to disclose.

The personal MVP should stay cheap enough for local-first use and early
Cloudflare experiments. Public code must not assume live hosted AI resources.

## Decision

CarpeOS uses hybrid retrieval:

- structured filtering for trust zones, lifecycle state, epistemic authority,
  valid time, recorded time, project identity, and source record metadata;
- full-text search for exact and lexical matching;
- vector search as an optional semantic candidate source;
- recency scoring as a bounded ranking signal;
- canonical recheck before returning any visible result.

Retrieval indexes are rebuildable projections. They are derived from canonical
events, erasure records, configuration, and authorization policy. They are never
the source of truth.

CarpeOS embeds meaningful knowledge units rather than raw hook payloads. Good
candidate units include claims, observations, decisions, session summaries, and
selected evidence metadata. Raw hook JSON, protected values, provider payloads,
credentials, local paths, and production logs are excluded from embedding input
and retrieval output.

The target production embedding shape for the first hosted adapter is:

- model family: BGE-style text embeddings;
- candidate model: `@cf/baai/bge-base-en-v1.5`;
- dimensions: 768;
- maximum chunk budget: about 512 tokens per chunk;
- pooling metadata: `mean` or provider-reported equivalent when exposed.

The local CLI includes `deterministic-local-dev` embeddings. This provider is
synthetic and development-only. It creates stable 768-dimensional vectors for
tests and smoke checks without claiming semantic quality.

Hosted Workers AI and Vectorize support remains asynchronous and not deployed in
this repository. A private operator must provision resources, bind credentials,
seed authorization, run migrations, and collect deployment evidence before
claiming hosted semantic retrieval.

## Cloudflare Free-Tier Caveats

Official Cloudflare limits are operational constraints and can change. Before
running hosted embedding or vector search, verify the current Workers AI and
Vectorize pricing/limits pages.

As of the G006 design update:

- Workers AI free usage is documented as 10,000 Neurons/day. The practical issue
  is that embedding throughput is capped by daily Neuron quota; jobs must be
  bounded, retryable, and resumable.
- Vectorize free usage is documented as 30 million queried vector
  dimensions/month and 5 million stored vector dimensions/account. With
  768-dimensional embeddings, stored vector capacity is consumed by
  `stored_vectors * 768`, and query budget is consumed by the number of vector
  dimensions scanned/queried.

Free-tier limits are not correctness guarantees. If a quota is exceeded, the
operator should pause hosted embedding, keep local canonical data intact, and
resume later without accepting partial vector projection state as authority.

## Consequences

Positive consequences:

- LLM-facing retrieval can cite source records and exclusion reasons instead of
  returning ungrounded memory.
- Retrieval can improve ranking without weakening ontology, lineage, or erasure
  guarantees.
- Local deterministic embeddings keep tests stable without requiring network
  credentials or paid infrastructure.
- Hosted semantic search can be added later through adapter boundaries.

Tradeoffs:

- Retrieval queries are more expensive than direct vector lookup because every
  candidate must be rechecked.
- Embedding jobs need explicit lifecycle state and projection freshness metadata.
- Some relevant text may remain hidden when trust-zone visibility or erasure
  policy excludes it.
- Hosted free-tier operation requires bounded queues and operator monitoring.

## Non-Goals

This ADR does not implement:

- a public retrieval API route;
- an MCP server;
- GraphRAG traversal;
- Obsidian note generation;
- production Workers AI deployment;
- production Vectorize deployment;
- automatic daemon scheduling for embedding jobs.
