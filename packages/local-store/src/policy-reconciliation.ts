import { createHash } from "node:crypto";

export type ReasonCode =
  | "replace"
  | "invalidate"
  | "already_applied"
  | "shared_materialization_unsafe"
  | "missing_unsafe"
  | "ambiguous_unsafe"
  | "imported_unsafe"
  | "self_unsafe"
  | "cycle_unsafe"
  | "zone_unsafe"
  | "lineage_unsafe"
  | "conflicting_intent_unsafe";

export type UnsafeReasonCode = Exclude<ReasonCode, "replace" | "invalidate" | "already_applied">;

export type GlobalTaintReasonCode =
  | "incomplete_enumeration_global_taint"
  | "unstable_snapshot_global_taint"
  | "eligible_unsafe_overlap_global_taint"
  | "conflicting_eligible_intent_global_taint"
  | "eligible_reachable_cycle_global_taint"
  | "eligible_imported_shared_lineage_global_taint"
  | "eligible_cross_zone_global_taint"
  | "eligible_subject_uncertainty_global_taint"
  | "unsafe_influences_eligible_global_taint"
  | "nonunique_component_partition_global_taint"
  | "unproved_zero_write_global_taint"
  | "unproved_conformance_global_taint";

type Bucket = "eligible_write" | "eligible_noop" | "unsafe_unchanged";
type Action = "replace" | "invalidate" | "already_applied" | "none";

export type PolicyReconciliationEntryV2 = {
  source_event_id: string;
  target_event_id: string | null;
  replacement_event_id: string | null;
  bucket: Bucket;
  action: Action;
  reason_code: ReasonCode;
  component_id: string;
};

export type PolicyReconciliationPlanV2 = {
  schema: "carpeos.policy-reconciliation-plan/v2";
  trust_zone_id: string;
  from_policy: string;
  to_policy: string;
  limit: number;
  total_candidate_count: number;
  classified_count: number;
  truncated: boolean;
  high_water: {
    canonical_local_sequence_max: number;
    disposition_row_count: number;
    review_row_count: number;
    outbox_id_max: number;
    supersession_event_count: number;
  };
  counts: {
    eligible_write_count: number;
    eligible_noop_count: number;
    unsafe_unchanged_count: number;
    replace_count: number;
    invalidate_count: number;
    already_applied_count: number;
    reason_code_counts: Array<{ reason_code: ReasonCode; count: number }>;
  };
  plan_admissible: boolean;
  global_taint_reason_codes: GlobalTaintReasonCode[];
  global_taint_component_ids: string[];
  global_taint_entry_ids: string[];
  entries: PolicyReconciliationEntryV2[];
  plan_digest: string;
};

export type ReconciliationCandidate = {
  source_event_id: string;
  target_event_id?: string | null;
  replacement_event_id?: string | null;
  classification?: "replace" | "invalidate" | "already_applied";
  unsafe_reason_code?: UnsafeReasonCode;
  policy_version?: string;
  lineage_event_ids?: readonly string[];
  supersession_relations?: readonly (readonly [string, string])[];
  taint_reason_codes?: readonly GlobalTaintReasonCode[];
};

export type ReconciliationHighWater = PolicyReconciliationPlanV2["high_water"];

