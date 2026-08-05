import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AnySchemaObject } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { createAjv2020 } from "../src/index.js";

const repoRoot = resolve(import.meta.dirname, "../../..");
const policySha256 = "3da2700b19734b2c62eedf75a52c3947ac7ea17573a829eab4270cff6416e83e";
const schemas = [
  readJson("schemas/product4-ownership-v1.json"),
  readJson("schemas/ruleset-activation-v1.json"),
] as Array<AnySchemaObject & { $id: string }>;
const ajv = createAjv2020();
for (const schema of schemas) ajv.addSchema(schema);

const ownership = {
  schema_version: "product4-ownership-v1",
  receipt_type: "product4_ownership",
  status: "blocked_unknown",
  repository_id: 1315097793,
  ruleset_id: 19955787,
  context: "Product 4 Candidate Evidence",
  policy_sha256: policySha256,
  app: { app_id: 4242, installation_id: 4343, slug: "synthetic-product4-app", checks_write: false },
  authorities: {
    rotation_owner: { status: "unknown", ref: "rotation_owner" },
    settings_admin: { status: "unknown", ref: "settings_admin" },
    release_controller: { status: "unknown", ref: "release_controller" },
    credential_owner: { status: "unknown", ref: "credential_owner" },
    artifact_owner: { status: "unknown", ref: "artifact_owner" },
  },
  evidence: {
    repository_id: 1315097793,
    ruleset_id: 19955787,
    app_id: 4242,
    installation_id: 4343,
    policy_sha256: policySha256,
    preimage_digest: "a".repeat(64),
  },
  approval: { approved: false, approval_digest: "b".repeat(64) },
  blockers: ["settings_admin_unknown"],
  observed_at: "2026-01-02T00:00:00Z",
};

const rulesetReceipt = {
  schema_version: "ruleset-activation-v1",
  receipt_type: "product4_ruleset_activation",
  status: "blocked",
  repository_id: 1315097793,
  ruleset_id: 19955787,
  context: "Product 4 Candidate Evidence",
  policy_sha256: policySha256,
  operation: "semantic_add_fixed_context",
  preimage_digest: "1".repeat(64),
  post_image_digest: "2".repeat(64),
  preservation_digest: "3".repeat(64),
  ownership_receipt_digest: "4".repeat(64),
  approval_digest: "5".repeat(64),
  response_loss: "blocked_indeterminate",
  rollback: { authorized: false, fresh_read_required: true, status: "blocked" },
  blockers: ["response_loss"],
  observed_at: "2026-01-02T00:00:00Z",
};

describe("Product 4 M4 ownership and ruleset schemas", () => {
  it("accepts blocked unknown receipts without making a live ownership claim", () => {
    const ownershipValidator = ajv.getSchema(
      "https://spec.carpeos.org/product4/schemas/product4-ownership-v1.json",
    );
    const rulesetValidator = ajv.getSchema(
      "https://spec.carpeos.org/product4/schemas/ruleset-activation-v1.json",
    );
    expect(ownershipValidator?.(ownership), JSON.stringify(ownershipValidator?.errors)).toBe(true);
    expect(rulesetValidator?.(rulesetReceipt), JSON.stringify(rulesetValidator?.errors)).toBe(true);
  });

  it("rejects alternate policy, executable fields, and unknown receipt fields", () => {
    const ownershipValidator = ajv.getSchema(
      "https://spec.carpeos.org/product4/schemas/product4-ownership-v1.json",
    );
    const rulesetValidator = ajv.getSchema(
      "https://spec.carpeos.org/product4/schemas/ruleset-activation-v1.json",
    );
    expect(ownershipValidator?.({ ...ownership, policy_sha256: "c".repeat(64) })).toBe(false);
    expect(ownershipValidator?.({ ...ownership, script: "never" })).toBe(false);
    expect(rulesetValidator?.({ ...rulesetReceipt, executable: "never" })).toBe(false);
  });
});

function readJson(relativePath: string): AnySchemaObject & { $id: string } {
  return JSON.parse(readFileSync(resolve(repoRoot, relativePath), "utf8")) as AnySchemaObject & {
    $id: string;
  };
}
