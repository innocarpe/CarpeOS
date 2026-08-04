# ADR 0015: Policy-version reconciliation requires bounded, digest-pinned preview plans

Status: **Accepted for Product 3.2 B0; implemented and tested on current main for pre-release validation; unpublished, uninstalled, and undeployed; B1 deferred and absent**

Date: 2026-08-03

## Context

Historical extraction, policy-scoped materialization, and held-review promotion can leave older-policy local canonical Observations active. Reconciliation must make that debt reviewable without granting authority, mutating ambiguity, or hiding uncertainty.

Canonical/review/disposition history remains append-only and bitemporal. Schema v1, event types, trust zones, fail-open hooks, and promoted-active-only defaults remain unchanged. Reconciliation is an implemented, explicit local trust-zone CLI operation on current main for pre-release validation; it is never automatic through hooks, MCP, open, migration, or sync, and is not published, installed, or deployed.

## Decision

**Product 3.2 selects B0: deterministic bounded reconciliation preview only, with zero writes.** B1 safe-subset Supersession apply is deferred and does not merge for 3.2. This is the approved fallback, not a scope reduction: exact pre-limit candidate total, deterministic emitted-prefix classification, component partition, global-taint visibility, and the canonical plan-v2 digest remain required.

No preview result creates authority or changes canonical state. Unsafe entries remain unchanged and conspicuous. No silent/best-effort skip exists; global taint marks the plan inadmissible. Automatic Claim/AcceptanceDecision creation remains forbidden.

## Normative plan-v2 preview wire contract

All values are JSON. Objects contain exactly their stated keys: no omitted optional keys, unknown keys, aliases, shorthand, or display/timestamp/error/body fields. UTF-8 strings use NFC normalization before validation and `stableJson`. `Identifier` is `^[a-z][a-z0-9_:-]{2,127}$`; `PolicyIdentifier` is `^[a-z][a-z0-9_-]{2,63}$`; `TrustZoneId` is `^tz_[a-z0-9][a-z0-9_-]{2,63}$`; `EventId` is `^evt_[a-z0-9][a-z0-9_-]{7,127}$`; `ComponentId` is `^cmp:[0-9a-f]{64}$`; and `Sha256Digest` is `sha256:` plus 64 lowercase hexadecimal characters. Counts/high-water values are safe JSON integers in `0..9007199254740991`; `limit` is an integer in `1..200`; booleans are JSON booleans.

`ReasonCode` is exactly `"replace" | "invalidate" | "already_applied" | "shared_materialization_unsafe" | "missing_unsafe" | "ambiguous_unsafe" | "imported_unsafe" | "self_unsafe" | "cycle_unsafe" | "zone_unsafe" | "lineage_unsafe" | "conflicting_intent_unsafe"`. `UnsafeReasonCode` excludes the first three. `GlobalTaintReasonCode` is exactly `"incomplete_enumeration_global_taint" | "unstable_snapshot_global_taint" | "eligible_unsafe_overlap_global_taint" | "conflicting_eligible_intent_global_taint" | "eligible_reachable_cycle_global_taint" | "eligible_imported_shared_lineage_global_taint" | "eligible_cross_zone_global_taint" | "eligible_subject_uncertainty_global_taint" | "unsafe_influences_eligible_global_taint" | "nonunique_component_partition_global_taint" | "unproved_zero_write_global_taint" | "unproved_conformance_global_taint"`. Arrays are never `null`; only target/replacement IDs may be JSON `null` where stated.

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

Preview accepts explicit `trust_zone_id`, `from_policy`, `to_policy`, and `limit` in `1..200`. It calculates `total_candidate_count` as the exact pre-limit total, orders all candidates by `(source_event_id, policy_version)`, and emits entries for exactly the first `min(total_candidate_count, limit)` candidates. `classified_count === entries.length`; `truncated === (total_candidate_count > limit)`. Every action/reason count, component, and per-entry evidence covers emitted entries only. When `total_candidate_count <= limit`, all candidates are emitted and classification is fully deterministic. When truncated, `plan_admissible=false` and `global_taint_reason_codes` includes `incomplete_enumeration_global_taint`. Preview and usage errors always write zero reconciliation rows.

Permitted entry combinations are exhaustive: `eligible_write/replace/replace` has distinct non-null target/replacement; `eligible_write/invalidate/invalidate` has non-null target and null replacement; `eligible_noop/already_applied/already_applied` has non-null target and nullable replacement; `unsafe_unchanged/none` uses an unsafe reason and nullable target/replacement. No other pair is valid. `source_event_id` differs from non-null target/replacement except an unsafe `self_unsafe` fact.

### Components, normalization, and global taint

`partitionReconciliationComponents` builds an undirected graph over the emitted entries’ sources, non-null target/replacement IDs, materialization lineage IDs, and existing/prospective Supersession relations. A component is its lexicographically sorted vertex IDs; `component_id` is `cmp:${sha256Hex(stableJson(componentVertexIds))}`. Components are recomputed, never accepted from CLI input, and describe emitted entries only.

Sort `reason_code_counts` by reason code; sort/deduplicate global-taint reasons/components/entry IDs lexicographically; sort entries by `(source_event_id,bucket,action,target_event_id-or-empty,replacement_event_id-or-empty,reason_code,component_id)`. Reason counts cover every emitted entry reason exactly once. The primary counts sum to `classified_count`; `replace_count + invalidate_count = eligible_write_count`; `already_applied_count = eligible_noop_count`.