const POLICY_IDENTIFIER = /^[a-z][a-z0-9_-]{2,63}$/;
const TRUST_ZONE_ID = /^tz_[a-z0-9][a-z0-9_-]{2,63}$/;
const EVENT_ID = /^evt_[a-z0-9][a-z0-9_-]{7,127}$/;
const COMPONENT_ID = /^cmp:[0-9a-f]{64}$/;
const PLAN_KEYS = [
  "schema",
  "trust_zone_id",
  "from_policy",
  "to_policy",
  "limit",
  "total_candidate_count",
  "classified_count",
  "truncated",
  "high_water",
  "counts",
  "plan_admissible",
  "global_taint_reason_codes",
  "global_taint_component_ids",
  "global_taint_entry_ids",
  "entries",
  "plan_digest",
];
const PREIMAGE_KEYS = PLAN_KEYS.filter((key) => key !== "plan_digest");
const HIGH_WATER_KEYS = [
  "canonical_local_sequence_max",
  "disposition_row_count",
  "review_row_count",
  "outbox_id_max",
  "supersession_event_count",
];
const COUNT_KEYS = [
  "eligible_write_count",
  "eligible_noop_count",
  "unsafe_unchanged_count",
  "replace_count",
  "invalidate_count",
  "already_applied_count",
  "reason_code_counts",
];
const REASON_COUNT_KEYS = ["reason_code", "count"];
const ENTRY_KEYS = [
  "source_event_id",
  "target_event_id",
  "replacement_event_id",
  "bucket",
  "action",
  "reason_code",
  "component_id",
];
const UNSAFE_REASONS = new Set<UnsafeReasonCode>([
  "shared_materialization_unsafe",
  "missing_unsafe",
  "ambiguous_unsafe",
  "imported_unsafe",
  "self_unsafe",
  "cycle_unsafe",
  "zone_unsafe",
  "lineage_unsafe",
  "conflicting_intent_unsafe",
]);
const GLOBAL_REASONS = new Set<GlobalTaintReasonCode>([
  "incomplete_enumeration_global_taint",
  "unstable_snapshot_global_taint",
  "eligible_unsafe_overlap_global_taint",
  "conflicting_eligible_intent_global_taint",
  "eligible_reachable_cycle_global_taint",
  "eligible_imported_shared_lineage_global_taint",
  "eligible_cross_zone_global_taint",
  "eligible_subject_uncertainty_global_taint",
  "unsafe_influences_eligible_global_taint",
  "nonunique_component_partition_global_taint",
  "unproved_zero_write_global_taint",
  "unproved_conformance_global_taint",
]);

function compareRaw(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableJson(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"));
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .map((key) => key.normalize("NFC"))
    .sort(compareRaw)
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}

function assertExactKeys(
  value: unknown,
  keys: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`invalid ${label}`);
  const actual = Object.keys(value).sort(compareRaw);
  const expected = [...keys].sort(compareRaw);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`invalid ${label} keys`);
  }
}

function assertSafeInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`invalid ${label}`);
}

function assertIdentifier(value: unknown, pattern: RegExp, label: string): asserts value is string {
  if (typeof value !== "string" || value.normalize("NFC") !== value || !pattern.test(value))
    throw new Error(`invalid ${label}`);
}

function entrySortKey(entry: PolicyReconciliationEntryV2): string {
  return [
    entry.source_event_id,
    entry.bucket,
    entry.action,
    entry.target_event_id ?? "",
    entry.replacement_event_id ?? "",
    entry.reason_code,
    entry.component_id,
  ].join("\0");
}

function assertSortedUnique(values: readonly string[], label: string): void {
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0 && compareRaw(values[index - 1] ?? "", values[index] ?? "") >= 0)
      throw new Error(`unsorted ${label}`);
  }
}

function validateEntry(entry: unknown): asserts entry is PolicyReconciliationEntryV2 {
  assertExactKeys(entry, ENTRY_KEYS, "entry");
  const value = entry as PolicyReconciliationEntryV2;
  assertIdentifier(value.source_event_id, EVENT_ID, "source_event_id");
  if (value.target_event_id !== null)
    assertIdentifier(value.target_event_id, EVENT_ID, "target_event_id");
  if (value.replacement_event_id !== null)
    assertIdentifier(value.replacement_event_id, EVENT_ID, "replacement_event_id");
  assertIdentifier(value.component_id, COMPONENT_ID, "component_id");
  const isReplace =
    value.bucket === "eligible_write" &&
    value.action === "replace" &&
    value.reason_code === "replace" &&
    value.target_event_id !== null &&
    value.replacement_event_id !== null &&
    value.source_event_id !== value.target_event_id &&
    value.source_event_id !== value.replacement_event_id &&
    value.target_event_id !== value.replacement_event_id;
  const isInvalidate =
    value.bucket === "eligible_write" &&
    value.action === "invalidate" &&
    value.reason_code === "invalidate" &&
    value.target_event_id !== null &&
    value.replacement_event_id === null &&
    value.source_event_id !== value.target_event_id;
  const isNoop =
    value.bucket === "eligible_noop" &&
    value.action === "already_applied" &&
    value.reason_code === "already_applied" &&
    value.target_event_id !== null &&
    value.source_event_id !== value.target_event_id &&
    (value.replacement_event_id === null || value.source_event_id !== value.replacement_event_id);
  const isUnsafe =
    value.bucket === "unsafe_unchanged" &&
    value.action === "none" &&
    UNSAFE_REASONS.has(value.reason_code as UnsafeReasonCode) &&
    (value.reason_code === "self_unsafe" ||
      (value.target_event_id !== value.source_event_id &&
        value.replacement_event_id !== value.source_event_id));
  if (!isReplace && !isInvalidate && !isNoop && !isUnsafe)
    throw new Error("invalid entry combination");
}

