import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildCandidateIntent } from "../product4/candidate-intent.mjs";
import {
  classifyCandidateState,
  createCandidateState,
  promoteCandidateState,
} from "../product4/candidate-state.mjs";
import { evaluateCandidateEvidence, PREDICATE_IDS } from "../product4/evaluator.mjs";
import {
  buildEvidenceIdentity,
  buildEvidenceReceipt,
  buildExactCheckQuery,
} from "../product4/github-evidence-api.mjs";
import {
  digestJson,
  MAINTENANCE_STUDY_FIXTURE_SHA256,
  PRODUCT4_CONTEXT,
  PRODUCT4_POLICY_SHA256,
} from "../product4/policy-identity.mjs";
import { buildPromotionLedger } from "../product4/promotion-ledger.mjs";
import { buildReleaseAuthorityReceipt } from "../product4/release-authority.mjs";
import { assertOwnershipReceipt } from "../product4/ruleset-guard.mjs";
import {
  assertReleaseIdentity,
  buildReleaseIdentity,
  verifyReleaseGates,
} from "../verify-4.0-gates.mjs";

const timestamp = "2026-01-02T00:00:00Z";
const candidateSha = "a".repeat(40);
const baseSha = "b".repeat(40);
const releaseSha = "c".repeat(40);
const treeSha = "d".repeat(64);
const workflowSha = "e".repeat(40);
const digest = "f".repeat(64);
const externalId = `carpeos-4.0.0:${candidateSha}:${MAINTENANCE_STUDY_FIXTURE_SHA256}`;

