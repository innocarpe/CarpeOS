import {
  digestJson,
  MAINTENANCE_STUDY_FIXTURE_SHA256,
  PRODUCT4_CONTEXT,
  PRODUCT4_POLICY_SHA256,
  PRODUCT4_REPOSITORY_ID,
} from "./policy-identity.mjs";

export const EVALUATOR_ATTESTATION_SCHEMA = "product4-evaluator-attestation-v1";
export const PREDICATE_IDS = Object.freeze([
  "identity_bound",
  "fixture_bound",
  "policy_pinned",
  "context_pinned",
  "migration_read_oracle",
  "six_command_loop",
  "p02_truthful_no_analog",
  "zero_write",
  "state_order",
  "no_privileged_candidate_execution",
  "strict_attestation",
  "exact_c_api",
  "duplicate_refusal",
  "lost_response_reconciliation",
  "provenance_bound",
  "negative_cases",
]);

const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const FORBIDDEN_KEY =
  /token|secret|credential|private_path|protected_plaintext|script|module|url|executable|shell|candidate_success/i;
const ATTESTATION_KEYS = [
  "schema_version",
  "attestation_type",
  "repository_id",
  "head_sha",
  "tree_sha256",
  "fixture_sha256",
  "policy_sha256",
  "context",
  "external_id",
  "issuer_workflow_sha",
  "predicate_results",
  "observations",
  "provenance",
];
const PREDICATE_RESULT_KEYS = ["predicate_id", "passed", "evidence_digest"];
const OBSERVATION_KEYS = ["p02", "zero_write", "high_water", "candidate_execution"];
const REQUIRED_OBSERVATION_KEYS = ["p02", "zero_write", "high_water"];
const P02_OBSERVATION_KEYS = ["diagnosis", "outcome", "analog_available", "state_transition"];
const MUTATION_KEYS = [
  "canonical_events",
  "review_rows",
  "disposition_rows",
  "outbox_rows",
  "protected_uploads",
];
const CANDIDATE_EXECUTION_KEYS = ["unprivileged", "isolated"];
const PROVENANCE_KEYS = [
  "source_report_sha256",
  "base_sha",
  "evaluator_workflow_sha",
  "evaluated_at",
];

export class EvaluatorError extends Error {
  constructor(code, message, blockers = []) {
    super(`${code}: ${message}`);
    this.name = "EvaluatorError";
    this.code = code;
    this.blockers = blockers;
  }
}

export function evaluateCandidateEvidence({
  identity,
  candidateReport,
  trustedPredicates,
  observations,
  provenance,
  issuerWorkflowSha,
  candidateReportedSuccess,
  requireCandidateExecutionObservation = false,
}) {
  const blockers = [];
  try {
    assertIdentity(identity);
    assertTrustedPredicates(trustedPredicates);
    assertObservations(observations, undefined, { requireCandidateExecutionObservation });
    assertProvenance(provenance, issuerWorkflowSha);
    assertSafeReport(candidateReport);
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : "trusted evidence is invalid");
  }
  void candidateReportedSuccess;
  if (blockers.length > 0) return refusal("invalid_or_untrusted_evidence", blockers);

  const failedPredicates = PREDICATE_IDS.filter(
    (predicateId) => trustedPredicates[predicateId] !== true,
  );
  if (failedPredicates.length > 0) return refusal("predicate_refusal", failedPredicates);

  const unsigned = {
    schema_version: EVALUATOR_ATTESTATION_SCHEMA,
    attestation_type: "strict_non_executable",
    repository_id: PRODUCT4_REPOSITORY_ID,
    head_sha: identity.head_sha,
    tree_sha256: identity.tree_sha256,
    fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
    policy_sha256: PRODUCT4_POLICY_SHA256,
    context: PRODUCT4_CONTEXT,
    external_id: identity.external_id,
    issuer_workflow_sha: issuerWorkflowSha,
    predicate_results: PREDICATE_IDS.map((predicate_id) => ({
      predicate_id,
      passed: true,
      evidence_digest: digestJson({ predicate_id, passed: true, observations }),
    })),
    observations: clone(observations),
    provenance: {
      source_report_sha256: digestJson(candidateReport),
      base_sha: provenance.base_sha,
      evaluator_workflow_sha: provenance.evaluator_workflow_sha,
      evaluated_at: provenance.evaluated_at,
    },
  };
  const attestation = assertEvaluatorAttestation(unsigned);
  return {
    status: "trusted",
    success: true,
    attestation,
    attestation_digest: digestJson(attestation),
  };
}

