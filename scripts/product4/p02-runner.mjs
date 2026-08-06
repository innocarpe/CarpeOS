import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  assertP02Fixture,
  assertP02Receipt,
  assertP02RunSemantics,
  buildP02Receipt,
  fixtureHighWater,
  loadP02Fixture,
  P02_COMMAND_LINE,
} from "./p02-replay.mjs";
import { canonicalJson, digestJson, sha256Hex } from "./policy-identity.mjs";

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
const SEED_PROTECTED_VALUE_ID = "pv_synthetic_maintenance_001";
const SEED_IDEMPOTENCY_KEY = "idem_synthetic_maintenance_seed_001";

/**
 * Seed one synthetic fixture row, take an immutable baseline, and replay only
 * the read-only reconciliation command twice. Seeding is deliberately kept
 * outside runOnce: the command under test must never create fixture state.
 */
export function runP02Twice({ home, workspaceRoot = process.cwd(), cliRoot = REPO_ROOT }) {
  if (typeof home !== "string" || home.length === 0)
    throw new Error("P02 runner requires a runtime home");
  if (typeof cliRoot !== "string" || cliRoot.length === 0)
    throw new Error("P02 runner requires a CLI root");
  const runtimeHome = resolve(home);

  const { fixture, fixtureSha256 } = loadP02Fixture();
  const seeded = seedDisposableFixture({
    workspaceRoot,
    cliRoot,
    fixture,
    home: runtimeHome,
  });
  assertSeedObservation(seeded, fixture);

  const observer = new DatabaseSync(resolve(runtimeHome, "carpeos.sqlite"), { readOnly: true });
  try {
    const before = readStoreObservation(runtimeHome, observer);
    const runA = runOnce(runtimeHome, workspaceRoot, cliRoot, fixture, fixtureSha256, "runA");
    const between = readStoreObservation(runtimeHome, observer);
    const runB = runOnce(runtimeHome, workspaceRoot, cliRoot, fixture, fixtureSha256, "runB");
    const after = readStoreObservation(runtimeHome, observer);
    const mutationProbe = mutationProbeBetween(before, between, after);
    const mutationObservation = buildMutationObservation({ before, between, after });
    const receipt = buildP02Receipt({
      runA,
      runB,
      mutationProbe,
      fixture,
      fixtureSha256,
      mutationObservation,
      strict: true,
    });
    assertP02Receipt(receipt);
    return receipt;
  } finally {
    observer.close();
  }
}

/**
 * Explicit fixture boundary. The maintenance fixture intentionally carries an
 * abstract Observation preimage rather than a full production event; no public
 * append API can represent that exact synthetic row. The local store is still
 * initialized through its supported CLI opener, then this boundary inserts the
 * fixture row once with append-only SQL. Reconciliation itself remains read-only.
 */