export function classifyPolicyReconciliationEntry(
  candidate: ReconciliationCandidate,
): Omit<PolicyReconciliationEntryV2, "component_id"> {
  assertIdentifier(candidate.source_event_id, EVENT_ID, "source_event_id");
  const target = candidate.target_event_id ?? null;
  const replacement = candidate.replacement_event_id ?? null;
  if (target !== null) assertIdentifier(target, EVENT_ID, "target_event_id");
  if (replacement !== null) assertIdentifier(replacement, EVENT_ID, "replacement_event_id");
  if (
    candidate.classification === "replace" &&
    target !== null &&
    replacement !== null &&
    target !== candidate.source_event_id &&
    replacement !== candidate.source_event_id &&
    target !== replacement
  )
    return {
      source_event_id: candidate.source_event_id,
      target_event_id: target,
      replacement_event_id: replacement,
      bucket: "eligible_write",
      action: "replace",
      reason_code: "replace",
    };
  if (
    candidate.classification === "invalidate" &&
    target !== null &&
    replacement === null &&
    target !== candidate.source_event_id
  )
    return {
      source_event_id: candidate.source_event_id,
      target_event_id: target,
      replacement_event_id: null,
      bucket: "eligible_write",
      action: "invalidate",
      reason_code: "invalidate",
    };
  if (
    candidate.classification === "already_applied" &&
    target !== null &&
    target !== candidate.source_event_id &&
    replacement !== candidate.source_event_id
  )
    return {
      source_event_id: candidate.source_event_id,
      target_event_id: target,
      replacement_event_id: replacement,
      bucket: "eligible_noop",
      action: "already_applied",
      reason_code: "already_applied",
    };
  const reason = candidate.unsafe_reason_code ?? "missing_unsafe";
  if (!UNSAFE_REASONS.has(reason)) throw new Error("invalid unsafe_reason_code");
  if (
    (target === candidate.source_event_id || replacement === candidate.source_event_id) &&
    reason !== "self_unsafe"
  )
    throw new Error("self relation requires self_unsafe");
  return {
    source_event_id: candidate.source_event_id,
    target_event_id: target,
    replacement_event_id: replacement,
    bucket: "unsafe_unchanged",
    action: "none",
    reason_code: reason,
  };
}

export function partitionReconciliationComponents(
  entries: readonly Omit<PolicyReconciliationEntryV2, "component_id">[],
  candidates: readonly ReconciliationCandidate[] = [],
): string[] {
  const graph = new Map<string, Set<string>>();
  const add = (id: string) => {
    if (!graph.has(id)) graph.set(id, new Set());
  };
  const link = (left: string, right: string) => {
    add(left);
    add(right);
    graph.get(left)?.add(right);
    graph.get(right)?.add(left);
  };
  for (const entry of entries) {
    add(entry.source_event_id);
    for (const id of [entry.target_event_id, entry.replacement_event_id])
      if (id !== null) link(entry.source_event_id, id);
    const candidate = candidates.find((item) => item.source_event_id === entry.source_event_id);
    for (const id of candidate?.lineage_event_ids ?? []) {
      assertIdentifier(id, EVENT_ID, "lineage_event_id");
      link(entry.source_event_id, id);
    }
    for (const [left, right] of candidate?.supersession_relations ?? []) {
      assertIdentifier(left, EVENT_ID, "supersession_relation");
      assertIdentifier(right, EVENT_ID, "supersession_relation");
      link(left, right);
    }
  }
  const componentByVertex = new Map<string, string>();
  for (const root of [...graph.keys()].sort(compareRaw)) {
    if (componentByVertex.has(root)) continue;
    const pending = [root];
    const vertices: string[] = [];
    while (pending.length > 0) {
      const current = pending.pop() as string;
      if (componentByVertex.has(current)) continue;
      componentByVertex.set(current, "pending");
      vertices.push(current);
      for (const next of graph.get(current) ?? [])
        if (!componentByVertex.has(next)) pending.push(next);
    }
    vertices.sort(compareRaw);
    const id = `cmp:${createHash("sha256").update(stableJson(vertices), "utf8").digest("hex")}`;
    for (const vertex of vertices) componentByVertex.set(vertex, id);
  }
  return entries.map((entry) => {
    const id = componentByVertex.get(entry.source_event_id);
    if (id === undefined) throw new Error("unproved component partition");
    return id;
  });
}

