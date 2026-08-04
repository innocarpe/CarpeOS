import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const workflow = readFileSync(join(root, ".github/workflows/release.yml"), "utf8");

describe("release artifact workflow", () => {
  it("creates one manifest-bound tarball and reuses its exact path", () => {
    assert.match(workflow, /node scripts\/pack-once\.mjs pack/);
    assert.equal((workflow.match(/scripts\/pack-once\.mjs pack/g) || []).length, 1);
    assert.match(workflow, /tarball=\$GITHUB_WORKSPACE\/\.release-artifact\/\$\(node -p/);
    assert.match(workflow, /npm install --prefix "\$SMOKE_ROOT\/install" "\$TARBALL"/);
    assert.match(workflow, /CLI="\$SMOKE_ROOT\/install\/node_modules\/\.bin\/carpeos"/);
    assert.match(workflow, /"\$CLI" setup doctor/);
    assert.match(workflow, /node scripts\/smoke-dogfood\.mjs --cli "\$CLI"/);
    assert.match(workflow, /npm publish "\$TARBALL" --access public --provenance/);
    assert.doesNotMatch(workflow, /working-directory: packages\/carpeos\n[\s\S]*npm publish/);
  });

  it("requires manifest identity before install and publish, then verifies registry metadata", () => {
    assert.equal(
      (workflow.match(/assert-artifact --manifest "\$MANIFEST" --tarball "\$TARBALL"/g) || [])
        .length,
      2,
    );
    assert.match(workflow, /verify-registry --manifest "\$MANIFEST"/);
    assert.match(workflow, /NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/);
  });
});
