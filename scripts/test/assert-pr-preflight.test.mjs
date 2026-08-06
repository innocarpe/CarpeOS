import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const assertScript = join(root, "scripts/assert-pr-preflight.mjs");
const stampPath = join(root, ".git/carpeos-preflight.stamp");

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return (result.stdout || "").trim();
}

function runAssert() {
  return spawnSync(process.execPath, [assertScript], {
    cwd: root,
    encoding: "utf8",
  });
}

describe("assert-pr-preflight", () => {
  it("fails when stamp is missing", () => {
    rmSync(stampPath, { force: true });
    const result = runAssert();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /PR_PREFLIGHT_ASSERT FAIL/);
    assert.match(result.stderr, /missing stamp/);
  });

  it("fails when stamp mode is only quick", () => {
    const head = git(["rev-parse", "HEAD"]);
    mkdirSync(dirname(stampPath), { recursive: true });
    writeFileSync(
      stampPath,
      `${JSON.stringify({ schema: "carpeos-preflight-stamp/v1", head, mode: "quick" }, null, 2)}\n`,
    );
    const result = runAssert();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /quick alone is banned/);
  });

  it("passes when stamp matches HEAD with mode pr", () => {
    const head = git(["rev-parse", "HEAD"]);
    mkdirSync(dirname(stampPath), { recursive: true });
    writeFileSync(
      stampPath,
      `${JSON.stringify(
        {
          schema: "carpeos-preflight-stamp/v1",
          head,
          mode: "pr",
          passed_at: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
    const result = runAssert();
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /PR_PREFLIGHT_ASSERT PASS/);
  });
});
