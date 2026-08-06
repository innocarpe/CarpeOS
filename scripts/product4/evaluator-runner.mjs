import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertCandidateIntent,
  assertCandidateIntentWriteOnce,
  buildCandidateIntent,
} from "./candidate-intent.mjs";
import {
  assertCandidateState,
  classifyCandidateState,
  createCandidateState,
} from "./candidate-state.mjs";
import { assertSixCommandLoop } from "./command-loop.mjs";
import {
  assertEvaluatorAttestation,
  evaluateCandidateEvidence,
  PREDICATE_IDS,
  TRUSTED_EVIDENCE_SCHEMA,
  sealTrustedEvidence,
} from "./evaluator.mjs";
import {
  assertExactCheckQuery,
  buildEvidenceIdentity,
  buildEvidenceReceipt,
  buildExactCheckQuery,
  collectCheckRuns,
  reconcileLostPatch,
  reconcileLostPost,
} from "./github-evidence-api.mjs";
import { migrationPlanDigest, readMigrationOracle } from "./migration-oracle.mjs";
import { assertP02SandboxReceipt, readP02SandboxReceipt, runP02Twice } from "./p02-runner.mjs";
import {
  digestJson,
  MAINTENANCE_STUDY_FIXTURE_SHA256,
  PRODUCT4_CONTEXT,
  PRODUCT4_POLICY_SHA256,
  PRODUCT4_REPOSITORY_ID,
} from "./policy-identity.mjs";
import { assertRawCandidateReport, buildRawCandidateReportFromP02 } from "./raw-producer.mjs";
import { gitHeadSha, gitTreeSha256 } from "./tree-digest.mjs";

export {
  assertP02SandboxReceipt as assertSandboxReceipt,
  buildP02SandboxReceipt as buildSandboxReceipt,
  sandboxProbeDigest,
} from "./p02-runner.mjs";
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
const CANDIDATE_CREDENTIAL_ENV = [
  "ACTIONS_RUNTIME_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "NODE_AUTH_TOKEN",
  "NPM_TOKEN",
  "NPM_CONFIG_TOKEN",
  "CARPEOS_PRODUCT4_GITHUB_READ_TOKEN",
];
export const BASE_PROTOCOL_EVIDENCE_SCHEMA = "product4-base-owned-protocol-evidence-v1";
const BASE_PROTOCOL_EVIDENCE_BRAND = Symbol("product4.baseOwnedProtocolEvidence");
const PROTOCOL_PREDICATE_IDS = Object.freeze([
  "migration_read_oracle",
  "six_command_loop",
  "exact_c_api",
  "duplicate_refusal",
  "lost_response_reconciliation",
  "negative_cases",
]);

