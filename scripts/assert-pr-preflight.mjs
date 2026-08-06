#!/usr/bin/env node
/**
 * Fail-closed gate before `gh pr create` / push-for-review.
 *
 * Requires a PREFLIGHT PASS stamp from `scripts/preflight.mjs` for the current
 * HEAD with mode `pr` or `full` (`quick` alone is never enough to open a PR).
 *
 * Usage:
 *   node scripts/assert-pr-preflight.mjs
 *   pnpm preflight:assert
 *
 * Exit:
 *   0 stamp ok for HEAD
 *   1 missing / stale / wrong mode
 *   2 usage / git error
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PREFLIGHT_STAMP_REL } from "./preflight.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWED_MODES = new Set(["pr", "full"]);

function gitStdout(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${(result.stderr || result.stdout || "").trim()}`,
    );
  }
  return (result.stdout || "").trim();
}

function fail(message, code = 1) {
  process.stderr.write(
    `PR_PREFLIGHT_ASSERT FAIL: ${message}\n` +
      `Run: make preflight   # or: make preflight-fix\n` +
      `Then: node scripts/assert-pr-preflight.mjs\n` +
      `Only then: gh pr create …\n`,
  );
  process.exitCode = code;
}

function main() {
  const stampPath = join(ROOT, PREFLIGHT_STAMP_REL);
  if (!existsSync(stampPath)) {
    fail(
      `missing stamp at ${PREFLIGHT_STAMP_REL} (preflight never passed on this machine/checkout)`,
    );
    return;
  }

  let stamp;
  try {
    stamp = JSON.parse(readFileSync(stampPath, "utf8"));
  } catch (error) {
    fail(`unreadable stamp: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  if (!stamp || typeof stamp !== "object") {
    fail("stamp is not an object");
    return;
  }

  const head = gitStdout(["rev-parse", "HEAD"]);
  if (stamp.head !== head) {
    fail(
      `stamp head ${stamp.head ?? "(none)"} != HEAD ${head} — re-run preflight after the latest commit`,
    );
    return;
  }

  if (!ALLOWED_MODES.has(stamp.mode)) {
    fail(
      `stamp mode=${JSON.stringify(stamp.mode)} is not enough for PR open (need pr|full; quick alone is banned)`,
    );
    return;
  }

  process.stdout.write(
    `PR_PREFLIGHT_ASSERT PASS  head=${head} mode=${stamp.mode} passed_at=${stamp.passed_at ?? "?"}\n`,
  );
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error), 2);
}
