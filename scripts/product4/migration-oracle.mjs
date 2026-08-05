import {
  digestJson,
  PRODUCT4_CONTEXT,
  PRODUCT4_POLICY_SHA256,
  sha256Hex,
} from "./policy-identity.mjs";

const ADDITIVE_OPERATION_KINDS = new Set(["add_table", "add_column", "add_index", "add_trigger"]);
const FORBIDDEN_KEY =
  /token|secret|credential|private_path|protected_plaintext|command|script|module|url|executable|shell/i;
const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[a-z][a-z0-9_-]{2,63}$/;
const OPERATION_ID = /^op_[a-z0-9][a-z0-9_-]{2,63}$/;
const MIGRATION_ID = /^m4_[a-z0-9][a-z0-9_-]{2,63}$/;

export class MigrationContractError extends Error {
  constructor(code, message, details = []) {
    super(message);
    this.name = "MigrationContractError";
    this.code = code;
    this.details = details;
  }
}

export function assertMigrationPlan(plan) {
  const errors = [];
  if (!isRecord(plan)) errors.push("plan must be an object");
  if (!isRecord(plan)) throwError("invalid_plan", errors);

  if (plan.schema_version !== "product4-migration-plan-v1") {
    errors.push("schema_version must be product4-migration-plan-v1");
  }
  if (!MIGRATION_ID.test(plan.migration_id ?? "")) errors.push("migration_id is invalid");
  if (plan.source_schema_version !== "v1") errors.push("source_schema_version must be v1");
  if (plan.target_schema_version !== "product4-v1") {
    errors.push("target_schema_version must be product4-v1");
  }
  if (plan.policy_sha256 !== PRODUCT4_POLICY_SHA256) errors.push("policy_sha256 is not P4_0");
  if (plan.context !== PRODUCT4_CONTEXT) errors.push("context is not the frozen Product 4 context");
  if (!Array.isArray(plan.required_action_ids) || plan.required_action_ids.length === 0) {
    errors.push("required_action_ids must be non-empty");
  } else {
    checkUniqueIdentifiers(plan.required_action_ids, "required_action_ids", errors);
  }
  if (!Array.isArray(plan.operations) || plan.operations.length === 0) {
    errors.push("operations must be non-empty");
  } else {
    const operationIds = new Set();
    for (const operation of plan.operations) {
      if (!isRecord(operation)) {
        errors.push("operation must be an object");
        continue;
      }
      if (!OPERATION_ID.test(operation.operation_id ?? "")) errors.push("operation_id is invalid");
      if (operationIds.has(operation.operation_id))
        errors.push(`duplicate operation ${operation.operation_id}`);
      operationIds.add(operation.operation_id);
      if (!ADDITIVE_OPERATION_KINDS.has(operation.kind)) {
        errors.push(`operation ${operation.operation_id} is not additive`);
      }
      if (!IDENTIFIER.test(operation.table ?? ""))
        errors.push(`operation ${operation.operation_id} table is invalid`);
      if (!IDENTIFIER.test(operation.name ?? ""))
        errors.push(`operation ${operation.operation_id} name is invalid`);
      if (
        Object.keys(operation).some(
          (key) => key !== "operation_id" && key !== "kind" && key !== "table" && key !== "name",
        )
      ) {
        errors.push(`operation ${operation.operation_id} contains an unsupported field`);
      }
    }
  }
  if (
    !isRecord(plan.rollback) ||
    plan.rollback.mode !== "explicit_authorized" ||
    plan.rollback.preserve_canonical !== true ||
    plan.rollback.requires_fresh_read !== true
  ) {
    errors.push(
      "rollback must be explicit, authorized, fresh-read guarded, and canonical-preserving",
    );
  }
  assertNoForbiddenKeys(plan, errors);
  if (errors.length > 0) throwError("invalid_plan", errors);
  return plan;
}

export function migrationPlanDigest(plan) {
  assertMigrationPlan(plan);
  return digestJson(stripKey(plan, "plan_digest"));
}

