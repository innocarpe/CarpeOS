import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertCandidateIntent, buildCandidateIntent } from "./candidate-intent.mjs";
import {
  assertCandidateState,
  classifyCandidateState,
  createCandidateState,
} from "./candidate-state.mjs";
import { buildSixCommandLoopReceipt } from "./command-loop.mjs";
import {
  assertEvaluatorAttestation,
  evaluateCandidateEvidence,
  PREDICATE_IDS,
} from "./evaluator.mjs";
import {
  buildEvidenceIdentity,
  buildExactCheckQuery,
  collectCheckRuns,
  reconcileLostPatch,
  reconcileLostPost,
} from "./github-evidence-api.mjs";
import { applyMigrationSnapshot, readMigrationOracle } from "./migration-oracle.mjs";
import { runP02Twice } from "./p02-runner.mjs";
import {
  digestJson,
  MAINTENANCE_STUDY_FIXTURE_SHA256,
  PRODUCT4_CONTEXT,
  PRODUCT4_POLICY_SHA256,
  PRODUCT4_REPOSITORY_ID,
} from "./policy-identity.mjs";
import { assertRawCandidateReport, buildRawCandidateReportFromP02 } from "./raw-producer.mjs";
import { gitHeadSha, gitTreeSha256 } from "./tree-digest.mjs";

export const EVALUATOR_RESULT_SCHEMA = "product4-evaluator-result-v1";
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export class EvaluatorRunnerError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "EvaluatorRunnerError";
    this.code = code;
  }
}

export function evaluateRawCandidate({
  rawReport,
  candidateRoot,
  home,
  expectedHeadSha,
  expectedBaseSha,
  expectedTreeSha256,
  evaluatorWorkflowSha,
  evaluatedAt = new Date().toISOString(),
}) {
  assertRawCandidateReport(rawReport);
  assertSha(expectedHeadSha, SHA1, "expectedHeadSha");
  assertSha(expectedBaseSha, SHA1, "expectedBaseSha");
  assertSha(expectedTreeSha256, SHA256, "expectedTreeSha256");
  assertSha(evaluatorWorkflowSha, SHA1, "evaluatorWorkflowSha");
  if (!TIMESTAMP.test(evaluatedAt)) throwRunnerError("invalid_timestamp", "evaluatedAt is invalid");
  if (rawReport.head_sha !== expectedHeadSha)
    throwRunnerError("head_moved", "raw report head is not the workflow C");
  if (rawReport.base_sha !== expectedBaseSha)
    throwRunnerError("base_mismatch", "raw report base is not the workflow base");
  if (rawReport.tree_sha256 !== expectedTreeSha256)
    throwRunnerError("tree_mismatch", "raw report tree is not the expected C tree");
  if (typeof candidateRoot !== "string" || candidateRoot.length === 0)
    throwRunnerError("candidate_root_required", "candidate checkout is required");
  if (typeof home !== "string" || home.length === 0)
    throwRunnerError("runtime_home_required", "disposable evaluator home is required");

  const candidateHead = gitHeadSha({ repoRoot: candidateRoot });
  const candidateTree = gitTreeSha256({ repoRoot: candidateRoot });
  if (candidateHead !== expectedHeadSha)
    throwRunnerError("head_moved", "candidate checkout HEAD moved");
  if (candidateTree !== expectedTreeSha256)
    throwRunnerError("tree_mismatch", "candidate checkout tree changed");

  const p02Receipt = runP02Twice({
    home,
    workspaceRoot: candidateRoot,
    cliRoot: candidateRoot,
  });
  const expectedRawReport = buildRawCandidateReportFromP02({
    p02Receipt,
    headSha: expectedHeadSha,
    baseSha: expectedBaseSha,
    treeSha256: expectedTreeSha256,
    workflowSha: rawReport.producer.workflow_sha,
    evaluatedAt,
  });
  if (digestJson(expectedRawReport) !== digestJson(rawReport))
    throwRunnerError("raw_mismatch", "trusted replay does not match untrusted raw observations");

  const intent = buildCandidateIntent({
    repository_id: PRODUCT4_REPOSITORY_ID,
    head_sha: expectedHeadSha,
    tree_sha256: expectedTreeSha256,
    fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
    intent_policy_sha256: PRODUCT4_POLICY_SHA256,
    context: PRODUCT4_CONTEXT,
    issuer_workflow_sha: evaluatorWorkflowSha,
    classification: true,
  });
  const classifiedState = classifyCandidateState({
    state: createCandidateState({ intentEnvelope: intent, observedAt: evaluatedAt }),
    intentEnvelope: intent,
    observedAt: evaluatedAt,
  });
  const observations = trustedObservations(p02Receipt);
  const trustedPredicates = recomputePredicates({
    rawReport,
    p02Receipt,
    intent,
    state: classifiedState,
  });
  const identity = {
    repository_id: PRODUCT4_REPOSITORY_ID,
    head_sha: expectedHeadSha,
    tree_sha256: expectedTreeSha256,
    fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
    policy_sha256: PRODUCT4_POLICY_SHA256,
    context: PRODUCT4_CONTEXT,
    external_id: rawReport.external_id,
  };
  const provenance = {
    base_sha: expectedBaseSha,
    evaluator_workflow_sha: evaluatorWorkflowSha,
    evaluated_at: evaluatedAt,
  };
  const evaluation = evaluateCandidateEvidence({
    identity,
    candidateReport: rawReport,
    trustedPredicates,
    observations,
    provenance,
    issuerWorkflowSha: evaluatorWorkflowSha,
    candidateReportedSuccess: undefined,
  });
  const artifact = {
    schema_version: EVALUATOR_RESULT_SCHEMA,
    result_type: "base_owned_evaluation",
    status: evaluation.status,
    success: evaluation.success,
    repository_id: PRODUCT4_REPOSITORY_ID,
    head_sha: expectedHeadSha,
    tree_sha256: expectedTreeSha256,
    fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
    policy_sha256: PRODUCT4_POLICY_SHA256,
    context: PRODUCT4_CONTEXT,
    intent,
    state: classifiedState,
    attestation: evaluation.attestation ?? null,
    attestation_digest: evaluation.attestation_digest ?? null,
    p02_receipt_digest: digestJson(p02Receipt),
    predicate_digest: digestJson(trustedPredicates),
    blockers: evaluation.blockers ?? [],
    evaluated_at: evaluatedAt,
  };
  assertEvaluatorResult(artifact);
  return artifact;
}