function authority() {
  return buildReleaseAuthorityReceipt({
    schema_version: "carpeos.release-authority/v1",
    receipt_type: "release_authority",
    status: "verified",
    repository_id: 1315097793,
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
    workflow_policy: {
      release_workflow_sha: workflowSha,
      verifier_sha: workflowSha,
      policy_sha256: PRODUCT4_POLICY_SHA256,
      context: PRODUCT4_CONTEXT,
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
    observed_at: timestamp,
  });
}

function ownership() {
  const authorityRef = (ref) => ({ status: "verified", ref });
  const value = {
    schema_version: "product4-ownership-v1",
    receipt_type: "product4_ownership",
    status: "verified",
    repository_id: 1315097793,
    ruleset_id: 19955787,
    context: PRODUCT4_CONTEXT,
    policy_sha256: PRODUCT4_POLICY_SHA256,
    app: {
      app_id: 4242,
      installation_id: 4343,
      slug: "synthetic-product4-app",
      checks_write: true,
    },
    authorities: {
      rotation_owner: authorityRef("rotation_owner"),
      settings_admin: authorityRef("settings_admin"),
      release_controller: authorityRef("release_controller"),
      credential_owner: authorityRef("credential_owner"),
      artifact_owner: authorityRef("artifact_owner"),
    },
    evidence: {
      repository_id: 1315097793,
      ruleset_id: 19955787,
      app_id: 4242,
      installation_id: 4343,
      policy_sha256: PRODUCT4_POLICY_SHA256,
      preimage_digest: digest,
    },
    approval: { approved: true, approval_digest: digest },
    blockers: [],
    observed_at: timestamp,
  };
  return assertOwnershipReceipt(value);
}

function ruleset() {
  return {
    schema_version: "ruleset-activation-v1",
    receipt_type: "product4_ruleset_activation",
    status: "activated",
    repository_id: 1315097793,
    ruleset_id: 19955787,
    context: PRODUCT4_CONTEXT,
    policy_sha256: PRODUCT4_POLICY_SHA256,
    operation: "semantic_add_fixed_context",
    preimage_digest: digest,
    post_image_digest: digest,
    preservation_digest: digest,
    ownership_receipt_digest: digest,
    approval_digest: digest,
    response_loss: "none",
    rollback: { authorized: false, fresh_read_required: true, status: "not_requested" },
    blockers: [],
    observed_at: timestamp,
  };
}

function candidateEvidence() {
  const intent = buildCandidateIntent({
    head_sha: candidateSha,
    tree_sha256: treeSha,
    issuer_workflow_sha: workflowSha,
    classification: true,
  });
  const observations = {
    p02: {
      diagnosis: "no_analog",
      outcome: "blocked_no_apply",
      analog_available: false,
      state_transition: "none_supported",
    },
    zero_write: {
      canonical_events: 0,
      review_rows: 0,
      disposition_rows: 0,
      outbox_rows: 0,
      protected_uploads: 0,
    },
    high_water: {
      canonical_events: 0,
      review_rows: 0,
      disposition_rows: 0,
      outbox_rows: 0,
      protected_uploads: 0,
    },
  };
  const evaluation = evaluateCandidateEvidence({
    identity: {
      repository_id: 1315097793,
      head_sha: candidateSha,
      tree_sha256: treeSha,
      fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
      policy_sha256: PRODUCT4_POLICY_SHA256,
      context: PRODUCT4_CONTEXT,
      external_id: externalId,
    },
    candidateReport: { observed: "synthetic" },
    trustedPredicates: Object.fromEntries(PREDICATE_IDS.map((id) => [id, true])),
    observations,
    provenance: {
      base_sha: baseSha,
      evaluator_workflow_sha: workflowSha,
      evaluated_at: timestamp,
    },
    issuerWorkflowSha: workflowSha,
    candidateReportedSuccess: false,
  });
  const pendingState = classifyCandidateState({
    state: createCandidateState({ intentEnvelope: intent, observedAt: timestamp }),
    intentEnvelope: intent,
    observedAt: timestamp,
  });
  const promotedState = promoteCandidateState({
    state: pendingState,
    evidenceTuple: {
      base_sha: baseSha,
      head_sha: candidateSha,
      tree_sha256: treeSha,
      fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
      intent_policy_sha256: PRODUCT4_POLICY_SHA256,
      context: PRODUCT4_CONTEXT,
      check_name: PRODUCT4_CONTEXT,
      external_id: externalId,
      attestation_sha256: evaluation.attestation_digest,
    },
    approval: { approved: true, actor_ref: "human_authority", approval_digest: digest },
    observedAt: timestamp,
  });
  const evaluatorResult = {
    schema_version: "product4-evaluator-result-v1",
    result_type: "base_owned_evaluation",
    status: "trusted",
    success: true,
    repository_id: 1315097793,
    head_sha: candidateSha,
    tree_sha256: treeSha,
    fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
    policy_sha256: PRODUCT4_POLICY_SHA256,
    context: PRODUCT4_CONTEXT,
    intent,
    state: promotedState,
    attestation: evaluation.attestation,
    attestation_digest: evaluation.attestation_digest,
    p02_receipt_digest: digest,
    predicate_digest: digest,
    blockers: [],
    evaluated_at: timestamp,
  };
  const evidenceIdentity = buildEvidenceIdentity({
    repositoryPath: "synthetic/carpeos",
    headSha: candidateSha,
    externalId,
    appId: 4242,
  });
  const query = buildExactCheckQuery({
    repositoryPath: evidenceIdentity.repository_path,
    headSha: candidateSha,
  });
  const apiEvidence = buildEvidenceReceipt({
    query,
    identity: evidenceIdentity,
    pages: [
      {
        items: [
          {
            id: 1,
            repository_id: 1315097793,
            repository_path: evidenceIdentity.repository_path,
            head_sha: candidateSha,
            external_id: externalId,
            fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
            policy_sha256: PRODUCT4_POLICY_SHA256,
            context: PRODUCT4_CONTEXT,
            check_name: PRODUCT4_CONTEXT,
            app_id: 4242,
            runs: [{ id: 2, app_id: 4242, head_sha: candidateSha, conclusion: "success" }],
          },
        ],
        headers: { link: "" },
      },
    ],
    observedAt: timestamp,
  });
  const promotionLedger = buildPromotionLedger({
    intent,
    state: promotedState,
    attestation: evaluation.attestation,
    apiEvidence,
    ownershipReceipt: ownership(),
    rulesetReceipt: ruleset(),
    observedAt: timestamp,
  });
  return { evaluatorResult, promotionLedger, baseSha };
}

function envelope(fields) {
  return { ...fields, receipt_digest: digestJson(fields) };
}

function manifestAndTarball() {
  const directory = mkdtempSync(join(tmpdir(), "carpeos-release-gate-"));
  const bytes = Buffer.from("synthetic packed artifact\n");
  const filename = "carpeos-4.0.0.tgz";
  const tarballPath = join(directory, filename);
  writeFileSync(tarballPath, bytes);
  const manifest = {
    schema: "carpeos.release-artifact/v1",
    git_sha: releaseSha,
    annotated_tag: "v4.0.0",
    package_name: "@innocarpe/carpeos",
    version: "4.0.0",
    filename,
    bytes: bytes.length,
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    sha512: `sha512-${"A".repeat(86)}==`,
    npm_integrity: `sha512-${"A".repeat(86)}==`,
    creation_tool: "npm",
    creation_tool_version: "11.0.0",
  };
  return { directory, manifest, tarballPath };
}

function releaseReceipts(manifest, candidate) {
  const installSmoke = envelope({
    schema_version: "product4-install-smoke-v1",
    receipt_type: "install_smoke",
    status: "passed",
    package_name: "@innocarpe/carpeos",
    version: manifest.version,
    manifest_digest: digestJson(manifest),
    artifact_sha256: manifest.sha256.slice("sha256:".length),
    install_digest: "1".repeat(64),
    smoke_digest: "2".repeat(64),
    observed_at: timestamp,
  });
  const ancestry = envelope({
    schema_version: "product4-release-ancestry-v1",
    receipt_type: "release_ancestry",
    status: "verified",
    base_sha: candidate.baseSha,
    candidate_sha: candidate.evaluatorResult.head_sha,
    release_sha: releaseSha,
    base_is_ancestor: true,
    candidate_is_ancestor: true,
    allowlist_digest: "3".repeat(64),
    observed_at: timestamp,
  });
  const allowedPaths = ["CHANGELOG.md", "packages/carpeos/package.json"];
  const changedPaths = ["CHANGELOG.md"];
  const releaseDiff = envelope({
    schema_version: "product4-release-diff-v1",
    receipt_type: "release_diff",
    status: "verified",
    candidate_sha: candidate.evaluatorResult.head_sha,
    release_sha: releaseSha,
    allowed_paths: allowedPaths,
    changed_paths: changedPaths,
    allowed_paths_digest: digestJson(allowedPaths),
    changed_paths_digest: digestJson(changedPaths),
    only_allowed_paths: true,
    observed_at: timestamp,
  });
  const tagIdentity = envelope({
    schema_version: "product4-tag-identity-v1",
    receipt_type: "tag_identity",
    status: "verified",
    tag: "v4.0.0",
    version: "4.0.0",
    target_sha: releaseSha,
    actor_ref: "tag_authority",
    protected: true,
    annotated: true,
    observed_at: timestamp,
  });
  const approval = envelope({
    schema_version: "product4-release-approval-v1",
    receipt_type: "release_approval",
    status: "approved",
    approved: true,
    tag: "v4.0.0",
    release_sha: releaseSha,
    approval_digest: "4".repeat(64),
    observed_at: timestamp,
  });
  return { installSmoke, ancestry, releaseDiff, tagIdentity, approval };
}

test("M5 release gate binds C, R, P4_0, pack-once, ancestry, diff, approval, and authority", () => {
  const candidate = candidateEvidence();
  const { directory, manifest, tarballPath } = manifestAndTarball();
  try {
    const receipts = releaseReceipts(manifest, candidate);
    const report = verifyReleaseGates({
      authorityReceipt: authority(),
      ownershipReceipt: ownership(),
      rulesetReceipt: ruleset(),
      evaluatorResult: candidate.evaluatorResult,
      promotionLedger: candidate.promotionLedger,
      manifest,
      tarballPath,
      installSmoke: receipts.installSmoke,
      ancestry: receipts.ancestry,
      releaseDiff: receipts.releaseDiff,
      tagIdentity: receipts.tagIdentity,
      approval: receipts.approval,
      tag: "v4.0.0",
      releaseSha,
      observedAt: timestamp,
    });
    assert.equal(report.status, "ready", JSON.stringify(report, null, 2));
    assert.equal(report.decision, "ready");
    assert.equal(report.technical_release_blocking_claim, "none");
    assert.equal(report.identity?.decision, "ready");
    assertReleaseIdentity(report.identity);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("M5 release gate fails closed without authority or receipts and never claims a technical block", () => {
  const report = verifyReleaseGates({ tag: "v4.0.0", releaseSha });
  assert.equal(report.status, "blocked");
  assert.equal(report.decision, "defer");
  assert.equal(report.technical_release_blocking_claim, "none");
  assert.equal(report.evidence_scope, "procedural_only");
  assert.ok(report.blockers.includes("release_authority_missing"));
  assert.ok(report.blockers.includes("release_identity_incomplete"));
});

test("M5 release identity rejects digest and tag tampering", () => {
  const evidence = Object.fromEntries(
    [
      "candidate_attestation_digest",
      "promotion_ledger_digest",
      "ownership_receipt_digest",
      "ruleset_receipt_digest",
      "manifest_digest",
      "artifact_sha256",
      "install_smoke_digest",
      "ancestry_digest",
      "release_diff_digest",
      "tag_identity_digest",
    ].map((key) => [key, digest]),
  );
  const identity = buildReleaseIdentity({
    version: "4.0.0",
    tag: "v4.0.0",
    releaseSha,
    candidateSha,
    baseSha,
    evidence,
    authorityReceiptDigest: digest,
    approvalDigest: digest,
    decision: "defer",
    blockers: ["authority_unknown"],
    observedAt: timestamp,
  });
  assertReleaseIdentity(identity);
  assert.throws(() => assertReleaseIdentity({ ...identity, tag: "v4.0.1" }), /invalid_identity/);
  assert.throws(
    () => assertReleaseIdentity({ ...identity, identity_digest: "0".repeat(64) }),
    /invalid_identity/,
  );
});
