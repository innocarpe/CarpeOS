import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, relative, resolve } from "node:path";
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
  buildEvidenceReceipt,
  buildExactCheckQuery,
  assertExactCheckQuery,
  collectCheckRuns,
  normalizeCheckRunsResponse,
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
const TRUSTED_EVALUATOR_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PRODUCT4_SCOPE_MARKERS = [
  "apps/carpeos-cli/",
  "packages/capture/",
  "packages/local-store/",
  "scripts/product4/",
];
const PRODUCT4_REQUIRED_SCOPE = [
  "apps/carpeos-cli/src/index.ts",
  "scripts/product4/policy-identity.mjs",
  "scripts/product4/p02-runner.mjs",
];
const CANDIDATE_CREDENTIAL_ENV = [
  "ACTIONS_RUNTIME_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "NODE_AUTH_TOKEN",
  "NPM_TOKEN",
  "NPM_CONFIG_TOKEN",
];

export class EvaluatorRunnerError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "EvaluatorRunnerError";
    this.code = code;
  }
}
export function classifyImmutableCandidateScope({ headSha, treeSha256, scopePaths }) {
  const validIdentity = SHA1.test(headSha ?? "") && SHA256.test(treeSha256 ?? "");
  const normalizedPaths = Array.isArray(scopePaths)
    ? [...new Set(scopePaths.filter((path) => typeof path === "string" && path.length > 0))].sort()
    : [];
  const scope = {
    head_sha: validIdentity ? headSha : "",
    tree_sha256: validIdentity ? treeSha256 : "",
    paths: normalizedPaths,
  };
  const scopeDigest = digestJson(scope);
  const hasRequiredScope = PRODUCT4_REQUIRED_SCOPE.every((path) => normalizedPaths.includes(path));
  const hasOnlyNonCandidateSurface =
    normalizedPaths.length > 0 && normalizedPaths.every((path) => !hasCandidateSurfacePath(path));
  const state =
    !validIdentity || normalizedPaths.length === 0
      ? "classification_pending"
      : hasRequiredScope
        ? "pending_evidence"
        : hasOnlyNonCandidateSurface
          ? "not_applicable"
          : "classification_pending";
  const classification = {
    source: "immutable_c_tree",
    scope_digest: scopeDigest,
    ...(state === "pending_evidence" ? { candidate: true } : {}),
    ...(state === "not_applicable" ? { candidate: false } : {}),
  };
  return {
    classification,
    scope_digest: scopeDigest,
    intent: state === "pending_evidence",
    state,
  };
}

export function immutableTreeScopePaths({ repoRoot }) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0)
    throwRunnerError("candidate_root_required", "candidate checkout is required");
  const result = spawnSync("git", ["ls-tree", "-r", "-z", "--name-only", "--full-tree", "HEAD"], {
    cwd: resolve(repoRoot),
    encoding: "buffer",
    env: { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
  });
  if (result.error) throwRunnerError("scope_read_failed", result.error.message);
  if (result.status !== 0)
    throwRunnerError(
      "scope_read_failed",
      result.stderr?.toString("utf8") || "git scope read failed",
    );
  return [
    ...new Set((result.stdout ?? Buffer.alloc(0)).toString("utf8").split("\0").filter(Boolean)),
  ].sort();
}