export function seedDisposableFixture({ home, workspaceRoot, cliRoot, fixture }) {
  assertP02Fixture(fixture);
  const runtimeHome = resolve(home);
  bootstrapStore({ home: runtimeHome, workspaceRoot, cliRoot });
  const databasePath = resolve(runtimeHome, "carpeos.sqlite");
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA foreign_keys = ON");
    const existing = readStoreObservation(runtimeHome);
    const protectedValueCount = Number(
      database.prepare("SELECT COUNT(*) AS count FROM protected_values").get().count,
    );
    if (isFixtureSeeded(existing, fixture) && protectedValueCount === 1) {
      assertSeedProtectedValue(database, fixture);
      assertSeedRow(database, fixture);
      return existing;
    }
    const allZero = Object.values(existing.counts).every((count) => count === 0);
    if (!allZero || protectedValueCount !== 0) {
      throwRunnerError(
        "fixture_store_not_disposable",
        "P02 fixture setup refuses a non-empty disposable store",
      );
    }

    const seed = fixture.disposable_store.canonical_events[0];
    const eventJson = canonicalJson(seed);
    const eventFingerprint = digestJson(seed);
    const plaintext = Buffer.from("synthetic maintenance fixture", "utf8");
    database.exec("BEGIN IMMEDIATE");
    try {
      database
        .prepare(
          `
            INSERT INTO protected_values (
              protected_value_id, vault_ref, key_ref, nonce_ref, tag_ref,
              nonce, tag, ciphertext, plaintext_digest, size_bytes, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          SEED_PROTECTED_VALUE_ID,
          "vault_local",
          "key_local_active",
          "nonce_synthetic_maintenance_001",
          "tag_synthetic_maintenance_001",
          Buffer.alloc(12, 0),
          Buffer.alloc(16, 0),
          plaintext,
          sha256Hex(plaintext),
          plaintext.byteLength,
          seed.recorded_time,
        );
      database
        .prepare(
          `
            INSERT INTO canonical_events (
              event_id, event_type, trust_zone_id, idempotency_key,
              request_fingerprint, protected_value_id, event_json, recorded_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          seed.event_id,
          seed.event_type,
          seed.trust_zone_id,
          SEED_IDEMPOTENCY_KEY,
          eventFingerprint,
          SEED_PROTECTED_VALUE_ID,
          eventJson,
          seed.recorded_time,
        );
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    assertSeedProtectedValue(database, fixture);
    assertSeedRow(database, fixture);
  } finally {
    database.close();
  }
  const seeded = readStoreObservation(runtimeHome);
  assertSeedObservation(seeded, fixture);
  return seeded;
}

function bootstrapStore({ home, workspaceRoot, cliRoot }) {
  const cliPath = resolve(cliRoot, "apps/carpeos-cli/dist/index.js");
  const result = spawnSync(
    process.execPath,
    [cliPath, "project", "identify", "--home", home, "--trust-zone", "tz_synthetic"],
    {
      cwd: workspaceRoot,
      env: commandEnvironment(home),
      encoding: "buffer",
    },
  );
  if (result.error !== undefined || result.status !== 0) {
    throwRunnerError(
      "fixture_store_bootstrap_failed",
      result.error?.message ?? `store bootstrap exited with ${String(result.status)}`,
    );
  }
  let body;
  try {
    body = JSON.parse(result.stdout?.toString("utf8") ?? "");
  } catch {
    throwRunnerError("fixture_store_bootstrap_failed", "store bootstrap did not emit JSON");
  }
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    body.command !== "project identify" ||
    body.trust_zone_id !== "tz_synthetic"
  ) {
    throwRunnerError("fixture_store_bootstrap_failed", "store bootstrap identity is invalid");
  }
}

