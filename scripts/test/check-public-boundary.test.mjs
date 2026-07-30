import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const boundaryCheck = join(root, "scripts/check-public-boundary.mjs");
const publicGitignore = readFileSync(join(root, ".gitignore"), "utf8");
const biomeIncludes = JSON.parse(readFileSync(join(root, "biome.json"), "utf8")).files.includes;

function createRepository() {
  const repository = mkdtempSync(join(tmpdir(), "carpeos-public-boundary-"));
  const init = spawnSync("git", ["init", "--quiet"], {
    cwd: repository,
    encoding: "utf8",
  });
  assert.equal(init.status, 0, init.stderr);
  return repository;
}

function runBoundaryCheck(repository) {
  return spawnSync(process.execPath, [boundaryCheck], {
    cwd: repository,
    encoding: "utf8",
  });
}

function git(repository, args) {
  return spawnSync("git", args, {
    cwd: repository,
    encoding: "utf8",
  });
}

function gitAdd(repository, filePath, { force = false } = {}) {
  const result = git(repository, ["add", ...(force ? ["--force"] : []), "--", filePath]);
  assert.equal(result.status, 0, result.stderr);
}

function tomlAssignment(keyParts, valueParts) {
  return `${keyParts.join("")} = "${valueParts.join("")}"\n`;
}

function assertRejectedCloudflareAssignment({ keyParts, valueParts }) {
  const repository = createRepository();
  try {
    const fileName = "wrangler.toml";
    writeFileSync(join(repository, fileName), tomlAssignment(keyParts, valueParts));
    gitAdd(repository, fileName);

    const result = runBoundaryCheck(repository);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      new RegExp(`non-placeholder Cloudflare ${keyParts.join("")} assignment`),
    );
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
}

describe("check-public-boundary", () => {
  it("excludes private runtime and generated Wrangler directories from Biome inputs", () => {
    for (const directory of [".omx", ".carpeos", ".wrangler"]) {
      assert.ok(biomeIncludes.includes(`!${directory}`));
      assert.ok(biomeIncludes.includes(`!**/${directory}`));
    }
  });

  it("passes a synthetic public fixture", () => {
    const repository = createRepository();
    try {
      writeFileSync(join(repository, "README.md"), "# Synthetic public fixture\n");
      const result = runBoundaryCheck(repository);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Public boundary check passed/);
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it("fails a synthetic protected-path fixture", () => {
    const repository = createRepository();
    try {
      const protectedDir = join(repository, ".carpeos");
      mkdirSync(protectedDir);
      writeFileSync(join(protectedDir, "fixture.toml"), 'name = "synthetic-fixture"\n');
      const result = runBoundaryCheck(repository);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /protected runtime, secret, or transcript path/);
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it("ignores an untracked generated Wrangler working directory at nested depth", () => {
    const repository = createRepository();
    const artifactPath = "packages/synthetic-worker/.wrangler/tmp/bundle.js";
    try {
      writeFileSync(join(repository, ".gitignore"), publicGitignore);
      mkdirSync(dirname(join(repository, artifactPath)), { recursive: true });
      writeFileSync(join(repository, artifactPath), "export default {};\n");

      const ignored = git(repository, ["check-ignore", "--quiet", "--", artifactPath]);
      const tracked = git(repository, ["ls-files", "--cached", "--", artifactPath]);
      const untracked = git(repository, [
        "ls-files",
        "--others",
        "--exclude-standard",
        "--",
        artifactPath,
      ]);
      assert.equal(ignored.status, 0, ignored.stderr);
      assert.equal(tracked.stdout, "");
      assert.equal(untracked.stdout, "");

      const result = runBoundaryCheck(repository);
      assert.equal(result.status, 0, result.stderr);
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it("rejects a force-tracked generated Wrangler working directory", () => {
    const repository = createRepository();
    const artifactPath = "packages/synthetic-worker/.wrangler/tmp/bundle.js";
    try {
      writeFileSync(join(repository, ".gitignore"), publicGitignore);
      mkdirSync(dirname(join(repository, artifactPath)), { recursive: true });
      writeFileSync(join(repository, artifactPath), "export default {};\n");
      gitAdd(repository, artifactPath, { force: true });

      const result = runBoundaryCheck(repository);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /protected runtime, secret, or transcript path/);
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it("passes approved public Cloudflare placeholders", () => {
    const repository = createRepository();
    try {
      const assignments = [
        tomlAssignment(["database", "_id"], ["00000000-0000-0000-0000-000000000000"]),
        tomlAssignment(["account", "_id"], ["not", "-deployed"]),
        tomlAssignment(["database", "_name"], ["carpeos", "_sync"]),
        tomlAssignment(["bucket", "_name"], ["carpeos", "-protected-values"]),
      ].join("");
      writeFileSync(join(repository, "wrangler.toml"), assignments);

      const result = runBoundaryCheck(repository);
      assert.equal(result.status, 0, result.stderr);
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it("rejects a tracked non-placeholder Cloudflare database ID", () => {
    assertRejectedCloudflareAssignment({
      keyParts: ["database", "_id"],
      valueParts: ["4f8a1c2e", "-", "71d5", "-", "4bea", "-", "9d35", "-", "6ab1f0c2e845"],
    });
  });

  it("rejects a tracked non-placeholder Cloudflare account ID", () => {
    assertRejectedCloudflareAssignment({
      keyParts: ["account", "_id"],
      valueParts: ["9a31d640", "2fd84e27", "b65c3174", "0c21e89f"],
    });
  });

  it("rejects a tracked private-looking Cloudflare database name", () => {
    assertRejectedCloudflareAssignment({
      keyParts: ["database", "_name"],
      valueParts: ["operator", "_knowledge"],
    });
  });

  it("rejects a tracked private-looking Cloudflare bucket name", () => {
    assertRejectedCloudflareAssignment({
      keyParts: ["bucket", "_name"],
      valueParts: ["operator", "-protected-values"],
    });
  });

  it("does not reject Cloudflare assignment examples embedded in prose", () => {
    const repository = createRepository();
    try {
      const inlineExample = tomlAssignment(
        ["database", "_id"],
        ["4f8a1c2e", "-", "71d5", "-", "4bea", "-", "9d35", "-", "6ab1f0c2e845"],
      ).trim();
      writeFileSync(
        join(repository, "README.md"),
        `For explanation only, a private config might contain ${inlineExample} before redaction.\n`,
      );

      const result = runBoundaryCheck(repository);
      assert.equal(result.status, 0, result.stderr);
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it("does not treat path-like prose install/home/wrappers as a Linux home path", () => {
    const repository = createRepository();
    try {
      mkdirSync(join(repository, "docs"), { recursive: true });
      writeFileSync(
        join(repository, "docs/synthetic-note.md"),
        "The recheck isolates install/home/wrappers/init without leaking operator homes.\n",
      );
      gitAdd(repository, "docs/synthetic-note.md");
      const result = runBoundaryCheck(repository);
      assert.equal(result.status, 0, result.stderr);
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it("still rejects absolute Linux home paths in tracked prose", () => {
    const repository = createRepository();
    try {
      mkdirSync(join(repository, "docs"), { recursive: true });
      // Split so this test file itself does not trip the boundary scanner.
      const leaked = ["/", "home", "/", "runner", "/", "work", "/carpeos"].join("");
      writeFileSync(join(repository, "docs/leak.md"), `Do not commit ${leaked} into docs.\n`);
      gitAdd(repository, "docs/leak.md");
      const result = runBoundaryCheck(repository);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /absolute Linux home path/);
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });
});
