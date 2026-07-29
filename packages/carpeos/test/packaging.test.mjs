import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const pkg = join(root, "..");

describe("@innocarpe/carpeos packaging", () => {
  it("ships cli and mcp bundles", () => {
    assert.equal(existsSync(join(pkg, "dist/cli.js")), true);
    assert.equal(existsSync(join(pkg, "dist/mcp-server.js")), true);
    assert.equal(existsSync(join(pkg, "bin/carpeos.js")), true);
  });

  it("cli entry prints help without starting mcp server", () => {
    const result = spawnSync(process.execPath, [join(pkg, "bin/carpeos.js")], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /USAGE/);
    assert.match(result.stdout, /carpeos/);
    assert.doesNotMatch(result.stderr + result.stdout, /carpeos-mcp-server: startup failed/);
  });
});