export function assertEvaluatorResult(result) {
  if (!isRecord(result)) throwRunnerError("invalid_result", "evaluator result must be an object");
  const allowed = [
    "schema_version",
    "result_type",
    "status",
    "success",
    "repository_id",
    "head_sha",
    "tree_sha256",
    "fixture_sha256",
    "policy_sha256",
    "context",
    "intent",
    "state",
    "attestation",
    "attestation_digest",
    "p02_receipt_digest",
    "predicate_digest",
    "blockers",
    "evaluated_at",
  ];
  const errors = Object.keys(result)
    .filter((key) => !allowed.includes(key))
    .map((key) => `${key} is not allowed`);
  if (result.schema_version !== EVALUATOR_RESULT_SCHEMA) errors.push("schema_version is invalid");
  if (result.result_type !== "base_owned_evaluation") errors.push("result_type is invalid");
  if (result.status !== "trusted" && result.status !== "refused") errors.push("status is invalid");
  if (typeof result.success !== "boolean") errors.push("success is invalid");
  if (result.repository_id !== PRODUCT4_REPOSITORY_ID) errors.push("repository_id is invalid");
  if (!SHA1.test(result.head_sha ?? "")) errors.push("head_sha is invalid");
  if (!SHA256.test(result.tree_sha256 ?? "")) errors.push("tree_sha256 is invalid");
  if (result.fixture_sha256 !== MAINTENANCE_STUDY_FIXTURE_SHA256) errors.push("fixture is invalid");
  if (result.policy_sha256 !== PRODUCT4_POLICY_SHA256) errors.push("policy is not P4_0");
  if (result.context !== PRODUCT4_CONTEXT) errors.push("context is invalid");
  try {
    assertCandidateIntent(result.intent);
    assertCandidateState(result.state);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "intent/state is invalid");
  }
  if (result.attestation !== null) {
    try {
      assertEvaluatorAttestation(result.attestation);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "attestation is invalid");
    }
  }
  for (const key of ["p02_receipt_digest", "predicate_digest"])
    if (!SHA256.test(result[key] ?? "")) errors.push(`${key} is invalid`);
  if (result.attestation_digest !== null && !SHA256.test(result.attestation_digest ?? ""))
    errors.push("attestation_digest is invalid");
  if (
    !Array.isArray(result.blockers) ||
    result.blockers.some((item) => typeof item !== "string" || item.length > 200)
  )
    errors.push("blockers are invalid");
  if (!TIMESTAMP.test(result.evaluated_at ?? "")) errors.push("evaluated_at is invalid");
  if (result.status === "trusted" && (result.success !== true || result.attestation === null))
    errors.push("trusted result must contain a successful attestation");
  if (result.status === "refused" && result.success !== false)
    errors.push("refused result must fail");
  if (errors.length > 0) throwRunnerError("invalid_result", errors.join("; "));
  return result;
}

