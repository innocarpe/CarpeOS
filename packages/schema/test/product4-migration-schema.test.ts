import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AnySchemaObject } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { createAjv2020 } from "../src/index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const schema = JSON.parse(
  readFileSync(resolve(repoRoot, "schemas/product4-migration-plan-v1.json"), "utf8"),
) as AnySchemaObject & { $id: string };
const ajv = createAjv2020();
ajv.addSchema(schema);
const validate = ajv.getSchema(schema.$id);

const validPlan = {
  schema_version: "product4-migration-plan-v1",
  migration_id: "m4_synthetic_receipts",
  source_schema_version: "v1",
  target_schema_version: "product4-v1",
  policy_sha256: "3da2700b19734b2c62eedf75a52c3947ac7ea17573a829eab4270cff6416e83e",
  context: "Product 4 Candidate Evidence",
  required_action_ids: ["read_oracle"],
  operations: [
    {
      operation_id: "op_product4_receipts",
      kind: "add_table",
      table: "product4_receipts",
      name: "product4_receipts",
    },
  ],
  rollback: {
    mode: "explicit_authorized",
    preserve_canonical: true,
    requires_fresh_read: true,
  },
};

describe("Product 4 migration plan schema", () => {
  it("accepts an additive P4_0 plan", () => {
    expect(validate).toBeDefined();
    expect(validate?.(validPlan), JSON.stringify(validate?.errors)).toBe(true);
  });

  it("rejects destructive kinds, executable fields, and alternate policies", () => {
    const destructive = structuredClone(validPlan);
    const destructiveOperation = destructive.operations.at(0);
    if (destructiveOperation === undefined) throw new Error("test plan has no operation");
    destructiveOperation.kind = "drop_table";
    expect(validate?.(destructive)).toBe(false);

    const executable = structuredClone(validPlan) as Record<string, unknown>;
    executable.sql = "DROP TABLE canonical_events";
    expect(validate?.(executable)).toBe(false);

    const alternatePolicy = structuredClone(validPlan);
    alternatePolicy.policy_sha256 = "a".repeat(64);
    expect(validate?.(alternatePolicy)).toBe(false);
  });
});