function runOnce(home, workspaceRoot, cliRoot, fixture, fixtureSha256, label) {
  const cliPath = resolve(cliRoot, "apps/carpeos-cli/dist/index.js");
  const result = spawnSync(process.execPath, [cliPath, ...P02_ARGS], {
    cwd: workspaceRoot,
    env: commandEnvironment(home),
    encoding: "buffer",
  });
  if (result.error !== undefined) {
    throwRunnerError("cli_spawn_failed", result.error.message);
  }
  const stdout = result.stdout?.toString("utf8") ?? "";
  const stderr = result.stderr?.toString("utf8") ?? "";
  let body;
  try {
    body = JSON.parse(stdout);
  } catch {
    throwRunnerError("plan_malformed", `${label} CLI did not emit JSON`);
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throwRunnerError("plan_malformed", `${label} CLI output must be a JSON object`);
  }
  const highWater = body.high_water;
  const rows = {
    total_candidate_count: body.total_candidate_count,
    classified_count: body.classified_count,
  };
  const ids = Array.isArray(body.entries)
    ? body.entries.flatMap((entry) =>
        isRecord(entry)
          ? [entry.source_event_id, entry.target_event_id, entry.replacement_event_id].filter(
              Boolean,
            )
          : [],
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
  const run = {
    fixture_sha256: fixtureSha256,
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
  assertP02RunSemantics(run, { fixture, label });
  return run;
}

function commandEnvironment(home) {
  return {
    CARPEOS_HOME: home,
    CARPEOS_TRUST_ZONE: "tz_synthetic",
    NODE_NO_WARNINGS: "1",
    HOME: home,
    NO_COLOR: "1",
    TZ: "UTC",
    PATH: process.env.PATH ?? "/usr/bin:/bin",
  };
}

export function readStoreObservation(home, observer) {
  const databasePath = resolve(home, "carpeos.sqlite");
  const ownsDatabase = observer === undefined;
  const database = observer ?? new DatabaseSync(databasePath, { readOnly: true });
  try {
    const counts = {};
    const tablePreimages = {};
    for (const [key, table] of Object.entries(ZERO_WRITE_TABLES)) {
      const rows = database.prepare(`SELECT * FROM ${table}`).all();
      const rowDigests = rows
        .map((row) => digestJson(normalizeSqlRow(row)))
        .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
      counts[key] = rowDigests.length;
      tablePreimages[key] = {
        count: rowDigests.length,
        row_digests: rowDigests,
        preimage_sha256: digestJson(rowDigests),
      };
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
    const dataVersion = Number(database.prepare("PRAGMA data_version").get().data_version);
    return {
      counts,
      highWater,
      table_preimages: tablePreimages,
      ...(ownsDatabase ? {} : { data_version: dataVersion }),
    };
  } finally {
    if (ownsDatabase) database.close();
  }
}

/**
 * Compare immutable table preimages, not just row counts. Every observation is
 * compared to the baseline so update/delete and write-then-delete changes that
 * restore the final count remain visible at the between snapshot.
 */
export function mutationProbeBetween(...observations) {
  if (observations.length < 2)
    throwRunnerError(
      "mutation_observation_missing",
      "at least two store observations are required",
    );
  const baseline = observations[0];
  const mutation = {};
  for (const key of Object.keys(ZERO_WRITE_TABLES)) {
    const changed = observations.slice(1).some((observation) => {
      const left = baseline?.table_preimages?.[key];
      const right = observation?.table_preimages?.[key];
      return (
        left === undefined ||
        right === undefined ||
        left.count !== right.count ||
        left.preimage_sha256 !== right.preimage_sha256 ||
        !equalJson(left.row_digests, right.row_digests) ||
        !equalRelevantHighWater(baseline.highWater, observation.highWater, key) ||
        (baseline.data_version !== undefined && observation?.data_version !== baseline.data_version)
      );
    });
    mutation[key] = changed ? 1 : 0;
  }
  return mutation;
}

export function buildMutationObservation({ before, between, after }) {
  return {
    before: summarizeStoreObservation(before),
    between: summarizeStoreObservation(between),
    after: summarizeStoreObservation(after),
  };
}

function summarizeStoreObservation(observation) {
  const summary = {
    high_water: observation.highWater,
    tables: Object.fromEntries(
      Object.entries(ZERO_WRITE_TABLES).map(([key]) => {
        const table = observation.table_preimages?.[key];
        if (table === undefined)
          throwRunnerError("mutation_observation_missing", `${key} preimage missing`);
        return [key, { ...table, row_digests: [...table.row_digests] }];
      }),
    ),
  };
  if (observation.data_version !== undefined) summary.data_version = observation.data_version;
  return summary;
}

function equalRelevantHighWater(left, right, tableKey) {
  if (!left || !right) return false;
  const fields = {
    canonical_events: ["canonical_local_sequence_max", "supersession_event_count"],
    review_rows: ["review_row_count"],
    disposition_rows: ["disposition_row_count"],
    outbox_rows: ["outbox_id_max"],
    protected_uploads: [],
  }[tableKey];
  return fields.every((field) => left[field] === right[field]);
}

function normalizeSqlRow(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, normalizeSqlValue(value)]),
  );
}

function normalizeSqlValue(value) {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Uint8Array) {
    return {
      blob_sha256: sha256Hex(Buffer.from(value)),
      byte_length: value.byteLength,
    };
  }
  if (Array.isArray(value)) return value.map((item) => normalizeSqlValue(item));
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, normalizeSqlValue(child)]),
    );
  return value;
}

function isFixtureSeeded(observation, fixture) {
  if (!observation || !fixture) return false;
  if (
    observation.counts.canonical_events !== fixture.expected.high_water.canonical_events ||
    observation.counts.review_rows !== fixture.expected.high_water.review_rows ||
    observation.counts.disposition_rows !== fixture.expected.high_water.disposition_rows ||
    observation.counts.outbox_rows !== fixture.expected.high_water.outbox_rows ||
    observation.counts.protected_uploads !== fixture.expected.high_water.protected_uploads
  )
    return false;
  return (
    observation.highWater.canonical_local_sequence_max ===
    fixture.expected.high_water.canonical_events
  );
}

