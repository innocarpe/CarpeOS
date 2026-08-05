import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { assertP02Receipt, buildP02Receipt, P02_COMMAND_LINE } from "./p02-replay.mjs";
import { digestJson, MAINTENANCE_STUDY_FIXTURE_SHA256 } from "./policy-identity.mjs";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const P02_ARGS = [
  "adjudicate",
  "reconcile-policy",
  "--from-policy",
  "adj_v1",
  "--to-policy",
  "adj_v3",
  "--trust-zone",
  "tz_synthetic",
  "--limit",
  "100",
];
const ZERO_WRITE_TABLES = {
  canonical_events: "canonical_events",
  review_rows: "knowledge_disposition_reviews",
  disposition_rows: "knowledge_dispositions",
  outbox_rows: "outbox",
  protected_uploads: "protected_value_imports",
};

export function runP02Twice({ home, workspaceRoot = process.cwd(), cliRoot = REPO_ROOT }) {
  if (typeof home !== "string" || home.length === 0)
    throw new Error("P02 runner requires a runtime home");
  if (typeof cliRoot !== "string" || cliRoot.length === 0)
    throw new Error("P02 runner requires a CLI root");
  const before = readStoreObservation(home);
  const runA = runOnce(home, workspaceRoot, cliRoot);
  const between = readStoreObservation(home);
  const runB = runOnce(home, workspaceRoot, cliRoot);
  const after = readStoreObservation(home);
  const mutationProbe = mutationProbeBetween(before, between, after);
  const receipt = buildP02Receipt({ runA, runB, mutationProbe });
  assertP02Receipt(receipt);
  return receipt;
}

function runOnce(home, workspaceRoot, cliRoot) {
  const cliPath = resolve(cliRoot, "apps/carpeos-cli/dist/index.js");
  const result = spawnSync(process.execPath, [cliPath, ...P02_ARGS], {
    cwd: workspaceRoot,
    env: {
      CARPEOS_HOME: home,
      CARPEOS_TRUST_ZONE: "tz_synthetic",
      NODE_NO_WARNINGS: "1",
      HOME: home,
      NO_COLOR: "1",
      TZ: "UTC",
      PATH: process.env.PATH ?? "/usr/bin:/bin",
    },
    encoding: "buffer",
  });
  const stdout = result.stdout?.toString("utf8") ?? "";
  const stderr = result.stderr?.toString("utf8") ?? "";
  let body;
  try {
    body = JSON.parse(stdout);
  } catch {
    throw new Error("P02 CLI did not emit JSON");
  }
  const highWater = body.high_water;
  const rows = {
    total_candidate_count: body.total_candidate_count,
    classified_count: body.classified_count,
  };
  const ids = Array.isArray(body.entries)
    ? body.entries.flatMap((entry) =>
        [entry.source_event_id, entry.target_event_id, entry.replacement_event_id].filter(Boolean),
      )
    : [];
  const environmentDigest = digestJson({
    runtime: process.version,
    platform: process.platform,
    arch: process.arch,
    trust_zone: "tz_synthetic",
    node_no_warnings: "1",
    no_color: "1",
    timezone: "UTC",
    path_available: true,
  });
  return {
    fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
    command_bytes: P02_COMMAND_LINE,
    tool_version: `carpeos-cli:${process.version}`,
    environment_digest: environmentDigest,
    exit_code: result.status ?? 1,
    stdout_bytes: stdout,
    stderr_bytes: stderr,
    plan_digest: body.plan_digest,
    rows,
    high_water: highWater,
    ids,
    provenance_digest: digestJson({
      command: P02_COMMAND_LINE,
      stdout,
      stderr,
      environment_digest: environmentDigest,
    }),
  };
}

function readStoreObservation(home) {
  const databasePath = resolve(home, "carpeos.sqlite");
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const counts = {};
    for (const [key, table] of Object.entries(ZERO_WRITE_TABLES)) {
      counts[key] = Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
    }
    const highWater = {
      canonical_local_sequence_max: Number(
        database
          .prepare("SELECT COALESCE(MAX(local_sequence), 0) AS value FROM canonical_events")
          .get().value,
      ),
      disposition_row_count: counts.disposition_rows,
      review_row_count: counts.review_rows,
      outbox_id_max: Number(
        database.prepare("SELECT COALESCE(MAX(outbox_id), 0) AS value FROM outbox").get().value,
      ),
      supersession_event_count: Number(
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM canonical_events WHERE event_type = 'Supersession'",
          )
          .get().count,
      ),
    };
    return { counts, highWater };
  } finally {
    database.close();
  }
}

function mutationProbeBetween(...observations) {
  const mutation = {};
  for (const key of Object.keys(ZERO_WRITE_TABLES)) {
    const values = observations.map((observation) => observation.counts[key]);
    mutation[key] = Math.max(...values) - Math.min(...values);
  }
  return mutation;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (
      flag !== "--home" &&
      flag !== "--workspace-root" &&
      flag !== "--cli-root" &&
      flag !== "--output"
    )
      throw new Error("P02 runner accepts only --home, --workspace-root, --cli-root, and --output");
    const value = argv[index + 1];
    if (typeof value !== "string" || value.length === 0 || values[flag] !== undefined)
      throw new Error(`${flag} requires one non-empty value and cannot repeat`);
    values[flag] = value;
    index += 1;
  }
  if (values["--home"] === undefined || values["--output"] === undefined)
    throw new Error("P02 runner requires --home and --output");
  return values;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const receipt = runP02Twice({
      home: resolve(args["--home"]),
      workspaceRoot:
        args["--workspace-root"] === undefined ? process.cwd() : resolve(args["--workspace-root"]),
      cliRoot: args["--cli-root"] === undefined ? REPO_ROOT : resolve(args["--cli-root"]),
    });
    writeFileSync(resolve(args["--output"]), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
