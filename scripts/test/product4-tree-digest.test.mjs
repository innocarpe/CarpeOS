import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { gitHeadSha, gitTreeSha256 } from "../product4/tree-digest.mjs";

const repoRoot = resolve(import.meta.dirname, "../..");

test("M4 computes a deterministic SHA-256 over the complete Git tree listing", () => {
  const first = gitTreeSha256({ repoRoot });
  const second = gitTreeSha256({ repoRoot });
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first, second);
});
test("M4 binds the tree digest to a full immutable HEAD", () => {
  assert.match(gitHeadSha({ repoRoot }), /^[0-9a-f]{40}$/);
});

test("M4 refuses an unbound commit selector", () => {
  assert.throws(() => gitTreeSha256({ repoRoot, commit: "HEAD~1" }), /invalid_commit/);
});
