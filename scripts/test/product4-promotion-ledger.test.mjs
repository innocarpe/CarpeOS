import assert from "node:assert/strict";
import test from "node:test";

import { buildCandidateIntent } from "../product4/candidate-intent.mjs";
import { classifyCandidateState, createCandidateState } from "../product4/candidate-state.mjs";
import { evaluateCandidateEvidence, PREDICATE_IDS } from "../product4/evaluator.mjs";
import {
  buildEvidenceIdentity,
  buildEvidenceReceipt,
  buildExactCheckQuery,
  normalizeCheckRunsResponse,
} from "../product4/github-evidence-api.mjs";
import {
  digestJson,
  MAINTENANCE_STUDY_FIXTURE_SHA256,
  PRODUCT4_CONTEXT,
  PRODUCT4_POLICY_SHA256,
} from "../product4/policy-identity.mjs";
import {
  appendPromotionEntry,
  assertPromotionLedger,
  buildPromotionLedger,
} from "../product4/promotion-ledger.mjs";
import { assertOwnershipReceipt } from "../product4/ruleset-guard.mjs";

const timestamp = "2026-01-02T00:00:00Z";
const headSha = "a".repeat(40);
const baseSha = "b".repeat(40);
const treeSha = "c".repeat(64);
const workflowSha = "d".repeat(40);
const externalId = `carpeos-4.0.0:${headSha}:${MAINTENANCE_STUDY_FIXTURE_SHA256}`;

function intent() {
  return buildCandidateIntent({
    head_sha: headSha,
    tree_sha256: treeSha,
    issuer_workflow_sha: workflowSha,
    classification: true,
  });
}

function state(envelope) {
  return classifyCandidateState({
    state: createCandidateState({ intentEnvelope: envelope, observedAt: timestamp }),
    intentEnvelope: envelope,
    observedAt: timestamp,
  });
}

function attestation(envelope) {
  const identity = {
    repository_id: 1315097793,
    head_sha: headSha,
    tree_sha256: treeSha,
    fixture_sha256: envelope.fixture_sha256,
    policy_sha256: PRODUCT4_POLICY_SHA256,
    context: PRODUCT4_CONTEXT,
    external_id: externalId,
  };
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
      canonical_events: 1,
      review_rows: 0,
      disposition_rows: 0,
      outbox_rows: 0,
      protected_uploads: 0,
    },
    candidate_execution: {
      unprivileged: true,
      isolated: true,
    },
  };
  const candidateReport = {
    schema_version: "product4-candidate-report-v1",
    report_type: "raw_candidate_report",
    repository_id: identity.repository_id,
    head_sha: identity.head_sha,
    tree_sha256: identity.tree_sha256,
    fixture_sha256: identity.fixture_sha256,
    intent_policy_sha256: identity.policy_sha256,
    context: identity.context,
    external_id: identity.external_id,
    observed: "synthetic",
  };
  const trustedPredicates = Object.fromEntries(PREDICATE_IDS.map((id) => [id, true]));
  const provenance = {
    base_sha: baseSha,
    evaluator_workflow_sha: workflowSha,
    evaluated_at: timestamp,
  };
  const trustedEvidence = {
    schema_version: "carpeos.product4-trusted-evidence/v1",
    owner: "base_evaluator",
    identity: { ...identity },
    predicate_digest: digestJson(trustedPredicates),
    observation_digest: digestJson(observations),
    source_report_digest: digestJson(candidateReport),
    source: {
      kind: "base_recompute",
      evaluator_tree_sha256: "e".repeat(64),
    },
  };
  return evaluateCandidateEvidence({
    identity,
    candidateReport,
    trustedPredicates,
    observations,
    provenance,
    issuerWorkflowSha: workflowSha,
    trustedEvidence,
    candidateReportedSuccess: false,
    requireCandidateExecutionObservation: true,
  }).attestation;
}

function apiEvidence() {
  const identity = buildEvidenceIdentity({
    repositoryPath: "synthetic/carpeos",
    headSha,
    externalId,
    appId: 4242,
  });
  const query = buildExactCheckQuery({ repositoryPath: identity.repository_path, headSha });
  const repository = { id: identity.repository_id, full_name: identity.repository_path };
  const app = { id: identity.app_id };
  const checkSuite = {
    id: 1,
    repository,
    app,
    head_sha: identity.head_sha,
    status: "completed",
    conclusion: "success",
  };
  const checkRun = {
    id: 9,
    name: identity.check_name,
    external_id: identity.external_id,
    repository,
    app,
    head_sha: identity.head_sha,
    status: "completed",
    conclusion: "success",
    check_suite: checkSuite,
  };
  const page = normalizeCheckRunsResponse(
    { total_count: 1, check_runs: [checkRun], headers: { link: "" } },
    { identity },
  );
  return buildEvidenceReceipt({
    query,
    identity,
    pages: [page],
    observedAt: timestamp,
  });
}

function ownership() {
  const authority = (ref) => ({ status: "unknown", ref });
  const receipt = {
    schema_version: "product4-ownership-v1",
    receipt_type: "product4_ownership",
    status: "blocked_unknown",
    repository_id: 1315097793,
    ruleset_id: 19955787,
    context: "Product 4 Candidate Evidence",
    policy_sha256: PRODUCT4_POLICY_SHA256,
    app: {
      app_id: 4242,
      installation_id: 4343,
      slug: "synthetic-product4-app",
      checks_write: false,
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
      preimage_digest: "e".repeat(64),
    },
    approval: { approved: false, approval_digest: "f".repeat(64) },
    blockers: ["settings_admin_unknown"],
    observed_at: timestamp,
  };
  assertOwnershipReceipt(receipt);
  return receipt;
}

function rulesetReceipt() {
  return {
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
    blockers: ["ownership_unknown"],
    observed_at: timestamp,
  };
}

test("M4 creates a receipt-gated blocked ledger without canonical authority", () => {
  const candidateIntent = intent();
  const ledger = buildPromotionLedger({
    intent: candidateIntent,
    state: state(candidateIntent),
    attestation: attestation(candidateIntent),
    apiEvidence: apiEvidence(),
    ownershipReceipt: ownership(),
    rulesetReceipt: rulesetReceipt(),
    observedAt: timestamp,
  });
  assert.equal(ledger.promotion_status, "blocked");
  assert.equal(ledger.canonical_write, "none");
  assert.deepEqual(ledger.blockers, [
    "human_authority_required",
    "ownership_unknown",
    "ruleset_activation_not_verified",
  ]);
  assertPromotionLedger(ledger);
});

test("M4 appends ledger entries only in sequence and refuses authority-like content", () => {
  const candidateIntent = intent();
  const ledger = buildPromotionLedger({
    intent: candidateIntent,
    state: state(candidateIntent),
    attestation: attestation(candidateIntent),
    apiEvidence: apiEvidence(),
    ownershipReceipt: ownership(),
    rulesetReceipt: rulesetReceipt(),
    observedAt: timestamp,
  });
  const appended = appendPromotionEntry(ledger, {
    sequence: ledger.entries.length + 1,
    kind: "promotion_blocked",
    status: "blocked",
    actor: "reconciliation",
    evidence_digest: "9".repeat(64),
    observed_at: timestamp,
  });
  assert.equal(appended.entries.length, ledger.entries.length + 1);
  assert.throws(
    () => appendPromotionEntry(ledger, { ...appended.entries.at(-1), sequence: 1 }),
    /append-only/,
  );
  assert.throws(
    () => assertPromotionLedger({ ...appended, canonical_write: "Claim" }),
    /canonical_write/,
  );
});
