# ADR 0015: Policy-version reconciliation requires complete, digest-pinned, safe-subset-atomic plans

Status: **Accepted for Product 3.2 design; runtime implementation pending**

Date: 2026-08-03

## Context

Historical extraction, policy-scoped materialization, and held-review promotion can leave older-policy local canonical Observations active. Reconciliation must correct only provably safe entries without granting authority, mutating ambiguity, or hiding uncertainty.

Canonical/review/disposition history remains append-only and bitemporal. Supersession is permanent and canonically rechecked. Reconciliation is a planned explicit, local, trust-zone-scoped CLI operation—never hook, MCP, open, migration, or sync automation. Schema v1, event types, trust zones, fail-open hooks, and promoted-active-only defaults remain unchanged.

## Decision

3.2 targets conditional B1 safe-subset apply: apply all eligible entries atomically while isolated unsafe entries are unchanged, visible, and acknowledged. B0—safe runtime work plus zero-write preview only—is mandatory when complete enumeration, stable component partition, eligible/unsafe independence, graph safety, digest identity, pinned recomputation, conformance, or atomicity cannot be proved. No silent/best-effort skip exists; global taint aborts and acknowledgement cannot override it.

## Normative plan-v2 wire contract

All values are JSON values. Objects contain **exactly** their stated keys: no omitted optional keys, unknown keys, aliases, shorthand, or extra display/timestamp/error/body fields. UTF-8 strings use NFC normalization before validation and stable JSON serialization. `Identifier` is the schema-compatible `^[a-z][a-z0-9_:-]{2,127}$`; `PolicyIdentifier` is `^[a-z][a-z0-9_-]{2,63}$`; `TrustZoneId` is `^tz_[a-z0-9][a-z0-9_-]{2,63}$`; `EventId` is `^evt_[a-z0-9][a-z0-9_-]{7,127}$`; `ComponentId` is `^cmp:[0-9a-f]{64}$`; `IdempotencyKey` is `^idem_[A-Za-z0-9_-]{16,128}$`; `ProtectedValueId` is `^pv_[a-z0-9][a-z0-9_-]{7,127}$`; and `RequestFingerprint` is `sha-256:` followed by 64 lowercase hexadecimal characters. Counts and high-water fields are safe JSON integers in `0..9007199254740991`; `limit` is an integer in `1..200`. Booleans are JSON booleans, never strings or numbers.

`SafeInteger` and `Integer1To200` denote those validated JSON integer domains. `Sha256Digest` is exactly `sha256:` followed by 64 lowercase hexadecimal characters. `ReasonCode` is exactly `"replace" | "invalidate" | "already_applied" | "shared_materialization_unsafe" | "missing_unsafe" | "ambiguous_unsafe" | "imported_unsafe" | "self_unsafe" | "cycle_unsafe" | "zone_unsafe" | "lineage_unsafe" | "conflicting_intent_unsafe"`; `UnsafeReasonCode` is the same union excluding the first three values. `GlobalTaintReasonCode` is exactly `"incomplete_enumeration_global_taint" | "unstable_snapshot_global_taint" | "eligible_unsafe_overlap_global_taint" | "conflicting_eligible_intent_global_taint" | "eligible_reachable_cycle_global_taint" | "eligible_imported_shared_lineage_global_taint" | "eligible_cross_zone_global_taint" | "eligible_subject_uncertainty_global_taint" | "unsafe_influences_eligible_global_taint" | "nonunique_component_partition_global_taint" | "unproved_zero_write_global_taint" | "unproved_conformance_global_taint" | "unproved_transaction_safety_global_taint"`. Arrays are JSON arrays, never `null`; only `target_event_id` and `replacement_event_id` may be JSON `null` where explicitly allowed.

The plan object has exactly these keys:

