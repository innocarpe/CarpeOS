import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, resolve } from "node:path";
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
import {
  canonicalJson,
  digestJson,
  MAINTENANCE_STUDY_FIXTURE_SHA256,
  PRODUCT4_CONTEXT,
  PRODUCT4_POLICY_SHA256,
  sha256Hex,
} from "./policy-identity.mjs";
export const P02_SANDBOX_RECEIPT_SCHEMA = "product4-sandbox-receipt-v1";
export const P02_SANDBOX_PROBE_SCHEMA = "carpeos.product4-sandbox-probe/v1";
export const P02_SANDBOX_CONTRACT = Object.freeze({
  backend: "bubblewrap",
  network: "disabled",
  candidate_inputs: "read_only",
  trusted_mounts: false,
  writable_paths: Object.freeze(["/home", "/output", "/tmp"]),
  capabilities: "dropped",
  no_new_privileges: true,
  process_limit: 64,
  memory_limit_mb: 1024,
});
const P02_SANDBOX_PROBE_KEYS = Object.freeze([
  "schema_version",
  "identity",
  "roots",
  "facts",
  "probe_digest",
]);
const P02_SANDBOX_PROBE_IDENTITY_KEYS = Object.freeze([
  "head_sha",
  "base_sha",
  "tree_sha256",
  "fixture_sha256",
  "policy_sha256",
  "context",
]);
const P02_SANDBOX_PROBE_ROOT_KEYS = Object.freeze([
  "candidate_root",
  "workspace_root",
  "cli_root",
  "home",
  "output",
]);
const P02_SANDBOX_PROBE_FACT_KEYS = Object.freeze([
  "network",
  "candidate_inputs",
  "trusted_mounts",
  "capabilities",
  "no_new_privileges",
  "writable_paths",
  "process_limit",
  "memory_limit_mb",
]);
const P02_SANDBOX_RECEIPT_KEYS = Object.freeze([
  "schema_version",
  "backend",
  "candidate_root",
  "head_sha",
  "base_sha",
  "tree_sha256",
  "fixture_sha256",
  "policy_sha256",
  "context",
  "network",
  "candidate_inputs",
  "trusted_mounts",
  "writable_paths",
  "capabilities",
  "no_new_privileges",
  "process_limit",
  "memory_limit_mb",
  "observed_probe",
  "probe_sha256",
  "sandbox_command_digest",
  "receipt_digest",
]);
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ZERO_CAP = "0000000000000000";
const MEMORY_LIMIT_BYTES = P02_SANDBOX_CONTRACT.memory_limit_mb * 1024 * 1024;
const FROZEN_IDENTITY = Object.freeze({
  fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
  policy_sha256: PRODUCT4_POLICY_SHA256,
  context: PRODUCT4_CONTEXT,
});
const SANDBOX_ROOT_LABELS = Object.freeze([
  "candidate_root",
  "workspace_root",
  "cli_root",
  "home",
  "output",
]);
const PROBE_DIGEST_KEYS = Object.freeze(
  P02_SANDBOX_PROBE_KEYS.filter((key) => key !== "probe_digest"),
);
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
export function sandboxCommandDigest() {
  return digestJson(P02_SANDBOX_CONTRACT);
}

/**
 * Validate the exact in-sandbox observation record. A digest-only claim cannot
 * establish the controls used for a replay, so the complete record is required.
 */
export function assertSandboxProbeObservation(probe, { allowMissingDigest = false } = {}) {
  if (!isRecord(probe))
    throwRunnerError("sandbox_probe_missing", "sandbox probe observation is required");
  const keys = Object.keys(probe);
  const requiredKeys = allowMissingDigest ? PROBE_DIGEST_KEYS : P02_SANDBOX_PROBE_KEYS;
  if (
    keys.length !== requiredKeys.length ||
    requiredKeys.some((key) => !Object.hasOwn(probe, key)) ||
    keys.some((key) => !requiredKeys.includes(key))
  )
    throwRunnerError("sandbox_probe_forged", "sandbox probe fields are not exact");
  if (probe.schema_version !== P02_SANDBOX_PROBE_SCHEMA)
    throwRunnerError("sandbox_probe_forged", "sandbox probe schema is invalid");

  assertProbeIdentity(probe.identity);
  assertProbeRoots(probe.roots);
  assertProbeFacts(probe.facts);

  if (!allowMissingDigest) {
    assertSha(probe.probe_digest, SHA256, "sandbox probe probe_digest");
    if (probe.probe_digest !== digestSandboxProbe(probe))
      throwRunnerError("sandbox_probe_forged", "sandbox probe digest is invalid");
  }
  return probe;
}

