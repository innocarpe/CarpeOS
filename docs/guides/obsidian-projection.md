# Obsidian Projection Guide

Status: G007 local package implementation and synthetic tests. Not hosted.

This guide covers the implemented deterministic Obsidian projection package. It
uses synthetic placeholders only. Do not put real vault paths, private notes,
runtime database exports, credentials, transcripts, or private repository URLs
in public docs or fixtures.

## Boundary

Obsidian notes are a read model derived from visible canonical events and
erasure records. They are not the source of truth.

Generated notes include:

- `carpeos_projection: true`
- `canonical_effect: "none"`
- source IDs and source lineage
- a non-authoritative marker in the note body

Editing generated notes has no canonical effect. A separate capture flow would
be required to record an edit as a new canonical event; that flow is outside
G007.

G007 implements the package API in `@carpeos/obsidian-projection`. It does not
add an end-user Obsidian plugin, hosted sync, or a documented CLI command.

## Rebuild Inputs

A rebuild consumes:

- a typed local-store retrieval snapshot;
- an output root;
- visible trust-zone IDs;
- optional projection version;
- path policy;
- generated timestamp policy;
- non-authoritative marker text.

The local store owns canonical reads and authorization-shaped snapshots.
Projection code consumes those typed shapes and does not query canonical tables
directly.

## Categories

The closed projection category enum is:

| Category | Meaning |
| --- | --- |
| `accepted_fact` | Claim rendered as an accepted fact only with visible acceptance lineage. |
| `observation` | Visible observation. |
| `evidence_summary` | Visible safe evidence metadata, not raw protected plaintext. |
| `proposed_claim` | Draft or otherwise not-accepted claim. |
| `rejected_claim` | Claim with visible rejection lineage. |
| `conflict` | Visible contradiction/conflict lineage. |
| `supersession` | Visible supersession lineage. |
| `erasure` | Visible erasure ledger lineage. |
| `index` | Generated index note from projection config and generated files. |

Unknown categories are rejected by schema validation.

## Accepted Fact Rule

An `accepted_fact` note requires visible acceptance lineage. A draft claim does
not render as a fact note. Rejected, conflicted, superseded, erased, hidden, or
protected-policy-denied records do not become accepted facts.

The generated note is still a projection. The authoritative source remains the
visible canonical `Claim`, `AcceptanceDecision`, `Supersession`, and
`ErasureLedger` graph.

## Manifest

Each rebuild writes:

```text
.carpeos-obsidian-projection-manifest.json
```

The manifest records:

- projection version;
- output root;
- generated timestamp policy;
- configuration digest;
- visible trust-zone IDs;
- path policy;
- every generated file path;
- generated category;
- source lineage;
- content digest;
- tombstone state.

File entries are sorted deterministically by path and deduplicated.

## Path Safety

Generated paths are vault-relative Markdown paths. The implementation rejects:

- absolute paths;
- backslashes;
- null bytes;
- empty path segments;
- `.`, `..`, and `~` segments;
- non-Markdown paths;
- paths that resolve outside the managed output root;
- generated file collisions.

Subject refs and event IDs are slugged into safe path segments with digest
suffixes.

## Cleanup Behavior

Rebuild cleanup is manifest-bounded:

- files listed in a previous valid manifest can be deleted when the new visible
  canonical input no longer generates them;
- unmanaged notes are preserved;
- if the previous manifest is corrupt, prior files are preserved because
  ownership cannot be proven safely;
- erasure records remove affected generated files on the next valid-manifest
  rebuild and generate erasure notes when visible.

## Operator Flow

1. Initialize and capture synthetic or private canonical events through the
   local runtime.
2. Build a typed local-store retrieval snapshot for the intended visible trust
   zones.
3. Call `rebuildObsidianProjection` with an output root and visibility config.
4. Review the generated manifest and note paths.
5. Open the output root as a local Obsidian vault or copy the generated files
   into a private vault outside this public repository.
6. Rebuild after new events, supersessions, or erasures.

There is no G007 hosted projection service and no automatic Obsidian sync.

## Test Coverage

The G007 local test suite includes coverage for:

- byte-stable rebuilds from reordered input;
- deterministic manifest ordering;
- accepted/proposed/rejected claim separation;
- required lineage for accepted facts, proposed claims, rejected claims,
  conflicts, supersessions, erasures, and evidence summaries;
- conflict and erasure note rendering without protected plaintext;
- deletion of previously managed files after erasure;
- preservation of unmanaged notes;
- preservation when the previous manifest is corrupt;
- traversal and unsafe path rejection;
- YAML/front matter serialization;
- generated note and manifest schema conformance.