```ts
type PolicyReconciliationPlanV2 = {
  schema: "carpeos.policy-reconciliation-plan/v2";
  trust_zone_id: TrustZoneId;
  from_policy: PolicyIdentifier;
  to_policy: PolicyIdentifier;
  limit: Integer1To200;
  total_candidate_count: SafeInteger;
  classified_count: SafeInteger;
  truncated: boolean;
  high_water: {
    canonical_local_sequence_max: SafeInteger;
    disposition_row_count: SafeInteger;
    review_row_count: SafeInteger;
    outbox_id_max: SafeInteger;
    supersession_event_count: SafeInteger;
  };
  counts: {
    eligible_write_count: SafeInteger;
    eligible_noop_count: SafeInteger;
    unsafe_unchanged_count: SafeInteger;
    replace_count: SafeInteger;
    invalidate_count: SafeInteger;
    already_applied_count: SafeInteger;
    reason_code_counts: Array<{ reason_code: ReasonCode; count: SafeInteger }>;
  };
  plan_admissible: boolean;
  global_taint_reason_codes: GlobalTaintReasonCode[];
  global_taint_component_ids: ComponentId[];
  global_taint_entry_ids: EventId[];
  entries: PolicyReconciliationEntryV2[];
  plan_digest: Sha256Digest;
};
```

`high_water` and `counts` likewise allow no extra/missing keys. `total_candidate_count` is calculated before `limit`; sources are enumerated in `(source_event_id, policy_version)` order. Apply requires `total_candidate_count <= limit`, `classified_count === total_candidate_count`, and `truncated === false`.

Only a local canonical Observation whose source provenance/idempotency matches historical extraction, policy-scoped materialization, or held-review promotion can yield an entry. Every enumerated source yields exactly one entry:

```ts
type PolicyReconciliationEntryV2 = {
  source_event_id: EventId;
  target_event_id: EventId | null;
  replacement_event_id: EventId | null;
  bucket: "eligible_write" | "eligible_noop" | "unsafe_unchanged";
  action: "replace" | "invalidate" | "already_applied" | "none";
  reason_code: ReasonCode;
  component_id: ComponentId;
};
```

The permitted `(bucket, action, reason_code, target_event_id, replacement_event_id)` combinations are exhaustive:

| Bucket | Action | Reason code | Target / replacement |
| --- | --- | --- | --- |
| `eligible_write` | `replace` | `replace` | target and replacement are both non-null, distinct identifiers. |
| `eligible_write` | `invalidate` | `invalidate` | target non-null; replacement `null`. |
| `eligible_noop` | `already_applied` | `already_applied` | target non-null; replacement is non-null only when the already-committed edge identifies one, otherwise `null`. |
| `unsafe_unchanged` | `none` | one of `shared_materialization_unsafe`, `missing_unsafe`, `ambiguous_unsafe`, `imported_unsafe`, `self_unsafe`, `cycle_unsafe`, `zone_unsafe`, `lineage_unsafe`, `conflicting_intent_unsafe` | both nullable; a non-null target/replacement must be an identifier. |

No other action/reason pair is valid. `source_event_id` is distinct from each non-null target/replacement for every entry except an unsafe `self_unsafe` entry, which must name the same non-null ID in the self position that established the unsafe classification. An unsafe entry is not silently repaired.

### Components, normalization, and taint

The planned `partitionReconciliationComponents` builds an undirected graph whose vertices are every source, non-null target, non-null replacement, and materialization lineage ID observed during complete enumeration. It adds edges for each entry’s source-to-target, source-to-replacement, materialization lineage, and existing/prospective Supersession relation. A component is the lexicographically sorted set of its vertex IDs. Its `component_id` is `cmp:${sha256Hex(stableJson(componentVertexIds))}`. Every entry receives its sole component’s ID; component IDs are recomputed, never accepted from CLI input.

Normalize all strings to NFC, validate, sort `reason_code_counts` by `reason_code`, sort/deduplicate global-taint reason/component arrays lexicographically, and sort/deduplicate global-taint entry IDs lexicographically. Sort entries by `(source_event_id,bucket,action,target_event_id-or-empty,replacement_event_id-or-empty,reason_code,component_id)`. `reason_code_counts` contains every entry reason exactly once with its count. The primary counts sum to `classified_count`; `replace_count + invalidate_count = eligible_write_count`; `already_applied_count = eligible_noop_count`.

