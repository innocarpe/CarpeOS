import {
  digestJson,
  MAINTENANCE_STUDY_FIXTURE_SHA256,
  PRODUCT4_CONTEXT,
  PRODUCT4_POLICY_SHA256,
} from "./policy-identity.mjs";

export const P02_COMMAND_LINE =
  "carpeos adjudicate reconcile-policy --from-policy adj_v1 --to-policy adj_v3 --trust-zone tz_synthetic --limit 100";
export const P02_SCHEMA_VERSION = "carpeos.product4-p02-replay/v1";

const ZERO_WRITE_KEYS = [
  "canonical_events",
  "review_rows",
  "disposition_rows",
  "outbox_rows",
  "protected_uploads",
];
const SHA256 = /^[0-9a-f]{64}$/;
const PLAN_DIGEST = /^sha256:[0-9a-f]{64}$/;
const FORBIDDEN_KEY =
  /token|secret|credential|private_path|protected_plaintext|script|module|url|executable|shell/i;
const RUN_KEYS = [
  "fixture_sha256",
  "command_bytes",
  "tool_version",
  "environment_digest",
  "exit_code",
  "stdout_bytes",
  "stderr_bytes",
  "plan_digest",
  "rows",
  "high_water",
  "ids",
  "provenance_digest",
];
const RECEIPT_KEYS = [
  "schema_version",
  "policy_sha256",
  "context",
  "fixture_sha256",
  "command_line",
  "run_a",
  "run_b",
  "equality",
  "mutation_probe",
  "diagnosis",
  "outcome",
  "analog_available",
  "state_transition",
  "receipt_digest",
];
const ROW_KEYS = ["total_candidate_count", "classified_count"];
const HIGH_WATER_KEYS = [
  "canonical_local_sequence_max",
  "disposition_row_count",
  "review_row_count",
  "outbox_id_max",
  "supersession_event_count",
];
const EQUALITY_KEYS = [
  "command_bytes",
  "stdout_bytes",
  "stderr_bytes",
  "plan_digest",
  "rows",
  "high_water",
  "ids",
  "provenance",
];
const MUTATION_PROBE_KEYS = ZERO_WRITE_KEYS;

export function buildP02Receipt({
  runA,
  runB,
  mutationProbe,
  fixtureSha256 = MAINTENANCE_STUDY_FIXTURE_SHA256,
}) {
  assertRun(runA, "runA", fixtureSha256);
  assertRun(runB, "runB", fixtureSha256);
  assertMutationProbe(mutationProbe);
  if (runA.command_bytes !== P02_COMMAND_LINE || runB.command_bytes !== P02_COMMAND_LINE) {
    throwP02Error("command_mismatch", "P02 must use the exact supported command");
  }
  if (
    runA.exit_code !== 0 ||
    runB.exit_code !== 0 ||
    runA.stderr_bytes !== "" ||
    runB.stderr_bytes !== ""
  ) {
    throwP02Error("replay_failed", "P02 requires two successful runs with empty stderr");
  }
  const equal = {
    command_bytes: runA.command_bytes === runB.command_bytes,
    stdout_bytes: runA.stdout_bytes === runB.stdout_bytes,
    stderr_bytes: runA.stderr_bytes === runB.stderr_bytes,
    plan_digest: runA.plan_digest === runB.plan_digest,
    rows: equalJson(runA.rows, runB.rows),
    high_water: equalJson(runA.high_water, runB.high_water),
    ids: equalJson(runA.ids, runB.ids),
    provenance: runA.provenance_digest === runB.provenance_digest,
  };
  if (Object.values(equal).some((value) => value !== true)) {
    throwP02Error("non_deterministic_replay", "P02 runs are not byte- and observation-identical");
  }

  return {
    schema_version: P02_SCHEMA_VERSION,
    policy_sha256: PRODUCT4_POLICY_SHA256,
    context: PRODUCT4_CONTEXT,
    fixture_sha256: fixtureSha256,
    command_line: P02_COMMAND_LINE,
    run_a: summarizeRun(runA),
    run_b: summarizeRun(runB),
    equality: equal,
    mutation_probe: { ...mutationProbe },
    diagnosis: "no_analog",
    outcome: "blocked_no_apply",
    analog_available: false,
    state_transition: "none_supported",
    receipt_digest: digestJson({
      schema_version: P02_SCHEMA_VERSION,
      policy_sha256: PRODUCT4_POLICY_SHA256,
      context: PRODUCT4_CONTEXT,
      fixture_sha256: fixtureSha256,
      command_line: P02_COMMAND_LINE,
      run_a: summarizeRun(runA),
      run_b: summarizeRun(runB),
      equality: equal,
      mutation_probe: mutationProbe,
      diagnosis: "no_analog",
      outcome: "blocked_no_apply",
      analog_available: false,
      state_transition: "none_supported",
    }),
  };
}

