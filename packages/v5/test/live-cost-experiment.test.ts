import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const scriptPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../scripts/live-cost-experiment.mjs",
);

// Dynamic import of ESM script helpers
const mod = await import(scriptPath);

describe("live-cost-experiment pure helpers", () => {
  it("calculates Direct flash cost from official snapshot formula", () => {
    const calc = mod.calculateCostUsd({
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_hit_tokens: 500_000,
      cache_miss_tokens: 500_000,
    });
    expect(calc.ok).toBe(true);
    if (calc.ok) {
      // 0.5*0.0028 + 0.5*0.14 + 1*0.28 = 0.3514
      expect(calc.cost_usd).toBeCloseTo(0.3514, 6);
    }
  });

  it("fails closed when usage is missing", () => {
    const calc = mod.calculateCostUsd({
      input_tokens: null,
      output_tokens: null,
      cache_hit_tokens: null,
      cache_miss_tokens: null,
    });
    expect(calc.ok).toBe(false);
    if (!calc.ok) expect(calc.error).toBe("usage_missing");
  });

  it("treats null cache splits as full cache miss", () => {
    const calc = mod.calculateCostUsd({
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_hit_tokens: null,
      cache_miss_tokens: null,
    });
    expect(calc.ok).toBe(true);
    if (calc.ok) expect(calc.cost_usd).toBeCloseTo(0.14, 6);
  });
});

describe("live-cost-experiment dry-run CLI", () => {
  it("prints a body-free plan without network", async () => {
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync(process.execPath, [scriptPath, "--dry-run", "--cases", "1"], {
      encoding: "utf8",
      env: { ...process.env, DEEPSEEK_API_KEY: undefined },
    });
    expect(r.status).toBe(0);
    const plan = JSON.parse(r.stdout);
    expect(plan.schema).toBe("carpeos.v5.cost-experiment-plan/v1");
    expect(plan.dry_run).toBe(true);
    expect(plan.model_id).toBe("deepseek-v4-flash");
    expect(plan.cases).toHaveLength(1);
    expect(plan.canonical_effect).toBe("none");
    expect(r.stdout).not.toMatch(/Bearer /);
    void require;
  });
});
