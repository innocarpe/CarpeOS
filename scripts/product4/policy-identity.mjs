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
  return JSON.parse(readFileSync(POLICY_PATH, "utf8"));
}

export function readMaintenanceStudyFixture() {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
}

export const PRODUCT4_POLICY_SHA256 = digestJson(readProduct4Policy());
export const MAINTENANCE_STUDY_FIXTURE_SHA256 = digestJson(readMaintenanceStudyFixture());

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])]),
  );
}