export function assertP02Receipt(receipt) {
  if (!isRecord(receipt)) throwP02Error("invalid_receipt", "receipt must be an object");

  const errors = [];
  assertExactKeys(receipt, RECEIPT_KEYS, "receipt", errors);
  if (receipt.schema_version !== P02_SCHEMA_VERSION) errors.push("schema_version is invalid");
  if (receipt.policy_sha256 !== PRODUCT4_POLICY_SHA256) errors.push("policy_sha256 is not P4_0");
  if (receipt.context !== PRODUCT4_CONTEXT) errors.push("context is not frozen");
  if (receipt.fixture_sha256 !== MAINTENANCE_STUDY_FIXTURE_SHA256)
    errors.push("fixture_sha256 is invalid");
  if (receipt.command_line !== P02_COMMAND_LINE) errors.push("command_line is invalid");
  if (receipt.diagnosis !== "no_analog") errors.push("diagnosis must be no_analog");
  if (receipt.outcome !== "blocked_no_apply") errors.push("outcome must be blocked_no_apply");
  if (receipt.analog_available !== false) errors.push("analog_available must be false");
  if (receipt.state_transition !== "none_supported")
    errors.push("state_transition must be none_supported");

  for (const [run, label] of [
    [receipt.run_a, "run_a"],
    [receipt.run_b, "run_b"],
  ]) {
    if (!isRecord(run)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    try {
      assertRun(run, label, MAINTENANCE_STUDY_FIXTURE_SHA256);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `${label} is invalid`);
    }
    if (run.exit_code !== 0 || run.stderr_bytes !== "")
      errors.push(`${label} must be a successful run with empty stderr`);
  }

  if (
    !isRecord(receipt.equality) ||
    Object.keys(receipt.equality).length !== EQUALITY_KEYS.length ||
    EQUALITY_KEYS.some((key) => receipt.equality[key] !== true)
  ) {
    errors.push("all replay equality observations must be true");
  }
  assertMutationProbe(receipt.mutation_probe, errors);
  assertNoForbiddenKeys(receipt, errors);
  if (SHA256.test(receipt.receipt_digest ?? "")) {
    const unsignedReceipt = { ...receipt };
    delete unsignedReceipt.receipt_digest;
    if (digestJson(unsignedReceipt) !== receipt.receipt_digest)
      errors.push("receipt_digest does not match receipt");
  }
  if (!SHA256.test(receipt.receipt_digest ?? "")) errors.push("receipt_digest is invalid");
  if (errors.length > 0) throwP02Error("invalid_receipt", errors.join("; "));
  return receipt;
}