An unsafe entry is isolated only if its complete component is disjoint from every eligible target/replacement and cannot alter eligible classification. The planned PR06 classifier maps each causal condition deterministically to its exact global-taint code(s): truncation/incomplete enumeration → `incomplete_enumeration_global_taint`; unstable high-water/counts → `unstable_snapshot_global_taint`; eligible/unsafe shared target, replacement, materialization, or component → `eligible_unsafe_overlap_global_taint`; conflicting eligible intent → `conflicting_eligible_intent_global_taint`; existing/prospective cycle containing or reachable from eligible → `eligible_reachable_cycle_global_taint`; imported/shared lineage touching eligible → `eligible_imported_shared_lineage_global_taint`; cross-zone uncertainty touching eligible → `eligible_cross_zone_global_taint`; subject uncertainty touching eligible → `eligible_subject_uncertainty_global_taint`; an unsafe fact that can change eligible replacement, validity, or canonical result → `unsafe_influences_eligible_global_taint`; nonunique partition → `nonunique_component_partition_global_taint`; inability to prove zero-write, conformance, or transaction safety → respectively `unproved_zero_write_global_taint`, `unproved_conformance_global_taint`, or `unproved_transaction_safety_global_taint`. It includes all applicable codes and causal component/entry IDs, then sorts/deduplicates every global-taint array. Unsafe-only self/cycle/shared/imported/ambiguous components may remain isolated and unchanged.

### Canonical digest preimage

For an admissible apply plan, `classified_count === total_candidate_count`. The only digest preimage is exactly this object, normalized before `stableJson`; `plan_digest` is explicitly excluded.

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

No receipt timestamp, display/error text, acknowledgement, apply result, body, or other field enters the preimage. Planned store builder, CLI JSON preview, and fixtures must preserve exact UTF-8 bytes and actual SHA-256, not only structurally equivalent JSON.

## Preview and apply

The planned CLI path is `carpeos adjudicate reconcile-policy`; it does not exist yet. Preview is explicit and writes zero:

```sh
carpeos adjudicate reconcile-policy \
  --from-policy adj_v1 --to-policy adj_v3 \
  --trust-zone tz_synthetic --limit 100
```

Apply requires every exact pin, nontruncated complete admissible recomputation, `--apply-safe-subset`, and acknowledgement equal to `unsafe_unchanged_count`, including zero. The digest metavariable below is illustrative only: `[0-9a-f]{64}` means exactly 64 lowercase hexadecimal characters, not literal dots.

```sh
carpeos adjudicate reconcile-policy \
  --from-policy adj_v1 --to-policy adj_v3 \
  --trust-zone tz_synthetic --limit 100 \
  --plan-digest "sha256:<[0-9a-f]{64}>" \
  --expected-total-count 10 \
  --expected-eligible-write-count 6 \
  --expected-eligible-noop-count 1 \
  --expected-unsafe-count 3 \
  --apply --apply-safe-subset --acknowledge-unsafe-count 3
```

`expected_total_count = expected_eligible_write_count + expected_eligible_noop_count + expected_unsafe_count`. All expected counts are safe integers. Unknown, missing, duplicate, non-integer, inconsistent, or mismatched options fail. Acknowledgement confirms isolated unsafe material stays unchanged; it never changes classification or admits taint.

## Authoritative planned B1 store path

PR06 owns planned preview symbols in `packages/local-store/src/policy-reconciliation.ts`: `classifyPolicyReconciliationEntry`, `partitionReconciliationComponents`, `buildPolicyReconciliationPlanV2`, `policyReconciliationDigestPreimageV2`, and `digestPolicyReconciliationPlanV2`. It owns no writer. PR07 is serialized after it and alone adds planned `LocalCaptureStore.applyPolicyReconciliationPlanV2(input)` in `packages/local-store/src/store.ts`; `apps/carpeos-cli/src/index.ts` calls that method only for planned apply. PR07 must reuse PR06’s builder/types unchanged.