function assertProbeIdentity(identity) {
  assertExactObject(identity, P02_SANDBOX_PROBE_IDENTITY_KEYS, "sandbox probe identity");
  assertSha(identity.head_sha, SHA1, "sandbox probe head_sha");
  assertSha(identity.base_sha, SHA1, "sandbox probe base_sha");
  assertSha(identity.tree_sha256, SHA256, "sandbox probe tree_sha256");
  if (
    identity.fixture_sha256 !== FROZEN_IDENTITY.fixture_sha256 ||
    identity.policy_sha256 !== FROZEN_IDENTITY.policy_sha256 ||
    identity.context !== FROZEN_IDENTITY.context
  )
    throwRunnerError(
      "sandbox_probe_forged",
      "sandbox probe fixture, policy, and context identity is not frozen",
    );
}

function assertProbeRoots(roots) {
  assertExactObject(roots, P02_SANDBOX_PROBE_ROOT_KEYS, "sandbox probe roots");
  const canonical = {};
  for (const label of P02_SANDBOX_PROBE_ROOT_KEYS)
    canonical[label] = assertRegularDirectoryRoot(
      roots[label],
      `sandbox probe ${label}`,
      "sandbox_probe_forged",
    );
  for (const left of SANDBOX_ROOT_LABELS) {
    for (const right of SANDBOX_ROOT_LABELS) {
      if (left >= right) continue;
      if (left === "candidate_root" && right === "workspace_root") continue;
      if (pathsOverlap(canonical[left], canonical[right]))
        throwRunnerError(
          "sandbox_probe_forged",
          `sandbox probe ${left} and ${right} roots overlap`,
        );
    }
  }
  return canonical;
}

function assertProbeFacts(facts) {
  assertExactObject(facts, P02_SANDBOX_PROBE_FACT_KEYS, "sandbox probe facts");
  if (
    facts.network !== P02_SANDBOX_CONTRACT.network ||
    facts.candidate_inputs !== P02_SANDBOX_CONTRACT.candidate_inputs ||
    facts.trusted_mounts !== P02_SANDBOX_CONTRACT.trusted_mounts ||
    facts.capabilities !== P02_SANDBOX_CONTRACT.capabilities ||
    facts.no_new_privileges !== P02_SANDBOX_CONTRACT.no_new_privileges ||
    facts.process_limit !== P02_SANDBOX_CONTRACT.process_limit ||
    facts.memory_limit_mb !== P02_SANDBOX_CONTRACT.memory_limit_mb ||
    !Array.isArray(facts.writable_paths) ||
    facts.writable_paths.length !== P02_SANDBOX_CONTRACT.writable_paths.length ||
    facts.writable_paths.some((path, index) => path !== P02_SANDBOX_CONTRACT.writable_paths[index])
  )
    throwRunnerError("sandbox_probe_forged", "sandbox probe facts do not match the fixed contract");
  if (new Set(facts.writable_paths).size !== facts.writable_paths.length)
    throwRunnerError("sandbox_probe_forged", "sandbox probe writable paths are not exact");
  if (typeof facts.no_new_privileges !== "boolean")
    throwRunnerError(
      "sandbox_probe_forged",
      "sandbox probe no-new-privileges observation is invalid",
    );
  if (!Number.isSafeInteger(facts.process_limit) || facts.process_limit <= 0)
    throwRunnerError("sandbox_probe_forged", "sandbox probe process limit observation is invalid");
  if (!Number.isSafeInteger(facts.memory_limit_mb) || facts.memory_limit_mb <= 0)
    throwRunnerError("sandbox_probe_forged", "sandbox probe memory limit observation is invalid");
}

function assertExactObject(value, expectedKeys, label) {
  if (!isRecord(value)) throwRunnerError("sandbox_probe_forged", `${label} is required`);
  const keys = Object.keys(value);
  if (
    keys.length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.hasOwn(value, key)) ||
    keys.some((key) => !expectedKeys.includes(key))
  )
    throwRunnerError("sandbox_probe_forged", `${label} fields are not exact`);
}

function digestSandboxProbe(probe) {
  const unsigned = Object.fromEntries(PROBE_DIGEST_KEYS.map((key) => [key, probe[key]]));
  return digestJson(unsigned);
}

/**
 * Digest a validated observation. A caller may use this to seal a complete
 * record before passing it to buildP02SandboxReceipt; a digest-only call is
 * refused.
 */