function assertSeedProtectedValue(database, fixture) {
  const seed = fixture.disposable_store.canonical_events[0];
  const plaintext = Buffer.from("synthetic maintenance fixture", "utf8");
  const rows = database
    .prepare(
      `SELECT protected_value_id, vault_ref, key_ref, nonce_ref, tag_ref,
              nonce, tag, ciphertext, plaintext_digest, size_bytes, created_at
       FROM protected_values`,
    )
    .all();
  if (rows.length !== 1) {
    throwRunnerError("fixture_seed_preimage_mismatch", "protected seed row count is not one");
  }
  const actual = rows[0];
  if (
    actual.protected_value_id !== SEED_PROTECTED_VALUE_ID ||
    actual.vault_ref !== "vault_local" ||
    actual.key_ref !== "key_local_active" ||
    actual.nonce_ref !== "nonce_synthetic_maintenance_001" ||
    actual.tag_ref !== "tag_synthetic_maintenance_001" ||
    actual.plaintext_digest !== sha256Hex(plaintext) ||
    actual.size_bytes !== plaintext.byteLength ||
    actual.created_at !== seed.recorded_time ||
    !equalBytes(actual.nonce, Buffer.alloc(12, 0)) ||
    !equalBytes(actual.tag, Buffer.alloc(16, 0)) ||
    !equalBytes(actual.ciphertext, plaintext)
  ) {
    throwRunnerError(
      "fixture_seed_preimage_mismatch",
      "protected seed columns do not match the deterministic fixture seed",
    );
  }
}
function equalBytes(actual, expected) {
  return actual instanceof Uint8Array && Buffer.from(actual).equals(expected);
}
function assertSeedRow(database, fixture) {
  const seed = fixture.disposable_store.canonical_events[0];
  const row = database
    .prepare(
      `SELECT event_id, event_type, trust_zone_id, idempotency_key,
              request_fingerprint, protected_value_id, event_json, recorded_at
       FROM canonical_events`,
    )
    .all();
  if (row.length !== 1) {
    throwRunnerError("fixture_seed_preimage_mismatch", "canonical seed row count is not one");
  }
  const actual = row[0];
  if (
    actual.event_id !== seed.event_id ||
    actual.event_type !== seed.event_type ||
    actual.trust_zone_id !== seed.trust_zone_id ||
    actual.idempotency_key !== SEED_IDEMPOTENCY_KEY ||
    actual.protected_value_id !== SEED_PROTECTED_VALUE_ID ||
    actual.recorded_at !== seed.recorded_time ||
    actual.request_fingerprint !== digestJson(seed)
  ) {
    throwRunnerError(
      "fixture_seed_preimage_mismatch",
      "canonical seed columns do not match fixture",
    );
  }
  let event;
  try {
    event = JSON.parse(actual.event_json);
  } catch {
    throwRunnerError("fixture_seed_preimage_mismatch", "canonical seed event_json is not JSON");
  }
  if (digestJson(event) !== digestJson(seed)) {
    throwRunnerError(
      "fixture_seed_preimage_mismatch",
      "canonical seed event_json does not match fixture",
    );
  }
}
function assertSeedObservation(observation, fixture) {
  const expectedHighWater = fixtureHighWater(fixture);
  if (!equalJson(observation.highWater, expectedHighWater)) {
    throwRunnerError(
      "fixture_seed_high_water_mismatch",
      "seeded fixture high-water does not match expected values",
    );
  }
  const expectedCounts = {
    canonical_events: fixture.expected.high_water.canonical_events,
    review_rows: fixture.expected.high_water.review_rows,
    disposition_rows: fixture.expected.high_water.disposition_rows,
    outbox_rows: fixture.expected.high_water.outbox_rows,
    protected_uploads: fixture.expected.high_water.protected_uploads,
  };
  if (!equalJson(observation.counts, expectedCounts)) {
    throwRunnerError(
      "fixture_seed_preimage_mismatch",
      "seeded fixture table counts do not match expected values",
    );
  }
}

function throwRunnerError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.name = "P02RunnerError";
  error.code = code;
  throw error;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
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