`applyPolicyReconciliationPlanV2` is the sole B1 writer. It calls the existing private `withImmediateTransaction` once, recomputes the full plan/digest/high-water/components/classifications under `BEGIN IMMEDIATE`, and compares all CLI pins before writes. It must not call `importPulledEvent`, `proposeObservationDraft`, or any nested transaction as its apply path.

For every eligible write, the planned PR07 builder verifies that the target is an active, non-erased, local canonical Observation from `from_policy` with `epistemic_authority: observed`. For `replace`, it also verifies a non-null replacement that is an active, non-erased, non-superseded local canonical Observation from `to_policy` in the same trust zone with the same resolved subject. For `invalidate`, replacement is `null`. An identical already-committed Supersession is `eligible_noop`/`already_applied`. Any conflicting existing Supersession, cycle, authority, zone, or subject condition is classified by planned PR06 as unsafe or global taint and is never resolved during apply. Existing store guarantees used here are canonical-event conformance and idempotency/write invariants; this ADR does not claim existing Supersession-specific conflict or replay rules.

For each eligible-write entry, PR07 uses only this edge-stable identity preimage. `plan_digest`, `component_id`, high-water, counts, limit, wall clock, client ID, and display/body data are excluded. Plan digest and component ID are admission and receipt evidence only. The same logical edge/policy/zone/source therefore converges across admissible plans and stores.

```ts
const edgeIdentityPreimage = {
  schema: "carpeos.policy-reconciliation-edge/v2",
  trust_zone_id: plan.trust_zone_id,
  from_policy: plan.from_policy,
  to_policy: plan.to_policy,
  source_event_id: entry.source_event_id,
  target_event_id: entry.target_event_id,
  replacement_event_id: entry.replacement_event_id,
  action: entry.action,
};
const identity_hash = sha256Hex(stableJson(edgeIdentityPreimage));
```

All edge inputs are normalized and validated before hashing. The planned builder derives `idempotency_key` as `idem_reconcile_v2_${identity_hash}`, `event_id` as `evt_${identity_hash.slice(0, 32)}`, `supersession_id` as `sup_${identity_hash.slice(32, 64)}`, `protected_value_id` as `pv_${identity_hash.slice(0, 32)}`, and `request_fingerprint` as `sha-256:${identity_hash}`. Each output validates respectively against `IdempotencyKey`, `EventId`, schema-compatible `Identifier`, `ProtectedValueId`, and `RequestFingerprint`, and is unique against the normalized plan and store before any insert. Free-form input, randomness, apply time, body content, and CLI display values never influence identity. The builder fixes Supersession lifecycle, authority, and reason; the CLI cannot control them.

### Planned canonical source and Supersession construction

The planned PR06 classifier freezes inputs before PR07 can apply: `source_event_id` is an active, non-erased local canonical event matching a recognized materialization family; `target_event_id` is an active, non-erased local canonical Observation from `from_policy` with `epistemic_authority: observed`. For `replace`, `replacement_event_id` is a non-null active, non-erased, non-superseded local canonical Observation from `to_policy`. For `invalidate`, replacement is `null`. Source, target, and non-null replacement must have the exact same validated trust-zone object and the same resolved `subject_ref`. An identical committed edge is classified as `eligible_noop`/`already_applied`; any conflict, cycle, authority, zone, subject, or lineage uncertainty is planned PR06 unsafe/global-taint classification, never apply-time repair.

PR07 constructs this exact planned `CanonicalEvent<"Supersession">`. `maxTimestamp` validates every present input against the UTC schema timestamp, parses each to epoch milliseconds, takes the numeric maximum, then emits `new Date(maxMs).toISOString().replace(".000Z", "Z")`. An absent replacement contributes no value:

