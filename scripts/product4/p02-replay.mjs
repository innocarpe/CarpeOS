import {
  digestJson,
  MAINTENANCE_STUDY_FIXTURE_SHA256,
  PRODUCT4_CONTEXT,
  PRODUCT4_POLICY_SHA256,
  readMaintenanceStudyFixture,
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
const OPTIONAL_RECEIPT_KEYS = ["fixture_verification", "mutation_observation"];
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
const FIXTURE_KEYS = [
  "fixture_type",
  "fixture_id",
  "repository_id",
  "trust_zone_id",
  "from_policy",
  "to_policy",
  "limit",
  "command_line",
  "disposable_store",
  "expected",
];
const FIXTURE_EVENT_KEYS = [
  "event_id",
  "event_type",
  "policy_version",
  "trust_zone_id",
  "recorded_time",
  "source_ref",
];
const FIXTURE_VERIFICATION_KEYS = [
  "fixture_sha256",
  "seed_preimage_sha256",
  "seed_event_id",
  "expected_high_water",
];
const PLAN_KEYS = [
  "schema",
  "trust_zone_id",
  "from_policy",
  "to_policy",
  "limit",
  "total_candidate_count",
  "classified_count",
  "truncated",
  "high_water",
  "counts",
  "plan_admissible",
  "global_taint_reason_codes",
  "global_taint_component_ids",
  "global_taint_entry_ids",
  "entries",
  "plan_digest",
];
const TABLE_PREIMAGE_KEYS = ["count", "preimage_sha256", "row_digests"];
const STORE_OBSERVATION_KEYS = ["high_water", "tables", "data_version"];

export function loadP02Fixture() {
  let fixture;
  try {
    fixture = readMaintenanceStudyFixture();
  } catch (error) {
    throwP02Error(
      "fixture_unavailable",
      error instanceof Error ? error.message : "maintenance fixture could not be loaded",
    );
  }
  assertP02Fixture(fixture);
  const fixtureSha256 = digestJson(fixture);
  if (fixtureSha256 !== MAINTENANCE_STUDY_FIXTURE_SHA256) {
    throwP02Error(
      "fixture_digest_mismatch",
      "maintenance fixture digest does not match the frozen Product 4 fixture",
    );
  }
  return { fixture, fixtureSha256 };
}

export function assertP02Fixture(fixture) {
  if (!isRecord(fixture)) throwP02Error("fixture_invalid", "maintenance fixture must be an object");
  const errors = [];
  assertExactKeys(fixture, FIXTURE_KEYS, "fixture", errors);
  if (fixture.fixture_type !== "carpeos.product4-maintenance-study/v2")
    errors.push("fixture_type is invalid");
  if (fixture.fixture_id !== "maintenance-study-v2") errors.push("fixture_id is invalid");
  if (fixture.repository_id !== 1315097793) errors.push("repository_id is invalid");
  if (fixture.trust_zone_id !== "tz_synthetic") errors.push("trust_zone_id is invalid");
  if (fixture.from_policy !== "adj_v1") errors.push("from_policy is invalid");
  if (fixture.to_policy !== "adj_v3") errors.push("to_policy is invalid");
  if (fixture.limit !== 100) errors.push("limit is invalid");
  if (fixture.command_line !== P02_COMMAND_LINE) errors.push("command_line is invalid");

  if (!isRecord(fixture.disposable_store)) {
    errors.push("disposable_store is required");
  } else {
    assertExactKeys(
      fixture.disposable_store,
      ["canonical_events", "review_rows", "disposition_rows", "outbox_rows"],
      "disposable_store",
      errors,
    );
    const seedEvents = fixture.disposable_store.canonical_events;
    if (!Array.isArray(seedEvents) || seedEvents.length !== 1) {
      errors.push("fixture_seed_missing: disposable_store must contain exactly one canonical seed");
    } else {
      const seed = seedEvents[0];
      if (!isRecord(seed)) {
        errors.push("fixture_seed_invalid: canonical seed must be an object");
      } else {
        assertExactKeys(seed, FIXTURE_EVENT_KEYS, "fixture_seed", errors);
        if (seed.event_id !== "evt_synthetic_maintenance_001")
          errors.push("fixture_seed_invalid: event_id is invalid");
        if (seed.event_type !== "Observation")
          errors.push("fixture_seed_invalid: event_type must be Observation");
        if (seed.policy_version !== "adj_v1")
          errors.push("fixture_seed_invalid: policy_version is invalid");
        if (seed.trust_zone_id !== "tz_synthetic")
          errors.push("fixture_seed_invalid: trust_zone_id is invalid");
        if (seed.recorded_time !== "2026-01-02T00:00:00Z")
          errors.push("fixture_seed_invalid: recorded_time is invalid");
        if (seed.source_ref !== "synthetic_maintenance_seed_001")
          errors.push("fixture_seed_invalid: source_ref is invalid");
      }
    }
    for (const key of ["review_rows", "disposition_rows", "outbox_rows"]) {
      if (
        !Array.isArray(fixture.disposable_store[key]) ||
        fixture.disposable_store[key].length !== 0
      )
        errors.push(`disposable_store.${key} must be empty`);
    }
  }

  if (!isRecord(fixture.expected)) {
    errors.push("expected is required");
  } else {
    assertExactKeys(
      fixture.expected,
      [
        "diagnosis",
        "outcome",
        "analog_available",
        "state_transition",
        "exit_code",
        "stderr",
        "zero_write",
        "high_water",
      ],
      "expected",
      errors,
    );
    if (fixture.expected.diagnosis !== "no_analog") errors.push("expected diagnosis is invalid");
    if (fixture.expected.outcome !== "blocked_no_apply") errors.push("expected outcome is invalid");
    if (fixture.expected.analog_available !== false)
      errors.push("expected analog_available must be false");
    if (fixture.expected.state_transition !== "none_supported")
      errors.push("expected state_transition is invalid");
    if (fixture.expected.exit_code !== 0) errors.push("expected exit_code must be zero");
    if (fixture.expected.stderr !== "") errors.push("expected stderr must be empty");
    if (fixture.expected.zero_write !== true) errors.push("expected zero_write must be true");
    if (!isRecord(fixture.expected.high_water)) {
      errors.push("expected.high_water is required");
    } else {
      const expectedHighWaterKeys = [
        "canonical_events",
        "review_rows",
        "disposition_rows",
        "outbox_rows",
        "protected_uploads",
      ];
      assertExactKeys(
        fixture.expected.high_water,
        expectedHighWaterKeys,
        "expected.high_water",
        errors,
      );
      for (const key of expectedHighWaterKeys) {
        if (!isSafeNonNegativeInteger(fixture.expected.high_water[key]))
          errors.push(`expected.high_water.${key} must be a non-negative safe integer`);
      }
    }
  }
  assertNoForbiddenKeys(fixture, errors);
  if (errors.length > 0) throwP02Error("fixture_invalid", errors.join("; "));
  return fixture;
}

export function buildP02Receipt({
  runA,
  runB,
  mutationProbe,
  fixtureSha256 = MAINTENANCE_STUDY_FIXTURE_SHA256,
  fixture,
  mutationObservation,
  strict = fixture !== undefined || mutationObservation !== undefined,
}) {
  const strictReceipt = strict || fixture !== undefined || mutationObservation !== undefined;
  let fixtureForVerification;
  if (strictReceipt) {
    fixtureForVerification = fixture === undefined ? loadP02Fixture().fixture : fixture;
    assertP02Fixture(fixtureForVerification);
    const computedFixtureSha256 = digestJson(fixtureForVerification);
    if (computedFixtureSha256 !== fixtureSha256)
      throwP02Error("fixture_digest_mismatch", "fixture preimage does not match fixture_sha256");
    if (computedFixtureSha256 !== MAINTENANCE_STUDY_FIXTURE_SHA256)
      throwP02Error("fixture_digest_mismatch", "fixture is not the frozen Product 4 fixture");
  }

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
  if (strictReceipt) {
    assertP02RunSemantics(runA, { fixture: fixtureForVerification, label: "runA" });
    assertP02RunSemantics(runB, { fixture: fixtureForVerification, label: "runB" });
    if (mutationObservation === undefined)
      throwP02Error("mutation_observation_missing", "strict P02 receipts require table preimages");
    assertMutationObservation(mutationObservation);
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

  const unsigned = {
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
    ...(strictReceipt
      ? {
          fixture_verification: buildFixtureVerification(fixtureForVerification, fixtureSha256),
          mutation_observation: mutationObservation,
        }
      : {}),
  };
  return { ...unsigned, receipt_digest: digestJson(unsigned) };
}

export function assertP02Receipt(receipt) {
  if (!isRecord(receipt)) throwP02Error("invalid_receipt", "receipt must be an object");

  const currentFixture = loadP02Fixture();
  const errors = [];
  const strictReceipt =
    receipt.fixture_verification !== undefined || receipt.mutation_observation !== undefined;
  assertExactKeys(receipt, [...RECEIPT_KEYS, ...OPTIONAL_RECEIPT_KEYS], "receipt", errors);
  if (receipt.schema_version !== P02_SCHEMA_VERSION) errors.push("schema_version is invalid");
  if (receipt.policy_sha256 !== PRODUCT4_POLICY_SHA256) errors.push("policy_sha256 is not P4_0");
  if (receipt.context !== PRODUCT4_CONTEXT) errors.push("context is not frozen");
  if (receipt.fixture_sha256 !== currentFixture.fixtureSha256)
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
      assertRun(run, label, currentFixture.fixtureSha256);
      const parsed = parseJsonOutput(run.stdout_bytes);
      if (parsed?.schema === "carpeos.policy-reconciliation-plan/v2") {
        if (strictReceipt || Object.keys(parsed).length === PLAN_KEYS.length) {
          assertP02RunSemantics(run, { fixture: currentFixture.fixture, label });
        }
      }
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

  if (strictReceipt) {
    if (receipt.fixture_verification === undefined) {
      errors.push("fixture_verification is required for strict receipts");
    } else {
      try {
        assertFixtureVerification(
          receipt.fixture_verification,
          currentFixture.fixture,
          currentFixture.fixtureSha256,
        );
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "fixture_verification is invalid");
      }
    }
    if (receipt.mutation_observation === undefined) {
      errors.push("mutation_observation is required for strict receipts");
    } else {
      try {
        assertMutationObservation(receipt.mutation_observation);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "mutation_observation is invalid");
      }
    }
  }

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

export function assertP02RunSemantics(run, { fixture, label = "run" } = {}) {
  const fixtureInfo =
    fixture === undefined ? loadP02Fixture() : { fixture, fixtureSha256: digestJson(fixture) };
  assertP02Fixture(fixtureInfo.fixture);
  if (fixtureInfo.fixtureSha256 !== MAINTENANCE_STUDY_FIXTURE_SHA256)
    throwP02Error("fixture_digest_mismatch", `${label} fixture is not frozen`);
  assertRun(run, label, fixtureInfo.fixtureSha256);
  if (run.command_bytes !== fixtureInfo.fixture.command_line)
    throwP02Error("command_mismatch", `${label} command does not match the fixture`);
  if (run.exit_code !== fixtureInfo.fixture.expected.exit_code)
    throwP02Error("result_mismatch", `${label} exit code does not match the fixture`);
  if (run.stderr_bytes !== fixtureInfo.fixture.expected.stderr)
    throwP02Error("result_mismatch", `${label} stderr does not match the fixture`);

  const body = parseJsonOutput(run.stdout_bytes);
  if (!isRecord(body))
    throwP02Error("plan_malformed", `${label} stdout must contain a JSON object`);
  assertExactKeysOrThrow(body, PLAN_KEYS, `${label}.plan`);
  if (body.schema !== "carpeos.policy-reconciliation-plan/v2")
    throwP02Error("plan_malformed", `${label} plan schema is invalid`);
  if (body.trust_zone_id !== fixtureInfo.fixture.trust_zone_id)
    throwP02Error("result_mismatch", `${label} trust zone does not match the fixture`);
  if (body.from_policy !== fixtureInfo.fixture.from_policy)
    throwP02Error("result_mismatch", `${label} from_policy does not match the fixture`);
  if (body.to_policy !== fixtureInfo.fixture.to_policy)
    throwP02Error("result_mismatch", `${label} to_policy does not match the fixture`);
  if (body.limit !== fixtureInfo.fixture.limit)
    throwP02Error("result_mismatch", `${label} limit does not match the fixture`);
  if (!PLAN_DIGEST.test(body.plan_digest ?? "") || body.plan_digest !== run.plan_digest)
    throwP02Error("plan_digest_mismatch", `${label} plan digest is missing or forged`);
  const unsignedPlan = { ...body };
  delete unsignedPlan.plan_digest;
  if (`sha256:${digestJson(unsignedPlan)}` !== body.plan_digest)
    throwP02Error("plan_digest_mismatch", `${label} plan digest preimage does not match stdout`);

  const expectedHighWater = fixtureHighWater(fixtureInfo.fixture);
  if (
    !equalJson(body.high_water, expectedHighWater) ||
    !equalJson(run.high_water, expectedHighWater)
  )
    throwP02Error("high_water_mismatch", `${label} high-water does not match the seeded fixture`);
  if (!isSafeNonNegativeInteger(body.total_candidate_count) || body.total_candidate_count !== 0)
    throwP02Error("result_mismatch", `${label} total_candidate_count is not the seeded result`);
  if (!isSafeNonNegativeInteger(body.classified_count) || body.classified_count !== 0)
    throwP02Error("result_mismatch", `${label} classified_count is not the seeded result`);
  if (body.truncated !== false)
    throwP02Error("result_mismatch", `${label} plan is unexpectedly truncated`);
  if (body.plan_admissible !== true)
    throwP02Error("result_mismatch", `${label} plan is not admissible`);
  if (!Array.isArray(body.entries) || body.entries.length !== 0)
    throwP02Error("entry_identity_mismatch", `${label} emitted unexpected reconciliation entries`);
  if (
    !equalJson(body.counts, {
      eligible_write_count: 0,
      eligible_noop_count: 0,
      unsafe_unchanged_count: 0,
      replace_count: 0,
      invalidate_count: 0,
      already_applied_count: 0,
      reason_code_counts: [],
    })
  )
    throwP02Error("result_mismatch", `${label} counts are not the seeded no-analog result`);
  if (
    !Array.isArray(body.global_taint_reason_codes) ||
    body.global_taint_reason_codes.length !== 0 ||
    !Array.isArray(body.global_taint_component_ids) ||
    body.global_taint_component_ids.length !== 0 ||
    !Array.isArray(body.global_taint_entry_ids) ||
    body.global_taint_entry_ids.length !== 0
  )
    throwP02Error("entry_identity_mismatch", `${label} emitted unexpected global identities`);
  if (!equalJson(run.rows, { total_candidate_count: 0, classified_count: 0 }))
    throwP02Error("result_mismatch", `${label} row counts do not match stdout`);
  if (!Array.isArray(run.ids) || run.ids.length !== 0)
    throwP02Error("entry_identity_mismatch", `${label} IDs do not match stdout`);
  return body;
}

export function fixtureHighWater(fixture) {
  assertP02Fixture(fixture);
  return {
    canonical_local_sequence_max: fixture.expected.high_water.canonical_events,
    disposition_row_count: fixture.expected.high_water.disposition_rows,
    review_row_count: fixture.expected.high_water.review_rows,
    outbox_id_max: fixture.expected.high_water.outbox_rows,
    supersession_event_count: 0,
  };
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
  parseJsonOutput(run.stdout_bytes);
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
  return run;
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

function assertMutationObservation(value) {
  if (!isRecord(value))
    throwP02Error("mutation_observation_invalid", "mutation observation is required");
  assertExactKeysOrThrow(value, ["before", "between", "after"], "mutation_observation");
  for (const label of ["before", "between", "after"]) {
    const observation = value[label];
    if (!isRecord(observation))
      throwP02Error("mutation_observation_invalid", `${label} observation is invalid`);
    assertExactKeysOrThrow(observation, STORE_OBSERVATION_KEYS, `mutation_observation.${label}`);
    assertExactKeysOrThrow(observation.high_water, HIGH_WATER_KEYS, `${label}.high_water`);
    for (const key of HIGH_WATER_KEYS)
      if (!isSafeNonNegativeInteger(observation.high_water[key]))
        throwP02Error("mutation_observation_invalid", `${label}.high_water.${key} is invalid`);
    if (!isSafeNonNegativeInteger(observation.data_version))
      throwP02Error("mutation_observation_invalid", `${label}.data_version is invalid`);
    assertExactKeysOrThrow(observation.tables, ZERO_WRITE_KEYS, `${label}.tables`);
    for (const key of ZERO_WRITE_KEYS) {
      const table = observation.tables[key];
      assertExactKeysOrThrow(table, TABLE_PREIMAGE_KEYS, `${label}.tables.${key}`);
      if (!isSafeNonNegativeInteger(table.count))
        throwP02Error("mutation_observation_invalid", `${label}.tables.${key}.count is invalid`);
      if (!SHA256.test(table.preimage_sha256 ?? ""))
        throwP02Error(
          "mutation_observation_invalid",
          `${label}.tables.${key}.preimage_sha256 is invalid`,
        );
      if (
        !Array.isArray(table.row_digests) ||
        table.row_digests.length !== table.count ||
        table.row_digests.some((digest) => !SHA256.test(digest))
      )
        throwP02Error(
          "mutation_observation_invalid",
          `${label}.tables.${key}.row_digests is invalid`,
        );
      if (digestJson(table.row_digests) !== table.preimage_sha256)
        throwP02Error(
          "mutation_observation_invalid",
          `${label}.tables.${key}.preimage_sha256 does not match row digests`,
        );
    }
  }
  const first = value.before;
  for (const label of ["between", "after"]) {
    const current = value[label];
    if (
      first.data_version !== current.data_version ||
      !equalJson(first.high_water, current.high_water) ||
      !equalJson(first.tables, current.tables)
    )
      throwP02Error("mutation_detected", `store preimage changed ${label} P02 replay`);
  }
  return value;
}

function buildFixtureVerification(fixture, fixtureSha256) {
  const seed = fixture.disposable_store.canonical_events[0];
  return {
    fixture_sha256: fixtureSha256,
    seed_preimage_sha256: digestJson(seed),
    seed_event_id: seed.event_id,
    expected_high_water: fixtureHighWater(fixture),
  };
}

function assertFixtureVerification(value, fixture, fixtureSha256) {
  assertExactKeysOrThrow(value, FIXTURE_VERIFICATION_KEYS, "fixture_verification");
  const expected = buildFixtureVerification(fixture, fixtureSha256);
  if (!equalJson(value, expected))
    throwP02Error(
      "fixture_verification_invalid",
      "fixture verification does not match the loaded fixture",
    );
  return value;
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

function assertExactKeysOrThrow(value, allowedKeys, label) {
  if (!isRecord(value)) throwP02Error("plan_malformed", `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...allowedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throwP02Error("plan_malformed", `${label} keys are invalid`);
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

function parseJsonOutput(stdout) {
  if (typeof stdout !== "string") throwP02Error("plan_malformed", "P02 stdout is not text");
  try {
    return JSON.parse(stdout);
  } catch {
    throwP02Error("plan_malformed", "P02 stdout is not valid JSON");
  }
}

function throwP02Error(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.name = "P02ReplayError";
  error.code = code;
  throw error;
}