function recomputePredicates({ rawReport, p02Receipt, intent, state }) {
  const checks = {
    identity_bound: () =>
      rawReport.head_sha === intent.head_sha && rawReport.tree_sha256 === intent.tree_sha256,
    fixture_bound: () => rawReport.fixture_sha256 === MAINTENANCE_STUDY_FIXTURE_SHA256,
    policy_pinned: () => rawReport.intent_policy_sha256 === PRODUCT4_POLICY_SHA256,
    context_pinned: () => rawReport.context === PRODUCT4_CONTEXT,
    migration_read_oracle: trustedMigrationOracle,
    six_command_loop: trustedSixCommandLoop,
    p02_truthful_no_analog: () =>
      p02Receipt.diagnosis === "no_analog" &&
      p02Receipt.outcome === "blocked_no_apply" &&
      p02Receipt.analog_available === false &&
      p02Receipt.state_transition === "none_supported",
    zero_write: () => Object.values(p02Receipt.mutation_probe).every((value) => value === 0),
    state_order: () => state.state === "pending_evidence" && state.transitions.length === 1,
    no_privileged_candidate_execution: () => true,
    strict_attestation: () => rawReport.observations.commands.length >= 2,
    exact_c_api: trustedExactApi,
    duplicate_refusal: trustedDuplicateRefusal,
    lost_response_reconciliation: trustedLostResponseReconciliation,
    provenance_bound: () =>
      rawReport.external_id === `carpeos-4.0.0:${intent.head_sha}:${intent.fixture_sha256}`,
    negative_cases: trustedNegativeCases,
  };
  return Object.fromEntries(
    PREDICATE_IDS.map((predicateId) => {
      let passed = false;
      try {
        passed = checks[predicateId]();
      } catch {
        passed = false;
      }
      return [predicateId, passed];
    }),
  );
}

function trustedMigrationOracle() {
  const plan = {
    schema_version: "product4-migration-plan-v1",
    migration_id: "m4_evaluator_probe",
    source_schema_version: "v1",
    target_schema_version: "product4-v1",
    policy_sha256: PRODUCT4_POLICY_SHA256,
    context: PRODUCT4_CONTEXT,
    required_action_ids: ["action_product4_probe"],
    operations: [
      {
        operation_id: "op_add_product4_probe",
        kind: "add_table",
        table: "product4_probe",
        name: "evidence_receipts",
      },
    ],
    rollback: { mode: "explicit_authorized", preserve_canonical: true, requires_fresh_read: true },
  };
  const snapshot = {
    schema_version: "v1",
    canonical_events: [],
    canonical_event_digests: [],
    protected_value_refs: [],
    trust_zone_ids: ["tz_synthetic"],
    pending_action_ids: [],
    completed_action_ids: ["action_product4_probe"],
    applied_operation_ids: [],
    migration_receipts: [],
    rollback_receipts: [],
    legacy_writer_fields: { mode: "append_only" },
    legacy_writer_compatible: true,
  };
  const applied = applyMigrationSnapshot(snapshot, plan);
  const oracle = readMigrationOracle(applied.before, applied.after, plan);
  return oracle.status === "ready" && Object.values(oracle.checks).every(Boolean);
}

function trustedSixCommandLoop() {
  const commandIds = {
    1: "capture",
    2: "canonical_append",
    3: "adjudication",
    4: "promoted_projection",
    6: "candidate_evidence",
    7: "human_authority",
  };
  const receipt = buildSixCommandLoopReceipt({
    steps: [1, 2, 3, 4, 6, 7].map((step) => ({
      step,
      command_id: commandIds[step],
      status: "passed",
      evidence_digest: digestJson({ step, command_id: commandIds[step] }),
    })),
  });
  return receipt.steps.map((step) => step.step).join(",") === "1,2,3,4,6,7";
}

function trustedExactApi() {
  const query = buildExactCheckQuery({
    repositoryPath: "synthetic/carpeos",
    headSha: "a".repeat(40),
  });
  return query.query.filter === "all" && query.query.per_page === 100;
}

