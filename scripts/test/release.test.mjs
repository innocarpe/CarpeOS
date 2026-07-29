import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const release = join(root, "scripts/release.mjs");

describe("release.mjs", () => {
  it("prints help and dry-run plan without mutating git", () => {
    const help = spawnSync(process.execPath, [release, "--help"], {
      encoding: "utf8",
      cwd: root,
    });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /patch\|minor\|major/);

    const dry = spawnSync(process.execPath, [release, "patch", "--dry-run"], {
      encoding: "utf8",
      cwd: root,
    });
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout + dry.stderr, /Release plan:|dry-run/i);
  });
});
