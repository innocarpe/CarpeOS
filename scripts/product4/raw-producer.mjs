import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  digestJson,
  MAINTENANCE_STUDY_FIXTURE_SHA256,
  PRODUCT4_CONTEXT,
  PRODUCT4_POLICY_SHA256,
  PRODUCT4_REPOSITORY_ID,
  sha256Hex,
} from "./policy-identity.mjs";
import { assertP02Receipt } from "./p02-replay.mjs";

export const RAW_REPORT_SCHEMA = "product4-candidate-report-v1";
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const COMMAND_IDS = new Set([
  "migration_read_oracle",
  "six_command_loop",
  "p02_replay_a",
  "p02_replay_b",
  "negative_policy_refusal",
  "negative_api_refusal",
]);
const FORBIDDEN_KEY =
  /token|secret|credential|private_path|protected_plaintext|script|module|url|executable|shell|candidate_success/i;

export class RawProducerError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "RawProducerError";
    this.code = code;
  }
}

export function buildRawCandidateReport(input) {
  if (!isRecord(input)) throwRawError("invalid_report", "raw report input must be an object");
  const errors = [];
  assertExactKeys(
    input,
    [
      "head_sha",
      "base_sha",
      "tree_sha256",
      "workflow_sha",
      "external_id",
      "commands",
      "p02",
      "zero_write",
      "evaluated_at",
    ],
    "input",
    errors,
  );
  assertSha(input.head_sha, SHA1, "head_sha", errors);
  assertSha(input.base_sha, SHA1, "base_sha", errors);
  assertSha(input.tree_sha256, SHA256, "tree_sha256", errors);
  assertSha(input.workflow_sha, SHA1, "workflow_sha", errors);
  const expectedExternalId = `carpeos-4.0.0:${input.head_sha}:${MAINTENANCE_STUDY_FIXTURE_SHA256}`;
  if (input.external_id !== expectedExternalId)
    errors.push("external_id is not bound to C and fixture");
  if (!TIMESTAMP.test(input.evaluated_at ?? "")) errors.push("evaluated_at is invalid");
  assertCommands(input.commands, errors);
  assertP02(input.p02, errors);
  assertZeroWrite(input.zero_write, errors);
  assertNoForbiddenKeys(input, errors);
  if (errors.length > 0) {
    const code = errors.some((error) => error.startsWith("p02_evidence_mismatch:"))
      ? "p02_evidence_mismatch"
      : "invalid_report";
    throwRawError(code, errors.join("; "));
  }

  const report = {
    schema_version: RAW_REPORT_SCHEMA,
    report_type: "raw_candidate_report",
    repository_id: PRODUCT4_REPOSITORY_ID,
    head_sha: input.head_sha,
    base_sha: input.base_sha,
    tree_sha256: input.tree_sha256,
    fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
    intent_policy_sha256: PRODUCT4_POLICY_SHA256,
    context: PRODUCT4_CONTEXT,
    external_id: input.external_id,
    producer: {
      workflow_sha: input.workflow_sha,
      event: "pull_request",
      trust_level: "unprivileged",
    },
    observations: {
      commands: input.commands.map((command) => ({ ...command })),
      p02: { ...input.p02 },
      zero_write: { ...input.zero_write },
    },
  };
  assertRawCandidateReport(report);
  return report;
}

