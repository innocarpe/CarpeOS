#!/usr/bin/env node
/**
 * Synthetic, public-safe Product 4 adversarial dogfood.
 *
 * Every scenario is expected to refuse an unsafe transition or preserve the frozen contract. The
 * runner never writes a canonical store, requests authority, or contacts an external service.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyReleaseGates } from "../verify-4.0-gates.mjs";
import { buildCandidateIntent } from "./candidate-intent.mjs";
import { buildSixCommandLoopReceipt, PRODUCT4_COMMAND_LOOP } from "./command-loop.mjs";
import { evaluateCandidateEvidence, PREDICATE_IDS } from "./evaluator.mjs";
import { evaluateRawCandidate } from "./evaluator-runner.mjs";
import {
  buildEvidenceIdentity,
  buildEvidenceReceipt,
  buildExactCheckQuery,
} from "./github-evidence-api.mjs";
import { assertP02Receipt, buildP02Receipt, P02_COMMAND_LINE } from "./p02-replay.mjs";
import {
  digestJson,
  MAINTENANCE_STUDY_FIXTURE_SHA256,
  PRODUCT4_CONTEXT,
  PRODUCT4_POLICY_SHA256,
} from "./policy-identity.mjs";
import { buildRawCandidateReportFromP02 } from "./raw-producer.mjs";
import { buildReleaseAuthorityReceipt, reconcileReleaseAuthority } from "./release-authority.mjs";
import { projectFixedContext, reconcileRulesetResponse } from "./ruleset-guard.mjs";

export const DOGFOOD_SCHEMA = "product4-dogfood-receipt-v1";
const RECEIPT_TYPE = "product4_adversarial_dogfood";
const SHA256 = /^[0-9a-f]{64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const RECEIPT_KEYS = [
  "schema_version",
  "receipt_type",
  "repository_id",
  "fixture_sha256",
  "policy_sha256",
  "context",
  "status",
  "canonical_write",
  "live_authority",
  "scenarios",
  "blockers",
  "observed_at",
  "receipt_digest",
];
const SCENARIO_KEYS = ["id", "milestone", "expected", "status", "evidence_digest"];
const FORBIDDEN_KEY =
  /token|secret|credential|private_path|protected_plaintext|executable|shell|script|module|url/i;
const timestamp = "2026-01-02T00:00:00Z";
const candidateSha = "a".repeat(40);
const baseSha = "b".repeat(40);
const treeSha = "c".repeat(64);
const workflowSha = "d".repeat(40);
const digest = "f".repeat(64);
const externalId = `carpeos-4.0.0:${candidateSha}:${MAINTENANCE_STUDY_FIXTURE_SHA256}`;

export class DogfoodError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "DogfoodError";
    this.code = code;
  }
}

export function runSyntheticDogfood({ observedAt = timestamp } = {}) {
  assertTimestamp(observedAt, "observedAt");
  const scenarios = [
    scenario("m1_migration_contract", "M1", "preserve", migrationContract),
    scenario("m2_loop_recovery_only", "M2", "preserve", loopContract),
    scenario("m3_sentinel_write", "M3", "refuse", sentinelWrite),
    scenario("m3_wrong_p02", "M3", "refuse", wrongP02),
    scenario("m4_forged_hash_consistent_report", "M4", "refuse", forgedReport),
    scenario("m4_inactive_policy", "M4", "refuse", inactivePolicy),
    scenario("m4_moved_head", "M4", "refuse", movedHead),
    scenario("m4_duplicate_api_results", "M4", "refuse", duplicateApiResults),
    scenario("m4_ruleset_response_loss", "M4", "refuse", responseLoss),
    scenario("m5_gate_deletion_bypass", "M5", "refuse", gateDeletionBypass),
    scenario("m5_missing_ownership", "M5", "refuse", missingOwnership),
  ];
  const blockers = scenarios
    .filter((item) => item.status !== "passed")
    .map((item) => `${item.id}_failed`);
  const unsigned = {
    schema_version: DOGFOOD_SCHEMA,
    receipt_type: RECEIPT_TYPE,
    repository_id: 1315097793,
    fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
    policy_sha256: PRODUCT4_POLICY_SHA256,
    context: PRODUCT4_CONTEXT,
    status: blockers.length === 0 ? "passed" : "blocked",
    canonical_write: "none",
    live_authority: "not_attempted",
    scenarios,
    blockers,
    observed_at: observedAt,
  };
  return assertDogfoodReceipt({ ...unsigned, receipt_digest: digestJson(unsigned) });
}

export function assertDogfoodReceipt(receipt) {
  if (!isRecord(receipt)) throwDogfoodError("invalid_receipt", "dogfood receipt is required");
  const errors = [];
  if (Object.keys(receipt).some((key) => !RECEIPT_KEYS.includes(key)))
    errors.push("receipt contains unsupported fields");
  if (receipt.schema_version !== DOGFOOD_SCHEMA) errors.push("schema_version is invalid");
  if (receipt.receipt_type !== RECEIPT_TYPE) errors.push("receipt_type is invalid");
  if (receipt.repository_id !== 1315097793) errors.push("repository_id is invalid");
  if (receipt.fixture_sha256 !== MAINTENANCE_STUDY_FIXTURE_SHA256)
    errors.push("fixture is not frozen");
  if (receipt.policy_sha256 !== PRODUCT4_POLICY_SHA256) errors.push("policy is not P4_0");
  if (receipt.context !== PRODUCT4_CONTEXT) errors.push("context is invalid");
  if (!new Set(["passed", "blocked"]).has(receipt.status)) errors.push("status is invalid");
  if (receipt.canonical_write !== "none") errors.push("canonical_write must remain none");
  if (receipt.live_authority !== "not_attempted")
    errors.push("live authority must not be attempted");
  if (
    !Array.isArray(receipt.scenarios) ||
    receipt.scenarios.length < 8 ||
    receipt.scenarios.length > 32
  )
    errors.push("scenarios are invalid");
  else {
    const seen = new Set();
    receipt.scenarios.forEach((item, index) => {
      try {
        assertScenario(item);
        if (seen.has(item.id)) throwDogfoodError("invalid_scenario", `duplicate scenario ${index}`);
        seen.add(item.id);
      } catch (error) {
        errors.push(errorMessage(error));
      }
    });
  }
  const blockersValid =
    Array.isArray(receipt.blockers) &&
    receipt.blockers.length <= 32 &&
    receipt.blockers.every(
      (item) => typeof item === "string" && item.length > 0 && item.length <= 200,
    );
  if (!blockersValid) errors.push("blockers are invalid");
  if (receipt.status === "passed" && blockersValid && receipt.blockers.length !== 0)
    errors.push("passed receipt cannot retain blockers");
  if (!TIMESTAMP.test(receipt.observed_at ?? "")) errors.push("observed_at is invalid");
  if (!SHA256.test(receipt.receipt_digest ?? "")) errors.push("receipt_digest is invalid");
  assertNoForbiddenFields(receipt, errors);
  if (errors.length === 0) {
    const unsigned = { ...receipt };
    delete unsigned.receipt_digest;
    if (digestJson(unsigned) !== receipt.receipt_digest)
      errors.push("receipt_digest does not match receipt");
  }
  if (errors.length > 0) throwDogfoodError("invalid_receipt", errors.join("; "));
  return receipt;
}

function scenario(id, milestone, expected, action) {
  try {
    const outcome = action();
    return {
      id,
      milestone,
      expected,
      status: "passed",
      evidence_digest: digestJson({ id, expected, outcome }),
    };
  } catch (error) {
    return {
      id,
      milestone,
      expected,
      status: "failed",
      evidence_digest: digestJson({
        id,
        expected,
        outcome: "unexpected_acceptance",
        code: errorCode(error),
      }),
    };
  }
}

function migrationContract() {
  const plan = {
    schema_version: "product4-migration-plan-v1",
    migration_id: "m4_synthetic_dogfood",
    source_schema_version: "v1",
    target_schema_version: "product4-v1",
    policy_sha256: PRODUCT4_POLICY_SHA256,
    context: PRODUCT4_CONTEXT,
    required_action_ids: ["action_product4"],
    operations: [
      { operation_id: "op_add_receipt", kind: "add_table", table: "receipts", name: "product4" },
    ],
    rollback: { mode: "explicit_authorized", preserve_canonical: true, requires_fresh_read: true },
  };
  if (typeof plan.migration_id !== "string" || plan.operations.length !== 1)
    throwDogfoodError("migration_refusal", "migration contract was not preserved");
  return { outcome: "preserve", digest: digestJson(plan) };
}

function loopContract() {
  const steps = PRODUCT4_COMMAND_LOOP.map(({ step, command_id }) => ({
    step,
    command_id,
    status: "passed",
    evidence_digest: `${step}`.repeat(64),
  }));
  const receipt = buildSixCommandLoopReceipt({ steps });
  if (receipt.template_5.can_write !== false || receipt.auto_authority !== false)
    throwDogfoodError("loop_authority", "recovery-only template changed authority boundary");
  return { outcome: "preserve", digest: receipt.receipt_digest };
}

function sentinelWrite() {
  const probe = {
    canonical_events: 1,
    review_rows: 0,
    disposition_rows: 0,
    outbox_rows: 0,
    protected_uploads: 0,
  };
  const run = p02Run();
  expectRefusal(
    () => buildP02Receipt({ runA: run, runB: structuredClone(run), mutationProbe: probe }),
    "non_zero_write",
  );
  return "refused";
}

function wrongP02() {
  const receipt = buildP02Receipt({ runA: p02Run(), runB: p02Run(), mutationProbe: zeroProbe() });
  receipt.outcome = "applied";
  expectRefusal(() => assertP02Receipt(receipt), "blocked_no_apply");
  return "refused";
}

function forgedReport() {
  const observations = baseObservations();
  observations.zero_write.canonical_events = 1;
  const result = evaluateCandidateEvidence({
    identity: baseEvaluatorIdentity(),
    candidateReport: { observed: "synthetic" },
    trustedPredicates: allPredicates(),
    observations,
    provenance: { base_sha: baseSha, evaluator_workflow_sha: workflowSha, evaluated_at: timestamp },
    issuerWorkflowSha: workflowSha,
    candidateReportedSuccess: true,
  });
  if (result.status !== "refused" || result.success !== false)
    throwDogfoodError(
      "forged_report_accepted",
      "base evaluator accepted a forged write observation",
    );
  return "refused";
}

function inactivePolicy() {
  expectRefusal(
    () =>
      buildCandidateIntent({
        head_sha: candidateSha,
        tree_sha256: treeSha,
        issuer_workflow_sha: workflowSha,
        intent_policy_sha256: "0".repeat(64),
        classification: true,
      }),
    "policy_not_active",
  );
  return "refused";
}

function movedHead() {
  const raw = buildRawCandidateReportFromP02({
    p02Receipt: buildP02Receipt({ runA: p02Run(), runB: p02Run(), mutationProbe: zeroProbe() }),
    headSha: candidateSha,
    baseSha,
    treeSha256: treeSha,
    workflowSha,
    evaluatedAt: timestamp,
  });
  expectRefusal(
    () =>
      evaluateRawCandidate({
        rawReport: raw,
        candidateRoot: "synthetic/candidate",
        home: "synthetic/home",
        expectedHeadSha: "1".repeat(40),
        expectedBaseSha: baseSha,
        expectedTreeSha256: treeSha,
        evaluatorWorkflowSha: workflowSha,
        evaluatedAt: timestamp,
      }),
    "head_moved",
  );
  return "refused";
}

function duplicateApiResults() {
  const identity = buildEvidenceIdentity({
    repositoryPath: "synthetic/carpeos",
    headSha: candidateSha,
    externalId,
    appId: 4242,
  });
  const query = buildExactCheckQuery({
    repositoryPath: identity.repository_path,
    headSha: candidateSha,
  });
  const suite = {
    id: 1,
    repository_id: identity.repository_id,
    repository_path: identity.repository_path,
    head_sha: candidateSha,
    external_id: externalId,
    fixture_sha256: identity.fixture_sha256,
    policy_sha256: identity.policy_sha256,
    context: identity.context,
    check_name: identity.check_name,
    app_id: 4242,
    runs: [
      { id: 2, app_id: 4242, head_sha: candidateSha, conclusion: "success" },
      { id: 2, app_id: 4242, head_sha: candidateSha, conclusion: "failure" },
    ],
  };
  expectRefusal(
    () =>
      buildEvidenceReceipt({
        query,
        identity,
        pages: [{ items: [suite], headers: { link: "" } }],
        observedAt: timestamp,
      }),
    "duplicate_refusal",
  );
  return "refused";
}

function responseLoss() {
  const projection = projectFixedContext({
    ruleset: {
      repository_id: 1315097793,
      ruleset_id: 19955787,
      name: "synthetic-ruleset",
      target: "branch",
      enforcement: "active",
      bypass_actors: [],
      conditions: {},
      rules: [],
      required_contexts: [],
    },
    ownershipReceipt: verifiedOwnership(),
    approval: { approved: true, approval_digest: digest, observed_at: timestamp },
  });
  const reconciled = reconcileRulesetResponse({ projection, response: { status: "lost" } });
  if (
    reconciled.response_loss !== "blocked_indeterminate" ||
    reconciled.rollback.status !== "blocked"
  )
    throwDogfoodError("response_loss_accepted", "lost response did not fail closed");
  return "blocked_indeterminate";
}

function gateDeletionBypass() {
  const result = reconcileReleaseAuthority({
    receipt: verifiedAuthority(),
    releaseGate: { deleted: true, actor: "candidate_release_actor" },
  });
  if (
    result.status !== "procedural_ready" ||
    result.bypass.gate_deleted_result !== "denied" ||
    result.bypass.tag_result !== "denied" ||
    result.bypass.credential_result !== "denied"
  )
    throwDogfoodError("release_bypass_accepted", "candidate bypass obtained release capability");
  return "denied";
}

function missingOwnership() {
  const result = verifyReleaseGates({
    authorityReceipt: blockedAuthority(),
    observedAt: timestamp,
  });
  if (result.status !== "blocked" || !result.blockers.includes("ownership_receipt_missing"))
    throwDogfoodError(
      "ownership_missing_not_blocked",
      "missing ownership did not block release evidence",
    );
  return "blocked";
}

function baseEvaluatorIdentity() {
  return {
    repository_id: 1315097793,
    head_sha: candidateSha,
    tree_sha256: treeSha,
    fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
    policy_sha256: PRODUCT4_POLICY_SHA256,
    context: PRODUCT4_CONTEXT,
    external_id: externalId,
  };
}

function baseObservations() {
  return {
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
}

function allPredicates() {
  return Object.fromEntries(PREDICATE_IDS.map((id) => [id, true]));
}

function p02Run() {
  return {
    fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
    command_bytes: P02_COMMAND_LINE,
    tool_version: "carpeos-cli-synthetic",
    environment_digest: "1".repeat(64),
    exit_code: 0,
    stdout_bytes: '{"schema":"synthetic","entries":[]}',
    stderr_bytes: "",
    plan_digest: `sha256:${"2".repeat(64)}`,
    rows: { total_candidate_count: 0, classified_count: 0 },
    high_water: {
      canonical_local_sequence_max: 1,
      disposition_row_count: 0,
      review_row_count: 0,
      outbox_id_max: 1,
      supersession_event_count: 0,
    },
    ids: [],
    provenance_digest: "3".repeat(64),
  };
}

function zeroProbe() {
  return {
    canonical_events: 0,
    review_rows: 0,
    disposition_rows: 0,
    outbox_rows: 0,
    protected_uploads: 0,
  };
}

function verifiedOwnership() {
  const ref = (value) => ({ status: "verified", ref: value });
  return {
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
      rotation_owner: ref("rotation_owner"),
      settings_admin: ref("settings_admin"),
      release_controller: ref("release_controller"),
      credential_owner: ref("credential_owner"),
      artifact_owner: ref("artifact_owner"),
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
}

function verifiedAuthority() {
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

function blockedAuthority() {
  const authority = verifiedAuthority();
  const unsigned = {
    ...authority,
    status: "blocked_unknown",
    app: { ...authority.app, status: "unknown", checks_write: false },
    ownership: { ...authority.ownership, status: "unknown" },
    controller: { ...authority.controller, status: "unknown", independent: false },
    tag_authority: { ...authority.tag_authority, status: "unknown", protected: false },
    credential_issuer: {
      ...authority.credential_issuer,
      status: "unknown",
      independent: false,
      issues_to_release_job: false,
    },
    settings: { ...authority.settings, status: "unknown" },
    bypass_rehearsal: {
      ...authority.bypass_rehearsal,
      status: "not_run",
      gate_deleted_result: "unknown",
      tag_result: "unknown",
      credential_result: "unknown",
    },
    rollback: { ...authority.rollback, status: "unknown" },
    approval: { ...authority.approval, approved: false },
    blockers: ["authority_unknown"],
  };
  delete unsigned.receipt_digest;
  return buildReleaseAuthorityReceipt(unsigned);
}

function assertScenario(value) {
  if (!isRecord(value) || Object.keys(value).some((key) => !SCENARIO_KEYS.includes(key)))
    throwDogfoodError("invalid_scenario", "scenario keys are invalid");
  if (!/^[a-z0-9_]{3,80}$/.test(value.id))
    throwDogfoodError("invalid_scenario", "scenario id is invalid");
  if (!/^M[1-5]$/.test(value.milestone))
    throwDogfoodError("invalid_scenario", "scenario milestone is invalid");
  if (!new Set(["preserve", "refuse"]).has(value.expected))
    throwDogfoodError("invalid_scenario", "scenario expected outcome is invalid");
  if (value.status !== "passed")
    throwDogfoodError("invalid_scenario", `scenario did not pass: ${value.id}`);
  if (!SHA256.test(value.evidence_digest ?? ""))
    throwDogfoodError("invalid_scenario", "scenario digest is invalid");
}

function expectRefusal(action, expectedCode) {
  try {
    action();
  } catch (error) {
    const code = errorCode(error);
    if (code === expectedCode || errorMessage(error).includes(expectedCode)) return code;
    throwDogfoodError("wrong_refusal", `expected ${expectedCode}, observed ${code}`);
  }
  throwDogfoodError("unsafe_acceptance", `expected ${expectedCode} refusal`);
}

function assertTimestamp(value, label) {
  if (!TIMESTAMP.test(value ?? "")) throwDogfoodError("invalid_timestamp", `${label} is invalid`);
}

function assertNoForbiddenFields(value, errors, path = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertNoForbiddenFields(item, errors, `${path}[${index}]`);
    });
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) errors.push(`${path}.${key} is not allowed`);
    assertNoForbiddenFields(child, errors, `${path}.${key}`);
  }
}

function errorCode(error) {
  return typeof error?.code === "string" ? error.code : "error";
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function throwDogfoodError(code, message) {
  throw new DogfoodError(code, message);
}

function parseArgs(argv) {
  const output = { output: undefined, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      output.help = true;
    } else if (arg === "--output" && argv[index + 1]) {
      output.output = argv[++index];
    } else {
      throwDogfoodError("usage", `unexpected argument ${arg}`);
    }
  }
  return output;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write("Usage: node scripts/product4/dogfood.mjs [--output FILE]\n");
    } else {
      const receipt = runSyntheticDogfood();
      const output = `${JSON.stringify(receipt, null, 2)}\n`;
      if (options.output) writeFileSync(resolve(options.output), output, "utf8");
      else process.stdout.write(output);
      process.exitCode = receipt.status === "passed" ? 0 : 2;
    }
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = 2;
  }
}
