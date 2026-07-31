import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CARPEOS_MCP_TOOLS } from "../src/tools.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inventoryPath = join(packageRoot, "../../docs/contracts/mcp-tools-v1.json");

type Inventory = {
  contract_id: string;
  schema_version: string;
  list_order_is_contract: boolean;
  tools: Array<{ name: string }>;
  safe_error_codes: string[];
  not_implemented: Array<{ name: string }>;
};

const EXPECTED_SAFE_ERROR_CODES = [
  "invalid_schema",
  "unauthorized",
  "not_found",
  "idempotency_conflict",
  "protected_value_denied",
  "budget_exceeded",
  "internal_error",
] as const;

describe("MCP tool inventory contract (G7)", () => {
  it("keeps docs/contracts/mcp-tools-v1.json aligned with CARPEOS_MCP_TOOLS", () => {
    const inventory = JSON.parse(readFileSync(inventoryPath, "utf8")) as Inventory;

    expect(inventory.contract_id).toBe("mcp-tools-v1");
    expect(inventory.schema_version).toBe("v1");
    expect(inventory.list_order_is_contract).toBe(true);

    const inventoryNames = inventory.tools.map((tool) => tool.name);
    expect(inventoryNames).toEqual([...CARPEOS_MCP_TOOLS]);
    expect(inventoryNames).toHaveLength(9);

    // No reserved/unimplemented tools may leak into the live list.
    for (const item of inventory.not_implemented) {
      expect(inventoryNames).not.toContain(item.name);
      expect(CARPEOS_MCP_TOOLS).not.toContain(item.name);
    }

    expect(inventory.safe_error_codes).toEqual([...EXPECTED_SAFE_ERROR_CODES]);
  });

  it("documents each live tool with required metadata fields", () => {
    const inventory = JSON.parse(readFileSync(inventoryPath, "utf8")) as {
      tools: Array<{
        name: string;
        kind: string;
        requires_context_budget: boolean;
        required_input: string[];
        success_output_keys: string[];
      }>;
    };

    for (const tool of inventory.tools) {
      expect(tool.kind === "read" || tool.kind === "write").toBe(true);
      expect(tool.required_input).toContain("schema_version");
      expect(tool.required_input).toContain("tool");
      expect(tool.required_input).toContain("visibility");
      expect(tool.success_output_keys.length).toBeGreaterThan(0);
      expect(tool.success_output_keys).toContain("schema_version");
      expect(tool.success_output_keys).toContain("tool");
      if (tool.requires_context_budget) {
        expect(tool.required_input).toContain("context_budget");
      }
    }
  });
});
