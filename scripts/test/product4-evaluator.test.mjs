import assert from "node:assert/strict";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildCandidateIntent } from "../product4/candidate-intent.mjs";
import { buildSixCommandLoopReceipt, PRODUCT4_COMMAND_LOOP } from "../product4/command-loop.mjs";
import {
  assertEvaluatorAttestation,
  attestationDigest,
  evaluateCandidateEvidence,
  PREDICATE_IDS,
} from "../product4/evaluator.mjs";
import {
  assertBaseOwnedProtocolEvidence,
  assertCandidateWorkspaceBoundary,
  buildBaseOwnedProtocolEvidence,
  classifyImmutableCandidateScope,
  evaluateRawCandidate,
  evaluateRawCandidateWithBaseOwnedProtocolInputs,
  observeCandidateExecution,
  writeEvaluatorResult,
} from "../product4/evaluator-runner.mjs";
import {
  buildEvidenceIdentity,
  buildExactCheckQuery,
  normalizeCheckRunsResponse,
} from "../product4/github-evidence-api.mjs";
import { buildP02SandboxReceipt, sandboxProbeDigest } from "../product4/p02-runner.mjs";
import {
  digestJson,
  MAINTENANCE_STUDY_FIXTURE_SHA256,
  PRODUCT4_CONTEXT,
  PRODUCT4_POLICY_SHA256,
} from "../product4/policy-identity.mjs";
import { publishAttestation } from "../product4/publisher.mjs";
import { buildRawCandidateReport } from "../product4/raw-producer.mjs";

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
  candidate_execution: {
    unprivileged: true,
    isolated: true,
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
  repository_id: identity.repository_id,
  head_sha: identity.head_sha,
  tree_sha256: identity.tree_sha256,
  fixture_sha256: identity.fixture_sha256,
  intent_policy_sha256: identity.policy_sha256,
  context: identity.context,
  external_id: identity.external_id,
  observed: "synthetic",
};