An unsafe emitted entry is isolated only when its emitted component is disjoint from eligible target/replacement and cannot alter emitted eligible classification. The preview maps causal facts deterministically: `truncated=true` → `incomplete_enumeration_global_taint`; unstable snapshot/high-water/counts → `unstable_snapshot_global_taint`; eligible/unsafe overlap → `eligible_unsafe_overlap_global_taint`; conflicting eligible intent → `conflicting_eligible_intent_global_taint`; eligible-reachable cycle → `eligible_reachable_cycle_global_taint`; imported/shared lineage touching eligible → `eligible_imported_shared_lineage_global_taint`; cross-zone → `eligible_cross_zone_global_taint`; subject uncertainty → `eligible_subject_uncertainty_global_taint`; unsafe influence on eligible semantics → `unsafe_influences_eligible_global_taint`; nonunique partition → `nonunique_component_partition_global_taint`; unproved zero-write/conformance → respectively `unproved_zero_write_global_taint` or `unproved_conformance_global_taint`. It emits all applicable sorted/deduplicated codes and causal emitted component/entry IDs. Unsafe-only self/cycle/shared/imported/ambiguous emitted components remain unchanged.

### Canonical plan digest

The sole normalized digest preimage is exactly this object; `plan_digest` is excluded. Store, CLI, and fixtures produce exact UTF-8 `stableJson` bytes and actual SHA-256 equality.

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

No acknowledgement, apply result, receipt timestamp, display/error text, or body enters this preimage. The documented all-zero plan context (`tz_synthetic`, `adj_v1` to `adj_v3`, limit 100, zero high-water/counts/entries, nontruncated/admissible, empty taint arrays) has digest `sha256:131f346f95646f32abb1ee39b30df40970b75c15d2466ff96c353cbb204204e6`.

## Exact B0 CLI contract

The implemented B0 CLI path is preview-only on current main for pre-release validation; it is not published, installed, or deployed:

```sh
carpeos adjudicate reconcile-policy \
  --from-policy adj_v1 --to-policy adj_v3 \
  --trust-zone tz_synthetic --limit 100
```

Only `--from-policy`, `--to-policy`, `--trust-zone`, and `--limit` are reconciliation flags. `--plan-digest`, `--expected-total-count`, `--expected-eligible-write-count`, `--expected-eligible-noop-count`, `--expected-unsafe-count`, `--apply`, `--apply-safe-subset`, and `--acknowledge-unsafe-count` are unsupported usage and exit `2` before any reconciliation write. Preview and usage errors produce zero `protected_values`, `canonical_events`, `outbox`, disposition, and review writes. B0 creates no Supersession and has no apply command, writer, receipt, event construction, or transaction path; preview may inspect existing Supersessions when classifying components and taint.

## Why B1 failed admission

B1 is not safe to ship under current contracts. Truthful `recorded_time` records when CarpeOS actually records an event and cannot be backdated merely to obtain offline byte convergence. The current outbox coordinator uploads every linked protected value, so device-random ciphertext sharing an ID is not local-only/convergent. Current remote replay trusts idempotency key plus fingerprint without canonical-byte comparison, so an edge-only fingerprint could hide divergence. Candidate null/undefined handling and regex-only calendar validation were also insufficient to safely freeze event construction. These are public-safe design facts, not claims that B1 runtime was implemented.

## Future B1 re-admission

Any B1 reconsideration requires a separate ADR/version target and explicit approval, plus: a truthful bitemporal/convergence protocol; tested protected-free transfer or genuinely convergent protected lifecycle through sync client/worker; fingerprint binding to full canonical conflict detection; exact null normalization and strict calendar timestamp validation; and an authoritative one-transaction writer, receipt, and fault-test suite. None are Product 3.2 deliverables.

## Evaluation and privacy boundaries

Claim-vs-Observation is evidence-only, unexported/store-free, with `allow_auto_claim=false` and automatic Claim/AcceptanceDecision writes zero. Each class has at least four synthetic cases; any zero/undefined metric denominator is invalid corpus, exit `2`, never `1.00`. Deduplication is exact-normalized only; retrieval evaluation is offline only. CI, dogfood, release, and activation evidence is synthetic/disposable. Documentation, fixtures, sources, reports, and receipts contain no private paths, protected plaintext, real sessions, credentials, runtime dumps, or production output.

## Drivers, alternatives, and consequences

Drivers: precision before recall; evidence is not authority; explicit classification over silent best effort; exact digest pins; public-safe deterministic proof.

| Alternative | Decision |
| --- | --- |
| B0 bounded preview-only | **Selected for 3.2.** |
| B1 safe-subset apply | Deferred pending re-admission. |
| Best effort, hidden skip, automatic repair, fuzzy cleanup | Rejected. |
| Automatic Claims/AcceptanceDecision, online learning, schema expansion | Rejected for 3.2. |

B0 preserves reviewability and deterministic evidence without irreversible authority changes. Isolated unsafe residuals may remain active but are visible and unchanged; they are never described as cleaned. Release/freeze records B0 selection, plan schema/digest/golden result, counts, and unsafe/global-taint inventory. Future B1, fuzzy/semantic deduplication, automatic Claim drafting, feedback ranking, Supersession cancellation, and schema expansion remain outside 3.2.