export function applyMigrationSnapshot(
  snapshot,
  plan,
  { appliedAt = new Date("2026-01-02T00:00:00Z") } = {},
) {
  assertMigrationPlan(plan);
  const before = cloneJson(assertSnapshot(snapshot));
  const planDigest = migrationPlanDigest(plan);
  const existingReceipt = before.migration_receipts.find(
    (receipt) => receipt.migration_id === plan.migration_id,
  );

  if (existingReceipt !== undefined) {
    if (existingReceipt.plan_digest !== planDigest) {
      throwError(
        "migration_conflict",
        `migration ${plan.migration_id} was recorded with another plan digest`,
      );
    }
    return {
      before,
      after: cloneJson(before),
      replayed: true,
      receipt: cloneJson(existingReceipt),
      oracle: readMigrationOracle(before, before, plan),
    };
  }

  if (before.schema_version !== plan.source_schema_version) {
    throwError(
      "source_schema_mismatch",
      `expected ${plan.source_schema_version}, got ${before.schema_version}`,
    );
  }

  const after = cloneJson(before);
  after.schema_version = plan.target_schema_version;
  after.applied_operation_ids = unique([
    ...after.applied_operation_ids,
    ...plan.operations.map((item) => item.operation_id),
  ]);
  const receipt = {
    migration_id: plan.migration_id,
    plan_digest: planDigest,
    applied_operation_ids: plan.operations.map((item) => item.operation_id),
    applied_at: toTimestamp(appliedAt),
  };
  after.migration_receipts.push(receipt);
  const oracle = readMigrationOracle(before, after, plan);
  return { before, after, replayed: false, receipt, oracle };
}

export function readMigrationOracle(before, after, plan) {
  assertMigrationPlan(plan);
  const left = assertSnapshot(before);
  const right = assertSnapshot(after);
  const checks = {
    protected_free: isProtectedFree(left) && isProtectedFree(right),
    action_complete: isActionComplete(right, plan),
    old_writer_compatible:
      right.legacy_writer_compatible === true &&
      equalJson(left.legacy_writer_fields, right.legacy_writer_fields),
    append_only:
      equalJson(left.canonical_events, right.canonical_events) &&
      equalJson(left.canonical_event_digests, right.canonical_event_digests),
    trust_zone_preserved: equalStringSet(left.trust_zone_ids, right.trust_zone_ids),
    idempotent_operations:
      new Set(right.applied_operation_ids).size === right.applied_operation_ids.length &&
      plan.operations.every((operation) =>
        right.applied_operation_ids.includes(operation.operation_id),
      ),
    rollback_ready:
      plan.rollback.mode === "explicit_authorized" &&
      plan.rollback.preserve_canonical === true &&
      plan.rollback.requires_fresh_read === true &&
      right.migration_receipts.some((receipt) => receipt.migration_id === plan.migration_id),
  };
  const blockers = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  return {
    schema_version: "product4-migration-oracle-v1",
    migration_id: plan.migration_id,
    plan_digest: migrationPlanDigest(plan),
    status: blockers.length === 0 ? "ready" : "blocked",
    checks,
    blockers,
    canonical_state_digest_before: canonicalStateDigest(left),
    canonical_state_digest_after: canonicalStateDigest(right),
  };
}

export function rollbackMigrationSnapshot({
  before,
  after,
  plan,
  authorization,
  rolledBackAt = new Date("2026-01-02T00:00:00Z"),
}) {
  assertMigrationPlan(plan);
  const original = assertSnapshot(before);
  const migrated = assertSnapshot(after);
  assertRollbackAuthorization(authorization);
  const planDigest = migrationPlanDigest(plan);
  const receipt = migrated.migration_receipts.find(
    (item) => item.migration_id === plan.migration_id,
  );
  if (receipt === undefined || receipt.plan_digest !== planDigest) {
    throwError("migration_not_applied", `migration ${plan.migration_id} has no matching receipt`);
  }
  if (canonicalStateDigest(original) !== canonicalStateDigest(migrated)) {
    throwError(
      "canonical_state_changed",
      "rollback refuses a changed canonical or trust-zone snapshot",
    );
  }

  const rolledBack = cloneJson(migrated);
  rolledBack.schema_version = plan.source_schema_version;
  const operationIds = new Set(plan.operations.map((operation) => operation.operation_id));
  rolledBack.applied_operation_ids = rolledBack.applied_operation_ids.filter(
    (id) => !operationIds.has(id),
  );
  rolledBack.migration_receipts = rolledBack.migration_receipts.filter(
    (item) => item.migration_id !== plan.migration_id,
  );
  const rollbackReceipt = {
    migration_id: plan.migration_id,
    plan_digest: planDigest,
    actor_ref: authorization.actor_ref,
    approval_digest: authorization.approval_digest,
    fresh_read_digest: authorization.fresh_read_digest,
    canonical_state_digest: canonicalStateDigest(rolledBack),
    rolled_back_at: toTimestamp(rolledBackAt),
  };
  rolledBack.rollback_receipts.push(rollbackReceipt);
  return {
    before: original,
    migrated: migrated,
    after: rolledBack,
    receipt: rollbackReceipt,
    preserved_canonical_state: canonicalStateDigest(original) === canonicalStateDigest(rolledBack),
    status: "rolled_back",
  };
}

