import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCandidateState,
  classifyCandidateState,
  createCandidateState,
  promoteCandidateState,
} from "../product4/candidate-state.mjs";
import {
  MAINTENANCE_STUDY_FIXTURE_SHA256,
  PRODUCT4_CONTEXT,
  PRODUCT4_POLICY_SHA256,
} from "../product4/policy-identity.mjs";

const intentBase = {
  repository_id: 1315097793,
  head_sha: "a".repeat(40),
  tree_sha256: "b".repeat(64),
  fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
  intent_policy_sha256: PRODUCT4_POLICY_SHA256,
  context: PRODUCT4_CONTEXT,
  issuer_workflow_sha: "c".repeat(40),
  classification_digest: "d".repeat(64),
};

const evidenceTuple = {
  base_sha: "e".repeat(40),
  head_sha: intentBase.head_sha,
  tree_sha256: intentBase.tree_sha256,
  fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
  intent_policy_sha256: PRODUCT4_POLICY_SHA256,
  context: PRODUCT4_CONTEXT,
  check_name: "Product 4 Candidate Evidence",
  external_id: `carpeos-4.0.0:${intentBase.head_sha}:${MAINTENANCE_STUDY_FIXTURE_SHA256}`,
  attestation_sha256: "f".repeat(64),
};

const approval = {
  approved: true,
  actor_ref: "human_authority",
  approval_digest: "1".repeat(64),
};

function classifiedState(intent) {
  return classifyCandidateState({
    state: createCandidateState({ intentEnvelope: intentBase }),
    intentEnvelope: { ...intentBase, intent },
  });
}

test("M4 keeps candidate state write-once and distinguishes candidate from non-candidate", () => {
  const candidate = classifiedState(true);
  assert.equal(candidate.state, "pending_evidence");
  assert.equal(candidate.intent, true);
  assert.equal(candidate.transitions.length, 1);
  assertCandidateState(candidate);

  const nonCandidate = classifiedState(false);
  assert.equal(nonCandidate.state, "not_applicable");
  assert.equal(nonCandidate.intent, false);
  assertCandidateState(nonCandidate);

  assert.throws(
    () =>
      classifyCandidateState({
        state: candidate,
        intentEnvelope: { ...intentBase, intent: false },
      }),
    /state_conflict/,
  );
});

test("M4 keeps ambiguous intent pending and refuses identity or inactive-policy drift", () => {
  const pending = createCandidateState({ intentEnvelope: intentBase });
  assert.equal(pending.state, "classification_pending");
  assert.throws(
    () => classifyCandidateState({ state: pending, intentEnvelope: intentBase }),
    /classification_pending/,
  );

  const moved = { ...intentBase, head_sha: "2".repeat(40), intent: true };
  assert.throws(
    () => classifyCandidateState({ state: pending, intentEnvelope: moved }),
    /identity_conflict/,
  );

  assert.throws(
    () =>
      createCandidateState({
        intentEnvelope: { ...intentBase, intent_policy_sha256: "3".repeat(64) },
      }),
    /invalid_intent/,
  );
});

test("M4 requires explicit human approval for one immutable bc-preflip transition", () => {
  const candidate = classifiedState(true);
  assert.throws(
    () => promoteCandidateState({ state: candidate, evidenceTuple, approval: { approved: false } }),
    /approval_required/,
  );

  const promoted = promoteCandidateState({ state: candidate, evidenceTuple, approval });
  assert.equal(promoted.state, "bc-preflip");
  assert.equal(promoted.transitions.length, 2);
  assert.equal(promoted.transitions[1].actor, "human_authority");
  assert.deepEqual(promoted.evidence_tuple, evidenceTuple);
  assertCandidateState(promoted);

  assert.throws(
    () => promoteCandidateState({ state: promoted, evidenceTuple, approval }),
    /invalid_transition/,
  );
});

test("M4 rejects executable metadata and evidence tuple drift", () => {
  const candidate = classifiedState(true);
  const unsafeTuple = { ...evidenceTuple, script: "candidate payload" };
  assert.throws(
    () => promoteCandidateState({ state: candidate, evidenceTuple: unsafeTuple, approval }),
    /invalid_evidence|not allowed/,
  );

  const changedTuple = { ...evidenceTuple, head_sha: "4".repeat(40) };
  assert.throws(
    () => promoteCandidateState({ state: candidate, evidenceTuple: changedTuple, approval }),
    /mismatches C/,
  );
});