export function assertEvaluatorAttestation(attestation) {
  if (!isRecord(attestation))
    throwEvaluatorError("invalid_attestation", "attestation must be an object");
  const errors = [];
  assertExactKeys(attestation, ATTESTATION_KEYS, "attestation", errors);
  if (attestation.schema_version !== EVALUATOR_ATTESTATION_SCHEMA)
    errors.push("schema_version is invalid");
  if (attestation.attestation_type !== "strict_non_executable")
    errors.push("attestation_type is invalid");
  if (attestation.repository_id !== PRODUCT4_REPOSITORY_ID) errors.push("repository_id is invalid");
  if (!SHA1.test(attestation.head_sha ?? "")) errors.push("head_sha is invalid");
  if (!SHA256.test(attestation.tree_sha256 ?? "")) errors.push("tree_sha256 is invalid");
  if (attestation.fixture_sha256 !== MAINTENANCE_STUDY_FIXTURE_SHA256)
    errors.push("fixture is not frozen");
  if (attestation.policy_sha256 !== PRODUCT4_POLICY_SHA256) errors.push("policy is not P4_0");
  if (attestation.context !== PRODUCT4_CONTEXT) errors.push("context is not frozen");
  const externalPattern = new RegExp(
    `^carpeos-4\\.0\\.0:${attestation.head_sha}:${MAINTENANCE_STUDY_FIXTURE_SHA256}$`,
  );
  if (typeof attestation.external_id !== "string" || attestation.external_id.length > 200)
    errors.push("external_id is invalid");
  if (typeof attestation.external_id === "string" && !externalPattern.test(attestation.external_id))
    errors.push("external_id is not bound to C and fixture");
  if (!SHA1.test(attestation.issuer_workflow_sha ?? ""))
    errors.push("issuer_workflow_sha is invalid");
  assertPredicates(attestation.predicate_results, errors);
  assertObservations(attestation.observations, errors, {
    requireCandidateExecutionObservation: true,
  });
  assertPredicateEvidenceDigests(attestation.predicate_results, attestation.observations, errors);
  assertProvenance(attestation.provenance, attestation.provenance?.evaluator_workflow_sha, errors, {
    requireSourceReportSha256: true,
  });
  assertNoForbiddenKeys(attestation, errors);
  if (errors.length > 0) throwEvaluatorError("invalid_attestation", errors.join("; "));
  return attestation;
}

export function attestationDigest(attestation) {
  return digestJson(assertEvaluatorAttestation(attestation));
}

function assertIdentity(identity) {
  if (!isRecord(identity)) throwEvaluatorError("identity_refusal", "identity is required");
  if (identity.repository_id !== PRODUCT4_REPOSITORY_ID)
    throwEvaluatorError("identity_refusal", "repository id mismatch");
  if (!SHA1.test(identity.head_sha ?? ""))
    throwEvaluatorError("identity_refusal", "head C is invalid");
  if (!SHA256.test(identity.tree_sha256 ?? ""))
    throwEvaluatorError("identity_refusal", "tree digest is invalid");
  if (identity.fixture_sha256 !== MAINTENANCE_STUDY_FIXTURE_SHA256)
    throwEvaluatorError("fixture_refusal", "fixture mismatch");
  if (identity.policy_sha256 !== PRODUCT4_POLICY_SHA256)
    throwEvaluatorError("policy_not_active", "policy is not P4_0");
  if (identity.context !== PRODUCT4_CONTEXT)
    throwEvaluatorError("context_refusal", "context mismatch");
  const expected = `carpeos-4.0.0:${identity.head_sha}:${MAINTENANCE_STUDY_FIXTURE_SHA256}`;
  if (identity.external_id !== expected)
    throwEvaluatorError("identity_refusal", "external id is not C-bound");
}