export function assertRawCandidateReport(report) {
  if (!isRecord(report)) throwRawError("invalid_report", "raw report must be an object");
  const errors = [];
  const keys = [
    "schema_version",
    "report_type",
    "repository_id",
    "head_sha",
    "base_sha",
    "tree_sha256",
    "fixture_sha256",
    "intent_policy_sha256",
    "context",
    "external_id",
    "producer",
    "observations",
  ];
  assertExactKeys(report, keys, "report", errors);
  if (report.schema_version !== RAW_REPORT_SCHEMA) errors.push("schema_version is invalid");
  if (report.report_type !== "raw_candidate_report") errors.push("report_type is invalid");
  if (report.repository_id !== PRODUCT4_REPOSITORY_ID) errors.push("repository_id is invalid");
  assertSha(report.head_sha, SHA1, "head_sha", errors);
  assertSha(report.base_sha, SHA1, "base_sha", errors);
  assertSha(report.tree_sha256, SHA256, "tree_sha256", errors);
  if (report.fixture_sha256 !== MAINTENANCE_STUDY_FIXTURE_SHA256)
    errors.push("fixture is not frozen");
  if (report.intent_policy_sha256 !== PRODUCT4_POLICY_SHA256) errors.push("policy is not P4_0");
  if (report.context !== PRODUCT4_CONTEXT) errors.push("context is not frozen");
  if (report.external_id !== `carpeos-4.0.0:${report.head_sha}:${MAINTENANCE_STUDY_FIXTURE_SHA256}`)
    errors.push("external_id is not C-bound");
  if (!isRecord(report.producer)) errors.push("producer is required");
  else {
    if (!SHA1.test(report.producer.workflow_sha ?? "")) errors.push("producer workflow is invalid");
    if (report.producer.event !== "pull_request") errors.push("producer event is invalid");
    if (report.producer.trust_level !== "unprivileged")
      errors.push("producer trust level is invalid");
  }
  if (!isRecord(report.observations)) errors.push("observations are required");
  else {
    assertCommands(report.observations.commands, errors);
    assertP02(report.observations.p02, errors);
    assertZeroWrite(report.observations.zero_write, errors);
  }
  assertNoForbiddenKeys(report, errors);
  if (errors.length > 0) {
    const code = errors.some((error) => error.startsWith("p02_evidence_mismatch:"))
      ? "p02_evidence_mismatch"
      : "invalid_report";
    throwRawError(code, errors.join("; "));
  }
  return report;
}

export function rawReportDigest(report) {
  return digestJson(assertRawCandidateReport(report));
}

function assertCommands(commands, errors) {
  if (!Array.isArray(commands) || commands.length < 1 || commands.length > COMMAND_IDS.size) {
    errors.push("commands must be a bounded non-empty array");
    return;
  }
  const seen = new Set();
  for (const command of commands) {
    if (!isRecord(command)) {
      errors.push("command observation must be an object");
      continue;
    }
    assertExactKeys(
      command,
      ["command_id", "invocation_digest", "exit_code", "stdout_sha256", "stderr_sha256"],
      "command",
      errors,
    );
    if (!COMMAND_IDS.has(command.command_id) || seen.has(command.command_id))
      errors.push("command id is unknown or duplicated");
    seen.add(command.command_id);
    assertSha(command.invocation_digest, SHA256, "invocation_digest", errors);
    assertSha(command.stdout_sha256, SHA256, "stdout_sha256", errors);
    assertSha(command.stderr_sha256, SHA256, "stderr_sha256", errors);
    if (
      !Number.isSafeInteger(command.exit_code) ||
      command.exit_code < 0 ||
      command.exit_code > 255
    )
      errors.push("command exit_code is invalid");
  }
  const replayA = commands.find((command) => command?.command_id === "p02_replay_a");
  const replayB = commands.find((command) => command?.command_id === "p02_replay_b");
  if (replayA !== undefined && replayB !== undefined) {
    for (const key of ["invocation_digest", "exit_code", "stdout_sha256", "stderr_sha256"]) {
      if (replayA[key] !== replayB[key])
        errors.push(`p02_evidence_mismatch: replay command ${key} differs between A and B`);
    }
  }
}

function assertP02(p02, errors) {
  if (!isRecord(p02)) {
    errors.push("p02 observation is required");
    return;
  }
  assertExactKeys(
    p02,
    ["diagnosis", "outcome", "analog_available", "state_transition"],
    "p02",
    errors,
  );
  if (p02.diagnosis !== "no_analog") errors.push("p02 diagnosis must be no_analog");
  if (p02.outcome !== "blocked_no_apply") errors.push("p02 outcome must be blocked_no_apply");
  if (p02.analog_available !== false) errors.push("p02 analog_available must be false");
  if (p02.state_transition !== "none_supported")
    errors.push("p02 transition must be none_supported");
}

function assertZeroWrite(zeroWrite, errors) {
  if (!isRecord(zeroWrite)) {
    errors.push("zero_write observation is required");
    return;
  }
  const keys = [
    "canonical_events",
    "review_rows",
    "disposition_rows",
    "outbox_rows",
    "protected_uploads",
  ];
  assertExactKeys(zeroWrite, keys, "zero_write", errors);
  for (const key of keys) if (zeroWrite[key] !== 0) errors.push(`zero_write.${key} must be zero`);
}