```ts
const lineageEvents = replacement === undefined
  ? [source, target]
  : [source, target, replacement];

function maxTimestamp(starts: readonly string[]): string {
  const epochMilliseconds = starts.map((timestamp) => {
    assertSchemaUtcTimestamp(timestamp);
    const milliseconds = Date.parse(timestamp);
    if (!Number.isFinite(milliseconds)) throw new Error("invalid schema timestamp");
    return milliseconds;
  });
  const maxMs = Math.max(...epochMilliseconds);
  return new Date(maxMs).toISOString().replace(".000Z", "Z");
}

const event: CanonicalEvent<"Supersession"> = {
  schema_version: "v1",
  event_id,
  event_type: "Supersession",
  subject_ref: target.subject_ref,
  valid_time: {
    start: maxTimestamp(lineageEvents.map((lineage) => lineage.valid_time.start)),
    end: null,
  },
  recorded_time: {
    start: maxTimestamp(lineageEvents.map((lineage) => lineage.recorded_time.start)),
    end: null,
  },
  lifecycle_status: "active",
  epistemic_authority: "verified",
  trust_zone: target.trust_zone,
  provenance: replacement === undefined
    ? [
        { ref_type: "event", ref_id: source.event_id, relationship: "derived_from" },
        { ref_type: "event", ref_id: target.event_id, relationship: "supersedes" },
      ]
    : [
        { ref_type: "event", ref_id: source.event_id, relationship: "derived_from" },
        { ref_type: "event", ref_id: target.event_id, relationship: "supersedes" },
        { ref_type: "event", ref_id: replacement.event_id, relationship: "derived_from" },
      ],
  idempotency_key,
  request_fingerprint,
  payload: replacement === undefined
    ? {
        supersession_id,
        supersedes_event_id: target.event_id,
        reason: "Policy reconciliation invalidated an older-policy Observation.",
      }
    : {
        supersession_id,
        supersedes_event_id: target.event_id,
        replacement_event_id: replacement.event_id,
        reason: "Policy reconciliation replaced an older-policy Observation.",
      },
};
```

`zone_sequence` is omitted locally. The `valid_time` and `recorded_time` maxima are deterministic source-lineage time, never apply wall clock. Provenance has precisely the shown order; duplicate provenance references are rejected.

### Planned protected, canonical, and outbox rows

The exact UTF-8 protected plaintext is `stableJson` of this object and contains no statement, body, component, or plan digest:

```ts
const protectedPlaintext = {
  schema: "carpeos.policy-reconciliation-protected/v2",
  trust_zone_id: plan.trust_zone_id,
  from_policy: plan.from_policy,
  to_policy: plan.to_policy,
  source_event_id: entry.source_event_id,
  target_event_id: entry.target_event_id,
  replacement_event_id: entry.replacement_event_id,
  action: entry.action,
};
```

PR07 uses existing AES-256-GCM `encrypt` for a device-local row. `protected_value_id`, SHA-256 plaintext digest, and UTF-8 plaintext size are edge-stable; nonce, tag, and ciphertext can differ by device and remain local-only. The protected row is exactly: `protected_value_id`; `vault_ref: "vault_local"`; `key_ref: "key_local_active"`; `nonce_ref: "nonce_${protected_value_id.slice(3)}"`; `tag_ref: "tag_${protected_value_id.slice(3)}"`; AES-256-GCM nonce/tag/ciphertext; plaintext digest/size; and `created_at: event.recorded_time.start`.

The canonical row is exactly `event_id`, `event_type: "Supersession"`, `trust_zone_id`, edge-derived `idempotency_key`, edge-derived `request_fingerprint`, derived `protected_value_id`, `event_json: stableJson(event)`, and `recorded_at: event.recorded_time.start`. The pending outbox row is exactly `event_id`, `state: "pending"`, `attempts: 0`, `available_at: event.recorded_time.start`, `push_request_json: stableJson(pushRequest)`, `created_at: event.recorded_time.start`, and `updated_at: event.recorded_time.start`, with this exact sync push request:

```ts
const pushRequest = {
  schema_version: "v1",
  request_id: `req_${sha256Hex(stableJson({ event_id, client_id })).slice(0, 32)}`,
  client_id,
  trust_zone_id: plan.trust_zone_id,
  idempotency_key,
  request_fingerprint,
  events: [event],
  erasures: [],
};
```

