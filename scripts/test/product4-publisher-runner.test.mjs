import assert from "node:assert/strict";
import test from "node:test";

import { buildCandidateIntent } from "../product4/candidate-intent.mjs";
import { classifyCandidateState, createCandidateState } from "../product4/candidate-state.mjs";
import {
  evaluateCandidateEvidence,
  PREDICATE_IDS,
  sealTrustedEvidence,
} from "../product4/evaluator.mjs";
import {
  digestJson,
  MAINTENANCE_STUDY_FIXTURE_SHA256,
  PRODUCT4_CONTEXT,
  PRODUCT4_POLICY_SHA256,
} from "../product4/policy-identity.mjs";
import { publishEvaluatorResult } from "../product4/publisher-runner.mjs";

const headSha = "a".repeat(40);
const treeSha = "b".repeat(64);
const baseSha = "c".repeat(40);
const workflowSha = "d".repeat(40);
const evaluatedAt = "2026-01-02T00:00:00Z";

function evaluatorResult() {
  const identity = {
    repository_id: 1315097793,
    head_sha: headSha,
    tree_sha256: treeSha,
    fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
    policy_sha256: PRODUCT4_POLICY_SHA256,
    context: PRODUCT4_CONTEXT,
    external_id: `carpeos-4.0.0:${headSha}:${MAINTENANCE_STUDY_FIXTURE_SHA256}`,
  };
  const intent = buildCandidateIntent({
    head_sha: headSha,
    tree_sha256: treeSha,
    issuer_workflow_sha: workflowSha,
    classification: true,
  });
  const state = classifyCandidateState({
    state: createCandidateState({ intentEnvelope: intent, observedAt: evaluatedAt }),
    intentEnvelope: intent,
    observedAt: evaluatedAt,
  });
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
  const provenance = {
    base_sha: baseSha,
    evaluator_workflow_sha: workflowSha,
    evaluated_at: evaluatedAt,
  };
  const trustedEvidence = sealTrustedEvidence({
    trustedEvidence: {
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
    },
    identity,
    trustedPredicates,
    observations,
    candidateReport,
  });
  const result = evaluateCandidateEvidence({
    identity,
    candidateReport,
    trustedPredicates,
    observations,
    provenance,
    issuerWorkflowSha: workflowSha,
    trustedEvidence,
    candidateReportedSuccess: true,
    requireCandidateExecutionObservation: true,
  });
  return {
    schema_version: "product4-evaluator-result-v1",
    result_type: "base_owned_evaluation",
    status: result.status,
    success: result.success,
    repository_id: identity.repository_id,
    head_sha: identity.head_sha,
    tree_sha256: identity.tree_sha256,
    fixture_sha256: identity.fixture_sha256,
    policy_sha256: identity.policy_sha256,
    context: identity.context,
    intent,
    state,
    attestation: result.attestation,
    attestation_digest: result.attestation_digest,
    p02_receipt_digest: "e".repeat(64),
    predicate_digest: digestJson(trustedPredicates),
    blockers: [],
    evaluated_at: evaluatedAt,
  };
}

test("M4 publisher consumes only a trusted attestation and records no live write", () => {
  const result = publishEvaluatorResult({
    evaluatorResult: evaluatorResult(),
    publisherWorkflowSha: "1".repeat(40),
    expectedHeadSha: headSha,
    expectedRunId: 42,
    artifact: { name: "product4-attestation", run_id: 42 },
  });
  assert.equal(result.status, "blocked_no_live_authority");
  assert.equal(result.live_write, "not_attempted");
  assert.deepEqual(result.blockers, ["ownership_unknown", "activation_not_authorized"]);
});

test("M4 publisher keeps pure fixtures behind an explicit non-production mode", () => {
  const result = publishEvaluatorResult({
    evaluatorResult: evaluatorResult(),
    publisherWorkflowSha: "1".repeat(40),
    mode: "unit",
  });
  assert.equal(result.status, "blocked_no_live_authority");
  assert.equal(result.live_write, "not_attempted");
});

test("M4 publisher refuses candidate-authored success fields", () => {
  const forged = evaluatorResult();
  forged.attestation = { ...forged.attestation, candidate_success: true };
  assert.throws(
    () =>
      publishEvaluatorResult({
        evaluatorResult: forged,
        publisherWorkflowSha: "1".repeat(40),
        mode: "unit",
      }),
    /invalid_attestation|not allowed/,
  );
});

test("M4 publisher refuses production input without expected C", () => {
  assert.throws(
    () =>
      publishEvaluatorResult({
        evaluatorResult: evaluatorResult(),
        publisherWorkflowSha: "1".repeat(40),
        expectedRunId: 42,
        artifact: { name: "product4-attestation", run_id: 42 },
      }),
    /expected head is required/,
  );
});

test("M4 publisher refuses production input with mismatched C", () => {
  assert.throws(
    () =>
      publishEvaluatorResult({
        evaluatorResult: evaluatorResult(),
        publisherWorkflowSha: "1".repeat(40),
        expectedHeadSha: "9".repeat(40),
        expectedRunId: 42,
        artifact: { name: "product4-attestation", run_id: 42 },
      }),
    /not bound to triggering workflow C/,
  );
});

test("M4 publisher refuses missing artifact identity, name, and run binding", () => {
  assert.throws(
    () =>
      publishEvaluatorResult({
        evaluatorResult: evaluatorResult(),
        publisherWorkflowSha: "1".repeat(40),
        expectedHeadSha: headSha,
        expectedRunId: 42,
      }),
    /artifact identity is required/,
  );
  assert.throws(
    () =>
      publishEvaluatorResult({
        evaluatorResult: evaluatorResult(),
        publisherWorkflowSha: "1".repeat(40),
        expectedHeadSha: headSha,
        expectedRunId: 42,
        artifact: { run_id: 42 },
      }),
    /artifact name is required/,
  );
  assert.throws(
    () =>
      publishEvaluatorResult({
        evaluatorResult: evaluatorResult(),
        publisherWorkflowSha: "1".repeat(40),
        expectedHeadSha: headSha,
        expectedRunId: 42,
        artifact: { name: "product4-attestation" },
      }),
    /artifact run binding is required/,
  );
});
