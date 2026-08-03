# ADR 0015: Policy-version reconciliation is complete, digest-pinned, and safe-subset atomic

Status: **Accepted for Product 3.2 design; runtime implementation pending**

Date: 2026-08-03

## Context

Historical extraction, policy-scoped materialization, and held-review promotion can leave older-policy local canonical Observations active. Reconciliation must improve provably safe entries without granting new authority, mutating ambiguous history, or hiding uncertainty.

Canonical/review/disposition history remains append-only and bitemporal. Supersession is permanent and canonically rechecked. Reconciliation is an explicit trust-zone-scoped local CLI operation only: never automatic through hooks, MCP, open, migration, or sync. It retains schema v1, existing event types, trust zones, fail-open hooks, and promoted-active-only defaults.

## Decision

Product 3.2 uses complete bounded preview and targets conditional B1 safe-subset apply. B1 applies every eligible entry atomically while isolated unsafe entries remain unchanged, visible, and explicitly acknowledged. B0—safe runtime changes plus zero-write preview-only reconciliation—is the required fallback when complete enumeration, stable partitioning, eligible/unsafe independence, graph safety, canonical digest identity, pinned recomputation, conformant construction, or transaction atomicity cannot be proved.

There is no silent or best-effort skip. Global taint aborts the whole apply, and acknowledgement cannot override it.

### Complete bounded enumeration and entry classification

Preview requires explicit `trust_zone_id`, `from_policy`, `to_policy`, and integer `limit` in `1..200`. It computes `total_candidate_count` before limiting and deterministically enumerates sources by `(source_event_id, policy_version)`. Apply requires `total_candidate_count <= limit`, `classified_count = total_candidate_count`, and `truncated=false`; paginated or truncated plans cannot apply.

Only local canonical Observations whose provenance/idempotency matches one of these families are resolved:

1. historical extraction;
2. policy-scoped materialization;
3. held-review promotion.

Every source produces one entry. Each entry has exactly this logical shape, with JSON `null` for an absent target or replacement:

```json
{
  "source_event_id": "evt_synthetic_source_001",
  "target_event_id": null,
  "replacement_event_id": "evt_synthetic_replacement_001",
  "bucket": "eligible_write",
  "action": "replace",
  "reason_code": "replace",
  "component_id": "cmp_synthetic_001"
}
```

Entry identifiers are synthetic examples only; entries never expose statements, paths, protected content, database rows, or free-form errors.

Classifications are:

| Bucket | Actions / reason codes | Effect |
| --- | --- | --- |
| `eligible_write` | `replace`, `invalidate` | Candidate for atomic Supersession write. |
| `eligible_noop` | `already_applied` | No write. |
| `unsafe_unchanged` | `shared_materialization_unsafe`, `missing_unsafe`, `ambiguous_unsafe`, `imported_unsafe`, `self_unsafe`, `cycle_unsafe`, `zone_unsafe`, `lineage_unsafe`, `conflicting_intent_unsafe` | No write; remain conspicuous in receipt. |

### Isolated unsafe material versus global taint

An unsafe entry is skippable only when its entire materialization/Supersession component is disjoint from every eligible target and replacement and cannot alter eligible classification. Its `component_id`, source ID, and reason remain in the complete receipt and digest.

Set `plan_admissible=false` for any of:

- truncation or incomplete enumeration;
- unstable high-water marks or counts;
- target, replacement, or materialization shared by eligible and unsafe entries;
- conflicting eligible intent;
- an existing or prospective cycle containing or reachable from an eligible entry;
- unresolved imported/shared lineage, cross-zone, or subject uncertainty touching eligible material;
- any unsafe fact able to change eligible replacement, validity, or canonical result;
- inability to partition components uniquely; or
- inability to prove zero-write, conformance, or transaction safety.

Unsafe-only self, cycle, shared, imported, or ambiguous components may remain `unsafe_unchanged` and are never repaired. A tainted plan exposes sorted, deduplicated `global_taint_reason_codes`, `global_taint_component_ids`, and `global_taint_entry_ids`; it cannot apply.

### Receipt and canonical plan digest

Preview receipt schema is exactly `carpeos.policy-reconciliation-plan/v2`. Its fields are exactly:

- `schema` (literal schema value), `trust_zone_id`, `from_policy`, `to_policy`, `limit`, `total_candidate_count`, `classified_count`, `truncated`;
- `high_water`: `canonical_local_sequence_max`, `disposition_row_count`, `review_row_count`, `outbox_id_max`, `supersession_event_count`;
- `counts`: `eligible_write_count`, `eligible_noop_count`, `unsafe_unchanged_count`, `replace_count`, `invalidate_count`, `already_applied_count`, `reason_code_counts`;
- `plan_admissible`, `global_taint_reason_codes`, `global_taint_component_ids`, `global_taint_entry_ids`, `entries`, and `plan_digest`.

`reason_code_counts` is a sorted array of `{reason_code,count}` ordered by `reason_code` and covers every eligible, noop, and unsafe reason. The three primary counts sum to `classified_count`; `replace_count + invalidate_count = eligible_write_count`; `already_applied_count = eligible_noop_count`; and a nontruncated admissible apply plan has `classified_count = total_candidate_count`.

Before `stableJson`, reason-code counts are sorted as above; global-taint reason/component arrays are lexicographically sorted and deduplicated; global-taint entry IDs are sorted lexicographically and deduplicated source event IDs; and entries are the complete eligible-write, eligible-noop, unsafe-unchanged set sorted by:

```text
(source_event_id, bucket, action, target_event_id-or-empty,
 replacement_event_id-or-empty, reason_code, component_id)
```

The only normative digest preimage is this exact object. `plan_digest` is excluded from its own preimage; no timestamp, display/error text, acknowledgement, apply result, or other field participates.

```ts
const digestPreimage = {
  schema: "carpeos.policy-reconciliation-plan/v2",
  trust_zone_id: plan.trust_zone_id,
  from_policy: plan.from_policy,
  to_policy: plan.to_policy,
  limit: plan.limit,
  total_candidate_count: plan.total_candidate_count,
  classified_count: plan.classified_count,
  truncated: plan.truncated,
  high_water: {
    canonical_local_sequence_max: plan.high_water.canonical_local_sequence_max,
    disposition_row_count: plan.high_water.disposition_row_count,
    review_row_count: plan.high_water.review_row_count,
    outbox_id_max: plan.high_water.outbox_id_max,
    supersession_event_count: plan.high_water.supersession_event_count,
  },
  counts: {
    eligible_write_count: plan.counts.eligible_write_count,
    eligible_noop_count: plan.counts.eligible_noop_count,
    unsafe_unchanged_count: plan.counts.unsafe_unchanged_count,
    replace_count: plan.counts.replace_count,
    invalidate_count: plan.counts.invalidate_count,
    already_applied_count: plan.counts.already_applied_count,
    reason_code_counts: plan.counts.reason_code_counts,
  },
  plan_admissible: plan.plan_admissible,
  global_taint_reason_codes: plan.global_taint_reason_codes,
  global_taint_component_ids: plan.global_taint_component_ids,
  global_taint_entry_ids: plan.global_taint_entry_ids,
  entries: plan.entries,
};
const plan_digest = `sha256:${sha256Hex(stableJson(digestPreimage))}`;
```

Preview writes zero. Store construction, CLI JSON preview, and golden fixtures must produce byte-identical `stableJson(digestPreimage)` and identical SHA-256. Mutation of every named scalar, high-water, count, global-taint, and entry field changes the digest; excluded display/timestamp fields do not. Shorthand or misspelled keys are not permitted.

### CLI preview and apply pins

Preview is explicit and metadata-only:

```sh
carpeos adjudicate reconcile-policy \
  --from-policy adj_v1 --to-policy adj_v3 \
  --trust-zone tz_synthetic --limit 100
```

Apply requires exact recomputation of every pin, an admissible nontruncated complete plan, `--apply-safe-subset`, and acknowledgement exactly equal to `unsafe_unchanged_count`, including zero:

```sh
carpeos adjudicate reconcile-policy \
  --from-policy adj_v1 --to-policy adj_v3 \
  --trust-zone tz_synthetic --limit 100 \
  --plan-digest sha256:... \
  --expected-total-count 10 \
  --expected-eligible-write-count 6 \
  --expected-eligible-noop-count 1 \
  --expected-unsafe-count 3 \
  --apply --apply-safe-subset --acknowledge-unsafe-count 3
```

`expected_total = eligible_write + eligible_noop + unsafe`. Unknown, missing, duplicate, or inconsistent options fail. The acknowledgement confirms that isolated unsafe entries remain unchanged; it does not change classification or admit taint.

### Atomicity, authority, and permanence

Under one `BEGIN IMMEDIATE`, recompute the full normalized plan, canonical preimage/digest, high-water, classifications, components, reasons, counts, and admissibility, then compare every pin. Any drift aborts with zero writes.

Before inserting, build and validate every eligible-write Supersession, minimal encrypted protected metadata, push request, deterministic ID/fingerprint, and uniqueness. In that same transaction insert all eligible protected, canonical, and pending-outbox rows. Unsafe and noop entries receive no row. An eligible failure rolls back everything: no item-level catch/continue and no nested commit.

The apply receipt schema is `carpeos.policy-reconciliation-apply/v2`; it echoes the plan digest, high-water, counts, eligible written/noop IDs, unsafe IDs/reasons/components, `unsafe_written_count=0`, transaction result, and permanence warning. Success requires all expected eligible writes; a stale digest after success fails. A fresh preview changes applied edges into noops. Committed Supersessions are permanent and honored after sync.

### Evaluation and privacy boundaries

Claim-vs-Observation work is evidence-only: the evaluator is unexported and store-free, `allow_auto_claim=false`, and automatic Claim and AcceptanceDecision writes remain zero. Claim candidates require bounded safe assertive text, nonempty exact-deduplicated support, resolved visible non-self affirmative support (`supports` or appropriate `derived_from`), and deterministic provenance order/digest. Support alone cannot upgrade an Observation; reject and insufficient-support cases cannot become Claim candidates.

Deduplication is exact-normalized only. Retrieval evaluation is offline only. CI, dogfood, release, and activation evidence are disposable and synthetic. No receipt, report, corpus, source, archive, or documentation may include private paths, protected plaintext, real sessions, credentials, runtime dumps, or production output.

## Drivers

1. Precision before recall: stale, generic, corrected, unsupported, and unsafe meaning must not become promoted memory.
2. Evidence is not authority: scores, forms, support, and synthetic evaluator results do not create acceptance.
3. Explicit safe subsets are safer than silent best effort.
4. Byte-identical immutable pins bind preview/apply and test/publish boundaries.
5. Public-safe deterministic proof is required.

## Alternatives

| Alternative | Decision |
| --- | --- |
| Evidence/docs/release hardening only | Rejected as insufficient: it leaves demonstrated session, held-policy, and old-active defects. |
| B0 preview-only | Accepted fallback whenever B1 proof is incomplete; no Supersession is written. |
| B1 explicit safe-subset apply | Target, conditional on all stated proofs. |
| Abort on any unsafe entry | Rejected when an unsafe component is demonstrably isolated; global taint and eligible failure still abort all writes. |
| Best effort, hidden skip, automatic repair, fuzzy cleanup | Rejected. |
| Automatic Claims/AcceptanceDecision, online learning, schema expansion | Rejected for 3.2. |

## Consequences

- Isolated unsafe residuals may remain active but must be visible and unchanged; they are never described as cleaned.
- Every B1 write is all-eligible-or-zero, canonically rechecked, and permanently auditable.
- B1 has a higher proof and testing burden; failure selects B0 without reverting safe work.
- Release/freeze evidence must record selected B0/B1, schema/digest/golden result, high-water/counts, residual unsafe IDs/reasons/components, evaluator identities, and exact artifact identity.

## Follow-ups

- Revisit automatic Claim drafting only through a separate ADR after stable evidence-only support proof.
- Revisit persisted feedback/adaptive ranking only after privacy, retention, replay, poisoning, and authority rules exist.
- Revisit fuzzy/semantic deduplication only with named false-negative classes and zero false-promotion evidence.
- Revisit Supersession cancellation and schema expansion outside 3.2.