export class EvaluatorRunnerError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "EvaluatorRunnerError";
    this.code = code;
  }
}
export function classifyImmutableCandidateScope({ baseSha, headSha, treeSha256, scopePaths }) {
  const validIdentity =
    SHA1.test(baseSha ?? "") && SHA1.test(headSha ?? "") && SHA256.test(treeSha256 ?? "");
  const normalizedPaths = normalizeScopePaths(scopePaths);
  const scope = {
    base_sha: validIdentity ? baseSha : "",
    head_sha: validIdentity ? headSha : "",
    tree_sha256: validIdentity ? treeSha256 : "",
    paths: normalizedPaths,
  };
  const scopeDigest = digestJson(scope);
  const hasCandidateSurface = normalizedPaths.some((path) => hasCandidateSurfacePath(path));
  const hasOnlyNonCandidateSurface =
    normalizedPaths.length > 0 && normalizedPaths.every((path) => !hasCandidateSurfacePath(path));
  const hasInvalidPath =
    !Array.isArray(scopePaths) ||
    scopePaths.some((path) => typeof path !== "string" || normalizeScopePath(path) === null);
  const state =
    !validIdentity || hasInvalidPath || normalizedPaths.length === 0
      ? "classification_pending"
      : hasOnlyNonCandidateSurface
        ? "not_applicable"
        : hasCandidateSurface
          ? "pending_evidence"
          : "classification_pending";
  const classification = {
    source: "immutable_base_to_c",
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

export function immutableTreeScopePaths({ repoRoot, baseSha, headSha = "HEAD" }) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0)
    throwRunnerError("candidate_root_required", "candidate checkout is required");
  assertSha(baseSha, SHA1, "baseSha");
  if (headSha !== "HEAD") assertSha(headSha, SHA1, "headSha");
  const result = spawnSync(
    "git",
    [
      "diff",
      "--name-only",
      "--no-renames",
      "--no-ext-diff",
      "--no-textconv",
      "-z",
      baseSha,
      headSha,
    ],
    {
      cwd: resolve(repoRoot),
      encoding: "buffer",
      env: { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    },
  );
  if (result.error) throwRunnerError("scope_read_failed", result.error.message);
  if (result.status !== 0)
    throwRunnerError(
      "scope_read_failed",
      result.stderr?.toString("utf8") || "git base-to-C scope read failed",
    );
  const paths = (result.stdout ?? Buffer.alloc(0)).toString("utf8").split("\0").filter(Boolean);
  if (paths.some((path) => normalizeScopePath(path) === null))
    throwRunnerError("scope_read_failed", "git returned an invalid changed path");
  return normalizeScopePaths(paths);
}

export const immutableChangedScopePaths = immutableTreeScopePaths;
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

function assertSandboxWorkspaceBoundary({ workspaceRoot, cliRoot }) {
  for (const [label, root] of [
    ["workspace", workspaceRoot],
    ["CLI", cliRoot],
  ]) {
    let realRoot;
    try {
      realRoot = realpathSync(resolve(root));
    } catch (error) {
      throwRunnerError(
        "candidate_workspace_boundary",
        `${label} sandbox root must exist: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (
      pathWithin(TRUSTED_EVALUATOR_ROOT, realRoot) ||
      pathWithin(realRoot, TRUSTED_EVALUATOR_ROOT)
    )
      throwRunnerError(
        "candidate_workspace_boundary",
        `${label} sandbox root overlaps trusted evaluator`,
      );
  }
}
export function observeCandidateExecution({
  candidateRoot,
  trustedRoot = TRUSTED_EVALUATOR_ROOT,
  environment = process.env,
  sandboxReceipt,
  expectedHeadSha,
  expectedBaseSha,
  expectedTreeSha256,
}) {
  assertCandidateWorkspaceBoundary({ candidateRoot, trustedRoot });
  assertP02SandboxReceipt(sandboxReceipt, { candidateRoot });
  assertSha(expectedHeadSha, SHA1, "expectedHeadSha");
  assertSha(expectedBaseSha, SHA1, "expectedBaseSha");
  assertSha(expectedTreeSha256, SHA256, "expectedTreeSha256");
  assertP02SandboxReceipt(sandboxReceipt, {
    candidateRoot,
    headSha: expectedHeadSha,
    baseSha: expectedBaseSha,
    treeSha256: expectedTreeSha256,
  });
  const unprivileged = CANDIDATE_CREDENTIAL_ENV.every(
    (name) => typeof environment?.[name] !== "string" || environment[name].length === 0,
  );
  return { unprivileged, isolated: true };
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
/**
 * @internal Construct only from trusted module receipts; raw candidate input never reaches here.
 */
export function buildBaseOwnedProtocolEvidence({
  headSha,
  treeSha256,
  migration,
  loop,
  exact_c_api,
  duplicate_refusal,
  lost_response_reconciliation,
  negative_cases,
}) {
  const identity = protocolIdentity({ headSha, treeSha256 });
  const observations = {
    migration_read_oracle: buildMigrationObservation(migration, identity),
    six_command_loop: buildLoopObservation(loop, identity),
    exact_c_api: buildExactApiObservation(exact_c_api, identity),
    duplicate_refusal: buildDuplicateObservation(duplicate_refusal, identity),
    lost_response_reconciliation: buildLostResponseObservation(
      lost_response_reconciliation,
      identity,
    ),
    negative_cases: buildNegativeObservation(negative_cases, identity),
  };
  const evidence = {
    schema_version: BASE_PROTOCOL_EVIDENCE_SCHEMA,
    identity,
    observations,
    evidence_digest: digestJson({
      schema_version: BASE_PROTOCOL_EVIDENCE_SCHEMA,
      identity,
      observations,
    }),
  };
  Object.defineProperty(evidence, BASE_PROTOCOL_EVIDENCE_BRAND, { value: true });
  deepFreeze(evidence);
  return assertBaseOwnedProtocolEvidence(evidence);
}

export function assertBaseOwnedProtocolEvidence(evidence, { headSha, treeSha256 } = {}) {
  if (!isRecord(evidence) || evidence[BASE_PROTOCOL_EVIDENCE_BRAND] !== true)
    throwRunnerError("protocol_evidence_forged", "protocol evidence is not evaluator-owned");
  assertExactObjectKeys(evidence, [
    "schema_version",
    "identity",
    "observations",
    "evidence_digest",
  ]);
  if (evidence.schema_version !== BASE_PROTOCOL_EVIDENCE_SCHEMA)
    throwRunnerError("protocol_evidence_forged", "protocol evidence schema is invalid");
  const identity = protocolIdentity({
    headSha: headSha ?? evidence.identity?.head_sha,
    treeSha256: treeSha256 ?? evidence.identity?.tree_sha256,
  });
  if (digestJson(evidence.identity) !== digestJson(identity))
    throwRunnerError(
      "protocol_evidence_forged",
      "protocol evidence identity is not immutable-bound",
    );
  assertExactObjectKeys(evidence.observations, PROTOCOL_PREDICATE_IDS);
  const preimages = new Set();
  for (const predicateId of PROTOCOL_PREDICATE_IDS) {
    const observation = evidence.observations[predicateId];
    assertProtocolObservation(observation, predicateId, identity, preimages);
  }
  const expectedEvidenceDigest = digestJson({
    schema_version: BASE_PROTOCOL_EVIDENCE_SCHEMA,
    identity,
    observations: evidence.observations,
  });
  if (evidence.evidence_digest !== expectedEvidenceDigest)
    throwRunnerError("protocol_evidence_forged", "protocol evidence digest is invalid");
  return evidence;
}

function protocolIdentity({ headSha, treeSha256 }) {
  assertSha(headSha, SHA1, "protocol headSha");
  assertSha(treeSha256, SHA256, "protocol treeSha256");
  return {
    repository_id: PRODUCT4_REPOSITORY_ID,
    head_sha: headSha,
    tree_sha256: treeSha256,
    fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
    policy_sha256: PRODUCT4_POLICY_SHA256,
    context: PRODUCT4_CONTEXT,
  };
}

function assertProtocolObservation(observation, predicateId, identity, preimages) {
  if (!isRecord(observation))
    throwRunnerError("protocol_evidence_forged", `${predicateId} observation is missing`);
  assertExactObjectKeys(observation, [
    "predicate_id",
    "evidence_source",
    "evidence_preimage",
    "evidence_digest",
  ]);
  if (observation.predicate_id !== predicateId)
    throwRunnerError("protocol_evidence_forged", `${predicateId} observation id is invalid`);
  if (
    typeof observation.evidence_source !== "string" ||
    observation.evidence_source.length === 0 ||
    observation.evidence_source.length > 200
  )
    throwRunnerError("protocol_evidence_forged", `${predicateId} evidence source is invalid`);
  if (!isRecord(observation.evidence_preimage))
    throwRunnerError("protocol_evidence_forged", `${predicateId} evidence preimage is missing`);
  if (digestJson(observation.evidence_preimage.identity ?? null) !== digestJson(identity))
    throwRunnerError("protocol_evidence_forged", `${predicateId} evidence preimage is not C-bound`);
  const preimageDigest = digestJson(observation.evidence_preimage);
  if (preimages.has(preimageDigest))
    throwRunnerError("protocol_evidence_forged", "protocol evidence preimages must be distinct");
  preimages.add(preimageDigest);
  const expectedDigest = digestJson({
    predicate_id: predicateId,
    identity,
    evidence_source: observation.evidence_source,
    evidence_preimage: observation.evidence_preimage,
  });
  if (observation.evidence_digest !== expectedDigest)
    throwRunnerError("protocol_evidence_forged", `${predicateId} evidence digest is invalid`);
}

function protocolObservation(predicateId, identity, source, preimage) {
  const evidencePreimage = { ...preimage, identity };
  const observation = {
    predicate_id: predicateId,
    evidence_source: source,
    evidence_preimage: evidencePreimage,
    evidence_digest: digestJson({
      predicate_id: predicateId,
      identity,
      evidence_source: source,
      evidence_preimage: evidencePreimage,
    }),
  };
  return observation;
}

function assertExactObjectKeys(value, keys) {
  if (!isRecord(value))
    throwRunnerError("protocol_evidence_forged", "protocol evidence object is required");
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throwRunnerError("protocol_evidence_forged", "protocol evidence fields are not exact");
}

function deepFreeze(value) {
  if (!isRecord(value) && !Array.isArray(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
function buildMigrationObservation(input, identity) {
  assertExactObjectKeys(input, ["before", "after", "plan", "receipt"]);
  assertExactObjectKeys(input.receipt, [
    "migration_id",
    "plan_digest",
    "applied_operation_ids",
    "applied_at",
  ]);
  let oracle;
  try {
    oracle = readMigrationOracle(input.before, input.after, input.plan);
  } catch (error) {
    throwRunnerError(
      "protocol_evidence_forged",
      `migration oracle is invalid: ${errorMessage(error)}`,
    );
  }
  const planDigest = migrationPlanDigest(input.plan);
  const expectedOperationIds = input.plan.operations.map((operation) => operation.operation_id);
  if (
    oracle.status !== "ready" ||
    Object.values(oracle.checks).some((passed) => passed !== true) ||
    input.receipt.migration_id !== input.plan.migration_id ||
    input.receipt.plan_digest !== planDigest ||
    digestJson(input.receipt.applied_operation_ids) !== digestJson(expectedOperationIds) ||
    !input.after.migration_receipts.some(
      (receipt) => digestJson(receipt) === digestJson(input.receipt),
    )
  )
    throwRunnerError("protocol_evidence_forged", "migration receipt/oracle is not C-bound");
  return protocolObservation(
    "migration_read_oracle",
    identity,
    "migration-oracle.readMigrationOracle",
    {
      plan_digest: planDigest,
      before_digest: digestJson(input.before),
      after_digest: digestJson(input.after),
      receipt_digest: digestJson(input.receipt),
      oracle_digest: digestJson(oracle),
    },
  );
}

function buildLoopObservation(input, identity) {
  assertExactObjectKeys(input, ["receipt"]);
  const receipt = input.receipt;
  assertExactObjectKeys(receipt, [
    "schema_version",
    "policy_sha256",
    "context",
    "steps",
    "template_5",
    "auto_authority",
    "receipt_digest",
  ]);
  try {
    assertSixCommandLoop(receipt);
  } catch (error) {
    throwRunnerError(
      "protocol_evidence_forged",
      `six-command loop is invalid: ${errorMessage(error)}`,
    );
  }
  if (!isRecord(receipt) || typeof receipt.receipt_digest !== "string")
    throwRunnerError("protocol_evidence_forged", "six-command loop receipt digest is required");
  const unsigned = { ...receipt };
  delete unsigned.receipt_digest;
  if (digestJson(unsigned) !== receipt.receipt_digest)
    throwRunnerError("protocol_evidence_forged", "six-command loop receipt digest is invalid");
  return protocolObservation("six_command_loop", identity, "command-loop.assertSixCommandLoop", {
    receipt_digest: receipt.receipt_digest,
    steps_digest: digestJson(receipt.steps),
  });
}

function buildExactApiObservation(input, identity) {
  assertExactObjectKeys(input, ["query", "pages", "identity", "observedAt"]);
  const apiIdentity = assertApiIdentity(input.identity, identity);
  let receipt;
  let runs;
  try {
    receipt = buildEvidenceReceipt({
      query: input.query,
      pages: input.pages,
      identity: apiIdentity,
      observedAt: input.observedAt,
    });
    runs = collectCheckRuns({ pages: input.pages, identity: apiIdentity });
  } catch (error) {
    throwRunnerError(
      "protocol_evidence_forged",
      `exact C API evidence is invalid: ${errorMessage(error)}`,
    );
  }
  if (runs.length === 0 || receipt.status !== "verified")
    throwRunnerError("protocol_evidence_forged", "exact C API evidence is not verified");
  return protocolObservation("exact_c_api", identity, "github-evidence.buildEvidenceReceipt", {
    receipt_digest: receipt.receipt_digest,
    query_digest: receipt.query_digest,
    identity_digest: receipt.identity_digest,
    page_digest: digestJson(input.pages),
    run_ids: runs.map((run) => run.id),
  });
}

function buildDuplicateObservation(input, identity) {
  assertExactObjectKeys(input, ["pages", "identity"]);
  const apiIdentity = assertApiIdentity(input.identity, identity);
  let code;
  try {
    collectCheckRuns({ pages: input.pages, identity: apiIdentity });
  } catch (error) {
    code = error?.code;
  }
  if (code !== "duplicate_refusal")
    throwRunnerError("protocol_evidence_forged", "duplicate API evidence did not refuse");
  return protocolObservation("duplicate_refusal", identity, "github-evidence.collectCheckRuns", {
    page_digest: digestJson(input.pages),
    identity_digest: digestJson(apiIdentity),
    refusal_code: code,
  });
}

function buildLostResponseObservation(input, identity) {
  assertExactObjectKeys(input, ["identity", "post", "patch"]);
  assertExactObjectKeys(input.post, ["matches"]);
  assertExactObjectKeys(input.patch, [
    "matches",
    "pendingRun",
    "attemptedPatch",
    "retryCount",
    "freshRun",
  ]);
  const apiIdentity = assertApiIdentity(input.identity, identity);
  let postResult;
  let patchResult;
  try {
    postResult = reconcileLostPost({ matches: input.post.matches, identity: apiIdentity });
    patchResult = reconcileLostPatch({
      matches: input.patch.matches,
      identity: apiIdentity,
      pendingRun: input.patch.pendingRun,
      attemptedPatch: input.patch.attemptedPatch,
      retryCount: input.patch.retryCount,
      freshRun: input.patch.freshRun,
    });
  } catch (error) {
    throwRunnerError(
      "protocol_evidence_forged",
      `lost-response reconciliation is invalid: ${errorMessage(error)}`,
    );
  }
  if (
    postResult.status !== "post_indeterminate" ||
    !["retry_once", "patch_reconciled"].includes(patchResult.status)
  )
    throwRunnerError("protocol_evidence_forged", "lost-response reconciliation is not fail-closed");
  return protocolObservation(
    "lost_response_reconciliation",
    identity,
    "github-evidence.reconcileLostPostAndPatch",
    {
      input_digest: digestJson(input),
      post_status: postResult.status,
      patch_status: patchResult.status,
    },
  );
}

function buildNegativeObservation(input, identity) {
  assertExactObjectKeys(input, ["identity", "invalidPolicySha256", "foreignHeadSha"]);
  const apiIdentity = assertApiIdentity(input.identity, identity);
  if (input.invalidPolicySha256 === PRODUCT4_POLICY_SHA256)
    throwRunnerError("protocol_evidence_forged", "negative policy input must be invalid");
  assertSha(input.invalidPolicySha256, SHA256, "negative policy sha");
  assertSha(input.foreignHeadSha, SHA1, "negative foreign head");
  if (input.foreignHeadSha === identity.head_sha)
    throwRunnerError("protocol_evidence_forged", "negative foreign head must differ from C");
  let policyRefusal = false;
  try {
    buildExactCheckQuery({
      repositoryPath: apiIdentity.repository_path,
      headSha: apiIdentity.head_sha,
      policySha256: input.invalidPolicySha256,
    });
  } catch (error) {
    policyRefusal = error?.code === "policy_not_active";
  }
  const validQuery = buildExactCheckQuery({
    repositoryPath: apiIdentity.repository_path,
    headSha: apiIdentity.head_sha,
  });
  const foreignQuery = {
    ...validQuery,
    path: `${apiIdentity.repository_path}/commits/${input.foreignHeadSha}/check-runs`,
    identity: { ...validQuery.identity, head_sha: input.foreignHeadSha },
  };
  let identityRefusal = false;
  try {
    assertExactCheckQuery(foreignQuery, validQuery);
  } catch (error) {
    identityRefusal = error?.code === "identity_conflict";
  }
  if (!policyRefusal || !identityRefusal)
    throwRunnerError("protocol_evidence_forged", "negative protocol checks did not refuse");
  return protocolObservation(
    "negative_cases",
    identity,
    "github-evidence.policy-and-identity-refusal",
    {
      policy_refusal_code: "policy_not_active",
      identity_refusal_code: "identity_conflict",
      valid_query_digest: digestJson(validQuery),
      invalid_policy_sha256: input.invalidPolicySha256,
      foreign_head_sha: input.foreignHeadSha,
    },
  );
}

function assertApiIdentity(input, identity) {
  assertExactObjectKeys(input, [
    "repository_id",
    "repository_path",
    "head_sha",
    "external_id",
    "fixture_sha256",
    "policy_sha256",
    "context",
    "check_name",
    "app_id",
  ]);
  let apiIdentity;
  try {
    apiIdentity = buildEvidenceIdentity({
      repositoryId: input.repository_id,
      repositoryPath: input.repository_path,
      headSha: input.head_sha,
      externalId: input.external_id,
      fixtureSha256: input.fixture_sha256,
      policySha256: input.policy_sha256,
      context: input.context,
      checkName: input.check_name,
      appId: input.app_id,
    });
  } catch (error) {
    throwRunnerError("protocol_evidence_forged", `API identity is invalid: ${errorMessage(error)}`);
  }
  if (
    apiIdentity.head_sha !== identity.head_sha ||
    apiIdentity.fixture_sha256 !== identity.fixture_sha256 ||
    apiIdentity.policy_sha256 !== identity.policy_sha256 ||
    apiIdentity.context !== identity.context ||
    apiIdentity.external_id !== `carpeos-4.0.0:${identity.head_sha}:${identity.fixture_sha256}`
  )
    throwRunnerError("protocol_evidence_forged", "API identity is not C-bound");
  return apiIdentity;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function evaluateRawCandidate(input) {
  if (!isRecord(input)) throwRunnerError("invalid_input", "evaluator input is required");
  rejectCallerEvidence(input, "public evaluator path");
  return evaluateRawCandidateFromBaseOwnedEvidence(input, undefined);
}

/**
 * @internal Trusted evaluator boundary. The provider is base-owned and must return
 * independently recomputed module receipts; candidate input never crosses this boundary.
 */
export function evaluateRawCandidateWithBaseOwnedProvider(
  input,
  { protocolProvider = defaultBaseOwnedProtocolProvider } = {},
) {
  if (!isRecord(input)) throwRunnerError("invalid_input", "evaluator input is required");
  rejectCallerEvidence(input, "base evaluator provider path");
  if (typeof protocolProvider !== "function")
    throwRunnerError("protocol_evidence_missing", "base-owned protocol provider is required");
  let protocolInputs;
  try {
    protocolInputs = protocolProvider({
      headSha: input.expectedHeadSha,
      treeSha256: input.expectedTreeSha256,
      baseSha: input.expectedBaseSha,
      repositoryId: PRODUCT4_REPOSITORY_ID,
      fixtureSha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
      policySha256: PRODUCT4_POLICY_SHA256,
      context: PRODUCT4_CONTEXT,
    });
  } catch (error) {
    if (error instanceof EvaluatorRunnerError) throw error;
    throwRunnerError(
      "protocol_evidence_missing",
      `base-owned protocol provider failed: ${errorMessage(error)}`,
    );
  }
  if (protocolInputs !== undefined && typeof protocolInputs?.then === "function")
    throwRunnerError("protocol_evidence_missing", "base-owned protocol provider must be synchronous");
  if (!isRecord(protocolInputs))
    throwRunnerError("protocol_evidence_missing", "base-owned protocol evidence is unavailable");
  let evidence;
  try {
    evidence = buildBaseOwnedProtocolEvidence({
      ...protocolInputs,
      headSha: input.expectedHeadSha,
      treeSha256: input.expectedTreeSha256,
    });
  } catch (error) {
    if (error instanceof EvaluatorRunnerError) throw error;
    throwRunnerError(
      "protocol_evidence_missing",
      `base-owned protocol evidence could not be produced: ${errorMessage(error)}`,
    );
  }
  return evaluateRawCandidateFromBaseOwnedEvidence(input, evidence);
}

/**
 * @internal Compatibility name retained for trusted tests. It no longer accepts
 * caller-supplied protocolInputs; use an injected provider callback instead.
 */
export function evaluateRawCandidateWithBaseOwnedProtocolInputs(input, options) {
  if (!isRecord(input) || Object.hasOwn(input, "protocolInputs"))
    throwRunnerError(
      Object.hasOwn(input ?? {}, "protocolInputs")
        ? "protocol_evidence_forged"
        : "protocol_evidence_missing",
      "caller-supplied protocol inputs are not accepted",
    );
  return evaluateRawCandidateWithBaseOwnedProvider(input, options);
}

function defaultBaseOwnedProtocolProvider() {
  const token = process.env.CARPEOS_PRODUCT4_GITHUB_READ_TOKEN;
  if (typeof token !== "string" || token.length === 0)
    throwRunnerError(
      "protocol_evidence_missing",
      "trusted read-only GitHub API token is unavailable",
    );
  throwRunnerError(
    "protocol_evidence_missing",
    "base-owned protocol provider has no independent protocol receipts",
  );
}

function rejectCallerEvidence(input, pathLabel) {
  for (const key of [
    "baseOwnedProtocolEvidence",
    "trustedProtocolEvidence",
    "protocolInputs",
    "trustedPredicates",
    "trustedEvidence",
    "protocolProvider",
    "baseOwnedProvider",
  ]) {
    if (Object.hasOwn(input, key) && input[key] !== undefined)
      throwRunnerError(
        key === "trustedPredicates" ? "predicate_refusal" : "protocol_evidence_forged",
        `${key} is not accepted on the ${pathLabel}`,
      );
  }
}

function evaluateRawCandidateFromBaseOwnedEvidence(
  {
    rawReport,
    candidateRoot,
    home,
    expectedHeadSha,
    expectedBaseSha,
    expectedTreeSha256,
    evaluatorWorkflowSha,
    sandboxReceipt,
    sandboxReceiptPath,
    existingIntent,
    trustedPredicates: callerTrustedPredicates,
    workspaceRoot = candidateRoot,
    cliRoot = candidateRoot,
    evaluatedAt = new Date().toISOString(),
  },
  protocolEvidence,
) {
  if (callerTrustedPredicates !== undefined)
    throwRunnerError("predicate_refusal", "caller-supplied trusted predicates are never accepted");
  assertRawCandidateReport(rawReport);
  assertNoCallerProtocolObservations(rawReport);
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
  if (protocolEvidence === undefined)
    throwRunnerError("protocol_evidence_missing", "base-owned protocol evidence is required");
  assertBaseOwnedProtocolEvidence(protocolEvidence, {
    headSha: expectedHeadSha,
    treeSha256: expectedTreeSha256,
  });
  if (typeof candidateRoot !== "string" || candidateRoot.length === 0)
    throwRunnerError("candidate_root_required", "candidate checkout is required");
  if (typeof home !== "string" || home.length === 0)
    throwRunnerError("runtime_home_required", "disposable evaluator home is required");
  if (typeof workspaceRoot !== "string" || workspaceRoot.length === 0)
    throwRunnerError("workspace_root_required", "sandbox workspace is required");
  if (typeof cliRoot !== "string" || cliRoot.length === 0)
    throwRunnerError("cli_root_required", "sandbox CLI root is required");

  assertCandidateWorkspaceBoundary({ candidateRoot });
  assertSandboxWorkspaceBoundary({ workspaceRoot, cliRoot });
  assertRuntimeHomeBoundary({ home, candidateRoot });
  if (sandboxReceipt !== undefined)
    throwRunnerError(
      "sandbox_receipt_forged",
      "sandbox receipt must be supplied as an external trusted receipt path",
    );
  if (typeof sandboxReceiptPath !== "string" || sandboxReceiptPath.length === 0)
    throwRunnerError("sandbox_receipt_missing", "external sandbox receipt path is required");
  const receipt = readTrustedSandboxReceipt({
    receiptPath: sandboxReceiptPath,
    candidateRoot,
    headSha: expectedHeadSha,
    baseSha: expectedBaseSha,
    treeSha256: expectedTreeSha256,
  });
  const candidateExecution = observeCandidateExecution({
    candidateRoot,
    sandboxReceipt: receipt,
    expectedHeadSha,
    expectedBaseSha,
    expectedTreeSha256,
  });
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
    baseSha: expectedBaseSha,
    headSha: expectedHeadSha,
    treeSha256: expectedTreeSha256,
    scopePaths: immutableTreeScopePaths({
      repoRoot: candidateRoot,
      baseSha: expectedBaseSha,
      headSha: expectedHeadSha,
    }),
  });
  const generatedIntent = buildCandidateIntent({
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
  const intent = writeCandidateIntentOnce({ home, intent: generatedIntent, existingIntent });
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
    workspaceRoot,
    cliRoot,
    candidateRoot,
    sandboxReceipt: receipt,
  });
  assertPersistedCandidateIntent({ home, intent });
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
    trustedProtocolEvidence: protocolEvidence,
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
  let evaluatorTreeSha256;
  try {
    evaluatorTreeSha256 = gitTreeSha256({
      repoRoot: TRUSTED_EVALUATOR_ROOT,
      commit: "HEAD",
    });
  } catch (error) {
    throwRunnerError(
      "evaluator_tree_unavailable",
      `trusted evaluator tree cannot be computed: ${errorMessage(error)}`,
    );
  }
  const trustedEvidence = {
    schema_version: TRUSTED_EVIDENCE_SCHEMA,
    owner: "base_evaluator",
    identity: { ...identity },
    predicate_digest: digestJson(trustedPredicates),
    observation_digest: digestJson(observations),
    source_report_digest: digestJson(rawReport),
    source: {
      kind: "base_recompute",
      evaluator_tree_sha256: evaluatorTreeSha256,
    },
  };
  const sealedTrustedEvidence = sealTrustedEvidence({
    trustedEvidence,
    identity,
    trustedPredicates,
    observations,
    candidateReport: rawReport,
  });
  const evaluation = evaluateCandidateEvidence({
    identity,
    candidateReport: rawReport,
    trustedPredicates,
    observations,
    provenance,
    issuerWorkflowSha: evaluatorWorkflowSha,
    candidateReportedSuccess: undefined,
    requireCandidateExecutionObservation: true,
    trustedEvidence: sealedTrustedEvidence,
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

function recomputePredicates({
  rawReport,
  p02Receipt,
  intent,
  state,
  observations,
  trustedProtocolEvidence,
}) {
  const distinctProtocolEvidence = new Set();
  const protocolPredicate = (predicateId) =>
    trustedProtocolObservation({
      intent,
      predicateId,
      distinctProtocolEvidence,
      trustedProtocolEvidence,
    });
  const checks = {
    identity_bound: () =>
      rawReport.head_sha === intent.head_sha &&
      rawReport.tree_sha256 === intent.tree_sha256 &&
      rawReport.external_id === `carpeos-4.0.0:${intent.head_sha}:${intent.fixture_sha256}`,
    fixture_bound: () => rawReport.fixture_sha256 === MAINTENANCE_STUDY_FIXTURE_SHA256,
    policy_pinned: () => rawReport.intent_policy_sha256 === PRODUCT4_POLICY_SHA256,
    context_pinned: () => rawReport.context === PRODUCT4_CONTEXT,
    migration_read_oracle: () => protocolPredicate("migration_read_oracle"),
    six_command_loop: () => protocolPredicate("six_command_loop"),
    p02_truthful_no_analog: () => trustedP02Receipt(p02Receipt),
    zero_write: () => trustedZeroWrite(p02Receipt),
    state_order: () => state.state === "pending_evidence" && state.transitions.length === 1,
    no_privileged_candidate_execution: () =>
      isRecord(observations?.candidate_execution) &&
      observations.candidate_execution.unprivileged === true &&
      observations.candidate_execution.isolated === true,
    strict_attestation: () => trustedStrictAttestation(rawReport),
    exact_c_api: () => protocolPredicate("exact_c_api"),
    duplicate_refusal: () => protocolPredicate("duplicate_refusal"),
    lost_response_reconciliation: () => protocolPredicate("lost_response_reconciliation"),
    provenance_bound: () =>
      rawReport.external_id === `carpeos-4.0.0:${intent.head_sha}:${intent.fixture_sha256}`,
    negative_cases: () => protocolPredicate("negative_cases"),
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

function trustedProtocolObservation({
  intent,
  predicateId,
  distinctProtocolEvidence,
  trustedProtocolEvidence,
}) {
  if (!trustedProtocolEvidence || !PROTOCOL_PREDICATE_IDS.includes(predicateId)) return false;
  const observation = trustedProtocolEvidence.observations?.[predicateId];
  if (!isRecord(observation) || observation.predicate_id !== predicateId) return false;
  const identity = protocolIdentity({
    headSha: intent.head_sha,
    treeSha256: intent.tree_sha256,
  });
  if (digestJson(trustedProtocolEvidence.identity ?? null) !== digestJson(identity)) return false;
  if (digestJson(observation.evidence_preimage?.identity ?? null) !== digestJson(identity))
    return false;
  const preimageDigest = digestJson(observation.evidence_preimage);
  if (distinctProtocolEvidence?.has(preimageDigest)) return false;
  const expectedDigest = digestJson({
    predicate_id: predicateId,
    identity,
    evidence_source: observation.evidence_source,
    evidence_preimage: observation.evidence_preimage,
  });
  if (observation.evidence_digest !== expectedDigest) return false;
  distinctProtocolEvidence?.add(preimageDigest);
  return true;
}

function assertNoCallerProtocolObservations(rawReport) {
  if (
    Object.hasOwn(rawReport, "protocol_observations") ||
    (isRecord(rawReport.observations) &&
      Object.hasOwn(rawReport.observations, "protocol_observations"))
  )
    throwRunnerError(
      "predicate_refusal",
      "caller-supplied protocol observations are never trusted",
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
  if (ids[0] !== "p02_replay_a" || ids[1] !== "p02_replay_b") return false;
  const evidence = commands.map((command) =>
    digestJson({
      invocation_digest: command?.invocation_digest,
      stdout_sha256: command?.stdout_sha256,
      stderr_sha256: command?.stderr_sha256,
    }),
  );
  return evidence[0] !== evidence[1];
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

function normalizeScopePath(path) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\0") ||
    path.includes("\\") ||
    path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  )
    return null;
  return path;
}

function normalizeScopePaths(paths) {
  if (!Array.isArray(paths)) return [];
  return [...new Set(paths.map((path) => normalizeScopePath(path)).filter(Boolean))].sort();
}

function assertRuntimeHomeBoundary({ home, candidateRoot, trustedRoot = TRUSTED_EVALUATOR_ROOT }) {
  const runtimeHome = resolve(home);
  mkdirSync(runtimeHome, { recursive: true });
  let homeReal;
  try {
    homeReal = realpathSync(runtimeHome);
  } catch (error) {
    throwRunnerError(
      "runtime_home_boundary",
      `runtime home must exist: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const candidateReal = realpathSync(resolve(candidateRoot));
  const trustedReal = realpathSync(resolve(trustedRoot));
  if (
    pathWithin(candidateReal, homeReal) ||
    pathWithin(homeReal, candidateReal) ||
    pathWithin(trustedReal, homeReal)
  )
    throwRunnerError(
      "runtime_home_boundary",
      "runtime home overlaps candidate or trusted evaluator",
    );
  return homeReal;
}

function readTrustedSandboxReceipt({ receiptPath, candidateRoot, headSha, baseSha, treeSha256 }) {
  if (typeof receiptPath !== "string" || receiptPath.length === 0)
    throwRunnerError("sandbox_receipt_missing", "sandbox receipt path is required");
  let receiptReal;
  try {
    const receiptInput = resolve(receiptPath);
    if (lstatSync(receiptInput).isSymbolicLink())
      throwRunnerError("sandbox_receipt_forged", "sandbox receipt cannot be a symlink");
    receiptReal = realpathSync(receiptInput);
    const receiptStat = statSync(receiptReal);
    if (!receiptStat.isFile() || (receiptStat.mode & 0o222) !== 0)
      throwRunnerError(
        "sandbox_receipt_forged",
        "sandbox receipt must be a read-only regular file",
      );
  } catch (error) {
    if (error instanceof EvaluatorRunnerError) throw error;
    throwRunnerError(
      "sandbox_receipt_missing",
      `sandbox receipt cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const candidateReal = realpathSync(resolve(candidateRoot));
  const trustedReal = realpathSync(TRUSTED_EVALUATOR_ROOT);
  if (pathWithin(candidateReal, receiptReal) || pathWithin(trustedReal, receiptReal))
    throwRunnerError("sandbox_receipt_forged", "sandbox receipt is not an external trusted input");
  return readP02SandboxReceipt(receiptReal, { candidateRoot, headSha, baseSha, treeSha256 });
}
function writeCandidateIntentOnce({ home, intent, existingIntent }) {
  const intentPath = resolve(home, "candidate-intent.json");
  mkdirSync(resolve(home), { recursive: true });
  if (existingIntent !== undefined) {
    assertCandidateIntentWriteOnce(existingIntent, intent);
  }
  let persisted;
  try {
    const intentStat = lstatSync(intentPath);
    if (!intentStat.isFile() || intentStat.isSymbolicLink())
      throwRunnerError("intent_refusal", "candidate intent path must be a regular file");
    persisted = JSON.parse(readFileSync(intentPath, "utf8"));
  } catch (error) {
    if (error instanceof EvaluatorRunnerError) throw error;
    if (error?.code !== "ENOENT")
      throwRunnerError(
        "intent_refusal",
        `candidate intent cannot be read: ${error instanceof Error ? error.message : String(error)}`,
      );
  }
  if (persisted !== undefined) {
    assertCandidateIntentWriteOnce(persisted, intent);
    return persisted;
  }
  try {
    writeFileSync(intentPath, `${JSON.stringify(intent, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (error?.code !== "EEXIST")
      throwRunnerError(
        "intent_refusal",
        `candidate intent write-once emission failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    const raced = JSON.parse(readFileSync(intentPath, "utf8"));
    assertCandidateIntentWriteOnce(raced, intent);
    return raced;
  }
  return intent;
}

function assertPersistedCandidateIntent({ home, intent }) {
  const intentPath = resolve(home, "candidate-intent.json");
  let persisted;
  try {
    const intentStat = lstatSync(intentPath);
    if (!intentStat.isFile() || intentStat.isSymbolicLink())
      throwRunnerError("intent_refusal", "candidate intent path must be a regular file");
    persisted = JSON.parse(readFileSync(intentPath, "utf8"));
  } catch (error) {
    if (error instanceof EvaluatorRunnerError) throw error;
    throwRunnerError(
      "intent_refusal",
      `candidate intent cannot be re-read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return assertCandidateIntentWriteOnce(persisted, intent);
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
    "--sandbox-receipt",
    "--workspace-root",
    "--cli-root",
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
    "--sandbox-receipt",
    "--output",
  ]) {
    if (values[flag] === undefined) throwRunnerError("invalid_args", `${flag} is required`);
  }
  return values;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = evaluateRawCandidateWithBaseOwnedProvider({
      rawReport: JSON.parse(readFileSync(resolve(args["--raw-report"]), "utf8")),
      candidateRoot: resolve(args["--candidate-root"]),
      sandboxReceiptPath: resolve(args["--sandbox-receipt"]),
      workspaceRoot:
        args["--workspace-root"] === undefined ? undefined : resolve(args["--workspace-root"]),
      cliRoot: args["--cli-root"] === undefined ? undefined : resolve(args["--cli-root"]),
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
