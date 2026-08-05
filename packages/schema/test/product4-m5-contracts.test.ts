import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AnySchemaObject } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { createAjv2020 } from "../src/index.js";

const repoRoot = resolve(import.meta.dirname, "../../..");
const policySha256 = "3da2700b19734b2c62eedf75a52c3947ac7ea17573a829eab4270cff6416e83e";
const authority = {
  schema_version: "carpeos.release-authority/v1",
  receipt_type: "release_authority",
  status: "blocked_unknown",
  repository_id: 1315097793,
  app: {
    app_id: 4242,
    installation_id: 4343,
    slug: "synthetic-product4-app",
    status: "unknown",
    checks_write: false,
  },
  ownership: {
    owner_ref: "owner_ref",
    rotation_owner_ref: "rotation_owner",
    status: "unknown",
  },
  controller: {
    ref: "release_controller",
    status: "unknown",
    independent: false,
    can_edit_release_workflow: false,
  },
  tag_authority: {
    ref: "tag_authority",
    status: "unknown",
    protected: false,
    allowed_actors_digest: "a".repeat(64),
  },
  credential_issuer: {
    ref: "credential_issuer",
    status: "unknown",
    independent: false,
    issues_to_release_job: false,
  },
  workflow_policy: {
    release_workflow_sha: "b".repeat(40),
    verifier_sha: "c".repeat(40),
    policy_sha256: policySha256,
    context: "Product 4 Candidate Evidence",
  },
  settings: {
    status: "unknown",
    preimage_digest: "d".repeat(64),
    postimage_digest: "e".repeat(64),
    semantic_digest: "f".repeat(64),
  },
  bypass_rehearsal: {
    status: "not_run",
    gate_deleted_result: "unknown",
    tag_result: "unknown",
    credential_result: "unknown",
    evidence_digest: "1".repeat(64),
  },
  rollback: { owner_ref: "rollback_owner", status: "unknown", fresh_read_required: true },
  approval: { approved: false, approval_digest: "2".repeat(64) },
  blockers: ["authority_unknown"],
  observed_at: "2026-01-02T00:00:00Z",
  receipt_digest: "3".repeat(64),
};

const releaseIdentity = {
  schema_version: "carpeos.release-identity/v1",
  release_type: "product4_release_identity",
  repository_id: 1315097793,
  package_name: "@innocarpe/carpeos",
  version: "4.0.0",
  tag: "v4.0.0",
  release_sha: "4".repeat(40),
  candidate_sha: "5".repeat(40),
  base_sha: "6".repeat(40),
  policy_sha256: policySha256,
  context: "Product 4 Candidate Evidence",
  evidence: {
    candidate_attestation_digest: "7".repeat(64),
    promotion_ledger_digest: "8".repeat(64),
    ownership_receipt_digest: "9".repeat(64),
    ruleset_receipt_digest: "a".repeat(64),
    manifest_digest: "b".repeat(64),
    artifact_sha256: "c".repeat(64),
    install_smoke_digest: "d".repeat(64),
    ancestry_digest: "e".repeat(64),
    release_diff_digest: "f".repeat(64),
    tag_identity_digest: "0".repeat(64),
  },
  authority_receipt_digest: "1".repeat(64),
  approval_digest: "2".repeat(64),
  decision: "defer",
  blockers: ["authority_unknown"],
  observed_at: "2026-01-02T00:00:00Z",
  identity_digest: "3".repeat(64),
};

const ajv = createAjv2020();
for (const schema of [
  readJson("schemas/release-authority-v1.json"),
  readJson("schemas/release-identity-v1.json"),
] as Array<AnySchemaObject & { $id: string }>) {
  ajv.addSchema(schema);
}

describe("Product 4 M5 release schemas", () => {
  it("accepts procedural authority uncertainty and deferred release identity", () => {
    const authorityValidator = ajv.getSchema(
      "https://spec.carpeos.org/schemas/release-authority-v1.json",
    );
    const identityValidator = ajv.getSchema(
      "https://spec.carpeos.org/schemas/release-identity-v1.json",
    );
    expect(authorityValidator?.(authority), JSON.stringify(authorityValidator?.errors)).toBe(true);
    expect(identityValidator?.(releaseIdentity), JSON.stringify(identityValidator?.errors)).toBe(
      true,
    );
  });

  it("rejects policy drift, executable fields, and missing authority binding", () => {
    const authorityValidator = ajv.getSchema(
      "https://spec.carpeos.org/schemas/release-authority-v1.json",
    );
    const identityValidator = ajv.getSchema(
      "https://spec.carpeos.org/schemas/release-identity-v1.json",
    );
    expect(authorityValidator?.({ ...authority, script: "never" })).toBe(false);
    expect(
      authorityValidator?.({
        ...authority,
        app: { ...authority.app, installation_id: undefined },
      }),
    ).toBe(false);
    expect(identityValidator?.({ ...releaseIdentity, policy_sha256: "4".repeat(64) })).toBe(false);
    expect(identityValidator?.({ ...releaseIdentity, credential: "never" })).toBe(false);
  });
});

function readJson(relativePath: string): AnySchemaObject & { $id: string } {
  return JSON.parse(readFileSync(resolve(repoRoot, relativePath), "utf8")) as AnySchemaObject & {
    $id: string;
  };
}
