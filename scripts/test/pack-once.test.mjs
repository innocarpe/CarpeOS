import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { assertArtifact, createManifest, verifyRegistry } from "../pack-once.mjs";
import { resolveCliInvocation } from "../smoke-dogfood.mjs";

const sha = "a".repeat(40);
const originalPath = process.env.PATH;
const temporary = [];
const integrity = `sha512-${"A".repeat(86)}==`;

function fakeTools({
  dirty = false,
  extraTarball = false,
  head = sha,
  noTarball = false,
  packageVersion = "3.1.0",
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), "pack-once-"));
  temporary.push(directory);
  const git = `#!/usr/bin/env node
const args = process.argv.slice(2).join(" ");
if (args === "status --porcelain") process.stdout.write(${JSON.stringify(dirty ? " M changed" : "")});
else if (args === "rev-parse HEAD") process.stdout.write("${head}");
else if (args === "rev-list -n 1 v3.1.0") process.stdout.write("${sha}");
else if (args === "cat-file -t v3.1.0") process.stdout.write("tag");
else process.exit(1);
`;
  const npm = `#!/usr/bin/env node
import { gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") { process.stdout.write("11.0.0"); process.exit(0); }
const out = args[args.indexOf("--pack-destination") + 1];
const body = Buffer.from(JSON.stringify({ name: "@innocarpe/carpeos", version: "${packageVersion}" }) + "\\n");
const header = Buffer.alloc(512); header.write("package/package.json"); header.write("0000644", 100); header.write(body.length.toString(8).padStart(11, "0") + "\\0", 124); header.write("ustar", 257); header.write("00", 263); for (let i = 148; i < 156; i += 1) header[i] = 32; const sum = header.reduce((n, byte) => n + byte, 0); header.write(sum.toString(8).padStart(6, "0") + "\\0 ", 148);
const tar = Buffer.concat([header, body, Buffer.alloc((512 - (body.length % 512)) % 512), Buffer.alloc(1024)]);
if (!${noTarball}) writeFileSync(out + "/carpeos-3.1.0.tgz", gzipSync(tar, { mtime: 0 }));
if (${extraTarball}) writeFileSync(out + "/second.tgz", gzipSync(tar, { mtime: 0 }));
process.stdout.write(JSON.stringify([{ filename: "carpeos-3.1.0.tgz" }]));
`;
  for (const [name, contents] of Object.entries({ git, npm })) {
    const path = join(directory, name);
    writeFileSync(path, contents);
    chmodSync(path, 0o755);
  }
  process.env.PATH = `${directory}:${originalPath}`;
  return directory;
}
function outputDirectory(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporary.push(directory);
  return join(directory, "artifact");
}