function allPredicates() {
  return Object.fromEntries(PREDICATE_IDS.map((predicateId) => [predicateId, true]));
}
function protocolEvidenceInputs() {
  const migrationPlan = {
    schema_version: "product4-migration-plan-v1",
    migration_id: "m4_evaluator_protocol",
    source_schema_version: "v1",
    target_schema_version: "product4-v1",
    policy_sha256: PRODUCT4_POLICY_SHA256,
    context: PRODUCT4_CONTEXT,
    required_action_ids: ["action_product4_protocol"],
    operations: [
      {
        operation_id: "op_product4_protocol",
        kind: "add_table",
        table: "product4_receipts",
        name: "protocol_receipts",
      },
    ],
    rollback: {
      mode: "explicit_authorized",
      preserve_canonical: true,
      requires_fresh_read: true,
    },
  };
  const before = {
    schema_version: "v1",
    canonical_events: [],
    canonical_event_digests: [],
    protected_value_refs: [],
    trust_zone_ids: ["tz_synthetic"],
    pending_action_ids: [],
    completed_action_ids: ["action_product4_protocol"],
    applied_operation_ids: [],
    migration_receipts: [],
    rollback_receipts: [],
    legacy_writer_fields: { mode: "append_only" },
    legacy_writer_compatible: true,
  };
  const after = {
    ...structuredClone(before),
    schema_version: "product4-v1",
    applied_operation_ids: ["op_product4_protocol"],
    migration_receipts: [
      {
        migration_id: migrationPlan.migration_id,
        plan_digest: digestJson({
          schema_version: migrationPlan.schema_version,
          migration_id: migrationPlan.migration_id,
          source_schema_version: migrationPlan.source_schema_version,
          target_schema_version: migrationPlan.target_schema_version,
          policy_sha256: migrationPlan.policy_sha256,
          context: migrationPlan.context,
          required_action_ids: migrationPlan.required_action_ids,
          operations: migrationPlan.operations,
          rollback: migrationPlan.rollback,
        }),
        applied_operation_ids: ["op_product4_protocol"],
        applied_at: "2026-01-02T00:00:00Z",
      },
    ],
  };
  const apiIdentity = {
    repository_id: 1315097793,
    repository_path: "synthetic/carpeos",
    head_sha: headSha,
    external_id: identity.external_id,
    fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
    policy_sha256: PRODUCT4_POLICY_SHA256,
    context: PRODUCT4_CONTEXT,
    check_name: "Product 4 Candidate Evidence",
    app_id: 4242,
  };
  const normalizedApiIdentity = buildEvidenceIdentity({
    repositoryId: apiIdentity.repository_id,
    repositoryPath: apiIdentity.repository_path,
    headSha: apiIdentity.head_sha,
    externalId: apiIdentity.external_id,
    fixtureSha256: apiIdentity.fixture_sha256,
    policySha256: apiIdentity.policy_sha256,
    context: apiIdentity.context,
    checkName: apiIdentity.check_name,
    appId: apiIdentity.app_id,
  });
  const query = buildExactCheckQuery({
    repositoryPath: normalizedApiIdentity.repository_path,
    headSha: normalizedApiIdentity.head_sha,
  });
  const repository = {
    id: normalizedApiIdentity.repository_id,
    full_name: normalizedApiIdentity.repository_path,
  };
  const app = { id: normalizedApiIdentity.app_id };
  const suite = {
    id: 1,
    repository,
    app,
    head_sha: normalizedApiIdentity.head_sha,
    status: "completed",
    conclusion: "success",
  };
  const run = {
    id: 5,
    name: normalizedApiIdentity.check_name,
    external_id: normalizedApiIdentity.external_id,
    repository,
    app,
    head_sha: normalizedApiIdentity.head_sha,
    status: "completed",
    conclusion: "success",
    check_suite: suite,
  };
  const page = normalizeCheckRunsResponse(
    { total_count: 1, check_runs: [run], headers: { link: "" } },
    { identity: normalizedApiIdentity },
  );
  const duplicateRun = { ...run, conclusion: "failure" };
  const duplicatePage = normalizeCheckRunsResponse(
    { total_count: 1, check_runs: [duplicateRun], headers: { link: "" } },
    { identity: normalizedApiIdentity },
  );
  const pendingRun = {
    id: 7,
    repository_id: normalizedApiIdentity.repository_id,
    repository_path: normalizedApiIdentity.repository_path,
    head_sha: normalizedApiIdentity.head_sha,
    external_id: normalizedApiIdentity.external_id,
    fixture_sha256: normalizedApiIdentity.fixture_sha256,
    policy_sha256: normalizedApiIdentity.policy_sha256,
    context: normalizedApiIdentity.context,
    check_name: normalizedApiIdentity.check_name,
    app_id: normalizedApiIdentity.app_id,
    status: "queued",
    conclusion: null,
  };
  const steps = PRODUCT4_COMMAND_LOOP.map(({ step, command_id }) => ({
    step,
    command_id,
    status: "passed",
    evidence_digest: digestJson({ step, command_id, head_sha: headSha }),
  }));
  return {
    migration: {
      before,
      after,
      plan: migrationPlan,
      receipt: after.migration_receipts[0],
    },
    loop: { receipt: buildSixCommandLoopReceipt({ steps }) },
    exact_c_api: {
      query,
      pages: [page],
      identity: apiIdentity,
      observedAt: "2026-01-02T00:00:00Z",
    },
    duplicate_refusal: {
      pages: [page, duplicatePage],
      identity: apiIdentity,
    },
    lost_response_reconciliation: {
      identity: apiIdentity,
      post: { matches: [] },
      patch: {
        matches: [],
        pendingRun,
        attemptedPatch: { status: "completed", conclusion: "success" },
        retryCount: 0,
      },
    },
    negative_cases: {
      identity: apiIdentity,
      invalidPolicySha256: "f".repeat(64),
      foreignHeadSha: "e".repeat(40),
    },
  };
}
function validRunnerRawReport() {
  return buildRawCandidateReport({
    head_sha: headSha,
    base_sha: "c".repeat(40),
    tree_sha256: identity.tree_sha256,
    workflow_sha: "d".repeat(40),
    external_id: identity.external_id,
    commands: [
      {
        command_id: "p02_replay_a",
        invocation_digest: "e".repeat(64),
        exit_code: 0,
        stdout_sha256: "f".repeat(64),
        stderr_sha256: "0".repeat(64),
      },
    ],
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
    evaluated_at: "2026-01-02T00:00:00Z",
  });
}
function trustedEvidence(overrides = {}) {
  return {
    schema_version: "carpeos.product4-trusted-evidence/v1",
    owner: "base_evaluator",
    identity: { ...identity },
    predicate_digest: digestJson(allPredicates()),
    observation_digest: digestJson(observations),
    source_report_digest: digestJson(candidateReport),
    source: {
      kind: "base_recompute",
      evaluator_tree_sha256: "e".repeat(64),
    },
    ...overrides,
  };
}

