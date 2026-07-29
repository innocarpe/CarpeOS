# CarpeOS v1 Retrieval Projections

Status: G007 retrieval, MCP context-pack, and Obsidian projection contracts.

This document defines the schema-backed source of truth for retrieval
projections. Retrieval records are rebuildable projections derived from
canonical events and erasure records. They are never the authoritative store.

The machine-readable retrieval contract is
`spec/v1/schema/retrieval-projection.schema.json`. G007 also defines
`spec/v1/schema/mcp-api.schema.json` and
`spec/v1/schema/obsidian-projection.schema.json`.

## Projection Records

G006 defines these projection record families:

- `RetrievalChunk`;
- `EmbeddingJob`;
- `EmbeddingRecord`;
- `ProjectionFreshness`;
- `RetrievalQuery`;
- `RetrievalResult`.

Implementations MUST derive TypeScript interfaces, validators, and runtime
contracts from the JSON schema or keep them structurally aligned with it.

## Source Manifests

Every chunk MUST carry a non-empty `source_records` manifest. A source record
identifies one canonical event or erasure record and includes:

- `source_record_kind`;
- `source_record_id`;
- `trust_zone_id`;
- `zone_sequence`;
- `source_fingerprint`;
- `relationship_role`;
- bitemporal and authority metadata when the source is an event.

`source_records` MUST be sorted and deduplicated deterministically by:

```text
trust_zone_id ASC,
zone_sequence ASC,
source_record_kind ASC,
source_record_id ASC,
relationship_role ASC
```

One-source chunks are valid. Multi-source chunks are required for derived
accepted-fact snippets, decision-backed claims, supersession lineages, and
erasure-aware context.

## Derivation

Every chunk MUST include a `derivation` object with:

- deterministic algorithm name;
- algorithm version;
- configuration digest;
- input manifest digest.

Chunk IDs are deterministic IDs derived from the full normalized source
manifest, derivation metadata, chunk index, chunk kind, text digest,
projection version, and chunker version. The G006 ID format is:

```text
chk_<40 lowercase hex chars>
```

This keeps IDs under Vectorize's 64-byte limit.

## Embeddings

Embedding records are projections over chunks. For the default Cloudflare
adapter, provenance records:

- model `@cf/baai/bge-base-en-v1.5`;
- 768 dimensions;
- `mean` or `cls` pooling;
- 512 input-token limit;
- input text digest.

Embedding jobs are idempotent by:

```text
(chunk_id, embedding_model, embedding_version, pooling)
```

Retry state MUST preserve `failure_kind`, `retry_after`, and `quota_reset_at`
when applicable. Error fields MUST NOT include source text.

## Retrieval

Retrieval has two phases:

1. candidate retrieval from structured filters, FTS, local vectors, or Vectorize;
2. canonical recheck before returning a final result.

Vector search is not an authority model. A vector hit can identify a candidate
chunk, but the final result MUST re-evaluate trust-zone visibility, lifecycle
status, epistemic authority, bitemporal filters, acceptance decisions,
supersessions, erasures, and projection freshness.

Results MUST report score components and lineage. Redacted and excluded
results MUST report a reason instead of returning plaintext. Visible results
MUST include `text` after canonical recheck. Redacted and excluded results MUST
NOT include `text` and MUST include a non-empty `reason`.

Result lineage uses the same `source_records` manifest rules as chunks:

- sorted deterministically;
- deduplicated;
- every lineage source trust zone must be included in
  `filters_applied.visible_trust_zone_ids`.

## Context-Pack Projection

MCP context packs are deterministic local projections over visible canonical
events and erasure records. They are agent-facing, budgeted, and
non-authoritative.

Context packs MUST separate:

- `accepted_facts`;
- `draft_claims`;
- `rejected_claims`;
- `observations`;
- `evidence_summaries`;
- `conflicts`;
- `supersessions`;
- `erasures`;
- `verification_gaps`;
- `redactions`.

`accepted_facts` require visible `AcceptanceDecision` lineage with
`decision: "accepted"`. Draft, rejected, conflicted, superseded, erased,
hidden, or protected-policy-denied records MUST stay out of `accepted_facts`.

Each context-pack request MUST declare `ContextBudget` with `max_items` and
`max_characters`. Responses MUST report deterministic `used`, `truncated`, and
`omitted` metadata. These are item and character limits only; they are not
token-exact budgets.

Context packs are **active capacity** projections over a larger **total
capacity** store. Implementations MAY apply expert-slot allocation, diversity
caps, multi-resolution text selection, and compaction projections as described
in ADR 0009 and `docs/architecture/memory-capacity.md`. Those mechanisms MUST
NOT change acceptance semantics: only visible accepted
`AcceptanceDecision` lineage may populate `accepted_facts`.

## Obsidian Projection

G007 implements a deterministic, manifest-bounded Obsidian projection. Obsidian
files are human reading surfaces and have no canonical authority.

The closed note category enum is:

- `accepted_fact`;
- `observation`;
- `evidence_summary`;
- `proposed_claim`;
- `rejected_claim`;
- `conflict`;
- `supersession`;
- `erasure`;
- `index`.

Every generated note MUST include category-specific source lineage:

| Category | Required lineage |
| --- | --- |
| `accepted_fact` | visible claim plus acceptance lineage |
| `proposed_claim` | visible draft claim lineage |
| `rejected_claim` | visible rejection lineage |
| `conflict` | visible contradiction lineage |
| `supersession` | visible supersession lineage |
| `erasure` | visible erasure lineage |
| `evidence_summary` | visible safe evidence metadata lineage |
| `observation` | visible observation lineage |
| `index` | projection config lineage |

Generated files MUST be listed in
`.carpeos-obsidian-projection-manifest.json`. The manifest bounds file paths,
source lineage, content digests, configuration digest, visible trust zones, path
policy, and generated timestamp policy. A rebuild may delete files previously
managed by a valid manifest when canonical inputs no longer produce them. If
the previous manifest is corrupt, the implementation MUST preserve prior files
instead of guessing what to delete.

Projection paths MUST be vault-relative Markdown paths using forward slashes.
Absolute paths, empty segments, `.`, `..`, `~`, null bytes, backslashes, and
paths escaping the managed output root MUST be rejected. Generated Markdown MUST
include stable canonical references and projection metadata, not raw protected
plaintext.

Editing generated Obsidian notes does not mutate canonical knowledge. A later
capture flow MAY record a human edit as a new canonical event, but that is
outside G007.

## Freshness

Projection freshness compares the last indexed zone sequence against the local
sync cursor for a trust zone. Stale projections MUST be reported explicitly.
They MUST NOT be silently presented as current accepted facts.

Allowed freshness relationships:

- `last_indexed_zone_sequence == sync_cursor_after_sequence`: fresh when
  `stale` is `false` and no `reason` is present;
- `last_indexed_zone_sequence < sync_cursor_after_sequence`: stale with
  `reason = behind_sync_cursor`;
- `last_indexed_zone_sequence > sync_cursor_after_sequence`: invalid because a
  projection cannot be ahead of the sync cursor it claims to reflect;
- any `stale = true` freshness record MUST include a non-empty `reason`.

## Hosted Deployment

G007 does not include hosted retrieval, hosted MCP, hosted Obsidian sync,
Workers AI execution, Vectorize operation, or a dashboard deployment. Those
remain planned hosted/operator milestones.
