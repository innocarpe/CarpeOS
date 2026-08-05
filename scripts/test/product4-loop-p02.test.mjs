import assert from "node:assert/strict";
import test from "node:test";

import { buildSixCommandLoopReceipt } from "../product4/command-loop.mjs";
import { assertP02Receipt, buildP02Receipt, P02_COMMAND_LINE } from "../product4/p02-replay.mjs";
import {
  MAINTENANCE_STUDY_FIXTURE_SHA256,
  PRODUCT4_CONTEXT,
  PRODUCT4_POLICY_SHA256,
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
