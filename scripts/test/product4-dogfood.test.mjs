import assert from "node:assert/strict";
import test from "node:test";
import { assertDogfoodReceipt, runSyntheticDogfood } from "../product4/dogfood.mjs";

const timestamp = "2026-01-02T00:00:00Z";
const expectedScenarioIds = [
  "m1_migration_contract",
  "m2_loop_recovery_only",
  "m3_sentinel_write",
  "m3_wrong_p02",
  "m4_forged_hash_consistent_report",
  "m4_inactive_policy",
  "m4_moved_head",
  "m4_duplicate_api_results",
  "m4_ruleset_response_loss",
  "m5_gate_deletion_bypass",
  "m5_missing_ownership",
];

test("synthetic dogfood passes every M1-M5 refusal scenario", () => {
  const receipt = runSyntheticDogfood({ observedAt: timestamp });

  assert.equal(receipt.status, "passed");
  assert.equal(receipt.canonical_write, "none");
  assert.equal(receipt.live_authority, "not_attempted");
  assert.deepEqual(
    receipt.scenarios.map((scenario) => scenario.id),
    expectedScenarioIds,
  );
  assert.ok(receipt.scenarios.every((scenario) => scenario.status === "passed"));
  assert.deepEqual(receipt.blockers, []);
  assert.equal(assertDogfoodReceipt(receipt), receipt);
});

test("dogfood receipt refuses canonical writes and forbidden fields", () => {
  const receipt = runSyntheticDogfood({ observedAt: timestamp });

  assert.throws(
    () => assertDogfoodReceipt({ ...receipt, canonical_write: "append" }),
    /invalid_receipt/,
  );
  assert.throws(
    () => assertDogfoodReceipt({ ...receipt, private_path: "synthetic/private" }),
    /invalid_receipt/,
  );
});

test("dogfood receipt refuses digest tampering", () => {
  const receipt = runSyntheticDogfood({ observedAt: timestamp });

  assert.throws(
    () => assertDogfoodReceipt({ ...receipt, receipt_digest: "0".repeat(64) }),
    /invalid_receipt/,
  );
});
