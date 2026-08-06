import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "../scripts/m0-recompute.mjs");

describe("M0 independent recompute", () => {
  it("passes --check-only without rewriting receipts", () => {
    const result = spawnSync(process.execPath, [script, "--check-only"], {
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('"m0_pass": true');
    expect(result.stdout).toContain("check-only");
    expect(result.stdout).not.toContain("receipts written under");
  }, 120_000);
});