Validate the request against sync conformance. Request envelope/client ID and local ciphertext may differ across stores; canonical event bytes, idempotency key, request fingerprint, and protected plaintext digest converge. Sync classifies the converged event as replay, never conflict.

Before insertion, identical existing key, event ID, fingerprint, and canonical bytes are noop. Any same key or event ID with a different fingerprint or canonical bytes is global taint and zero writes. Apply never repairs either case. In one `BEGIN IMMEDIATE`, validate all eligible writes and uniqueness before any insert, then preserve existing order: `protected_values`, `canonical_events`, pending `outbox`. Unsafe/noop entries receive no rows; any failure rolls back all eligible writes, with no catch/continue, nested transaction, or partial success. A fresh preview classifies the identical committed edge as `eligible_noop`/`already_applied`; the stale original digest fails rather than writing again.

### Planned convergence acceptance

Planned tests must prove that two admissible plans differing only in plan digest, high-water, counts, limit, or component for one edge produce identical edge preimage, IDs, and canonical event bytes. Two independent same-zone stores with differing `clientId`, clock, and local sequence must produce identical event bytes, idempotency key, request fingerprint, and protected plaintext digest and sync replay; only request envelope and local ciphertext may differ. Changing source, target, replacement, policy, zone, or action must change identity. An injected ID, fingerprint, or canonical-byte conflict must abort with zero writes.

## Exact apply receipt

A receipt exists only after a valid, complete, admissible pinned plan enters the transaction attempt. Invalid/missing pins or an inadmissible plan are typed CLI errors with no apply receipt. A transaction attempt emits exactly this metadata-only object: no timestamp, display text, error text, body, optional field, or unknown key. `rolled_back` has empty written-ID arrays but retains noop and unsafe inventory as plan evidence.

```ts
type PolicyReconciliationApplyReceiptV2 = {
  schema: "carpeos.policy-reconciliation-apply/v2";
  plan_schema: "carpeos.policy-reconciliation-plan/v2";
  plan_digest: Sha256Digest;
  trust_zone_id: TrustZoneId;
  from_policy: PolicyIdentifier;
  to_policy: PolicyIdentifier;
  limit: Integer1To200;
  total_candidate_count: SafeInteger;
  classified_count: SafeInteger;
  truncated: false;
  plan_admissible: true;
  global_taint_reason_codes: [];
  global_taint_component_ids: [];
  global_taint_entry_ids: [];
  high_water: PolicyReconciliationPlanV2["high_water"];
  counts: PolicyReconciliationPlanV2["counts"];
  eligible_written_event_ids: EventId[];
  eligible_noop_source_event_ids: EventId[];
  unsafe_entries: Array<{
    source_event_id: EventId;
    reason_code: UnsafeReasonCode;
    component_id: ComponentId;
  }>;
  unsafe_written_count: 0;
  transaction_result: "committed" | "rolled_back";
  permanence_warning: "Committed Supersessions are permanent and honored after sync.";
};
```
A zero-entry committed receipt has this literal shape; its digest is the actual SHA-256 computed from the documented zero-plan stableJson preimage:

```json
{
  "schema": "carpeos.policy-reconciliation-apply/v2",
  "plan_schema": "carpeos.policy-reconciliation-plan/v2",
  "plan_digest": "sha256:131f346f95646f32abb1ee39b30df40970b75c15d2466ff96c353cbb204204e6",
  "trust_zone_id": "tz_synthetic",
  "from_policy": "adj_v1",
  "to_policy": "adj_v3",
  "limit": 100,
  "total_candidate_count": 0,
  "classified_count": 0,
  "truncated": false,
  "plan_admissible": true,
  "global_taint_reason_codes": [],
  "global_taint_component_ids": [],
  "global_taint_entry_ids": [],
  "high_water": {
    "canonical_local_sequence_max": 0,
    "disposition_row_count": 0,
    "review_row_count": 0,
    "outbox_id_max": 0,
    "supersession_event_count": 0
  },
  "counts": {
    "eligible_write_count": 0,
    "eligible_noop_count": 0,
    "unsafe_unchanged_count": 0,
    "replace_count": 0,
    "invalidate_count": 0,
    "already_applied_count": 0,
    "reason_code_counts": []
  },
  "eligible_written_event_ids": [],
  "eligible_noop_source_event_ids": [],
  "unsafe_entries": [],
  "unsafe_written_count": 0,
  "transaction_result": "committed",
  "permanence_warning": "Committed Supersessions are permanent and honored after sync."
}
```