export function policyReconciliationDigestPreimageV2(
  plan: Omit<PolicyReconciliationPlanV2, "plan_digest"> | PolicyReconciliationPlanV2,
): Omit<PolicyReconciliationPlanV2, "plan_digest"> {
  validatePlan(plan, "plan_digest" in plan);
  const value = plan as PolicyReconciliationPlanV2;
  return {
    schema: "carpeos.policy-reconciliation-plan/v2",
    trust_zone_id: value.trust_zone_id,
    from_policy: value.from_policy,
    to_policy: value.to_policy,
    limit: value.limit,
    total_candidate_count: value.total_candidate_count,
    classified_count: value.classified_count,
    truncated: value.truncated,
    high_water: {
      canonical_local_sequence_max: value.high_water.canonical_local_sequence_max,
      disposition_row_count: value.high_water.disposition_row_count,
      review_row_count: value.high_water.review_row_count,
      outbox_id_max: value.high_water.outbox_id_max,
      supersession_event_count: value.high_water.supersession_event_count,
    },
    counts: {
      eligible_write_count: value.counts.eligible_write_count,
      eligible_noop_count: value.counts.eligible_noop_count,
      unsafe_unchanged_count: value.counts.unsafe_unchanged_count,
      replace_count: value.counts.replace_count,
      invalidate_count: value.counts.invalidate_count,
      already_applied_count: value.counts.already_applied_count,
      reason_code_counts: value.counts.reason_code_counts.map((item) => ({
        reason_code: item.reason_code,
        count: item.count,
      })),
    },
    plan_admissible: value.plan_admissible,
    global_taint_reason_codes: [...value.global_taint_reason_codes],
    global_taint_component_ids: [...value.global_taint_component_ids],
    global_taint_entry_ids: [...value.global_taint_entry_ids],
    entries: value.entries.map((entry) => ({ ...entry })),
  };
}

export function digestPolicyReconciliationPlanV2(
  plan: Omit<PolicyReconciliationPlanV2, "plan_digest"> | PolicyReconciliationPlanV2,
): string {
  return digest(policyReconciliationDigestPreimageV2(plan));
}