function assertExactKeys(value, allowed, label, errors) {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) errors.push(`${label}.${key} is not allowed`);
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

function assertSha(value, pattern, label, errors) {
  if (typeof value !== "string" || !pattern.test(value)) errors.push(`${label} is invalid`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function buildRawCandidateReportFromP02({
  p02Receipt,
  headSha,
  baseSha,
  treeSha256,
  workflowSha,
  evaluatedAt = new Date().toISOString(),
}) {
  if (!isRecord(p02Receipt)) throwRawError("invalid_p02", "P02 receipt must be an object");
  try {
    assertP02Receipt(p02Receipt);
  } catch (error) {
    throwRawError("invalid_p02", error instanceof Error ? error.message : "P02 receipt is invalid");
  }
  const runs = [p02Receipt.run_a, p02Receipt.run_b];
  if (runs.some((run) => !isRecord(run)))
    throwRawError("invalid_p02", "P02 replay runs are required");
  for (const key of [
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
  ]) {
    if (JSON.stringify(runs[0][key]) !== JSON.stringify(runs[1][key]))
      throwRawError("p02_evidence_mismatch", `P02 replay ${key} differs between A and B`);
  }
  const commands = runs.map((run, index) => ({
    command_id: index === 0 ? "p02_replay_a" : "p02_replay_b",
    invocation_digest: digestJson({
      command_bytes: run.command_bytes,
      tool_version: run.tool_version,
      environment_digest: run.environment_digest,
    }),
    exit_code: run.exit_code,
    stdout_sha256: sha256Hex(run.stdout_bytes),
    stderr_sha256: sha256Hex(run.stderr_bytes),
  }));
  return buildRawCandidateReport({
    head_sha: headSha,
    base_sha: baseSha,
    tree_sha256: treeSha256,
    workflow_sha: workflowSha,
    external_id: `carpeos-4.0.0:${headSha}:${MAINTENANCE_STUDY_FIXTURE_SHA256}`,
    commands,
    p02: {
      diagnosis: p02Receipt.diagnosis,
      outcome: p02Receipt.outcome,
      analog_available: p02Receipt.analog_available,
      state_transition: p02Receipt.state_transition,
    },
    zero_write: p02Receipt.mutation_probe,
    evaluated_at: evaluatedAt,
  });
}

function throwRawError(code, message) {
  throw new RawProducerError(code, message);
}

function parseArgs(argv) {
  const args = {};
  const allowed = new Set([
    "--input",
    "--p02",
    "--head-sha",
    "--base-sha",
    "--tree-sha256",
    "--workflow-sha",
    "--evaluated-at",
    "--output",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!allowed.has(flag)) throwRawError("invalid_args", `${flag} is not supported`);
    const value = argv[index + 1];
    if (typeof value !== "string" || value.length === 0)
      throwRawError("invalid_args", `${flag} requires a value`);
    if (args[flag] !== undefined) throwRawError("invalid_args", `${flag} cannot be repeated`);
    args[flag] = value;
    index += 1;
  }
  if (args["--output"] === undefined) throwRawError("invalid_args", "--output is required");
  const inputMode = args["--input"] !== undefined;
  const p02Mode = args["--p02"] !== undefined;
  if (inputMode === p02Mode)
    throwRawError("invalid_args", "choose exactly one of --input or --p02");
  if (p02Mode) {
    for (const flag of ["--head-sha", "--base-sha", "--tree-sha256", "--workflow-sha"]) {
      if (args[flag] === undefined) throwRawError("invalid_args", `${flag} is required with --p02`);
    }
  }
  return args;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report =
      args["--input"] === undefined
        ? buildRawCandidateReportFromP02({
            p02Receipt: JSON.parse(readFileSync(resolve(args["--p02"]), "utf8")),
            headSha: args["--head-sha"],
            baseSha: args["--base-sha"],
            treeSha256: args["--tree-sha256"],
            workflowSha: args["--workflow-sha"],
            evaluatedAt: args["--evaluated-at"],
          })
        : buildRawCandidateReport(JSON.parse(readFileSync(resolve(args["--input"]), "utf8")));
    writeFileSync(resolve(args["--output"]), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
