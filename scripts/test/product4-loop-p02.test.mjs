import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildSixCommandLoopReceipt } from "../product4/command-loop.mjs";
import {
  assertP02Fixture,
  assertP02Receipt,
  assertP02RunSemantics,
  buildP02Receipt,
  P02_COMMAND_LINE,
} from "../product4/p02-replay.mjs";
import {
  assertSandboxProbeObservation,
  buildP02SandboxReceipt,
  buildSandboxProbeObservation,
  mutationProbeBetween,
  sandboxProbeDigest,
} from "../product4/p02-runner.mjs";
import {
  digestJson,
  MAINTENANCE_STUDY_FIXTURE_SHA256,
  PRODUCT4_CONTEXT,
  PRODUCT4_POLICY_SHA256,
  readMaintenanceStudyFixture,
} from "../product4/policy-identity.mjs";

const steps = [1, 2, 3, 4, 6, 7].map((step) => ({
  step,
  command_id: {
    1: "capture",
    2: "canonical_append",
    3: "adjudication",
    4: "promoted_projection",
    6: "candidate_evidence",
    7: "human_authority",
  }[step],
  status: "passed",
  evidence_digest: `${step}`.repeat(64),
}));

const baseRun = {
  fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
  command_bytes: P02_COMMAND_LINE,
  tool_version: "carpeos-cli-test",
  environment_digest: "c".repeat(64),
  exit_code: 0,
  stdout_bytes: '{"schema":"carpeos.policy-reconciliation-plan/v2","entries":[]}',
  stderr_bytes: "",
  plan_digest: `sha256:${"a".repeat(64)}`,
  rows: { total_candidate_count: 0, classified_count: 0 },
  high_water: {
    canonical_local_sequence_max: 1,
    disposition_row_count: 0,
    review_row_count: 0,
    outbox_id_max: 1,
    supersession_event_count: 0,
  },
  ids: [],
  provenance_digest: "b".repeat(64),
};

const mutationProbe = {
  canonical_events: 0,
  review_rows: 0,
  disposition_rows: 0,
  outbox_rows: 0,
  protected_uploads: 0,
};

const emptyPlan = {
  schema: "carpeos.policy-reconciliation-plan/v2",
  trust_zone_id: "tz_synthetic",
  from_policy: "adj_v1",
  to_policy: "adj_v3",
  limit: 100,
  total_candidate_count: 0,
  classified_count: 0,
  truncated: false,
  high_water: {
    canonical_local_sequence_max: 1,
    disposition_row_count: 0,
    review_row_count: 0,
    outbox_id_max: 0,
    supersession_event_count: 0,
  },
  counts: {
    eligible_write_count: 0,
    eligible_noop_count: 0,
    unsafe_unchanged_count: 0,
    replace_count: 0,
    invalidate_count: 0,
    already_applied_count: 0,
    reason_code_counts: [],
  },
  plan_admissible: true,
  global_taint_reason_codes: [],
  global_taint_component_ids: [],
  global_taint_entry_ids: [],
  entries: [],
};
const strictPlan = {
  ...emptyPlan,
  plan_digest: `sha256:${digestJson(emptyPlan)}`,
};
const strictRun = {
  ...baseRun,
  stdout_bytes: JSON.stringify(strictPlan),
  plan_digest: strictPlan.plan_digest,
  high_water: strictPlan.high_water,
};
const mutationTableKeys = [
  "canonical_events",
  "review_rows",
  "disposition_rows",
  "outbox_rows",
  "protected_uploads",
];

