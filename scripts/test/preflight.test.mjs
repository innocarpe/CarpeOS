import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const preflight = resolve(root, "scripts/preflight.mjs");

test("preflight --help documents modes and exits 0", () => {
  const result = spawnSync(process.execPath, [preflight, "--help"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--mode=quick\|pr\|full/);
  assert.match(result.stdout, /make preflight/);
  assert.match(result.stdout, /bubblewrap/);
});

test("preflight rejects unknown mode", () => {
  const result = spawnSync(process.execPath, [preflight, "--mode=nope"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--mode must be one of/);
});
