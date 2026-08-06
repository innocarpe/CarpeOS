import assert from "node:assert/strict";
import test from "node:test";

import { buildCandidateIntent } from "../product4/candidate-intent.mjs";
import { classifyCandidateState, createCandidateState } from "../product4/candidate-state.mjs";
import { evaluateCandidateEvidence, PREDICATE_IDS } from "../product4/evaluator.mjs";
import {
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
  const result = evaluateCandidateEvidence({
    identity: {
      repository_id: 1315097793,
      head_sha: headSha,
      tree_sha256: treeSha,
      fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
      policy_sha256: PRODUCT4_POLICY_SHA256,
      context: PRODUCT4_CONTEXT,
      external_id: `carpeos-4.0.0:${headSha}:${MAINTENANCE_STUDY_FIXTURE_SHA256}`,
    },
    candidateReport: { observed: "synthetic" },
    trustedPredicates: Object.fromEntries(PREDICATE_IDS.map((id) => [id, true])),
    observations: {
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
      candidate_execution: {
        unprivileged: true,
        isolated: true,
      },
    },
    provenance: {
      base_sha: baseSha,
      evaluator_workflow_sha: workflowSha,
      evaluated_at: evaluatedAt,
    },
    issuerWorkflowSha: workflowSha,
  });
  return {
    schema_version: "product4-evaluator-result-v1",
    result_type: "base_owned_evaluation",
    status: result.status,
    success: result.success,
    repository_id: 1315097793,
    head_sha: headSha,
    tree_sha256: treeSha,
    fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
    policy_sha256: PRODUCT4_POLICY_SHA256,
    context: PRODUCT4_CONTEXT,
    intent,
    state,
    attestation: result.attestation,
    attestation_digest: result.attestation_digest,
    p02_receipt_digest: "e".repeat(64),
    predicate_digest: "f".repeat(64),
    blockers: [],
    evaluated_at: evaluatedAt,
  };
}

test("M4 publisher consumes only a trusted attestation and records no live write", () => {
  const result = publishEvaluatorResult({
    evaluatorResult: evaluatorResult(),
    publisherWorkflowSha: "1".repeat(40),
  });
  assert.equal(result.status, "blocked_no_live_authority");
  assert.equal(result.live_write, "not_attempted");
  assert.deepEqual(result.blockers, ["ownership_unknown", "activation_not_authorized"]);
});

test("M4 publisher refuses candidate-authored success fields", () => {
  const forged = evaluatorResult();
  forged.attestation = { ...forged.attestation, candidate_success: true };
  assert.throws(
    () => publishEvaluatorResult({ evaluatorResult: forged, publisherWorkflowSha: "1".repeat(40) }),
    /invalid_attestation|not allowed/,
  );
});