All receipt arrays are sorted lexicographically by their ID; `unsafe_entries` are sorted by `(source_event_id,reason_code,component_id)`. IDs are unique in each ID array; unsafe source IDs are unique. `eligible_written_event_ids.length === counts.eligible_write_count` only for `committed`, and is `0` for `rolled_back`; `eligible_noop_source_event_ids.length === counts.eligible_noop_count`; `unsafe_entries.length === counts.unsafe_unchanged_count`; `unsafe_written_count === 0`. A committed receipt requires all expected eligible writes and a non-stale digest. The literal permanence warning is mandatory.

Golden fixtures are planned at `packages/local-store/test/fixtures/policy-reconciliation-plan-v2.json`, `packages/local-store/test/fixtures/policy-reconciliation-plan-v2.preimage.json`, `apps/carpeos-cli/test/fixtures/policy-reconciliation-plan-v2.json`, and `apps/carpeos-cli/test/fixtures/policy-reconciliation-apply-v2.json`. Tests must round-trip store/CLI/fixture values, compare exact UTF-8 bytes and actual SHA-256 for the preimage, mutate every included field, prove excluded fields do not affect digest, and compare the exact apply receipt fixture.

## Evaluation and privacy boundaries

Claim-vs-Observation remains evidence-only: evaluator unexported/store-free, `allow_auto_claim=false`, and automatic Claim/AcceptanceDecision writes zero. Claim candidacy requires bounded safe assertive text, nonempty exact-deduplicated support, resolved visible non-self affirmative `supports` or appropriate `derived_from`, deterministic provenance order/digest; support alone cannot upgrade an Observation. Each class has at least four synthetic cases. Any zero/undefined reported denominator is invalid corpus and exit `2`, never `1.00`.

Deduplication is exact-normalized only; retrieval evaluation is offline only. CI, dogfood, release, and activation evidence is synthetic and disposable. Documentation, fixtures, sources, reports, and receipts contain no private paths, protected plaintext, real sessions, credentials, runtime dumps, or production output.

## Drivers

1. Precision before recall.
2. Evidence is not authority.
3. Explicit safe subsets, not silent best effort.
4. Exact state/digest pins at preview/apply and test/publish boundaries.
5. Public-safe deterministic proof.

## Alternatives

| Alternative | Decision |
| --- | --- |
| Evidence/docs/release hardening only | Rejected: leaves known session, held-policy, and old-active defects. |
| B0 preview-only | Accepted fallback; writes no Supersession. |
| B1 explicit safe-subset apply | Conditional target. |
| Abort on any unsafe entry | Rejected only for demonstrably isolated unsafe components; global taint and eligible failure still abort all writes. |
| Best effort, hidden skip, automatic repair, fuzzy cleanup | Rejected. |
| Automatic Claims/AcceptanceDecision, online learning, schema expansion | Rejected for 3.2. |

## Consequences

- Isolated unsafe residuals may remain active but are visible and unchanged; they are never described as cleaned.
- B1 writes are permanent, canonically rechecked, and all-eligible-or-zero.
- B1’s proof burden is intentional; missing proof selects B0 without reverting safe work.
- Freeze/release evidence must record the selected option, schema/digest/golden result, high-water/counts, residual unsafe IDs/reasons/components, evaluator identities, and exact artifact identity.

## Follow-ups

- Reconsider automatic Claim drafting only by separate ADR after stable evidence-only support proof.
- Reconsider feedback/adaptive ranking only after privacy, retention, replay, poisoning, and authority rules.
- Reconsider fuzzy/semantic deduplication only with named false-negative classes and zero false-promotion proof.
- Reconsider Supersession cancellation and schema expansion outside 3.2.