function assertTrustedPredicates(predicates) {
  if (!isRecord(predicates))
    throwEvaluatorError("predicate_refusal", "base recomputation is required");
  const keys = Object.keys(predicates);
  if (keys.length !== PREDICATE_IDS.length || PREDICATE_IDS.some((id) => !keys.includes(id)))
    throwEvaluatorError("predicate_refusal", "fixed predicate conjunction is incomplete");
}

function assertPredicates(predicates, errors) {
  if (!Array.isArray(predicates) || predicates.length !== PREDICATE_IDS.length) {
    errors.push("predicate_results must contain exactly 16 predicates");
    return;
  }
  const seen = new Set();
  for (const [index, result] of predicates.entries()) {
    if (
      !isRecord(result) ||
      !PREDICATE_IDS.includes(result.predicate_id) ||
      seen.has(result.predicate_id)
    ) {
      errors.push("predicate_results contains an unknown or duplicate predicate");
      continue;
    }
    assertExactKeys(result, PREDICATE_RESULT_KEYS, `predicate_results[${index}]`, errors);
    seen.add(result.predicate_id);
    if (result.passed !== true || !SHA256.test(result.evidence_digest ?? ""))
      errors.push(`predicate ${result.predicate_id} is not a passed fixed result`);
  }
  if (seen.size !== PREDICATE_IDS.length)
    errors.push("predicate_results is missing a fixed predicate");
}
function assertPredicateEvidenceDigests(predicates, observations, errors) {
  if (!Array.isArray(predicates) || !isRecord(observations)) return;
  for (const result of predicates) {
    if (!isRecord(result) || !PREDICATE_IDS.includes(result.predicate_id)) continue;
    const expected = digestJson({
      predicate_id: result.predicate_id,
      passed: true,
      observations,
    });
    if (result.evidence_digest !== expected)
      errors.push(`predicate ${result.predicate_id} evidence is not bound to observations`);
  }
}

function assertObservations(
  observations,
  errors,
  { requireCandidateExecutionObservation = false } = {},
) {
  const collectedErrors = errors ?? [];
  const collecting = errors !== undefined;
  if (!isRecord(observations)) {
    collectedErrors.push("observations are required");
  } else {
    assertExactKeys(
      observations,
      OBSERVATION_KEYS,
      "observations",
      collectedErrors,
      REQUIRED_OBSERVATION_KEYS,
    );
    if (!isRecord(observations.p02)) collectedErrors.push("p02 observation is required");
    else {
      assertExactKeys(observations.p02, P02_OBSERVATION_KEYS, "observations.p02", collectedErrors);
      if (
        observations.p02.diagnosis !== "no_analog" ||
        observations.p02.outcome !== "blocked_no_apply" ||
        observations.p02.analog_available !== false ||
        observations.p02.state_transition !== "none_supported"
      ) {
        collectedErrors.push("P02 observation is not the truthful no-analog result");
      }
    }
    assertZeroWrite(observations.zero_write, collectedErrors);
    assertHighWater(observations.high_water, collectedErrors);
    if (observations.candidate_execution === undefined) {
      if (requireCandidateExecutionObservation)
        collectedErrors.push("candidate_execution observation is required");
    } else {
      assertCandidateExecution(observations.candidate_execution, collectedErrors);
    }
  }
  if (collectedErrors.length > 0 && !collecting)
    throwEvaluatorError("observation_refusal", collectedErrors.join("; "));
}