function syntheticStoreObservation(canonicalRowDigests = ["a".repeat(64)], dataVersion) {
  const highWater = {
    canonical_local_sequence_max: canonicalRowDigests.length,
    disposition_row_count: 0,
    review_row_count: 0,
    outbox_id_max: 0,
    supersession_event_count: 0,
  };
  const tables = Object.fromEntries(
    mutationTableKeys.map((key) => {
      const rowDigests = key === "canonical_events" ? canonicalRowDigests : [];
      return [
        key,
        {
          count: rowDigests.length,
          row_digests: rowDigests,
          preimage_sha256: digestJson(rowDigests),
        },
      ];
    }),
  );
  return {
    highWater,
    table_preimages: tables,
    ...(dataVersion === undefined ? {} : { data_version: dataVersion }),
  };
}

test("M2 validates exactly six commands and keeps template 5 recovery-only", () => {
  const receipt = buildSixCommandLoopReceipt({ steps });
  assert.equal(receipt.schema_version, "carpeos.product4-command-loop/v1");
  assert.equal(receipt.policy_sha256, PRODUCT4_POLICY_SHA256);
  assert.equal(receipt.context, PRODUCT4_CONTEXT);
  assert.deepEqual(
    receipt.steps.map((step) => step.step),
    [1, 2, 3, 4, 6, 7],
  );
  assert.equal(receipt.template_5.mode, "recovery_only");
  assert.equal(receipt.template_5.can_write, false);
  assert.equal(receipt.template_5.auto_authority, false);
  assert.equal(receipt.auto_authority, false);
  assert.match(receipt.receipt_digest, /^[0-9a-f]{64}$/);
});