function validatePlan(value: unknown, includesDigest: boolean): void {
  assertExactKeys(value, includesDigest ? PLAN_KEYS : PREIMAGE_KEYS, "plan");
  const plan = value as Omit<PolicyReconciliationPlanV2, "plan_digest"> &
    Partial<Pick<PolicyReconciliationPlanV2, "plan_digest">>;
  if (plan.schema !== "carpeos.policy-reconciliation-plan/v2") throw new Error("invalid schema");
  assertIdentifier(plan.trust_zone_id, TRUST_ZONE_ID, "trust_zone_id");
  assertIdentifier(plan.from_policy, POLICY_IDENTIFIER, "from_policy");
  assertIdentifier(plan.to_policy, POLICY_IDENTIFIER, "to_policy");
  if (!Number.isSafeInteger(plan.limit) || plan.limit < 1 || plan.limit > 200)
    throw new Error("invalid limit");
  assertSafeInteger(plan.total_candidate_count, "total_candidate_count");
  assertSafeInteger(plan.classified_count, "classified_count");
  if (typeof plan.truncated !== "boolean" || typeof plan.plan_admissible !== "boolean")
    throw new Error("invalid boolean");
  assertExactKeys(plan.high_water, HIGH_WATER_KEYS, "high_water");
  for (const key of HIGH_WATER_KEYS)
    assertSafeInteger(plan.high_water[key as keyof typeof plan.high_water], key);
  assertExactKeys(plan.counts, COUNT_KEYS, "counts");
  for (const key of COUNT_KEYS.filter((key) => key !== "reason_code_counts"))
    assertSafeInteger(plan.counts[key as keyof typeof plan.counts], key);
  if (
    !Array.isArray(plan.entries) ||
    plan.classified_count !== plan.entries.length ||
    plan.classified_count !== Math.min(plan.total_candidate_count, plan.limit)
  )
    throw new Error("invalid classified count");
  if (plan.truncated !== plan.total_candidate_count > plan.limit)
    throw new Error("invalid truncated");
  for (const entry of plan.entries) validateEntry(entry);
  for (let index = 1; index < plan.entries.length; index += 1)
    if (
      compareRaw(
        entrySortKey(plan.entries[index - 1] as PolicyReconciliationEntryV2),
        entrySortKey(plan.entries[index] as PolicyReconciliationEntryV2),
      ) >= 0
    )
      throw new Error("unsorted entries");
  const counts = plan.counts;
  const entries = plan.entries as PolicyReconciliationEntryV2[];
  const actualReasons = new Map<ReasonCode, number>();
  for (const entry of entries)
    actualReasons.set(entry.reason_code, (actualReasons.get(entry.reason_code) ?? 0) + 1);
  if (
    !Array.isArray(counts.reason_code_counts) ||
    counts.reason_code_counts.length !== actualReasons.size
  )
    throw new Error("invalid reason counts");
  let priorReason: string | undefined;
  for (const row of counts.reason_code_counts) {
    assertExactKeys(row, REASON_COUNT_KEYS, "reason count");
    if (
      !actualReasons.has(row.reason_code) ||
      (priorReason !== undefined && compareRaw(priorReason, row.reason_code) >= 0)
    )
      throw new Error("invalid reason counts");
    assertSafeInteger(row.count, "reason count");
    if (actualReasons.get(row.reason_code) !== row.count) throw new Error("invalid reason counts");
    priorReason = row.reason_code;
  }
  const writes = entries.filter((entry) => entry.bucket === "eligible_write").length;
  const noops = entries.filter((entry) => entry.bucket === "eligible_noop").length;
  const unsafe = entries.filter((entry) => entry.bucket === "unsafe_unchanged").length;
  if (
    counts.eligible_write_count !== writes ||
    counts.eligible_noop_count !== noops ||
    counts.unsafe_unchanged_count !== unsafe ||
    counts.replace_count !== entries.filter((entry) => entry.action === "replace").length ||
    counts.invalidate_count !== entries.filter((entry) => entry.action === "invalidate").length ||
    counts.already_applied_count !==
      entries.filter((entry) => entry.action === "already_applied").length ||
    counts.replace_count + counts.invalidate_count !== writes ||
    counts.already_applied_count !== noops
  )
    throw new Error("invalid count equations");
  if (
    !Array.isArray(plan.global_taint_reason_codes) ||
    !Array.isArray(plan.global_taint_component_ids) ||
    !Array.isArray(plan.global_taint_entry_ids)
  )
    throw new Error("invalid taints");
  for (const reason of plan.global_taint_reason_codes)
    if (!GLOBAL_REASONS.has(reason)) throw new Error("invalid global taint");
  for (const id of plan.global_taint_component_ids)
    assertIdentifier(id, COMPONENT_ID, "global taint component id");
  for (const id of plan.global_taint_entry_ids)
    assertIdentifier(id, EVENT_ID, "global taint entry id");
  assertSortedUnique(plan.global_taint_reason_codes, "global taints");
  assertSortedUnique(plan.global_taint_component_ids, "global taint components");
  assertSortedUnique(plan.global_taint_entry_ids, "global taint entries");
  if (plan.plan_admissible !== (plan.global_taint_reason_codes.length === 0))
    throw new Error("invalid plan admissibility");
  if (
    includesDigest &&
    (typeof plan.plan_digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(plan.plan_digest))
  )
    throw new Error("invalid plan digest");
}

