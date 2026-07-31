# CarpeOS → OKF field mapping (K1)

Normative for `@carpeos/okf-projection` `mapEventsToOkf`. Product scope:
[ADR 0014](../../docs/adr/0014-okf-export-projection.md),
[product-3.1.0](../../docs/maintainers/product-3.1.0.md).

Target: **OKF v0.2**. Projection version: `okf-export/v1`.

## Defaults

| Setting | Default |
| --- | --- |
| Trust zones | Required; events outside visible zones → omit `wrong_trust_zone` |
| Held / draft observations | **Excluded** (`held_excluded`) unless `includeHeld: true` |
| Draft claims without acceptance | **Excluded** (`draft_claim_excluded` / `acceptance_missing`) |
| Rejected claims / rejections | **Excluded** (`rejected`) |
| Evidence | Only when **referenced** by an exported concept (`orphan_evidence` otherwise) |
| Evidence body | **Never** — metadata only |
| Import | Not in this package |

## Unit → concept

| CarpeOS | Exported when | Path | OKF `type` | `status` |
| --- | --- | --- | --- | --- |
| Claim + AcceptanceDecision(`accepted`) | claim + decision visible, not erased, not rejected | `decisions/<claim_id>.md` | `Accepted Decision` | `stable` (or `deprecated` if superseded) |
| Observation `lifecycle_status: active` | visible, not erased | `observations/<observation_id>.md` | `Observation` | `stable` / `deprecated` |
| Observation `lifecycle_status: draft` | `includeHeld` only | `drafts/<observation_id>.md` | `Draft Observation` | `draft` |
| EvidenceArtifact | referenced by exported claim/obs | `evidence/<artifact_id>.md` | `Evidence Summary` | `stable` |
| Supersession | supersedes target was exported | `lineage/<supersession_id>.md` | `Supersession` | `stable` |
| Erasure | never re-exports plaintext | — | event omitted (`erased`) | — |
| Claim rejected | never | — | — | — |

## Frontmatter families

| OKF field | CarpeOS source |
| --- | --- |
| `type` | Producer phrase table above (not raw schema event type) |
| `title` / `description` | Derived from id + statement one-liner |
| `status` | lifecycle + supersession |
| `generated.by` | config `generatedBy` (default `carpeos/okf-export/v1`) |
| `generated.at` | config `generatedAt` (pinned in tests) |
| `verified[]` | AcceptanceDecision `decided_by` / `decided_at` → actor `human:<id>` when unprefixed |
| `sources[]` | support refs + acceptance event; evidence as `/evidence/…` paths |
| `carpeos_projection` | always `true` |
| `canonical_effect` | always `"none"` |
| `carpeos_event_id` | canonical `event_id` of primary unit |
| `carpeos_event_type` | schema event type (`Claim`, `Observation`, …) |
| `carpeos_trust_zone_id` | trust zone id |
| `carpeos_claim_id` / `_observation_id` / `_artifact_id` / `_decision_id` / `_supersession_id` | payload ids when applicable |

## Reserved files

| Path | Content |
| --- | --- |
| `index.md` | `okf_version: "0.2"` + progressive listing of concepts |
| `log.md` | Newest-first export run note for `generatedAt` date |

## Omission reasons

`wrong_trust_zone` · `erased` · `rejected` · `held_excluded` · `draft_claim_excluded` ·
`acceptance_missing` · `acceptance_not_accepted` · `orphan_evidence` ·
`supersession_target_missing` · `not_exportable_type`