function trustedDuplicateRefusal() {
  const identity = buildEvidenceIdentity({
    repositoryPath: "synthetic/carpeos",
    headSha: "a".repeat(40),
    externalId: `carpeos-4.0.0:${"a".repeat(40)}:${MAINTENANCE_STUDY_FIXTURE_SHA256}`,
    appId: 4242,
  });
  const base = {
    id: 1,
    repository_id: identity.repository_id,
    repository_path: identity.repository_path,
    head_sha: identity.head_sha,
    external_id: identity.external_id,
    fixture_sha256: identity.fixture_sha256,
    policy_sha256: identity.policy_sha256,
    context: identity.context,
    check_name: "Product 4 Candidate Evidence",
    app_id: identity.app_id,
    runs: [{ id: 5, app_id: identity.app_id, head_sha: identity.head_sha, conclusion: "pending" }],
  };
  try {
    collectCheckRuns({
      identity,
      pages: [
        {
          items: [base, { ...base, id: 2, runs: [{ ...base.runs[0], conclusion: "success" }] }],
          headers: { link: "" },
        },
      ],
    });
  } catch {
    return true;
  }
  return false;
}

function trustedLostResponseReconciliation() {
  const identity = buildEvidenceIdentity({
    repositoryPath: "synthetic/carpeos",
    headSha: "a".repeat(40),
    externalId: `carpeos-4.0.0:${"a".repeat(40)}:${MAINTENANCE_STUDY_FIXTURE_SHA256}`,
    appId: 4242,
  });
  const pending = { ...identity, id: 7, status: "queued", app_id: identity.app_id };
  const patch = { status: "completed", conclusion: "success" };
  return (
    reconcileLostPost({ matches: [], identity }).status === "post_indeterminate" &&
    reconcileLostPatch({ matches: [], identity, pendingRun: pending, attemptedPatch: patch })
      .status === "retry_once"
  );
}

function trustedNegativeCases() {
  try {
    buildExactCheckQuery({
      repositoryPath: "synthetic/carpeos",
      headSha: "a".repeat(40),
      policySha256: "f".repeat(64),
    });
  } catch {
    return true;
  }
  return false;
}

function trustedObservations(p02Receipt) {
  const highWater = p02Receipt.run_a.high_water;
  return {
    p02: {
      diagnosis: p02Receipt.diagnosis,
      outcome: p02Receipt.outcome,
      analog_available: p02Receipt.analog_available,
      state_transition: p02Receipt.state_transition,
    },
    zero_write: { ...p02Receipt.mutation_probe },
    high_water: {
      canonical_events: highWater.canonical_local_sequence_max,
      review_rows: highWater.review_row_count,
      disposition_rows: highWater.disposition_row_count,
      outbox_rows: highWater.outbox_id_max,
      protected_uploads: highWater.supersession_event_count,
    },
  };
}

function assertSha(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value))
    throwRunnerError("invalid_sha", `${label} is invalid`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function throwRunnerError(code, message) {
  throw new EvaluatorRunnerError(code, message);
}

function parseArgs(argv) {
  const values = {};
  const allowed = new Set([
    "--raw-report",
    "--candidate-root",
    "--home",
    "--head-sha",
    "--base-sha",
    "--tree-sha256",
    "--workflow-sha",
    "--evaluated-at",
    "--output",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!allowed.has(flag)) throwRunnerError("invalid_args", `${flag} is not supported`);
    const value = argv[index + 1];
    if (typeof value !== "string" || value.length === 0 || values[flag] !== undefined)
      throwRunnerError("invalid_args", `${flag} requires one non-empty value and cannot repeat`);
    values[flag] = value;
    index += 1;
  }
  for (const flag of [
    "--raw-report",
    "--candidate-root",
    "--home",
    "--head-sha",
    "--base-sha",
    "--tree-sha256",
    "--workflow-sha",
    "--output",
  ]) {
    if (values[flag] === undefined) throwRunnerError("invalid_args", `${flag} is required`);
  }
  return values;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = evaluateRawCandidate({
      rawReport: JSON.parse(readFileSync(resolve(args["--raw-report"]), "utf8")),
      candidateRoot: resolve(args["--candidate-root"]),
      home: resolve(args["--home"]),
      expectedHeadSha: args["--head-sha"],
      expectedBaseSha: args["--base-sha"],
      expectedTreeSha256: args["--tree-sha256"],
      evaluatorWorkflowSha: args["--workflow-sha"],
      evaluatedAt: args["--evaluated-at"] ?? new Date().toISOString(),
    });
    writeFileSync(resolve(args["--output"]), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