export function assertCandidateWorkspaceBoundary({
  candidateRoot,
  trustedRoot = TRUSTED_EVALUATOR_ROOT,
}) {
  if (typeof candidateRoot !== "string" || candidateRoot.length === 0)
    throwRunnerError("candidate_root_required", "candidate checkout is required");
  if (typeof trustedRoot !== "string" || trustedRoot.length === 0)
    throwRunnerError("trusted_root_required", "trusted evaluator root is required");
  let candidateReal;
  let trustedReal;
  try {
    candidateReal = realpathSync(resolve(candidateRoot));
    trustedReal = realpathSync(resolve(trustedRoot));
  } catch (error) {
    throwRunnerError(
      "candidate_workspace_boundary",
      `candidate and trusted roots must exist: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (pathWithin(trustedReal, candidateReal) || pathWithin(candidateReal, trustedReal))
    throwRunnerError(
      "candidate_workspace_boundary",
      "candidate workspace overlaps trusted evaluator",
    );
  return { candidate_root: candidateReal, trusted_root: trustedReal };
}

export function observeCandidateExecution({
  candidateRoot,
  trustedRoot = TRUSTED_EVALUATOR_ROOT,
  environment = process.env,
}) {
  let isolated = false;
  try {
    assertCandidateWorkspaceBoundary({ candidateRoot, trustedRoot });
    isolated = true;
  } catch {
    isolated = false;
  }
  const unprivileged = CANDIDATE_CREDENTIAL_ENV.every(
    (name) => typeof environment?.[name] !== "string" || environment[name].length === 0,
  );
  return { unprivileged, isolated };
}

export function writeEvaluatorResult(outputPath, result) {
  if (typeof outputPath !== "string" || outputPath.length === 0)
    throwRunnerError("output_required", "evaluator output is required");
  const resolvedOutput = resolve(outputPath);
  const parent = dirname(resolvedOutput);
  let realParent;
  try {
    realParent = realpathSync(parent);
  } catch (error) {
    throwRunnerError(
      "output_refusal",
      `evaluator output parent is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (realParent !== parent)
    throwRunnerError("output_refusal", "evaluator output parent must not be a symlink");
  if (pathWithin(TRUSTED_EVALUATOR_ROOT, realParent))
    throwRunnerError("output_refusal", "evaluator output cannot be inside trusted evaluator");
  assertEvaluatorResult(result);
  try {
    writeFileSync(resolvedOutput, `${JSON.stringify(result, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    throwRunnerError(
      "output_refusal",
      `evaluator output must be a new regular file: ${error instanceof Error ? error.message : String(error)}`,
    );
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

  assertCandidateWorkspaceBoundary({ candidateRoot });
  const candidateExecution = observeCandidateExecution({ candidateRoot });
  if (!candidateExecution.unprivileged || !candidateExecution.isolated)
    throwRunnerError(
      "candidate_execution_boundary",
      "candidate execution must be unprivileged and isolated",
    );

  const candidateHead = gitHeadSha({ repoRoot: candidateRoot });
  const candidateTree = gitTreeSha256({ repoRoot: candidateRoot });
  if (candidateHead !== expectedHeadSha)
    throwRunnerError("head_moved", "candidate checkout HEAD moved");
  if (candidateTree !== expectedTreeSha256)
    throwRunnerError("tree_mismatch", "candidate checkout tree changed");

  const scope = classifyImmutableCandidateScope({
    headSha: expectedHeadSha,
    treeSha256: expectedTreeSha256,
    scopePaths: immutableTreeScopePaths({ repoRoot: candidateRoot }),
  });
  const intent = buildCandidateIntent({
    repository_id: PRODUCT4_REPOSITORY_ID,
    head_sha: expectedHeadSha,
    tree_sha256: expectedTreeSha256,
    fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
    intent_policy_sha256: PRODUCT4_POLICY_SHA256,
    context: PRODUCT4_CONTEXT,
    issuer_workflow_sha: evaluatorWorkflowSha,
    classification: scope.classification,
    scope_digest: scope.scope_digest,
  });
  if (
    intent.intent !== scope.intent ||
    intent.state !== scope.state ||
    intent.scope_digest !== scope.scope_digest
  )
    throwRunnerError(
      "classification_binding",
      "classification is not bound to immutable C/tree scope",
    );
  if (intent.state !== "pending_evidence" || intent.intent !== true)
    throwRunnerError(
      "classification_refusal",
      `immutable C/tree classification is ${intent.state}; evaluation remains blocked`,
    );

  const classifiedState = classifyCandidateState({
    state: createCandidateState({ intentEnvelope: intent, observedAt: evaluatedAt }),
    intentEnvelope: intent,
    observedAt: evaluatedAt,
  });
  assertIntentStateBinding({
    intent,
    state: classifiedState,
    headSha: expectedHeadSha,
    treeSha256: expectedTreeSha256,
    scopeDigest: scope.scope_digest,
  });

  const p02Receipt = runP02Twice({
    home,
    workspaceRoot: candidateRoot,
    cliRoot: candidateRoot,
  });
  const candidateHeadAfter = gitHeadSha({ repoRoot: candidateRoot });
  const candidateTreeAfter = gitTreeSha256({ repoRoot: candidateRoot });
  if (candidateHeadAfter !== expectedHeadSha)
    throwRunnerError("head_moved", "candidate checkout HEAD changed during evaluation");
  if (candidateTreeAfter !== expectedTreeSha256)
    throwRunnerError("tree_mismatch", "candidate checkout tree changed during evaluation");
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

  const observations = trustedObservations(p02Receipt, candidateExecution);
  const trustedPredicates = recomputePredicates({
    rawReport,
    p02Receipt,
    intent,
    state: classifiedState,
    observations,
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
    requireCandidateExecutionObservation: true,
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
  let attestationValid = false;
  if (isRecord(result.intent)) {
    if (
      result.intent.repository_id !== result.repository_id ||
      result.intent.head_sha !== result.head_sha ||
      result.intent.tree_sha256 !== result.tree_sha256 ||
      result.intent.fixture_sha256 !== result.fixture_sha256 ||
      result.intent.intent_policy_sha256 !== result.policy_sha256 ||
      result.intent.context !== result.context
    )
      errors.push("intent is not bound to evaluator result identity");
  }
  if (isRecord(result.state) && isRecord(result.state.identity)) {
    if (
      result.state.identity.repository_id !== result.repository_id ||
      result.state.identity.head_sha !== result.head_sha ||
      result.state.identity.tree_sha256 !== result.tree_sha256 ||
      result.state.identity.fixture_sha256 !== result.fixture_sha256 ||
      result.state.identity.intent_policy_sha256 !== result.policy_sha256 ||
      result.state.identity.context !== result.context
    )
      errors.push("state is not bound to evaluator result identity");
  }
  if (result.attestation !== null) {
    try {
      assertEvaluatorAttestation(result.attestation);
      attestationValid = true;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "attestation is invalid");
    }
    if (
      result.attestation.head_sha !== result.head_sha ||
      result.attestation.tree_sha256 !== result.tree_sha256 ||
      result.attestation.fixture_sha256 !== result.fixture_sha256 ||
      result.attestation.policy_sha256 !== result.policy_sha256 ||
      result.attestation.context !== result.context
    )
      errors.push("attestation is not bound to evaluator result identity");
  }
  if (
    result.attestation !== null &&
    attestationValid &&
    result.attestation_digest !== null &&
    SHA256.test(result.attestation_digest ?? "") &&
    digestJson(result.attestation) !== result.attestation_digest
  )
    errors.push("attestation_digest does not match attestation");
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

function recomputePredicates({ rawReport, p02Receipt, intent, state, observations }) {
  const checks = {
    identity_bound: () =>
      rawReport.head_sha === intent.head_sha && rawReport.tree_sha256 === intent.tree_sha256,
    fixture_bound: () => rawReport.fixture_sha256 === MAINTENANCE_STUDY_FIXTURE_SHA256,
    policy_pinned: () => rawReport.intent_policy_sha256 === PRODUCT4_POLICY_SHA256,
    context_pinned: () => rawReport.context === PRODUCT4_CONTEXT,
    migration_read_oracle: trustedMigrationOracle,
    six_command_loop: trustedSixCommandLoop,
    p02_truthful_no_analog: () => trustedP02Receipt(p02Receipt),
    zero_write: () => trustedZeroWrite(p02Receipt),
    state_order: () => state.state === "pending_evidence" && state.transitions.length === 1,
    no_privileged_candidate_execution: () =>
      isRecord(observations?.candidate_execution) &&
      observations.candidate_execution.unprivileged === true &&
      observations.candidate_execution.isolated === true,
    strict_attestation: () => trustedStrictAttestation(rawReport),
    exact_c_api: () => trustedExactApi({ rawReport, intent }),
    duplicate_refusal: () => trustedDuplicateRefusal({ rawReport, intent }),
    lost_response_reconciliation: () => trustedLostResponseReconciliation({ rawReport, intent }),
    provenance_bound: () =>
      rawReport.external_id === `carpeos-4.0.0:${intent.head_sha}:${intent.fixture_sha256}`,
    negative_cases: () => trustedNegativeCases({ rawReport, intent }),
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

function assertIntentStateBinding({ intent, state, headSha, treeSha256, scopeDigest }) {
  if (
    intent.repository_id !== PRODUCT4_REPOSITORY_ID ||
    intent.head_sha !== headSha ||
    intent.tree_sha256 !== treeSha256 ||
    intent.fixture_sha256 !== MAINTENANCE_STUDY_FIXTURE_SHA256 ||
    intent.intent_policy_sha256 !== PRODUCT4_POLICY_SHA256 ||
    intent.context !== PRODUCT4_CONTEXT ||
    intent.scope_digest !== scopeDigest
  )
    throwRunnerError("classification_binding", "intent is not bound to exact C/tree identity");
  if (
    state.identity?.repository_id !== PRODUCT4_REPOSITORY_ID ||
    state.identity?.head_sha !== headSha ||
    state.identity?.tree_sha256 !== treeSha256 ||
    state.identity?.fixture_sha256 !== MAINTENANCE_STUDY_FIXTURE_SHA256 ||
    state.identity?.intent_policy_sha256 !== PRODUCT4_POLICY_SHA256 ||
    state.identity?.context !== PRODUCT4_CONTEXT ||
    state.state !== intent.state ||
    state.intent !== intent.intent
  )
    throwRunnerError("classification_binding", "state is not bound to exact candidate identity");
  if (
    state.transitions.length !== 1 ||
    state.transitions[0].evidence_digest !== intent.classification_digest
  )
    throwRunnerError("classification_binding", "state transition is not bound to classification");
}
function trustedP02Receipt(receipt) {
  if (!isRecord(receipt) || !isRecord(receipt.fixture_verification)) return false;
  const expectedFixture = receipt.fixture_verification.fixture_sha256;
  return (
    expectedFixture === MAINTENANCE_STUDY_FIXTURE_SHA256 &&
    receipt.diagnosis === "no_analog" &&
    receipt.outcome === "blocked_no_apply" &&
    receipt.analog_available === false &&
    receipt.state_transition === "none_supported" &&
    receipt.run_a?.plan_digest === receipt.run_b?.plan_digest &&
    receipt.run_a?.high_water !== undefined &&
    receipt.run_b?.high_water !== undefined
  );
}

function trustedZeroWrite(receipt) {
  if (!isRecord(receipt) || !isRecord(receipt.mutation_observation)) return false;
  if (!isRecord(receipt.mutation_probe)) return false;
  if (Object.values(receipt.mutation_probe).some((value) => value !== 0)) return false;
  const phases = ["before", "between", "after"].map((phase) => receipt.mutation_observation[phase]);
  if (phases.some((phase) => !isRecord(phase))) return false;
  const baselineDigest = digestJson(phases[0]);
  return phases.every((phase) => digestJson(phase) === baselineDigest);
}

function trustedStrictAttestation(rawReport) {
  const commands = rawReport?.observations?.commands;
  if (!Array.isArray(commands) || commands.length !== 2) return false;
  const ids = commands.map((command) => command?.command_id).sort();
  return ids[0] === "p02_replay_a" && ids[1] === "p02_replay_b";
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

function trustedExactApi({ rawReport, intent }) {
  const identity = trustedEvidenceIdentity({ rawReport, intent });
  const query = buildExactCheckQuery({
    repositoryPath: identity.repository_path,
    headSha: identity.head_sha,
  });
  const repository = {
    id: identity.repository_id,
    full_name: identity.repository_path,
  };
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
    id: 5,
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
  const receipt = buildEvidenceReceipt({
    query,
    identity,
    pages: [page],
    observedAt: "2026-01-02T00:00:00Z",
  });
  return (
    receipt.head_sha === rawReport.head_sha &&
    receipt.external_id === rawReport.external_id &&
    receipt.query_digest === digestJson(query)
  );
}

function trustedDuplicateRefusal({ rawReport, intent }) {
  const identity = trustedEvidenceIdentity({ rawReport, intent });
  const repository = {
    id: identity.repository_id,
    full_name: identity.repository_path,
  };
  const app = { id: identity.app_id };
  const checkSuite = {
    id: 1,
    repository,
    app,
    head_sha: identity.head_sha,
    status: "completed",
    conclusion: "success",
  };
  const run = {
    id: 5,
    name: identity.check_name,
    external_id: identity.external_id,
    repository,
    app,
    head_sha: identity.head_sha,
    status: "completed",
    conclusion: "success",
    check_suite: checkSuite,
  };
  const conflictingRun = { ...run, conclusion: "failure" };
  const page = normalizeCheckRunsResponse(
    { total_count: 2, check_runs: [run, conflictingRun], headers: { link: "" } },
    { identity },
  );
  try {
    collectCheckRuns({ identity, pages: [page] });
  } catch {
    return true;
  }
  return false;
}

function trustedLostResponseReconciliation({ rawReport, intent }) {
  const identity = trustedEvidenceIdentity({ rawReport, intent });
  const pending = {
    id: 7,
    repository_id: identity.repository_id,
    repository_path: identity.repository_path,
    head_sha: identity.head_sha,
    external_id: identity.external_id,
    fixture_sha256: identity.fixture_sha256,
    policy_sha256: identity.policy_sha256,
    context: identity.context,
    check_name: identity.check_name,
    app_id: identity.app_id,
    status: "queued",
    conclusion: null,
  };
  const patch = { status: "completed", conclusion: "success" };
  return (
    reconcileLostPost({ matches: [], identity }).status === "post_indeterminate" &&
    reconcileLostPatch({ matches: [], identity, pendingRun: pending, attemptedPatch: patch })
      .status === "retry_once"
  );
}

function trustedNegativeCases({ rawReport, intent }) {
  const identity = trustedEvidenceIdentity({ rawReport, intent });
  let policyRefused = false;
  try {
    buildExactCheckQuery({
      repositoryPath: identity.repository_path,
      headSha: identity.head_sha,
      policySha256: "f".repeat(64),
    });
  } catch {
    policyRefused = true;
  }
  const query = buildExactCheckQuery({
    repositoryPath: identity.repository_path,
    headSha: identity.head_sha,
  });
  const foreignHeadSha = "b".repeat(40);
  const foreignQuery = {
    ...query,
    path: `${identity.repository_path}/commits/${foreignHeadSha}/check-runs`,
    identity: { ...query.identity, head_sha: foreignHeadSha },
  };
  let identityRefused = false;
  try {
    assertExactCheckQuery(foreignQuery, query);
  } catch {
    identityRefused = true;
  }
  return policyRefused && identityRefused;
}

function trustedEvidenceIdentity({ rawReport, intent }) {
  if (
    !isRecord(rawReport) ||
    !isRecord(intent) ||
    rawReport.head_sha !== intent.head_sha ||
    rawReport.tree_sha256 !== intent.tree_sha256 ||
    rawReport.external_id !== `carpeos-4.0.0:${intent.head_sha}:${intent.fixture_sha256}`
  )
    throwRunnerError("evidence_identity", "raw report is not bound to immutable C identity");
  return buildEvidenceIdentity({
    repositoryPath: "synthetic/carpeos",
    headSha: intent.head_sha,
    externalId: rawReport.external_id,
    appId: 4242,
  });
}

function trustedObservations(p02Receipt, candidateExecution) {
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
    candidate_execution: {
      unprivileged: candidateExecution.unprivileged === true,
      isolated: candidateExecution.isolated === true,
    },
  };
}

function assertSha(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value))
    throwRunnerError("invalid_sha", `${label} is invalid`);
}

function hasCandidateSurfacePath(path) {
  return PRODUCT4_SCOPE_MARKERS.some((marker) => path.startsWith(marker));
}

function pathWithin(parent, child) {
  const childPath = relative(parent, child);
  return childPath === "" || (!childPath.startsWith("..") && !isAbsolute(childPath));
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
    writeEvaluatorResult(args["--output"], result);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
