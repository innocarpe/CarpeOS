import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PRODUCT4_REPOSITORY_ID = 1315097793;
export const PRODUCT4_POLICY_ID = "P4_0";
export const PRODUCT4_CONTEXT = "Product 4 Candidate Evidence";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const POLICY_PATH = resolve(ROOT, "spec/product4/evaluator-policy-v1.json");
const FIXTURE_PATH = resolve(ROOT, "scripts/fixtures/maintenance-study-v2.json");

export const PRODUCT4_POLICY_SHA256 =
  "3da2700b19734b2c62eedf75a52c3947ac7ea17573a829eab4270cff6416e83e";
export const MAINTENANCE_STUDY_FIXTURE_SHA256 =
  "0c7f7e3d849d6ab77558cfb24027c03ef6f6236051d5b0a1f05e86ec959fa60f";

export function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function digestJson(value) {
  return sha256Hex(canonicalJson(value));
}

export function readProduct4Policy() {
  const policy = readJson(POLICY_PATH, "policy");
  assertFrozenDigest(policy, PRODUCT4_POLICY_SHA256, "policy", "policy_drift");
  return policy;
}

export function readMaintenanceStudyFixture() {
  const fixture = readJson(FIXTURE_PATH, "fixture");
  assertFrozenDigest(fixture, MAINTENANCE_STUDY_FIXTURE_SHA256, "fixture", "fixture_drift");
  return fixture;
}

export function assertFrozenProduct4Sources({ policy, fixture } = {}) {
  const loadedPolicy = policy === undefined ? readJson(POLICY_PATH, "policy") : policy;
  const loadedFixture = fixture === undefined ? readJson(FIXTURE_PATH, "fixture") : fixture;
  assertFrozenDigest(loadedPolicy, PRODUCT4_POLICY_SHA256, "policy", "policy_drift");
  assertFrozenDigest(loadedFixture, MAINTENANCE_STUDY_FIXTURE_SHA256, "fixture", "fixture_drift");
  return { policy: loadedPolicy, fixture: loadedFixture };
}

function readJson(path, source) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throwIdentityError(`${source}_unreadable`, `${source} source could not be loaded`);
  }
}

function assertFrozenDigest(value, expected, source, code) {
  const actual = digestJson(value);
  if (actual !== expected) {
    throwIdentityError(code, `${source} source digest drifted from the frozen Product 4 identity`);
  }
}

function throwIdentityError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.name = "Product4IdentityError";
  error.code = code;
  throw error;
}

assertFrozenProduct4Sources();

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])]),
  );
}