afterEach(() => {
  process.env.PATH = originalPath;
  while (temporary.length) rmSync(temporary.pop(), { recursive: true, force: true });
});
describe("pack-once", () => {
  it("selects only an explicit installed dogfood binary and fails closed", () => {
    const directory = mkdtempSync(join(tmpdir(), "smoke-dogfood-cli-"));
    temporary.push(directory);
    const sourceEntry = join(directory, "repository-cli.js");
    const installedBinary = join(directory, "carpeos");
    writeFileSync(sourceEntry, "#!/usr/bin/env node\n");
    writeFileSync(installedBinary, "#!/usr/bin/env node\n");
    chmodSync(sourceEntry, 0o755);
    chmodSync(installedBinary, 0o755);

    const installedCanonicalPath = realpathSync(installedBinary);
    assert.deepEqual(resolveCliInvocation(["--cli", installedBinary], sourceEntry), {
      command: installedCanonicalPath,
      args: [],
      entry: installedCanonicalPath,
      kind: "installed",
    });
    assert.deepEqual(
      resolveCliInvocation(["--cli", installedBinary], join(directory, "missing-source-cli.js")),
      {
        command: installedCanonicalPath,
        args: [],
        entry: installedCanonicalPath,
        kind: "installed",
      },
    );
    assert.throws(
      () => resolveCliInvocation(["--cli", sourceEntry], sourceEntry),
      /must not reference the repository CLI entry/,
    );
    assert.throws(
      () => resolveCliInvocation(["--cli", join(directory, "missing")], sourceEntry),
      /does not exist/,
    );
    assert.throws(
      () => resolveCliInvocation(["--cli", "relative-carpeos"], sourceEntry),
      /must be an absolute path/,
    );
    assert.throws(
      () => resolveCliInvocation(["--cli", installedBinary, "--unexpected"], sourceEntry),
      /usage/,
    );
  });

  it("packs once and writes a stable, bound metadata-only manifest", () => {
    fakeTools();
    const first = createManifest({
      sha,
      tag: "v3.1.0",
      version: "3.1.0",
      outDir: outputDirectory("pack-out-"),
    });
    const second = createManifest({
      sha,
      tag: "v3.1.0",
      version: "3.1.0",
      outDir: outputDirectory("pack-out-"),
    });
    assert.deepEqual(first.manifest, second.manifest);
    assert.deepEqual(Object.keys(first.manifest), [
      "schema",
      "git_sha",
      "annotated_tag",
      "package_name",
      "version",
      "filename",
      "bytes",
      "sha256",
      "sha512",
      "npm_integrity",
      "creation_tool",
      "creation_tool_version",
    ]);
    assert.equal(first.manifest.git_sha, sha);
    assert.equal(first.manifest.annotated_tag, "v3.1.0");
    assert.equal(first.manifest.npm_integrity, first.manifest.sha512);
    assertArtifact(first.manifestPath, first.tarball);
    assert.throws(
      () =>
        createManifest({
          sha,
          tag: "v3.1.0",
          version: "3.1.0",
          outDir: first.manifestPath.replace("/release-artifact.json", ""),
        }),
      /refusing to repack/,
    );
  });

  it("fails before packing for dirty state and rejects multiple or mismatched artifacts", () => {
    fakeTools({ dirty: true });
    assert.throws(
      () =>
        createManifest({
          sha,
          tag: "v3.1.0",
          version: "3.1.0",
          outDir: outputDirectory("dirty-pack-"),
        }),
      /repository is dirty/,
    );
    fakeTools({ head: "b".repeat(40) });
    assert.throws(
      () =>
        createManifest({
          sha,
          tag: "v3.1.0",
          version: "3.1.0",
          outDir: outputDirectory("mismatch-pack-"),
        }),
      /HEAD does not match/,
    );
    fakeTools({ noTarball: true });
    assert.throws(
      () =>
        createManifest({
          sha,
          tag: "v3.1.0",
          version: "3.1.0",
          outDir: outputDirectory("empty-pack-"),
        }),
      /exactly one tarball/,
    );
    fakeTools({ extraTarball: true });
    assert.throws(
      () =>
        createManifest({
          sha,
          tag: "v3.1.0",
          version: "3.1.0",
          outDir: outputDirectory("multiple-pack-"),
        }),
      /exactly one tarball/,
    );
    fakeTools({ packageVersion: "9.9.9" });
    assert.throws(
      () =>
        createManifest({
          sha,
          tag: "v3.1.0",
          version: "3.1.0",
          outDir: outputDirectory("identity-pack-"),
        }),
      /identity/,
    );
  });

  it("verifies published registry identity without publishing", async () => {
    const manifestPath = join(
      mkdtempSync(join(tmpdir(), "registry-pack-")),
      "release-artifact.json",
    );
    temporary.push(manifestPath.replace("/release-artifact.json", ""));
    writeFileSync(
      manifestPath,
      JSON.stringify({
        schema: "carpeos.release-artifact/v1",
        git_sha: sha,
        annotated_tag: "v3.1.0",
        package_name: "@innocarpe/carpeos",
        version: "3.1.0",
        filename: "carpeos-3.1.0.tgz",
        bytes: 1,
        sha256: `sha256:${"b".repeat(64)}`,
        sha512: integrity,
        npm_integrity: integrity,
        creation_tool: "npm",
        creation_tool_version: "11.0.0",
      }) + "\n",
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          name: "@innocarpe/carpeos",
          version: "3.1.0",
          gitHead: sha,
          dist: { integrity },
        }),
        { status: 200 },
      );
    try {
      assert.deepEqual(await verifyRegistry(manifestPath), {
        package_name: "@innocarpe/carpeos",
        version: "3.1.0",
        npm_integrity: integrity,
        git_sha: sha,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