function assertZeroWrite(value, errors) {
  if (!isRecord(value)) {
    errors.push("zero_write observation is required");
    return;
  }
  assertExactKeys(value, MUTATION_KEYS, "zero_write", errors);
  for (const key of MUTATION_KEYS)
    if (value[key] !== 0) errors.push(`zero_write.${key} must be zero`);
}

function assertHighWater(value, errors) {
  if (!isRecord(value)) {
    errors.push("high_water observation is required");
    return;
  }
  assertExactKeys(value, MUTATION_KEYS, "high_water", errors);
  for (const key of MUTATION_KEYS)
    if (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 1_000_000)
      errors.push(`high_water.${key} is invalid`);
}

function assertProvenance(
  provenance,
  evaluatorWorkflowSha,
  errors,
  { requireSourceReportSha256 = false } = {},
) {
  const collectedErrors = errors ?? [];
  const collecting = errors !== undefined;
  if (!isRecord(provenance)) {
    collectedErrors.push("provenance is required");
  } else {
    const requiredKeys = requireSourceReportSha256
      ? PROVENANCE_KEYS
      : ["base_sha", "evaluator_workflow_sha", "evaluated_at"];
    assertExactKeys(provenance, PROVENANCE_KEYS, "provenance", collectedErrors, requiredKeys);
    if (
      provenance.source_report_sha256 !== undefined &&
      !SHA256.test(provenance.source_report_sha256)
    )
      collectedErrors.push("provenance.source_report_sha256 is invalid");
    if (!SHA1.test(provenance.base_sha ?? ""))
      collectedErrors.push("provenance.base_sha is invalid");
    if (!SHA1.test(provenance.evaluator_workflow_sha ?? ""))
      collectedErrors.push("provenance.evaluator_workflow_sha is invalid");
    if (!TIMESTAMP.test(provenance.evaluated_at ?? ""))
      collectedErrors.push("provenance.evaluated_at is invalid");
    if (
      evaluatorWorkflowSha !== undefined &&
      provenance.evaluator_workflow_sha !== evaluatorWorkflowSha
    )
      collectedErrors.push("provenance evaluator workflow mismatch");
  }
  if (collectedErrors.length > 0 && !collecting)
    throwEvaluatorError("provenance_refusal", collectedErrors.join("; "));
}

function assertCandidateExecution(value, errors) {
  if (!isRecord(value)) {
    errors.push("candidate_execution observation is required");
    return;
  }
  assertExactKeys(value, CANDIDATE_EXECUTION_KEYS, "candidate_execution", errors);
  if (value.unprivileged !== true) errors.push("candidate_execution.unprivileged must be true");
  if (value.isolated !== true) errors.push("candidate_execution.isolated must be true");
}

function assertSafeReport(report) {
  if (!isRecord(report)) throwEvaluatorError("report_refusal", "raw candidate report is required");
  const errors = [];
  assertNoForbiddenKeys(report, errors);
  if (errors.length > 0) throwEvaluatorError("report_refusal", errors.join("; "));
}

function assertExactKeys(value, allowed, label, errors, required = allowed) {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) errors.push(`${label}.${key} is not allowed`);
  for (const key of required)
    if (!Object.hasOwn(value, key)) errors.push(`${label}.${key} is required`);
}

function assertNoForbiddenKeys(value, errors, path = "$") {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertNoForbiddenKeys(item, errors, `${path}[${index}]`);
    }
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) errors.push(`${path}.${key} is not allowed`);
    assertNoForbiddenKeys(child, errors, `${path}.${key}`);
  }
}

function refusal(code, blockers) {
  return { status: "refused", success: false, code, blockers: [...blockers] };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function throwEvaluatorError(code, message, blockers = []) {
  throw new EvaluatorError(code, message, blockers);
}