export function sandboxProbeDigest(probe) {
  if (probe === undefined)
    throwRunnerError(
      "sandbox_probe_missing",
      "sandbox probe digest requires an observed probe object",
    );
  const unsignedProbe = { ...probe };
  delete unsignedProbe.probe_digest;
  assertSandboxProbeObservation(unsignedProbe, { allowMissingDigest: true });
  return digestSandboxProbe(unsignedProbe);
}

/**
 * Collect the contract facts from inside the sandbox. The caller must provide
 * the exact identity and host roots that are sealed into the observation.
 */
export function collectSandboxProbeObservation({
  identity,
  roots,
  candidateProbePath = "/candidate/.product4-probe-write-test",
  writableProbePaths = [...P02_SANDBOX_CONTRACT.writable_paths],
} = {}) {
  let status;
  let limits;
  try {
    status = readFileSync("/proc/self/status", "utf8");
    limits = readFileSync("/proc/self/limits", "utf8");
    // /proc/self/ns/net is a symlink whose target is "net:[inode]" — not a
    // resolvable path. readlink preserves the observed namespace identity.
    readlinkSync("/proc/self/ns/net");
    readFileSync("/proc/self/mountinfo", "utf8");
  } catch (error) {
    throwRunnerError(
      "sandbox_probe_unobserved",
      `sandbox controls could not be observed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const noNewPrivsMatch = status.match(/^NoNewPrivs:\t([01])$/m);
  const capEffMatch = status.match(/^CapEff:\t([0-9a-fA-F]+)$/m);
  const nprocMatch = limits.match(/^Max processes\s+(\S+)\s+(\S+)\s+processes\s*$/m);
  const asMatch = limits.match(/^Max address space\s+(\S+)\s+(\S+)\s+bytes\s*$/m);
  if (!noNewPrivsMatch || !capEffMatch || !nprocMatch || !asMatch)
    throwRunnerError("sandbox_probe_unobserved", "sandbox control rows were not observed");

  let candidateWriteRefused = false;
  try {
    writeFileSync(candidateProbePath, "should-fail\n", { flag: "wx" });
  } catch {
    candidateWriteRefused = true;
  }
  if (!candidateWriteRefused)
    throwRunnerError("sandbox_probe_unobserved", "candidate root accepted a write");

  const writableResults = {};
  const writableErrors = {};
  for (const path of writableProbePaths) {
    try {
      writeFileSync(`${path}/.product4-probe-write-test`, "ok\n", { flag: "w" });
      writableResults[path] = true;
    } catch (error) {
      writableResults[path] = false;
      writableErrors[path] = error instanceof Error ? error.message : String(error);
    }
  }
  if (
    writableProbePaths.length !== P02_SANDBOX_CONTRACT.writable_paths.length ||
    writableProbePaths.some((path, index) => path !== P02_SANDBOX_CONTRACT.writable_paths[index]) ||
    Object.values(writableResults).some((value) => value !== true)
  )
    throwRunnerError(
      "sandbox_probe_unobserved",
      `writable path observations are incomplete: ${JSON.stringify({ writableResults, writableErrors })}`,
    );

  const processLimit = parseSoftLimit(nprocMatch[1], "process");
  const memoryBytes = parseSoftLimit(asMatch[1], "memory");
  if (noNewPrivsMatch[1] !== "1" || capEffMatch[1].toLowerCase() !== ZERO_CAP)
    throwRunnerError("sandbox_probe_unobserved", "privilege controls were not observed");
  if (processLimit !== P02_SANDBOX_CONTRACT.process_limit)
    throwRunnerError(
      "sandbox_probe_unobserved",
      "process limit was not observed at the contract value",
    );
  if (memoryBytes !== MEMORY_LIMIT_BYTES)
    throwRunnerError(
      "sandbox_probe_unobserved",
      "memory limit was not observed at the contract value",
    );
  if (!isRecord(identity) || !isRecord(roots))
    throwRunnerError("sandbox_probe_unobserved", "probe identity and roots are required");

  const probe = {
    schema_version: P02_SANDBOX_PROBE_SCHEMA,
    identity,
    roots,
    facts: {
      network: P02_SANDBOX_CONTRACT.network,
      candidate_inputs: P02_SANDBOX_CONTRACT.candidate_inputs,
      trusted_mounts: P02_SANDBOX_CONTRACT.trusted_mounts,
      capabilities: P02_SANDBOX_CONTRACT.capabilities,
      no_new_privileges: true,
      writable_paths: [...P02_SANDBOX_CONTRACT.writable_paths],
      process_limit: processLimit,
      memory_limit_mb: Math.floor(memoryBytes / (1024 * 1024)),
    },
  };
  return {
    ...probe,
    probe_digest: sandboxProbeDigest(probe),
  };
}

/** Test/helper: build a complete observed record from explicit identity and roots. */
export function buildSandboxProbeObservation({ identity, roots, facts = {} } = {}) {
  const probe = {
    schema_version: P02_SANDBOX_PROBE_SCHEMA,
    identity,
    roots,
    facts: {
      network: P02_SANDBOX_CONTRACT.network,
      candidate_inputs: P02_SANDBOX_CONTRACT.candidate_inputs,
      trusted_mounts: P02_SANDBOX_CONTRACT.trusted_mounts,
      capabilities: P02_SANDBOX_CONTRACT.capabilities,
      no_new_privileges: P02_SANDBOX_CONTRACT.no_new_privileges,
      writable_paths: [...P02_SANDBOX_CONTRACT.writable_paths],
      process_limit: P02_SANDBOX_CONTRACT.process_limit,
      memory_limit_mb: P02_SANDBOX_CONTRACT.memory_limit_mb,
      ...facts,
    },
  };
  return {
    ...probe,
    probe_digest: sandboxProbeDigest(probe),
  };
}

function parseSoftLimit(value, label) {
  if (value === "unlimited")
    throwRunnerError("sandbox_probe_unobserved", `${label} soft limit is unlimited`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throwRunnerError("sandbox_probe_unobserved", `${label} soft limit is invalid`);
  return parsed;
}

export function buildP02SandboxReceipt({
  candidateRoot,
  workspaceRoot,
  cliRoot,
  home,
  output,
  headSha,
  baseSha,
  treeSha256,
  fixtureSha256,
  policySha256,
  context,
  observedProbe,
  probe,
  probeSha256,
}) {
  if (typeof candidateRoot !== "string" || candidateRoot.length === 0)
    throwRunnerError("sandbox_receipt_invalid", "candidate root is required");
  if (observedProbe !== undefined && probe !== undefined && observedProbe !== probe)
    throwRunnerError("sandbox_probe_forged", "sandbox probe aliases are ambiguous");
  const suppliedProbe = observedProbe ?? probe;
  if (!isRecord(suppliedProbe))
    throwRunnerError(
      "sandbox_probe_missing",
      "sandbox receipt requires an observed probe object; bare probe hashes are refused",
    );
  const probeRecord = { ...suppliedProbe };
  if (!Object.hasOwn(probeRecord, "probe_digest"))
    probeRecord.probe_digest = sandboxProbeDigest(probeRecord);
  assertSandboxProbeObservation(probeRecord);

  assertSha(headSha, SHA1, "head_sha");
  assertSha(baseSha, SHA1, "base_sha");
  assertSha(treeSha256, SHA256, "tree_sha256");
  const expectedIdentity = {
    head_sha: headSha,
    base_sha: baseSha,
    tree_sha256: treeSha256,
    fixture_sha256: fixtureSha256 ?? FROZEN_IDENTITY.fixture_sha256,
    policy_sha256: policySha256 ?? FROZEN_IDENTITY.policy_sha256,
    context: context ?? FROZEN_IDENTITY.context,
  };
  assertProbeIdentity(expectedIdentity);
  for (const key of P02_SANDBOX_PROBE_IDENTITY_KEYS) {
    if (probeRecord.identity[key] !== expectedIdentity[key])
      throwRunnerError("sandbox_receipt_forged", `sandbox probe ${key} is not identity-bound`);
  }

  const expectedRoots = {
    ...probeRecord.roots,
    ...(workspaceRoot === undefined ? {} : { workspace_root: workspaceRoot }),
    ...(cliRoot === undefined ? {} : { cli_root: cliRoot }),
    ...(home === undefined ? {} : { home }),
    ...(output === undefined ? {} : { output }),
  };
  const canonicalCandidate = assertRegularDirectoryRoot(candidateRoot, "candidate root");
  const observedRoots = {};
  for (const key of P02_SANDBOX_PROBE_ROOT_KEYS) {
    const expected = assertRegularDirectoryRoot(expectedRoots[key], `sandbox ${key}`);
    const observed = assertRegularDirectoryRoot(probeRecord.roots[key], `sandbox probe ${key}`);
    observedRoots[key] = observed;
    if (expected !== observed)
      throwRunnerError(
        "sandbox_receipt_forged",
        `sandbox receipt ${key} is not bound to the observed root`,
      );
  }
  if (observedRoots.candidate_root !== canonicalCandidate)
    throwRunnerError(
      "sandbox_receipt_forged",
      "sandbox receipt is bound to another candidate root",
    );

  if (probeSha256 !== undefined) {
    assertSha(probeSha256, SHA256, "probe_sha256");
    if (probeSha256 !== probeRecord.probe_digest)
      throwRunnerError("sandbox_receipt_forged", "probe hash does not match observed probe digest");
  }
  const unsigned = {
    schema_version: P02_SANDBOX_RECEIPT_SCHEMA,
    backend: P02_SANDBOX_CONTRACT.backend,
    candidate_root: canonicalCandidate,
    head_sha: expectedIdentity.head_sha,
    base_sha: expectedIdentity.base_sha,
    tree_sha256: expectedIdentity.tree_sha256,
    fixture_sha256: expectedIdentity.fixture_sha256,
    policy_sha256: expectedIdentity.policy_sha256,
    context: expectedIdentity.context,
    network: P02_SANDBOX_CONTRACT.network,
    candidate_inputs: P02_SANDBOX_CONTRACT.candidate_inputs,
    trusted_mounts: P02_SANDBOX_CONTRACT.trusted_mounts,
    writable_paths: [...P02_SANDBOX_CONTRACT.writable_paths],
    capabilities: P02_SANDBOX_CONTRACT.capabilities,
    no_new_privileges: P02_SANDBOX_CONTRACT.no_new_privileges,
    process_limit: P02_SANDBOX_CONTRACT.process_limit,
    memory_limit_mb: P02_SANDBOX_CONTRACT.memory_limit_mb,
    observed_probe: probeRecord,
    probe_sha256: probeRecord.probe_digest,
    sandbox_command_digest: sandboxCommandDigest(),
  };
  return { ...unsigned, receipt_digest: digestJson(unsigned) };
}

export function assertP02SandboxReceipt(
  receipt,
  {
    candidateRoot,
    workspaceRoot,
    cliRoot,
    home,
    output,
    headSha,
    baseSha,
    treeSha256,
    fixtureSha256,
    policySha256,
    context,
  } = {},
) {
  if (!isRecord(receipt))
    throwRunnerError("sandbox_receipt_missing", "trusted sandbox receipt is required");
  const keys = Object.keys(receipt);
  if (
    keys.length !== P02_SANDBOX_RECEIPT_KEYS.length ||
    P02_SANDBOX_RECEIPT_KEYS.some((key) => !Object.hasOwn(receipt, key)) ||
    keys.some((key) => !P02_SANDBOX_RECEIPT_KEYS.includes(key))
  )
    throwRunnerError("sandbox_receipt_forged", "sandbox receipt fields are not exact");
  if (receipt.schema_version !== P02_SANDBOX_RECEIPT_SCHEMA)
    throwRunnerError("sandbox_receipt_forged", "sandbox receipt schema is invalid");
  if (receipt.backend !== P02_SANDBOX_CONTRACT.backend)
    throwRunnerError("sandbox_receipt_forged", "sandbox backend is not bubblewrap");
  assertSha(receipt.head_sha, SHA1, "sandbox receipt head_sha");
  assertSha(receipt.base_sha, SHA1, "sandbox receipt base_sha");
  assertSha(receipt.tree_sha256, SHA256, "sandbox receipt tree_sha256");
  assertSha(receipt.probe_sha256, SHA256, "sandbox receipt probe_sha256");
  assertSandboxProbeObservation(receipt.observed_probe);
  if (receipt.probe_sha256 !== receipt.observed_probe.probe_digest)
    throwRunnerError("sandbox_receipt_forged", "sandbox probe hash is not observation-bound");
  const expectedIdentity = {
    head_sha: headSha ?? receipt.head_sha,
    base_sha: baseSha ?? receipt.base_sha,
    tree_sha256: treeSha256 ?? receipt.tree_sha256,
    fixture_sha256: fixtureSha256 ?? FROZEN_IDENTITY.fixture_sha256,
    policy_sha256: policySha256 ?? FROZEN_IDENTITY.policy_sha256,
    context: context ?? FROZEN_IDENTITY.context,
  };
  assertProbeIdentity({
    head_sha: receipt.head_sha,
    base_sha: receipt.base_sha,
    tree_sha256: receipt.tree_sha256,
    fixture_sha256: receipt.fixture_sha256,
    policy_sha256: receipt.policy_sha256,
    context: receipt.context,
  });
  for (const key of P02_SANDBOX_PROBE_IDENTITY_KEYS) {
    if (
      receipt[key] !== receipt.observed_probe.identity[key] ||
      receipt[key] !== expectedIdentity[key]
    )
      throwRunnerError("sandbox_receipt_forged", `sandbox receipt ${key} is not identity-bound`);
  }

  const canonicalCandidate = assertRegularDirectoryRoot(
    receipt.candidate_root,
    "sandbox candidate root",
  );
  if (candidateRoot !== undefined) {
    const expected = assertRegularDirectoryRoot(candidateRoot, "candidate root");
    if (expected !== canonicalCandidate)
      throwRunnerError(
        "sandbox_receipt_forged",
        "sandbox receipt is bound to another candidate root",
      );
  }
  const expectedRoots = { workspaceRoot, cliRoot, home, output };
  const rootKeys = {
    workspaceRoot: "workspace_root",
    cliRoot: "cli_root",
    home: "home",
    output: "output",
  };
  for (const [key, expected] of Object.entries(expectedRoots)) {
    if (expected === undefined) continue;
    const expectedReal = assertRegularDirectoryRoot(expected, `sandbox ${key}`);
    const observedReal = assertRegularDirectoryRoot(
      receipt.observed_probe.roots[rootKeys[key]],
      `sandbox probe ${key}`,
    );
    if (expectedReal !== observedReal)
      throwRunnerError("sandbox_receipt_forged", `sandbox receipt ${key} is not identity-bound`);
  }
  const observedCandidate = assertRegularDirectoryRoot(
    receipt.observed_probe.roots.candidate_root,
    "sandbox probe candidate root",
  );
  if (observedCandidate !== canonicalCandidate)
    throwRunnerError(
      "sandbox_receipt_forged",
      "sandbox receipt candidate root is not observation-bound",
    );

  if (
    receipt.network !== P02_SANDBOX_CONTRACT.network ||
    receipt.candidate_inputs !== P02_SANDBOX_CONTRACT.candidate_inputs ||
    receipt.trusted_mounts !== P02_SANDBOX_CONTRACT.trusted_mounts ||
    receipt.capabilities !== P02_SANDBOX_CONTRACT.capabilities ||
    receipt.no_new_privileges !== P02_SANDBOX_CONTRACT.no_new_privileges ||
    receipt.process_limit !== P02_SANDBOX_CONTRACT.process_limit ||
    receipt.memory_limit_mb !== P02_SANDBOX_CONTRACT.memory_limit_mb ||
    JSON.stringify(receipt.writable_paths) !==
      JSON.stringify(P02_SANDBOX_CONTRACT.writable_paths) ||
    !equalJson(receipt.observed_probe.facts, {
      network: receipt.network,
      candidate_inputs: receipt.candidate_inputs,
      trusted_mounts: receipt.trusted_mounts,
      capabilities: receipt.capabilities,
      no_new_privileges: receipt.no_new_privileges,
      writable_paths: receipt.writable_paths,
      process_limit: receipt.process_limit,
      memory_limit_mb: receipt.memory_limit_mb,
    }) ||
    receipt.sandbox_command_digest !== sandboxCommandDigest()
  )
    throwRunnerError(
      "sandbox_receipt_forged",
      "sandbox receipt does not enforce the observed fixed contract",
    );
  const unsigned = { ...receipt };
  delete unsigned.receipt_digest;
  if (digestJson(unsigned) !== receipt.receipt_digest)
    throwRunnerError("sandbox_receipt_forged", "sandbox receipt digest is invalid");
  return receipt;
}

export function readP02SandboxReceipt(receiptPath, expected = {}) {
  if (typeof receiptPath !== "string" || receiptPath.length === 0)
    throwRunnerError("sandbox_receipt_missing", "sandbox receipt path is required");
  let body;
  try {
    body = JSON.parse(readFileSync(resolve(receiptPath), "utf8"));
  } catch (error) {
    throwRunnerError(
      "sandbox_receipt_missing",
      `sandbox receipt cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return assertP02SandboxReceipt(body, expected);
}

/**
 * Seed one synthetic fixture row, take an immutable baseline, and replay only
 * the read-only reconciliation command twice. Seeding is deliberately kept
 * outside runOnce: the command under test must never create fixture state.
 */
export function runP02Twice({
  home,
  workspaceRoot = process.cwd(),
  cliRoot = REPO_ROOT,
  candidateRoot = workspaceRoot,
  sandboxReceipt,
}) {
  if (typeof home !== "string" || home.length === 0)
    throw new Error("P02 runner requires a runtime home");
  if (typeof cliRoot !== "string" || cliRoot.length === 0)
    throw new Error("P02 runner requires a CLI root");
  assertP02SandboxReceipt(sandboxReceipt, {
    candidateRoot,
    workspaceRoot,
    cliRoot,
    home: resolve(home),
  });
  if (process.platform !== "linux")
    throwRunnerError("sandbox_unavailable", "P02 requires a Linux bubblewrap sandbox");
  const runtimeHome = resolve(home);
  mkdirSync(runtimeHome, { recursive: true });

  const { fixture, fixtureSha256 } = loadP02Fixture();
  const seeded = seedDisposableFixture({
    workspaceRoot,
    cliRoot,
    fixture,
    home: runtimeHome,
    sandboxReceipt,
  });
  assertSeedObservation(seeded, fixture);

  const observer = new DatabaseSync(resolve(runtimeHome, "carpeos.sqlite"), { readOnly: true });
  try {
    const before = readStoreObservation(runtimeHome, observer);
    const runA = runOnce(
      runtimeHome,
      workspaceRoot,
      cliRoot,
      fixture,
      fixtureSha256,
      "runA",
      sandboxReceipt,
    );
    const between = readStoreObservation(runtimeHome, observer);
    const runB = runOnce(
      runtimeHome,
      workspaceRoot,
      cliRoot,
      fixture,
      fixtureSha256,
      "runB",
      sandboxReceipt,
    );
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
export function seedDisposableFixture({ home, fixture }) {
  assertP02Fixture(fixture);
  const runtimeHome = resolve(home);
  const databasePath = resolve(runtimeHome, "carpeos.sqlite");
  assertDisposableDatabasePath(databasePath);
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

function runOnce(home, workspaceRoot, cliRoot, fixture, fixtureSha256, label, sandboxReceipt) {
  const result = runSandboxed({
    home,
    workspaceRoot,
    cliRoot,
    args: [...P02_ARGS],
    sandboxReceipt,
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

function runSandboxed({ home, workspaceRoot, cliRoot, args, sandboxReceipt }) {
  assertP02SandboxReceipt(sandboxReceipt, {
    workspaceRoot,
    cliRoot,
    home: resolve(home),
  });
  let workspaceReal;
  let cliReal;
  let homeReal;
  try {
    workspaceReal = realpathSync(resolve(workspaceRoot));
    cliReal = realpathSync(resolve(cliRoot));
    homeReal = realpathSync(resolve(home));
  } catch (error) {
    throwRunnerError(
      "sandbox_root_invalid",
      `sandbox roots must exist: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isAbsolute(workspaceReal) || !isAbsolute(cliReal) || !isAbsolute(homeReal))
    throwRunnerError("sandbox_root_invalid", "sandbox roots must be absolute");
  const runtimePaths = ["/usr", "/bin", "/lib", "/lib64", "/etc", resolve(process.execPath, "..")];
  const bwrapArgs = [
    "--die-with-parent",
    "--new-session",
    "--unshare-all",
    "--unshare-net",
    "--clearenv",
    "--ro-bind",
    workspaceReal,
    "/candidate",
    "--ro-bind",
    cliReal,
    "/cli",
    "--bind",
    homeReal,
    "/home",
    "--tmpfs",
    "/tmp",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--dir",
    "/run",
    "--chdir",
    "/candidate",
    "--setenv",
    "HOME",
    "/home",
    "--setenv",
    "CARPEOS_HOME",
    "/home",
    "--setenv",
    "CARPEOS_TRUST_ZONE",
    "tz_synthetic",
    "--setenv",
    "NODE_NO_WARNINGS",
    "1",
    "--setenv",
    "NODE_OPTIONS",
    "--disable-warning=ExperimentalWarning",
    "--setenv",
    "NO_COLOR",
    "1",
    "--setenv",
    "TZ",
    "UTC",
    "--setenv",
    "PATH",
    "/usr/local/bin:/usr/bin:/bin",
    "--cap-drop",
    "ALL",
  ];
  for (const runtimePath of [...new Set(runtimePaths)]) {
    try {
      realpathSync(runtimePath);
      bwrapArgs.push("--ro-bind", runtimePath, runtimePath);
    } catch {
      // A runner may not have every conventional runtime directory.
    }
  }
  // Apply rlimits inside the sandbox after setpriv. Host-side ulimit before
  // `sudo bwrap` is reset by sudo and is not visible on /proc/self/limits.
  // --noprofile/--norc: bash -u must not source /etc/bash.bashrc (PS1 unbound).
  bwrapArgs.push(
    "--",
    "setpriv",
    "--no-new-privs",
    "--inh-caps=-all",
    "--ambient-caps=-all",
    "--",
    "/bin/bash",
    "--noprofile",
    "--norc",
    "-ceu",
    'ulimit -u 64; ulimit -v 1048576; ulimit -f 102400; exec "$@"',
    "product4-p02-sandbox-limits",
    process.execPath,
    "/cli/apps/carpeos-cli/dist/index.js",
    ...args,
  );
  const result = spawnSync("sudo", ["-n", "bwrap", ...bwrapArgs], {
    cwd: workspaceReal,
    encoding: "buffer",
    timeout: 120_000,
  });
  if (result.error)
    throwRunnerError(
      "sandbox_unavailable",
      `setpriv/bubblewrap execution failed: ${result.error.message}`,
    );
  return result;
}

export function readStoreObservation(home, observer) {
  const databasePath = resolve(home, "carpeos.sqlite");
  assertDisposableDatabasePath(databasePath);
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
 * compared to the baseline so in-place updates remain visible at the between
 * snapshot. A database-version change without an attributable table preimage
 * is fail-closed because this observer cannot identify the mutated table.
 */
export function mutationProbeBetween(...observations) {
  if (observations.length < 2)
    throwRunnerError(
      "mutation_observation_missing",
      "at least two store observations are required",
    );
  const baseline = observations[0];
  const mutation = {};
  let tableMutationObserved = false;
  for (const key of Object.keys(ZERO_WRITE_TABLES)) {
    const changed = observations.slice(1).some((observation) => {
      const left = baseline?.table_preimages?.[key];
      const right = observation?.table_preimages?.[key];
      const tableChanged =
        left === undefined ||
        right === undefined ||
        left.count !== right.count ||
        left.preimage_sha256 !== right.preimage_sha256 ||
        !equalJson(left.row_digests, right.row_digests) ||
        !equalRelevantHighWater(baseline.highWater, observation.highWater, key);
      if (tableChanged) tableMutationObserved = true;
      return tableChanged;
    });
    mutation[key] = changed ? 1 : 0;
  }
  const databaseVersionChanged =
    baseline?.data_version !== undefined &&
    observations
      .slice(1)
      .some((observation) => observation?.data_version !== baseline.data_version);
  if (databaseVersionChanged && !tableMutationObserved) {
    throwRunnerError(
      "mutation_observation_ambiguous",
      "database data_version changed without an attributable zero-write table preimage",
    );
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

function assertDisposableDatabasePath(databasePath, { allowMissing = false } = {}) {
  let stat;
  try {
    stat = lstatSync(databasePath);
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") return;
    throwRunnerError(
      "fixture_store_not_disposable",
      `P02 database path is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (stat.isSymbolicLink() || !stat.isFile())
    throwRunnerError("fixture_store_not_disposable", "P02 database path must be a regular file");
}
function assertRegularDirectoryRoot(value, label, code = "sandbox_receipt_forged") {
  if (typeof value !== "string" || value.length === 0 || !isAbsolute(value))
    throwRunnerError(code, `${label} must be an absolute path`);
  let stat;
  try {
    stat = lstatSync(value);
  } catch (error) {
    throwRunnerError(
      code,
      `${label} is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throwRunnerError(code, `${label} must be a regular directory`);
  try {
    return realpathSync(value);
  } catch (error) {
    throwRunnerError(
      code,
      `${label} cannot be resolved: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function pathsOverlap(left, right) {
  const leftPrefix = left.endsWith("/") ? left : `${left}/`;
  const rightPrefix = right.endsWith("/") ? right : `${right}/`;
  return left === right || left.startsWith(rightPrefix) || right.startsWith(leftPrefix);
}
function assertSha(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value))
    throwRunnerError("sandbox_receipt_forged", `${label} is invalid`);
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
      flag !== "--candidate-root" &&
      flag !== "--sandbox-receipt" &&
      flag !== "--output"
    )
      throw new Error(
        "P02 runner accepts only --home, --workspace-root, --cli-root, --candidate-root, --sandbox-receipt, and --output",
      );
    const value = argv[index + 1];
    if (typeof value !== "string" || value.length === 0 || values[flag] !== undefined)
      throw new Error(`${flag} requires one non-empty value and cannot repeat`);
    values[flag] = value;
    index += 1;
  }
  if (
    values["--home"] === undefined ||
    values["--output"] === undefined ||
    values["--sandbox-receipt"] === undefined
  )
    throw new Error("P02 runner requires --home, --sandbox-receipt, and --output");
  return values;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const workspaceRoot =
      args["--workspace-root"] === undefined ? process.cwd() : resolve(args["--workspace-root"]);
    const candidateRoot =
      args["--candidate-root"] === undefined ? workspaceRoot : resolve(args["--candidate-root"]);
    const receipt = runP02Twice({
      home: resolve(args["--home"]),
      workspaceRoot,
      cliRoot: args["--cli-root"] === undefined ? REPO_ROOT : resolve(args["--cli-root"]),
      candidateRoot,
      sandboxReceipt: readP02SandboxReceipt(args["--sandbox-receipt"], { candidateRoot }),
    });
    writeFileSync(resolve(args["--output"]), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
