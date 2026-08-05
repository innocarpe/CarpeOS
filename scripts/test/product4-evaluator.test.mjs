import assert from "node:assert/strict";
import test from "node:test";

import {
  assertEvaluatorAttestation,
  attestationDigest,
  evaluateCandidateEvidence,
  PREDICATE_IDS,
} from "../product4/evaluator.mjs";
import {
  MAINTENANCE_STUDY_FIXTURE_SHA256,
  PRODUCT4_CONTEXT,
  PRODUCT4_POLICY_SHA256,
} from "../product4/policy-identity.mjs";
import { publishAttestation } from "../product4/publisher.mjs";

const headSha = "a".repeat(40);
const identity = {
  repository_id: 1315097793,
  head_sha: headSha,
  tree_sha256: "b".repeat(64),
  fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
  policy_sha256: PRODUCT4_POLICY_SHA256,
  context: PRODUCT4_CONTEXT,
  external_id: `carpeos-4.0.0:${headSha}:${MAINTENANCE_STUDY_FIXTURE_SHA256}`,
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
};
const provenance = {
  base_sha: "c".repeat(40),
  evaluator_workflow_sha: "d".repeat(40),
  evaluated_at: "2026-01-02T00:00:00Z",
};
const candidateReport = {
  schema_version: "product4-candidate-report-v1",
  report_type: "raw_candidate_report",
  observed: "synthetic",
};

function allPredicates() {
  return Object.fromEntries(PREDICATE_IDS.map((predicateId) => [predicateId, true]));
}

function evaluate(overrides = {}) {
  return evaluateCandidateEvidence({
    identity,
    candidateReport,
    trustedPredicates: allPredicates(),
    observations,
    provenance,
    issuerWorkflowSha: provenance.evaluator_workflow_sha,
    candidateReportedSuccess: true,
    ...overrides,
  });
}

test("M4 emits a strict attestation only after independent all-predicate recomputation", () => {
  const result = evaluate();
  assert.equal(result.status, "trusted");
  assert.equal(result.success, true);
  assert.equal(result.attestation.predicate_results.length, 16);
  assert.equal(result.attestation.observations.p02.outcome, "blocked_no_apply");
  assert.equal(result.attestation.observations.zero_write.outbox_rows, 0);
  assertEvaluatorAttestation(result.attestation);
  assert.equal(result.attestation_digest, attestationDigest(result.attestation));
});

test("M4 ignores candidate-reported success and refuses forged trusted observations", () => {
  const first = evaluate({ candidateReportedSuccess: false });
  const second = evaluate({ candidateReportedSuccess: true });
  assert.equal(first.status, "trusted");
  assert.equal(first.attestation_digest, second.attestation_digest);

  const forged = evaluate({
    observations: {
      ...observations,
      zero_write: { ...observations.zero_write, canonical_events: 1 },
    },
  });
  assert.equal(forged.status, "refused");
  assert.match(forged.blockers.join(";"), /zero_write\.canonical_events/);

  const missing = evaluate({
    trustedPredicates: { ...allPredicates(), negative_cases: undefined },
  });
  assert.equal(missing.status, "refused");
});

test("M4 refuses inactive policy, executable report fields, and malformed attestation", () => {
  const inactive = evaluate({ identity: { ...identity, policy_sha256: "e".repeat(64) } });
  assert.equal(inactive.status, "refused");
  assert.match(inactive.blockers.join(";"), /policy_not_active/);

  const executableReport = evaluate({
    candidateReport: { ...candidateReport, script: "never execute" },
  });
  assert.equal(executableReport.status, "refused");
  assert.match(executableReport.blockers.join(";"), /report_refusal/);

  const malformed = { ...evaluate().attestation, script: "never" };
  assert.throws(() => assertEvaluatorAttestation(malformed), /invalid_attestation/);
});

test("M4 publisher consumes the attestation as data and never runs candidate content", () => {
  const attestation = evaluate().attestation;
  let sinkCalls = 0;
  const seen = [];
  const published = publishAttestation({
    attestation,
    dataSink: (payload) => {
      sinkCalls += 1;
      seen.push(payload);
      return { check_id: 123, status: "accepted_as_data" };
    },
  });
  assert.equal(published.status, "published_data_only");
  assert.equal(sinkCalls, 1);
  assert.equal(seen[0].context, PRODUCT4_CONTEXT);
  assert.throws(
    () =>
      publishAttestation({
        attestation: { ...attestation, candidate_success: true },
        dataSink: () => null,
      }),
    /attestation_refusal/,
  );
});