function assertRun(run, label, fixtureSha256) {
  if (!isRecord(run)) throwP02Error("invalid_run", `${label} must be an object`);
  if (run.fixture_sha256 !== fixtureSha256)
    throwP02Error("fixture_mismatch", `${label} fixture mismatch`);
  if (run.command_bytes !== P02_COMMAND_LINE)
    throwP02Error("command_mismatch", `${label} must use the exact P02 command`);
  if (
    typeof run.tool_version !== "string" ||
    run.tool_version.length === 0 ||
    run.tool_version.length > 128
  ) {
    throwP02Error("invalid_run", `${label} tool version is invalid`);
  }
  if (!SHA256.test(run.environment_digest ?? ""))
    throwP02Error("invalid_run", `${label} environment digest is invalid`);
  if (!Number.isSafeInteger(run.exit_code) || run.exit_code < 0 || run.exit_code > 255) {
    throwP02Error("invalid_run", `${label} exit code is invalid`);
  }
  if (typeof run.stdout_bytes !== "string" || typeof run.stderr_bytes !== "string") {
    throwP02Error("invalid_run", `${label} stdout/stderr bytes are required`);
  }
  if (run.stdout_bytes.length > 1_000_000 || run.stderr_bytes.length > 1_000_000) {
    throwP02Error("invalid_run", `${label} stdout/stderr bytes exceed the bounded limit`);
  }
  if (!PLAN_DIGEST.test(run.plan_digest ?? ""))
    throwP02Error("invalid_run", `${label} plan digest is invalid`);
  if (!isRecord(run.rows) || !isRecord(run.high_water) || !Array.isArray(run.ids)) {
    throwP02Error("invalid_run", `${label} rows, high_water, and ids are required`);
  }
  if (!SHA256.test(run.provenance_digest ?? ""))
    throwP02Error("invalid_run", `${label} provenance digest is invalid`);

  const errors = Object.keys(run)
    .filter((key) => !RUN_KEYS.includes(key))
    .map((key) => `${label}.${key} is not allowed`);
  assertExactKeys(run.rows, ROW_KEYS, `${label}.rows`, errors);
  for (const key of ROW_KEYS) {
    if (!isSafeNonNegativeInteger(run.rows[key]))
      errors.push(`${label}.rows.${key} must be a non-negative safe integer`);
  }
  assertExactKeys(run.high_water, HIGH_WATER_KEYS, `${label}.high_water`, errors);
  for (const key of HIGH_WATER_KEYS) {
    if (!isSafeNonNegativeInteger(run.high_water[key]))
      errors.push(`${label}.high_water.${key} must be a non-negative safe integer`);
  }
  if (run.ids.length > 1000 || run.ids.some((id) => typeof id !== "string" || id.length > 256))
    errors.push(`${label}.ids must contain at most 1000 bounded string IDs`);
  assertNoForbiddenKeys(run, errors);
  if (errors.length > 0) throwP02Error("unsafe_run", errors.join("; "));
}

function assertMutationProbe(probe, errors) {
  const collectedErrors = errors ?? [];
  const collecting = errors !== undefined;
  if (!isRecord(probe)) {
    collectedErrors.push("mutation_probe must be an object");
  } else {
    assertExactKeys(probe, MUTATION_PROBE_KEYS, "mutation_probe", collectedErrors);
    for (const key of ZERO_WRITE_KEYS) {
      if (probe[key] !== 0) collectedErrors.push(`mutation_probe.${key} must be zero`);
    }
  }
  if (collectedErrors.length > 0 && !collecting)
    throwP02Error("non_zero_write", collectedErrors.join("; "));
}

function summarizeRun(run) {
  return {
    fixture_sha256: run.fixture_sha256,
    command_bytes: run.command_bytes,
    tool_version: run.tool_version,
    environment_digest: run.environment_digest,
    exit_code: run.exit_code,
    stdout_bytes: run.stdout_bytes,
    stderr_bytes: run.stderr_bytes,
    plan_digest: run.plan_digest,
    rows: run.rows,
    high_water: run.high_water,
    ids: run.ids,
    provenance_digest: run.provenance_digest,
  };
}

function assertExactKeys(value, allowedKeys, label, errors) {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) errors.push(`${label}.${key} is not allowed`);
  }
}

function isSafeNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}
function assertNoForbiddenKeys(value, errors, path = "$") {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries())
      assertNoForbiddenKeys(item, errors, `${path}[${index}]`);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) errors.push(`${path}.${key} is not allowed`);
    assertNoForbiddenKeys(child, errors, `${path}.${key}`);
  }
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function throwP02Error(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.name = "P02ReplayError";
  error.code = code;
  throw error;
}