export function buildPolicyReconciliationPlanV2(input: {
  trust_zone_id: string;
  from_policy: string;
  to_policy: string;
  limit: number;
  total_candidate_count: number;
  high_water: ReconciliationHighWater;
  candidates: readonly ReconciliationCandidate[];
  global_taint_reason_codes?: readonly GlobalTaintReasonCode[];
}): PolicyReconciliationPlanV2 {
  assertIdentifier(input.trust_zone_id, TRUST_ZONE_ID, "trust_zone_id");
  assertIdentifier(input.from_policy, POLICY_IDENTIFIER, "from_policy");
  assertIdentifier(input.to_policy, POLICY_IDENTIFIER, "to_policy");
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 200)
    throw new Error("invalid limit");
  assertSafeInteger(input.total_candidate_count, "total_candidate_count");
  const expected = Math.min(input.total_candidate_count, input.limit);
  if (
    input.candidates.length !== input.total_candidate_count &&
    input.candidates.length !== expected
  )
    throw new Error("candidate set does not match emitted prefix");
  const candidates = [...input.candidates]
    .sort(
      (left, right) =>
        compareRaw(left.source_event_id, right.source_event_id) ||
        compareRaw(left.policy_version ?? "", right.policy_version ?? ""),
    )
    .slice(0, expected);
  const baseEntries = candidates.map(classifyPolicyReconciliationEntry);
  const components = partitionReconciliationComponents(baseEntries, candidates);
  const entries = baseEntries
    .map((entry, index) => {
      const component_id = components[index];
      if (component_id === undefined) throw new Error("unproved component partition");
      return { ...entry, component_id };
    })
    .sort((left, right) => compareRaw(entrySortKey(left), entrySortKey(right)));
  const taints = new Set<GlobalTaintReasonCode>(input.global_taint_reason_codes ?? []);
  for (const reason of taints)
    if (!GLOBAL_REASONS.has(reason)) throw new Error("invalid global taint");
  if (input.total_candidate_count > input.limit) taints.add("incomplete_enumeration_global_taint");
  const eligible = entries.filter((entry) => entry.bucket !== "unsafe_unchanged");
  const unsafe = entries.filter((entry) => entry.bucket === "unsafe_unchanged");
  const causalComponentSet = new Set(
    unsafe
      .filter((entry) => eligible.some((other) => other.component_id === entry.component_id))
      .map((entry) => entry.component_id),
  );
  if (causalComponentSet.size > 0) taints.add("eligible_unsafe_overlap_global_taint");
  for (const candidate of candidates) {
    const entry = entries.find((item) => item.source_event_id === candidate.source_event_id);
    if (entry === undefined) continue;
    for (const reason of candidate.taint_reason_codes ?? []) {
      if (!GLOBAL_REASONS.has(reason)) throw new Error("invalid global taint");
      taints.add(reason);
      causalComponentSet.add(entry.component_id);
    }
  }
  const causalComponents = [...causalComponentSet].sort(compareRaw);
  for (const entry of unsafe) {
    if (!causalComponentSet.has(entry.component_id)) continue;
    const reason =
      entry.reason_code === "imported_unsafe"
        ? "eligible_imported_shared_lineage_global_taint"
        : entry.reason_code === "cycle_unsafe"
          ? "eligible_reachable_cycle_global_taint"
          : entry.reason_code === "zone_unsafe"
            ? "eligible_cross_zone_global_taint"
            : entry.reason_code === "conflicting_intent_unsafe"
              ? "conflicting_eligible_intent_global_taint"
              : undefined;
    if (reason !== undefined) taints.add(reason);
  }
  const reasonCounts = new Map<ReasonCode, number>();
  for (const entry of entries)
    reasonCounts.set(entry.reason_code, (reasonCounts.get(entry.reason_code) ?? 0) + 1);
  const unsigned = {
    schema: "carpeos.policy-reconciliation-plan/v2" as const,
    trust_zone_id: input.trust_zone_id,
    from_policy: input.from_policy,
    to_policy: input.to_policy,
    limit: input.limit,
    total_candidate_count: input.total_candidate_count,
    classified_count: entries.length,
    truncated: input.total_candidate_count > input.limit,
    high_water: input.high_water,
    counts: {
      eligible_write_count: eligible.filter((entry) => entry.bucket === "eligible_write").length,
      eligible_noop_count: eligible.filter((entry) => entry.bucket === "eligible_noop").length,
      unsafe_unchanged_count: unsafe.length,
      replace_count: entries.filter((entry) => entry.action === "replace").length,
      invalidate_count: entries.filter((entry) => entry.action === "invalidate").length,
      already_applied_count: entries.filter((entry) => entry.action === "already_applied").length,
      reason_code_counts: [...reasonCounts]
        .map(([reason_code, count]) => ({ reason_code, count }))
        .sort((left, right) => compareRaw(left.reason_code, right.reason_code)),
    },
    plan_admissible: taints.size === 0,
    global_taint_reason_codes: [...taints].sort(compareRaw),
    global_taint_component_ids: causalComponents,
    global_taint_entry_ids: entries
      .filter((entry) => causalComponents.includes(entry.component_id))
      .map((entry) => entry.source_event_id)
      .sort(compareRaw),
    entries,
  };
  return { ...unsigned, plan_digest: digestPolicyReconciliationPlanV2(unsigned) };
}
