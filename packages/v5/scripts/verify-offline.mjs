#!/usr/bin/env node
/**
 * Offline V5 draft-lane gate (local / maintainer).
 * Does not enable network, does not cut a release, does not write M0 receipts.
 *
 * Steps:
 *   1. M0 independent recompute (--check-only)
 *   2. package unit/contract tests
 *   3. live-cost-experiment dry-run (body-free plan only)
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, "..");

function run(label, command, args) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    cwd: pkgRoot,
    encoding: "utf8",
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(`\nFAIL: ${label} (exit ${result.status ?? "null"})`);
    process.exit(result.status ?? 1);
  }
}

run("M0 recompute (check-only)", process.execPath, [
  resolve(__dirname, "m0-recompute.mjs"),
  "--check-only",
]);

run("unit/contract tests", "pnpm", ["exec", "vitest", "run"]);

run("cost experiment dry-run", process.execPath, [
  resolve(__dirname, "live-cost-experiment.mjs"),
  "--dry-run",
]);

console.log("\nV5 offline verify: PASS (draft-lane contracts; not npm release)");