function assertSnapshot(snapshot) {
  if (!isRecord(snapshot)) throwError("invalid_snapshot", "migration snapshot must be an object");
  const requiredArrays = [
    "canonical_events",
    "canonical_event_digests",
    "protected_value_refs",
    "trust_zone_ids",
    "pending_action_ids",
    "completed_action_ids",
    "applied_operation_ids",
    "migration_receipts",
    "rollback_receipts",
  ];
  const missing = requiredArrays.filter(
    (key) => !(key in snapshot) || !Array.isArray(snapshot[key]),
  );
  if (missing.length > 0)
    throwError("invalid_snapshot", `missing snapshot arrays: ${missing.join(", ")}`);
  if (
    !isRecord(snapshot.legacy_writer_fields) ||
    typeof snapshot.legacy_writer_compatible !== "boolean"
  ) {
    throwError("invalid_snapshot", "old-writer compatibility evidence is required");
  }
  const errors = [];
  assertNoForbiddenKeys(snapshot, errors);
  if (errors.length > 0) throwError("unsafe_snapshot", errors);
  return snapshot;
}

function assertRollbackAuthorization(authorization) {
  if (!isRecord(authorization) || authorization.approved !== true) {
    throwError("rollback_not_authorized", "rollback requires explicit approval");
  }
  if (!IDENTIFIER.test(authorization.actor_ref ?? "")) {
    throwError("rollback_not_authorized", "rollback actor_ref is invalid");
  }
  if (
    !SHA256.test(authorization.approval_digest ?? "") ||
    !SHA256.test(authorization.fresh_read_digest ?? "")
  ) {
    throwError("rollback_not_authorized", "rollback approval and fresh-read digests are required");
  }
  const errors = [];
  assertNoForbiddenKeys(authorization, errors);
  if (errors.length > 0) throwError("rollback_not_authorized", errors);
}

function isProtectedFree(snapshot) {
  return snapshot.protected_value_refs.every(
    (ref) =>
      isRecord(ref) &&
      Object.keys(ref).every((key) =>
        ["protected_value_id", "digest", "size_bytes", "ref_type"].includes(key),
      ) &&
      ref.ref_type === "opaque" &&
      typeof ref.protected_value_id === "string" &&
      SHA256.test(ref.digest ?? "") &&
      Number.isSafeInteger(ref.size_bytes) &&
      ref.size_bytes > 0,
  );
}

function isActionComplete(snapshot, plan) {
  return (
    snapshot.pending_action_ids.length === 0 &&
    plan.required_action_ids.every((id) => snapshot.completed_action_ids.includes(id))
  );
}

function canonicalStateDigest(snapshot) {
  return sha256Hex(
    JSON.stringify({
      canonical_events: snapshot.canonical_events,
      canonical_event_digests: snapshot.canonical_event_digests,
      protected_value_refs: snapshot.protected_value_refs,
      trust_zone_ids: [...snapshot.trust_zone_ids].sort(),
    }),
  );
}

function assertNoForbiddenKeys(value, errors, path = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertNoForbiddenKeys(item, errors, `${path}[${index}]`);
    });
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) errors.push(`${path}.${key} is not allowed`);
    assertNoForbiddenKeys(child, errors, `${path}.${key}`);
  }
}

function checkUniqueIdentifiers(values, label, errors) {
  const seen = new Set();
  for (const value of values) {
    if (!IDENTIFIER.test(value)) errors.push(`${label} contains an invalid identifier`);
    if (seen.has(value)) errors.push(`${label} contains duplicate ${value}`);
    seen.add(value);
  }
}

function equalStringSet(left, right) {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneJson(value) {
  return structuredClone(value);
}

function stripKey(value, key) {
  const clone = cloneJson(value);
  delete clone[key];
  return clone;
}

function unique(values) {
  return [...new Set(values)];
}

function toTimestamp(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throwError("invalid_timestamp", "migration timestamp must be a valid Date");
  }
  return value.toISOString();
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function throwError(code, messageOrDetails) {
  const details = Array.isArray(messageOrDetails) ? messageOrDetails : [messageOrDetails];
  throw new MigrationContractError(code, details.join("; "), details);
}
