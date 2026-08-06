import assert from "node:assert/strict";
import test from "node:test";
import { buildP02Receipt, P02_COMMAND_LINE } from "../product4/p02-replay.mjs";
import {
  MAINTENANCE_STUDY_FIXTURE_SHA256,
  PRODUCT4_POLICY_SHA256,
} from "../product4/policy-identity.mjs";
import {
  assertRawCandidateReport,
  buildRawCandidateReport,
  buildRawCandidateReportFromP02,
  rawReportDigest,
} from "../product4/raw-producer.mjs";

const headSha = "a".repeat(40);
const baseSha = "b".repeat(40);
const input = {
  head_sha: headSha,
  base_sha: baseSha,
  tree_sha256: "c".repeat(64),
  workflow_sha: "d".repeat(40),
  external_id: `carpeos-4.0.0:${headSha}:${MAINTENANCE_STUDY_FIXTURE_SHA256}`,
  commands: [
    {
      command_id: "p02_replay_a",
      invocation_digest: "e".repeat(64),
      exit_code: 0,
      stdout_sha256: "f".repeat(64),
      stderr_sha256: "0".repeat(64),
    },
    {
      command_id: "p02_replay_b",
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
};

test("M4 builds a public-safe unprivileged raw report bound to C/tree/P4_0", () => {
  const report = buildRawCandidateReport(input);
  assertRawCandidateReport(report);
  assert.equal(report.repository_id, 1315097793);
  assert.equal(report.intent_policy_sha256, PRODUCT4_POLICY_SHA256);
  assert.equal(report.producer.trust_level, "unprivileged");
  assert.equal(report.observations.p02.outcome, "blocked_no_apply");
  assert.match(rawReportDigest(report), /^[0-9a-f]{64}$/);
});
test("M4 derives raw observations from the actual P02 replay receipt", () => {
  const run = {
    fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
    command_bytes: P02_COMMAND_LINE,
    tool_version: "carpeos-cli-test",
    environment_digest: "4".repeat(64),
    exit_code: 0,
    stdout_bytes: '{"entries":[]}\n',
    stderr_bytes: "",
    plan_digest: `sha256:${"5".repeat(64)}`,
    rows: { total_candidate_count: 0, classified_count: 0 },
    high_water: {
      canonical_local_sequence_max: 0,
      disposition_row_count: 0,
      review_row_count: 0,
      outbox_id_max: 0,
      supersession_event_count: 0,
    },
    ids: [],
    provenance_digest: "6".repeat(64),
  };
  const receipt = buildP02Receipt({
    runA: run,
    runB: structuredClone(run),
    mutationProbe: input.zero_write,
  });
  const report = buildRawCandidateReportFromP02({
    p02Receipt: receipt,
    headSha,
    baseSha,
    treeSha256: input.tree_sha256,
    workflowSha: input.workflow_sha,
    evaluatedAt: input.evaluated_at,
  });
  assertRawCandidateReport(report);
  assert.deepEqual(
    report.observations.commands.map((command) => command.command_id),
    ["p02_replay_a", "p02_replay_b"],
  );
  assert.deepEqual(
    report.observations.commands.map(({ invocation_digest, stdout_sha256, stderr_sha256 }) => ({
      invocation_digest,
      stdout_sha256,
      stderr_sha256,
    })),
    [
      {
        invocation_digest: report.observations.commands[0].invocation_digest,
        stdout_sha256: report.observations.commands[0].stdout_sha256,
        stderr_sha256: report.observations.commands[0].stderr_sha256,
      },
      {
        invocation_digest: report.observations.commands[0].invocation_digest,
        stdout_sha256: report.observations.commands[0].stdout_sha256,
        stderr_sha256: report.observations.commands[0].stderr_sha256,
      },
    ],
  );
});

test("M4 rejects replay command evidence that diverges between identical runs", () => {
  assert.throws(
    () =>
      buildRawCandidateReport({
        ...input,
        commands: [input.commands[0], { ...input.commands[1], invocation_digest: "1".repeat(64) }],
      }),
    /p02_evidence_mismatch/,
  );
});
test("M4 rejects forged P02, inactive policy-like fields, and executable report fields", () => {
  assert.throws(
    () => buildRawCandidateReport({ ...input, p02: { ...input.p02, outcome: "applied" } }),
    /p02 outcome/,
  );
  assert.throws(
    () => buildRawCandidateReport({ ...input, policy_sha256: "4".repeat(64) }),
    /input.policy_sha256 is not allowed/,
  );
  assert.throws(
    () =>
      buildRawCandidateReport({ ...input, commands: [{ ...input.commands[0], script: "never" }] }),
    /not allowed/,
  );
});
