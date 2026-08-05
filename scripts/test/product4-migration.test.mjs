import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMigrationSnapshot,
  assertMigrationPlan,
  MigrationContractError,
  migrationPlanDigest,
  readMigrationOracle,
  rollbackMigrationSnapshot,
} from "../product4/migration-oracle.mjs";
import { PRODUCT4_CONTEXT, PRODUCT4_POLICY_SHA256 } from "../product4/policy-identity.mjs";

const plan = {
  schema_version: "product4-migration-plan-v1",
  migration_id: "m4_synthetic_receipts",
  source_schema_version: "v1",
  target_schema_version: "product4-v1",
  policy_sha256: PRODUCT4_POLICY_SHA256,
  context: PRODUCT4_CONTEXT,
  required_action_ids: ["read_oracle", "protected_free", "action_complete"],
  operations: [
    {
      operation_id: "op_product4_receipts",
      kind: "add_table",
      table: "product4_receipts",
      name: "product4_receipts",
    },
    {
      operation_id: "op_product4_receipt_digest",
      kind: "add_index",
      table: "product4_receipts",
      name: "receipt_digest",
    },
  ],
  rollback: {
    mode: "explicit_authorized",
    preserve_canonical: true,
    requires_fresh_read: true,
  },
};

const initialSnapshot = {
  schema_version: "v1",
  canonical_events: [
    {
      event_id: "evt_synthetic_maintenance_001",
      event_type: "Observation",
      payload_digest: "a".repeat(64),
    },
  ],
  canonical_event_digests: [
    {
      event_id: "evt_synthetic_maintenance_001",
      digest: "a".repeat(64),
    },
  ],
  protected_value_refs: [
    {
      ref_type: "opaque",
      protected_value_id: "pv_synthetic_receipt_001",
      digest: "b".repeat(64),
      size_bytes: 32,
    },
  ],
  trust_zone_ids: ["tz_synthetic"],
  pending_action_ids: [],
  completed_action_ids: ["read_oracle", "protected_free", "action_complete"],
  applied_operation_ids: [],
  migration_receipts: [],
  rollback_receipts: [],
  legacy_writer_fields: {
    schema_version: "v1",
    event_fields: ["event_id", "event_type", "payload_digest"],
  },
  legacy_writer_compatible: true,
};

test("M1 migration plan is additive, frozen to P4_0, and digest-stable", () => {
  assert.doesNotThrow(() => assertMigrationPlan(plan));
  const first = migrationPlanDigest(plan);
  const reordered = {
    rollback: plan.rollback,
    operations: plan.operations,
    required_action_ids: plan.required_action_ids,
    context: plan.context,
    policy_sha256: plan.policy_sha256,
    target_schema_version: plan.target_schema_version,
    source_schema_version: plan.source_schema_version,
    migration_id: plan.migration_id,
    schema_version: plan.schema_version,
  };
  assert.equal(migrationPlanDigest(reordered), first);
});

test("M1 applies additive metadata idempotently and produces a ready oracle", () => {
  const first = applyMigrationSnapshot(initialSnapshot, plan);
  assert.equal(first.replayed, false);
  assert.equal(first.after.schema_version, "product4-v1");
  assert.deepEqual(first.after.canonical_events, initialSnapshot.canonical_events);
  assert.deepEqual(first.after.protected_value_refs, initialSnapshot.protected_value_refs);
  assert.equal(first.oracle.status, "ready");
  assert.deepEqual(first.oracle.blockers, []);

  const replay = applyMigrationSnapshot(first.after, plan);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.after, first.after);
  assert.equal(replay.oracle.status, "ready");
});

test("M1 read oracle blocks protected data, incomplete actions, old-writer drift, and trust-zone drift", () => {
  const migrated = applyMigrationSnapshot(initialSnapshot, plan).after;

  const protectedData = structuredClone(migrated);
  protectedData.protected_value_refs[0].plaintext = "never accepted";
  assert.equal(readMigrationOracle(initialSnapshot, protectedData, plan).status, "blocked");
  assert.match(
    readMigrationOracle(initialSnapshot, protectedData, plan).blockers.join(","),
    /protected_free/,
  );

  const incomplete = structuredClone(migrated);
  incomplete.pending_action_ids = ["read_oracle"];
  assert.match(
    readMigrationOracle(initialSnapshot, incomplete, plan).blockers.join(","),
    /action_complete/,
  );

  const oldWriterDrift = structuredClone(migrated);
  oldWriterDrift.legacy_writer_fields.event_fields.push("new_field");
  assert.match(
    readMigrationOracle(initialSnapshot, oldWriterDrift, plan).blockers.join(","),
    /old_writer_compatible/,
  );

  const trustZoneDrift = structuredClone(migrated);
  trustZoneDrift.trust_zone_ids.push("tz_other");
  assert.match(
    readMigrationOracle(initialSnapshot, trustZoneDrift, plan).blockers.join(","),
    /trust_zone_preserved/,
  );
});

test("M1 rejects destructive or unsafe migration plans", () => {
  const destructive = structuredClone(plan);
  destructive.operations[0].kind = "drop_table";
  assert.throws(
    () => assertMigrationPlan(destructive),
    (error) => {
      assert.ok(error instanceof MigrationContractError);
      assert.equal(error.code, "invalid_plan");
      return true;
    },
  );

  const executable = structuredClone(plan);
  executable.operations[0].sql = "DROP TABLE canonical_events";
  assert.throws(() => assertMigrationPlan(executable), /not additive|unsupported field/);

  const alternatePolicy = structuredClone(plan);
  alternatePolicy.policy_sha256 = "c".repeat(64);
  assert.throws(() => assertMigrationPlan(alternatePolicy), /policy_sha256/);
});

test("M1 rollback requires explicit authorization and preserves canonical state", () => {
  const migrated = applyMigrationSnapshot(initialSnapshot, plan).after;
  assert.throws(
    () =>
      rollbackMigrationSnapshot({
        before: initialSnapshot,
        after: migrated,
        plan,
        authorization: {},
      }),
    /explicit approval/,
  );

  const rollback = rollbackMigrationSnapshot({
    before: initialSnapshot,
    after: migrated,
    plan,
    authorization: {
      approved: true,
      actor_ref: "actor_operator",
      approval_digest: "d".repeat(64),
      fresh_read_digest: "e".repeat(64),
    },
  });
  assert.equal(rollback.status, "rolled_back");
  assert.equal(rollback.preserved_canonical_state, true);
  assert.equal(rollback.after.schema_version, "v1");
  assert.deepEqual(rollback.after.canonical_events, initialSnapshot.canonical_events);
  assert.deepEqual(rollback.after.protected_value_refs, initialSnapshot.protected_value_refs);
  assert.deepEqual(rollback.after.migration_receipts, []);
  assert.equal(rollback.after.rollback_receipts.length, 1);
});
