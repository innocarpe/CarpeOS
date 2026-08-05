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
  readJson("schemas/product4-promotion-ledger-v1.json"),
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
const promotionLedger = {
  schema_version: "product4-promotion-ledger-v1",
  ledger_type: "candidate_promotion_ledger",
  repository_id: 1315097793,
  head_sha: "a".repeat(40),
  tree_sha256: "b".repeat(64),
  fixture_sha256: "0c7f7e3d849d6ab77558cfb24027c03ef6f6236051d5b0a1f05e86ec959fa60f",
  policy_sha256: policySha256,
  context: "Product 4 Candidate Evidence",
  external_id:
    "carpeos-4.0.0:" +
    "a".repeat(40) +
    ":0c7f7e3d849d6ab77558cfb24027c03ef6f6236051d5b0a1f05e86ec959fa60f",
  intent_digest: "c".repeat(64),
  state_digest: "d".repeat(64),
  attestation_digest: "e".repeat(64),
  api_evidence_digest: "f".repeat(64),
  ownership_receipt_digest: "1".repeat(64),
  ruleset_receipt_digest: "2".repeat(64),
  promotion_status: "blocked",
  canonical_write: "none",
  blockers: ["ownership_unknown"],
  entries: [
    {
      sequence: 1,
      kind: "promotion_blocked",
      status: "blocked",
      actor: "base_evaluator",
      evidence_digest: "3".repeat(64),
      observed_at: "2026-01-02T00:00:00Z",
    },
  ],
  ledger_digest: "4".repeat(64),
};

describe("Product 4 M4 ownership, ruleset, and promotion schemas", () => {
  it("accepts blocked unknown receipts without making a live ownership claim", () => {
    const ownershipValidator = ajv.getSchema(
      "https://spec.carpeos.org/product4/schemas/product4-ownership-v1.json",
    );
    const rulesetValidator = ajv.getSchema(
      "https://spec.carpeos.org/product4/schemas/ruleset-activation-v1.json",
    );
    const promotionValidator = ajv.getSchema(
      "https://spec.carpeos.org/product4/schemas/product4-promotion-ledger-v1.json",
    );
    expect(ownershipValidator?.(ownership), JSON.stringify(ownershipValidator?.errors)).toBe(true);
    expect(rulesetValidator?.(rulesetReceipt), JSON.stringify(rulesetValidator?.errors)).toBe(true);
    expect(promotionValidator?.(promotionLedger), JSON.stringify(promotionValidator?.errors)).toBe(
      true,
    );
  });

  it("rejects alternate policy, executable fields, and unknown receipt fields", () => {
    const ownershipValidator = ajv.getSchema(
      "https://spec.carpeos.org/product4/schemas/product4-ownership-v1.json",
    );
    const rulesetValidator = ajv.getSchema(
      "https://spec.carpeos.org/product4/schemas/ruleset-activation-v1.json",
    );
    const promotionValidator = ajv.getSchema(
      "https://spec.carpeos.org/product4/schemas/product4-promotion-ledger-v1.json",
    );
    expect(ownershipValidator?.({ ...ownership, policy_sha256: "c".repeat(64) })).toBe(false);
    expect(ownershipValidator?.({ ...ownership, script: "never" })).toBe(false);
    expect(rulesetValidator?.({ ...rulesetReceipt, executable: "never" })).toBe(false);
    expect(promotionValidator?.({ ...promotionLedger, executable: "never" })).toBe(false);
  });
});

function readJson(relativePath: string): AnySchemaObject & { $id: string } {
  return JSON.parse(readFileSync(resolve(repoRoot, relativePath), "utf8")) as AnySchemaObject & {
    $id: string;
  };
}
