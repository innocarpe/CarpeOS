import assert from "node:assert/strict";
import test from "node:test";
import { PRODUCT4_CONTEXT, PRODUCT4_POLICY_SHA256 } from "../product4/policy-identity.mjs";
import {
  buildReleaseAuthorityReceipt,
  reconcileReleaseAuthority,
  simulateReleaseBypass,
} from "../product4/release-authority.mjs";

const timestamp = "2026-01-02T00:00:00Z";
const sha = "a".repeat(40);
const digest = "b".repeat(64);

function receipt(overrides = {}) {
  return buildReleaseAuthorityReceipt({
    schema_version: "carpeos.release-authority/v1",
    receipt_type: "release_authority",
    status: "blocked_unknown",
    repository_id: 1315097793,
    app: {
      app_id: 4242,
      installation_id: 4343,
      slug: "synthetic-product4-app",
      status: "unknown",
      checks_write: false,
    },
    ownership: {
      owner_ref: "owner_ref",
      rotation_owner_ref: "rotation_owner",
      status: "unknown",
    },
    controller: {
      ref: "release_controller",
      status: "unknown",
      independent: false,
      can_edit_release_workflow: false,
    },
    tag_authority: {
      ref: "tag_authority",
      status: "unknown",
      protected: false,
      allowed_actors_digest: digest,
    },
    credential_issuer: {
      ref: "credential_issuer",
      status: "unknown",
      independent: false,
      issues_to_release_job: false,
    },
    workflow_policy: {
      release_workflow_sha: sha,
      verifier_sha: sha,
      policy_sha256: PRODUCT4_POLICY_SHA256,
      context: PRODUCT4_CONTEXT,
    },
    settings: {
      status: "unknown",
      preimage_digest: digest,
      postimage_digest: digest,
      semantic_digest: digest,
    },
    bypass_rehearsal: {
      status: "not_run",
      gate_deleted_result: "unknown",
      tag_result: "unknown",
      credential_result: "unknown",
      evidence_digest: digest,
    },
    rollback: { owner_ref: "rollback_owner", status: "unknown", fresh_read_required: true },
    approval: { approved: false, approval_digest: digest },
    blockers: ["authority_unknown"],
    observed_at: timestamp,
    ...overrides,
  });
}

test("M5 keeps unknown authority procedural and denies tag and credential capability", () => {
  const blocked = receipt();
  const reconciliation = reconcileReleaseAuthority({ receipt: blocked });
  assert.equal(reconciliation.status, "blocked");
  assert.equal(reconciliation.tag_capability, "denied");
  assert.equal(reconciliation.credential_capability, "denied");
  assert.equal(
    simulateReleaseBypass({ receipt: blocked, releaseGate: { deleted: true } }).tag_result,
    "denied",
  );
});

test("M5 accepts only independently verified authority with a passed bypass rehearsal", () => {
  const verified = receipt({
    status: "verified",
    app: {
      app_id: 4242,
      installation_id: 4343,
      slug: "synthetic-product4-app",
      status: "verified",
      checks_write: true,
    },
    ownership: { owner_ref: "owner_ref", rotation_owner_ref: "rotation_owner", status: "verified" },
    controller: {
      ref: "release_controller",
      status: "verified",
      independent: true,
      can_edit_release_workflow: false,
    },
    tag_authority: {
      ref: "tag_authority",
      status: "verified",
      protected: true,
      allowed_actors_digest: digest,
    },
    credential_issuer: {
      ref: "credential_issuer",
      status: "verified",
      independent: true,
      issues_to_release_job: true,
    },
    settings: {
      status: "verified",
      preimage_digest: digest,
      postimage_digest: digest,
      semantic_digest: digest,
    },
    bypass_rehearsal: {
      status: "passed",
      gate_deleted_result: "denied",
      tag_result: "denied",
      credential_result: "denied",
      evidence_digest: digest,
    },
    rollback: { owner_ref: "rollback_owner", status: "verified", fresh_read_required: true },
    approval: { approved: true, approval_digest: digest },
    blockers: [],
  });
  const reconciliation = reconcileReleaseAuthority({
    receipt: verified,
    releaseGate: { deleted: true, actor: "candidate_release_actor" },
  });
  assert.equal(reconciliation.status, "procedural_ready");
  assert.equal(reconciliation.tag_capability, "controller_only");
  assert.equal(reconciliation.credential_capability, "protected_release_job_only");
});

test("M5 rejects authority tampering and malformed blocker containers", () => {
  const blocked = receipt();
  assert.throws(
    () =>
      ({ ...blocked, receipt_digest: "c".repeat(64) }) &&
      reconcileReleaseAuthority({ receipt: { ...blocked, receipt_digest: "c".repeat(64) } }),
    /invalid_receipt/,
  );
  assert.throws(
    () => reconcileReleaseAuthority({ receipt: { ...blocked, blockers: undefined } }),
    /invalid_receipt/,
  );
  assert.throws(
    () =>
      reconcileReleaseAuthority({
        receipt: {
          ...blocked,
          controller: { ...blocked.controller, can_edit_release_workflow: true },
          receipt_digest: blocked.receipt_digest,
        },
      }),
    /invalid_receipt/,
  );
  assert.throws(
    () => reconcileReleaseAuthority({ receipt: { ...blocked, token: "never" } }),
    /invalid_receipt/,
  );
});