function evaluate(overrides = {}) {
  return evaluateCandidateEvidence({
    identity,
    candidateReport,
    trustedPredicates: allPredicates(),
    observations,
    provenance,
    issuerWorkflowSha: provenance.evaluator_workflow_sha,
    trustedEvidence: trustedEvidence(),
    candidateReportedSuccess: true,
    requireCandidateExecutionObservation: true,
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
test("M4 rejects unknown fields at every nested attestation boundary", () => {
  const cases = [
    (attestation) => {
      attestation.predicate_results[0].unexpected = true;
    },
    (attestation) => {
      attestation.observations.unexpected = true;
    },
    (attestation) => {
      attestation.observations.p02.unexpected = true;
    },
    (attestation) => {
      attestation.observations.zero_write.unexpected = true;
    },
    (attestation) => {
      attestation.observations.high_water.unexpected = true;
    },
    (attestation) => {
      attestation.observations.candidate_execution.unexpected = true;
    },
    (attestation) => {
      attestation.provenance.unexpected = true;
    },
  ];
  for (const mutate of cases) {
    const malformed = structuredClone(evaluate().attestation);
    mutate(malformed);
    assert.throws(() => assertEvaluatorAttestation(malformed), /invalid_attestation/);
  }
});

test("M4 refuses forged privileged candidate execution observations", () => {
  const forged = evaluate({
    observations: {
      ...observations,
      candidate_execution: { unprivileged: false, isolated: true },
    },
  });
  assert.equal(forged.status, "refused");
  assert.match(forged.blockers.join("; "), /candidate_execution\.unprivileged/);
});

test("M4 classifies immutable base-to-C scope and keeps ambiguous scope pending", () => {
  const identityInput = {
    baseSha: "c".repeat(40),
    headSha,
    treeSha256: identity.tree_sha256,
  };
  const candidate = classifyImmutableCandidateScope({
    ...identityInput,
    scopePaths: [
      "apps/carpeos-cli/src/index.ts",
      "scripts/product4/policy-identity.mjs",
      "scripts/product4/p02-runner.mjs",
    ],
  });
  assert.equal(candidate.intent, true);
  assert.equal(candidate.state, "pending_evidence");
  assert.equal(candidate.classification.candidate, true);
  assert.equal(candidate.classification.scope_digest, candidate.scope_digest);

  const pending = classifyImmutableCandidateScope({ ...identityInput, scopePaths: [] });
  assert.equal(pending.intent, false);
  assert.equal(pending.state, "not_applicable");
  assert.equal(pending.classification.candidate, false);

  const nonCandidate = classifyImmutableCandidateScope({
    ...identityInput,
    scopePaths: ["docs/README.md"],
  });
  assert.equal(nonCandidate.intent, false);
  assert.equal(nonCandidate.state, "not_applicable");
  assert.equal(nonCandidate.classification.candidate, false);
});
test("M4 binds classification digest to immutable scope, not evaluator workflow provenance", () => {
  const immutable = {
    repository_id: 1315097793,
    head_sha: headSha,
    tree_sha256: identity.tree_sha256,
    fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
    intent_policy_sha256: PRODUCT4_POLICY_SHA256,
    context: PRODUCT4_CONTEXT,
    classification: { candidate: true, scope_digest: "e".repeat(64) },
  };
  const first = buildCandidateIntent({ ...immutable, issuer_workflow_sha: "d".repeat(40) });
  const second = buildCandidateIntent({ ...immutable, issuer_workflow_sha: "f".repeat(40) });
  assert.equal(first.classification_digest, second.classification_digest);
});

test("M4 refuses missing and forged sandbox evidence before candidate execution", () => {
  const trusted = mkdtempSync(join(tmpdir(), "product4-trusted-sandbox-"));
  const candidate = mkdtempSync(join(tmpdir(), "product4-candidate-sandbox-"));
  assert.throws(
    () => observeCandidateExecution({ candidateRoot: candidate, trustedRoot: trusted }),
    /sandbox_receipt_missing/,
  );
  const valid = buildP02SandboxReceipt({
    candidateRoot: candidate,
    headSha,
    baseSha: "c".repeat(40),
    treeSha256: identity.tree_sha256,
    probeSha256: sandboxProbeDigest(),
  });
  const forged = { ...valid, network: "enabled" };
  assert.throws(
    () =>
      observeCandidateExecution({
        candidateRoot: candidate,
        trustedRoot: trusted,
        sandboxReceipt: forged,
        expectedHeadSha: headSha,
        expectedBaseSha: "c".repeat(40),
        expectedTreeSha256: identity.tree_sha256,
      }),
    /sandbox_receipt_forged/,
  );
});
test("M4 validates module-backed C-bound protocol evidence and distinct preimages", () => {
  const evidence = buildBaseOwnedProtocolEvidence({
    headSha,
    treeSha256: identity.tree_sha256,
    ...protocolEvidenceInputs(),
  });
  assert.doesNotThrow(() =>
    assertBaseOwnedProtocolEvidence(evidence, {
      headSha,
      treeSha256: identity.tree_sha256,
    }),
  );
  assert.equal(Object.keys(evidence.observations).length, 6);
  const preimageDigests = Object.values(evidence.observations).map((observation) =>
    digestJson(observation.evidence_preimage),
  );
  assert.equal(new Set(preimageDigests).size, 6);
  for (const observation of Object.values(evidence.observations))
    assert.deepEqual(observation.evidence_preimage.identity, evidence.identity);
  const forged = { ...evidence, evidence_digest: "f".repeat(64) };
  assert.throws(() => assertBaseOwnedProtocolEvidence(forged), /protocol_evidence_forged/);
});

test("M4 refuses missing or unbranded protocol evidence", () => {
  const rawReport = validRunnerRawReport();
  const evidence = buildBaseOwnedProtocolEvidence({
    headSha,
    treeSha256: identity.tree_sha256,
    ...protocolEvidenceInputs(),
  });
  assert.throws(
    () =>
      evaluateRawCandidate({
        expectedHeadSha: headSha,
        expectedBaseSha: "c".repeat(40),
        expectedTreeSha256: identity.tree_sha256,
        evaluatorWorkflowSha: "d".repeat(40),
        rawReport,
        trustedProtocolEvidence: undefined,
      }),
    /protocol_evidence_missing/,
  );
  assert.throws(
    () =>
      evaluateRawCandidate({
        expectedHeadSha: headSha,
        expectedBaseSha: "c".repeat(40),
        expectedTreeSha256: identity.tree_sha256,
        evaluatorWorkflowSha: "d".repeat(40),
        rawReport,
        trustedProtocolEvidence: {
          observations: Object.fromEntries(PREDICATE_IDS.map((id) => [id, true])),
        },
      }),
    /protocol_evidence_forged/,
  );
  assert.throws(
    () =>
      evaluateRawCandidate({
        expectedHeadSha: headSha,
        expectedBaseSha: "c".repeat(40),
        expectedTreeSha256: identity.tree_sha256,
        evaluatorWorkflowSha: "d".repeat(40),
        rawReport,
        baseOwnedProtocolEvidence: evidence,
      }),
    /protocol_evidence_forged/,
  );
});
test("M4 internal protocol provider refuses missing or synthetic module inputs", () => {
  assert.throws(
    () => evaluateRawCandidateWithBaseOwnedProtocolInputs({}),
    /protocol_evidence_missing/,
  );
  assert.throws(
    () =>
      evaluateRawCandidateWithBaseOwnedProtocolInputs({
        expectedHeadSha: headSha,
        expectedTreeSha256: identity.tree_sha256,
        protocolInputs: {
          migration: { migration_read_oracle: true },
        },
      }),
    /protocol_evidence_forged/,
  );
});

test("M4 rejects caller-supplied all-true trusted predicates", () => {
  assert.throws(
    () => evaluateRawCandidate({ trustedPredicates: allPredicates() }),
    /predicate_refusal/,
  );
});
test("M4 rejects direct caller all-true predicates and identity/provenance rewraps", () => {
  const arbitrary = evaluateCandidateEvidence({
    identity,
    candidateReport: { observed: "arbitrary" },
    trustedPredicates: allPredicates(),
    observations,
    provenance,
    issuerWorkflowSha: provenance.evaluator_workflow_sha,
    requireCandidateExecutionObservation: true,
  });
  assert.equal(arbitrary.status, "refused");
  assert.match(arbitrary.blockers.join("; "), /trusted evidence envelope|identity/);

  const identityRewrap = evaluate({
    trustedEvidence: trustedEvidence({
      identity: { ...identity, head_sha: "f".repeat(40) },
    }),
  });
  assert.equal(identityRewrap.status, "refused");
  assert.match(identityRewrap.blockers.join("; "), /trustedEvidence identity head_sha/);

  const provenanceRewrap = evaluate({
    trustedEvidence: trustedEvidence({ source_report_digest: "f".repeat(64) }),
  });
  assert.equal(provenanceRewrap.status, "refused");
  assert.match(provenanceRewrap.blockers.join("; "), /trustedEvidence.source_report_digest/);
});
test("M4 refuses caller-supplied protocol observations", () => {
  const baseSha = "c".repeat(40);
  const workflowSha = "d".repeat(40);
  const raw = buildRawCandidateReport({
    head_sha: headSha,
    base_sha: baseSha,
    tree_sha256: identity.tree_sha256,
    workflow_sha: workflowSha,
    external_id: identity.external_id,
    commands: [
      {
        command_id: "p02_replay_a",
        invocation_digest: "e".repeat(64),
        exit_code: 0,
        stdout_sha256: "f".repeat(64),
        stderr_sha256: "0".repeat(64),
      },
    ],
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
    evaluated_at: "2026-01-02T00:00:00Z",
  });
  raw.observations.protocol_observations = {
    migration_read_oracle: { predicate_id: "migration_read_oracle", passed: true },
  };
  assert.throws(
    () =>
      evaluateRawCandidate({
        rawReport: raw,
        candidateRoot: "/tmp/product4-candidate",
        home: "/tmp/product4-home",
        expectedHeadSha: headSha,
        expectedBaseSha: baseSha,
        expectedTreeSha256: identity.tree_sha256,
        evaluatorWorkflowSha: workflowSha,
        sandboxReceiptPath: "/tmp/product4-receipt.json",
      }),
    /predicate_refusal/,
  );
});

test("M4 rejects workspace overlap and output symlink overwrite attempts", () => {
  const trusted = mkdtempSync(join(tmpdir(), "product4-trusted-"));
  const isolated = mkdtempSync(join(tmpdir(), "product4-candidate-"));
  assert.doesNotThrow(() =>
    assertCandidateWorkspaceBoundary({ candidateRoot: isolated, trustedRoot: trusted }),
  );
  assert.throws(
    () => assertCandidateWorkspaceBoundary({ candidateRoot: isolated, trustedRoot: isolated }),
    /candidate_workspace_boundary/,
  );

  const outputLink = join(isolated, "output-link");
  symlinkSync(trusted, outputLink, "dir");
  assert.throws(
    () => writeEvaluatorResult(join(outputLink, "attestation.json"), evaluate()),
    /output_refusal/,
  );
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
