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
    assert.doesNotMatch(workflow, /npm install --offline/);
    assert.match(workflow, /CLI="\$SMOKE_ROOT\/install\/node_modules\/\.bin\/carpeos"/);
    assert.match(workflow, /"\$CLI" --version/);
    assert.match(workflow, /"\$CLI" setup run --apply --home "\$CARPEOS_HOME"/);
    assert.match(workflow, /"\$CLI" setup doctor --home "\$CARPEOS_HOME"/);
    assert.match(workflow, /node scripts\/smoke-dogfood\.mjs --cli "\$CLI"/);
    assert.match(workflow, /trap cleanup EXIT\n\s+trap 'exit 1' HUP INT TERM/);
    assert.match(workflow, /npm publish "\$TARBALL" --access public --provenance/);
    assert.doesNotMatch(workflow, /working-directory: packages\/carpeos\n[\s\S]*npm publish/);
  });
  it("initializes the installed CLI state before doctor without a source fallback", () => {
    const smokeStart = workflow.indexOf(
      "      - name: Install and smoke the exact packed artifact",
    );
    const publishStart = workflow.indexOf("      - name: Publish packed artifact to npm");
    const smoke = workflow.slice(smokeStart, publishStart);
    const initialization = smoke.indexOf('"$CLI" setup run --apply --home "$CARPEOS_HOME"');
    const doctor = smoke.indexOf('"$CLI" setup doctor --home "$CARPEOS_HOME"');

    assert.ok(smokeStart >= 0);
    assert.ok(publishStart > smokeStart);
    assert.ok(initialization >= 0);
    assert.ok(doctor > initialization);
    assert.match(smoke, /"\$CLI" --version/);
    assert.match(smoke, /node scripts\/smoke-dogfood\.mjs --cli "\$CLI"/);
    assert.equal((smoke.match(/scripts\/smoke-dogfood\.mjs/g) || []).length, 1);
    assert.doesNotMatch(smoke, /(?:^|\n)\s*carpeos(?:\s|$)/m);
    assert.doesNotMatch(smoke, /apps\/carpeos-cli\/dist\/index\.js/);
    assert.match(smoke, /unset NODE_AUTH_TOKEN NPM_TOKEN/);
    assert.doesNotMatch(smoke, /NODE_AUTH_TOKEN:|secrets\.NPM_TOKEN|https?:\/\//);
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