test("M2 rejects step 5 in the normal loop, reordered steps, and automatic authority", () => {
  const stepFive = structuredClone(steps);
  stepFive[4] = {
    step: 5,
    command_id: "apply",
    status: "passed",
    evidence_digest: "5".repeat(64),
  };
  assert.throws(() => buildSixCommandLoopReceipt({ steps: stepFive }), /expected step 6/);

  const reordered = structuredClone(steps);
  [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  assert.throws(() => buildSixCommandLoopReceipt({ steps: reordered }), /expected step 1/);

  const authority = structuredClone(steps);
  authority[2].authority_effect = "AcceptanceDecision";
  assert.throws(() => buildSixCommandLoopReceipt({ steps: authority }), /forbidden authority/);
});

test("M3 creates a deterministic truthful no-analog P02 receipt", () => {
  const receipt = buildP02Receipt({
    runA: baseRun,
    runB: structuredClone(baseRun),
    mutationProbe,
  });
  assert.equal(receipt.schema_version, "carpeos.product4-p02-replay/v1");
  assert.equal(receipt.diagnosis, "no_analog");
  assert.equal(receipt.outcome, "blocked_no_apply");
  assert.equal(receipt.analog_available, false);
  assert.equal(receipt.state_transition, "none_supported");
  assert.deepEqual(receipt.mutation_probe, mutationProbe);
  assertP02Receipt(receipt);
});
test("M3 accepts equal deterministic replays under the strict attestation predicate", () => {
  const snapshot = syntheticStoreObservation(["a".repeat(64)], 1);
  const observation = {
    high_water: snapshot.highWater,
    tables: snapshot.table_preimages,
    data_version: snapshot.data_version,
  };
  const mutationObservation = {
    before: observation,
    between: structuredClone(observation),
    after: structuredClone(observation),
  };
  const receipt = buildP02Receipt({
    runA: strictRun,
    runB: structuredClone(strictRun),
    mutationProbe,
    fixture: readMaintenanceStudyFixture(),
    fixtureSha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
    mutationObservation,
    strict: true,
  });
  assertP02Receipt(receipt);
  assert.equal(receipt.equality.tool_version, true);
  assert.equal(receipt.equality.environment_digest, true);
  assert.equal(receipt.equality.exit_code, true);
});

test("M3 refuses non-identical replays and every non-zero write probe", () => {
  const changedStdout = structuredClone(baseRun);
  changedStdout.stdout_bytes += "\n";
  assert.throws(
    () => buildP02Receipt({ runA: baseRun, runB: changedStdout, mutationProbe }),
    /not byte- and observation-identical/,
  );

  const changedHighWater = structuredClone(baseRun);
  changedHighWater.high_water.outbox_id_max = 2;
  assert.throws(
    () => buildP02Receipt({ runA: baseRun, runB: changedHighWater, mutationProbe }),
    /not byte- and observation-identical/,
  );
  for (const [field, value] of [
    ["tool_version", "carpeos-cli-other"],
    ["environment_digest", "d".repeat(64)],
    ["exit_code", 1],
  ]) {
    const changed = structuredClone(baseRun);
    changed[field] = value;
    assert.throws(
      () => buildP02Receipt({ runA: baseRun, runB: changed, mutationProbe }),
      /not byte- and observation-identical|replay_failed/,
    );
  }

  const wrote = { ...mutationProbe, canonical_events: 1 };
  assert.throws(
    () => buildP02Receipt({ runA: baseRun, runB: structuredClone(baseRun), mutationProbe: wrote }),
    /must be zero/,
  );
});

test("M3 never fabricates an apply analogue", () => {
  const applyClaim = structuredClone(baseRun);
  applyClaim.analog_available = true;
  assert.throws(
    () => buildP02Receipt({ runA: applyClaim, runB: structuredClone(baseRun), mutationProbe }),
    /not byte- and observation-identical|unsafe/,
  );

  const invalid = buildP02Receipt({
    runA: baseRun,
    runB: structuredClone(baseRun),
    mutationProbe,
  });
  invalid.outcome = "applied";
  assert.throws(() => assertP02Receipt(invalid), /blocked_no_apply/);
});

test("M3 rejects omitted fixture seeds before any replay", () => {
  const fixture = readMaintenanceStudyFixture();
  fixture.disposable_store.canonical_events = [];
  assert.throws(() => assertP02Fixture(fixture), /fixture_seed_missing/);
});

test("M3 independently recomputes the plan and refuses forged result semantics", () => {
  assertP02RunSemantics(strictRun, { fixture: readMaintenanceStudyFixture(), label: "strictRun" });

  const forgedPlan = { ...strictPlan, total_candidate_count: 1 };
  const forged = {
    ...strictRun,
    stdout_bytes: JSON.stringify(forgedPlan),
    plan_digest: `sha256:${digestJson(forgedPlan)}`,
  };
  assert.throws(
    () =>
      assertP02RunSemantics(forged, {
        fixture: readMaintenanceStudyFixture(),
        label: "forged",
      }),
    /result_mismatch|entry_identity_mismatch|plan_digest_mismatch/,
  );

  const forgedDigest = { ...strictRun, plan_digest: `sha256:${"f".repeat(64)}` };
  assert.throws(
    () =>
      assertP02RunSemantics(forgedDigest, {
        fixture: readMaintenanceStudyFixture(),
        label: "forged_digest",
      }),
    /plan_digest_mismatch/,
  );
});

test("M3 detects in-place updates despite unchanged table counts", () => {
  const before = syntheticStoreObservation();
  const between = syntheticStoreObservation(["b".repeat(64)]);
  const after = syntheticStoreObservation();
  const probe = mutationProbeBetween(before, between, after);
  assert.equal(probe.canonical_events, 1);
  assert.equal(probe.review_rows, 0);
});

test("M3 refuses unattributed transient mutations instead of claiming per-table detection", () => {
  const before = syntheticStoreObservation(["a".repeat(64)], 1);
  const between = syntheticStoreObservation(["a".repeat(64)], 2);
  const after = syntheticStoreObservation(["a".repeat(64)], 2);
  assert.throws(
    () => mutationProbeBetween(before, between, after),
    /mutation_observation_ambiguous/,
  );
});

function sandboxIdentity() {
  return {
    head_sha: "a".repeat(40),
    base_sha: "b".repeat(40),
    tree_sha256: "c".repeat(64),
    fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
    policy_sha256: PRODUCT4_POLICY_SHA256,
    context: PRODUCT4_CONTEXT,
  };
}

function sandboxRoots() {
  return {
    candidate_root: mkdtempSync(join(tmpdir(), "product4-candidate-")),
    workspace_root: mkdtempSync(join(tmpdir(), "product4-workspace-")),
    cli_root: mkdtempSync(join(tmpdir(), "product4-cli-")),
    home: mkdtempSync(join(tmpdir(), "product4-home-")),
    output: mkdtempSync(join(tmpdir(), "product4-output-")),
  };
}

function observedProbe(overrides = {}) {
  return buildSandboxProbeObservation({
    identity: sandboxIdentity(),
    roots: sandboxRoots(),
    ...overrides,
  });
}

test("M4 refuses claim-only and legacy hash-only sandbox receipts", () => {
  assert.throws(
    () =>
      assertSandboxProbeObservation({
        schema_version: "carpeos.product4-sandbox-probe/v1",
        facts: {
          network: "disabled",
          candidate_inputs: "read_only",
          trusted_mounts: false,
          writable_paths: ["/home", "/output", "/tmp"],
          capabilities: "dropped",
          no_new_privileges: true,
          process_limit: 64,
          memory_limit_mb: 1024,
        },
      }),
    /sandbox_probe/,
  );
  assert.throws(() => sandboxProbeDigest(), /sandbox probe digest requires/);

  const roots = sandboxRoots();
  assert.throws(
    () =>
      buildP02SandboxReceipt({
        candidateRoot: roots.candidate_root,
        headSha: sandboxIdentity().head_sha,
        baseSha: sandboxIdentity().base_sha,
        treeSha256: sandboxIdentity().tree_sha256,
        probeSha256: "d".repeat(64),
      }),
    /sandbox_probe_missing|observed probe object|bare probe hashes/,
  );
});

test("M4 requires exact observed identity, controls, and separated regular roots", () => {
  const probe = observedProbe();
  assert.equal(probe.schema_version, "carpeos.product4-sandbox-probe/v1");
  assert.match(sandboxProbeDigest(probe), /^[0-9a-f]{64}$/);

  for (const [field, value] of [
    ["network", "enabled"],
    ["trusted_mounts", true],
    ["capabilities", "full"],
    ["no_new_privileges", false],
    ["process_limit", 128],
    ["memory_limit_mb", 2048],
  ]) {
    assert.throws(() => observedProbe({ facts: { [field]: value } }), /sandbox_probe_forged/);
  }
  assert.throws(
    () => observedProbe({ facts: { writable_paths: ["/home", "/output"] } }),
    /sandbox_probe_forged/,
  );
  assert.throws(
    () =>
      observedProbe({
        identity: { ...sandboxIdentity(), fixture_sha256: "d".repeat(64) },
      }),
    /sandbox_probe_forged/,
  );

  const roots = probe.roots;
  const overlapping = { ...roots, output: roots.candidate_root };
  assert.throws(
    () =>
      buildSandboxProbeObservation({
        identity: sandboxIdentity(),
        roots: overlapping,
      }),
    /overlap/,
  );
  const workspaceOverlap = { ...roots, workspace_root: roots.cli_root };
  assert.throws(
    () =>
      buildSandboxProbeObservation({
        identity: sandboxIdentity(),
        roots: workspaceOverlap,
      }),
    /overlap/,
  );
  const receipt = buildP02SandboxReceipt({
    candidateRoot: roots.candidate_root,
    workspaceRoot: roots.workspace_root,
    cliRoot: roots.cli_root,
    home: roots.home,
    output: roots.output,
    headSha: sandboxIdentity().head_sha,
    baseSha: sandboxIdentity().base_sha,
    treeSha256: sandboxIdentity().tree_sha256,
    observedProbe: probe,
  });
  assert.equal(receipt.probe_sha256, probe.probe_digest);
  assert.equal(receipt.observed_probe.probe_digest, probe.probe_digest);
});
