import assert from "node:assert/strict";
import test from "node:test";
import { PRODUCT4_POLICY_SHA256 } from "../product4/policy-identity.mjs";
import {
  assertOwnershipReceipt,
  assertRulesetReceipt,
  prepareRollback,
  projectFixedContext,
  reconcileRulesetResponse,
} from "../product4/ruleset-guard.mjs";

const timestamp = "2026-01-02T00:00:00Z";

function ownership(status = "verified") {
  const authority = (ref, authorityStatus = status === "verified" ? "verified" : "unknown") => ({
    status: authorityStatus,
    ref,
  });
  return {
    schema_version: "product4-ownership-v1",
    receipt_type: "product4_ownership",
    status,
    repository_id: 1315097793,
    ruleset_id: 19955787,
    context: "Product 4 Candidate Evidence",
    policy_sha256: PRODUCT4_POLICY_SHA256,
    app: {
      app_id: 4242,
      installation_id: 4343,
      slug: "synthetic-product4-app",
      checks_write: status === "verified",
    },
    authorities: {
      rotation_owner: authority("rotation_owner"),
      settings_admin: authority("settings_admin"),
      release_controller: authority("release_controller"),
      credential_owner: authority("credential_owner"),
      artifact_owner: authority("artifact_owner"),
    },
    evidence: {
      repository_id: 1315097793,
      ruleset_id: 19955787,
      app_id: 4242,
      installation_id: 4343,
      policy_sha256: PRODUCT4_POLICY_SHA256,
      preimage_digest: "a".repeat(64),
    },
    approval: { approved: status === "verified", approval_digest: "b".repeat(64) },
    blockers: status === "verified" ? [] : ["settings_admin_unknown"],
    observed_at: timestamp,
  };
}

function ruleset() {
  return {
    repository_id: 1315097793,
    ruleset_id: 19955787,
    name: "main protection",
    target: "branch",
    enforcement: "active",
    bypass_actors: [{ actor: "maintainer", mode: "pull_request" }],
    conditions: { ref_name: ["refs/heads/main"] },
    rules: [{ type: "required_status_checks", contexts: ["Checks"] }],
    required_contexts: [{ context: "Checks", integration_id: 111 }],
    unrelated: { preserve: true },
  };
}

function approval() {
  return { approved: true, approval_digest: "c".repeat(64), observed_at: timestamp };
}

test("M4 keeps unknown ownership blocked and refuses unsafe or alternate policy receipts", () => {
  const blocked = ownership("blocked_unknown");
  assertOwnershipReceipt(blocked);
  const projection = projectFixedContext({
    ruleset: ruleset(),
    ownershipReceipt: blocked,
    approval: approval(),
  });
  assert.equal(projection.status, "blocked");
  assert.deepEqual(projection.blockers, ["ownership_unknown"]);

  const unsafe = { ...blocked, token: "synthetic-forbidden" };
  assert.throws(() => assertOwnershipReceipt(unsafe), /invalid_ownership/);
  assert.throws(
    () => assertOwnershipReceipt({ ...blocked, policy_sha256: "d".repeat(64) }),
    /policy is not P4_0/,
  );
});

test("M4 projects one fixed context semantically and preserves unrelated ruleset fields", () => {
  const preimage = ruleset();
  const projection = projectFixedContext({
    ruleset: preimage,
    ownershipReceipt: ownership(),
    approval: approval(),
  });
  assert.equal(projection.status, "dry_run");
  assert.equal(projection.post_image.required_contexts.length, 2);
  assert.equal(
    projection.post_image.required_contexts.at(-1).context,
    "Product 4 Candidate Evidence",
  );
  assert.equal(projection.post_image.required_contexts.at(-1).integration_id, 4242);
  assert.deepEqual(projection.post_image.unrelated, preimage.unrelated);
  assert.deepEqual(projection.post_image.rules, preimage.rules);
  assert.notEqual(projection.preimage_digest, projection.post_image_digest);

  assert.throws(
    () =>
      projectFixedContext({
        ruleset: {
          ...preimage,
          required_contexts: [
            ...preimage.required_contexts,
            { context: "Product 4 Candidate Evidence", integration_id: 4242 },
          ],
        },
        ownershipReceipt: ownership(),
        approval: approval(),
      }),
    /duplicate_refusal/,
  );
});

test("M4 fails closed on response loss, drift, and implicit rollback", () => {
  const projection = projectFixedContext({
    ruleset: ruleset(),
    ownershipReceipt: ownership(),
    approval: approval(),
  });
  const lost = reconcileRulesetResponse({ projection, response: { status: "lost" } });
  assert.equal(lost.status, "blocked");
  assert.equal(lost.response_loss, "blocked_indeterminate");

  assert.throws(
    () =>
      reconcileRulesetResponse({
        projection,
        response: {
          status: "received",
          post_image: { ...projection.post_image, enforcement: "bypass" },
        },
      }),
    /preservation_failure|drift_detected/,
  );
  const reconciled = reconcileRulesetResponse({
    projection,
    response: { status: "received", post_image: projection.post_image },
  });
  assert.equal(reconciled.status, "blocked");
  assert.match(reconciled.blockers[0], /independent_authorization/);

  assert.throws(
    () =>
      prepareRollback({
        projection,
        current: projection.post_image,
        freshReadDigest: "e".repeat(64),
        approval: approval(),
      }),
    /stale_read/,
  );
  const rollback = prepareRollback({
    projection,
    current: projection.post_image,
    freshReadDigest: projection.post_image_digest,
    approval: approval(),
  });
  assert.equal(rollback.operation, "semantic_rollback");
  assert.equal(rollback.rollback.status, "ready");
});

test("M4 validates the strict activation receipt shape", () => {
  const receipt = {
    schema_version: "ruleset-activation-v1",
    receipt_type: "product4_ruleset_activation",
    status: "blocked",
    repository_id: 1315097793,
    ruleset_id: 19955787,
    context: "Product 4 Candidate Evidence",
    policy_sha256: PRODUCT4_POLICY_SHA256,
    operation: "semantic_add_fixed_context",
    preimage_digest: "1".repeat(64),
    post_image_digest: "2".repeat(64),
    preservation_digest: "3".repeat(64),
    ownership_receipt_digest: "4".repeat(64),
    approval_digest: "5".repeat(64),
    response_loss: "blocked_indeterminate",
    rollback: { authorized: false, fresh_read_required: true, status: "blocked" },
    blockers: ["response_loss"],
    observed_at: timestamp,
  };
  assertRulesetReceipt(receipt);
  assert.throws(() => assertRulesetReceipt({ ...receipt, script: "never" }), /invalid_receipt/);
});
