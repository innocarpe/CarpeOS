import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { assertArtifact, createManifest, verifyRegistry } from "../pack-once.mjs";
import { resolveCliInvocation } from "../smoke-dogfood.mjs";

const sha = "a".repeat(40);
const originalPath = process.env.PATH;
const temporary = [];
const integrity = `sha512-${"A".repeat(86)}==`;
const { version } = JSON.parse(
  readFileSync(new URL("../../packages/carpeos/package.json", import.meta.url), "utf8"),
);
const tag = `v${version}`;
const tarballFilename = `carpeos-${version}.tgz`;

function fakeTools({
  dirty = false,
  extraTarball = false,
  head = sha,
  noTarball = false,
  packageVersion = version,
  packOutput,
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), "pack-once-"));
  temporary.push(directory);
  const git = `#!/usr/bin/env node
const args = process.argv.slice(2).join(" ");
if (args === "status --porcelain") process.stdout.write(${JSON.stringify(dirty ? " M changed" : "")});
else if (args === "rev-parse HEAD") process.stdout.write("${head}");
else if (args === ${JSON.stringify(`rev-list -n 1 ${tag}`)}) process.stdout.write("${sha}");
else if (args === ${JSON.stringify(`cat-file -t ${tag}`)}) process.stdout.write("tag");
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
if (!${noTarball}) writeFileSync(out + "/${tarballFilename}", gzipSync(tar, { mtime: 0 }));
if (${extraTarball}) writeFileSync(out + "/second.tgz", gzipSync(tar, { mtime: 0 }));
process.stdout.write(${JSON.stringify(
    packOutput ??
      `> @innocarpe/carpeos@${packageVersion} prepack
> node scripts/prepack.mjs
[${JSON.stringify({ filename: tarballFilename })}]`,
  )});
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
function registryManifest() {
  const directory = mkdtempSync(join(tmpdir(), "registry-pack-"));
  temporary.push(directory);
  const manifestPath = join(directory, "release-artifact.json");
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
  return manifestPath;
}

function provenanceStatement({
  commit = sha,
  digest = Buffer.from("A".repeat(86) + "==", "base64").toString("hex"),
} = {}) {
  return {
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: "pkg:npm/%40innocarpe/carpeos@3.1.0", digest: { sha512: digest } }],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
        externalParameters: {
          workflow: {
            repository: "https://github.com/innocarpe/CarpeOS",
            ref: "refs/tags/v3.1.0",
            path: ".github/workflows/release.yml",
          },
        },
        internalParameters: { github: { event_name: "push" } },
        resolvedDependencies: [
          {
            uri: "git+https://github.com/innocarpe/CarpeOS@refs/tags/v3.1.0",
            digest: { gitCommit: commit },
          },
        ],
      },
      runDetails: {
        builder: { id: "https://github.com/actions/runner/github-hosted" },
        metadata: {
          invocationId: "https://github.com/innocarpe/CarpeOS/actions/runs/123/attempts/1",
        },
      },
    },
  };
}

function provenanceResponse(statement) {
  return {
    attestations: [
      {
        predicateType: "https://slsa.dev/provenance/v1",
        bundle: {
          dsseEnvelope: {
            payloadType: "application/vnd.in-toto+json",
            payload: Buffer.from(JSON.stringify(statement)).toString("base64"),
          },
        },
      },
    ],
  };
}

function registryMetadata({ gitHead, attestations } = {}) {
  return {
    name: "@innocarpe/carpeos",
    version: "3.1.0",
    ...(gitHead === undefined ? {} : { gitHead }),
    dist: {
      integrity,
      ...(attestations === undefined ? {} : { attestations }),
    },
  };
}
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
      tag,
      version,
      outDir: outputDirectory("pack-out-"),
    });
    const second = createManifest({
      sha,
      tag,
      version,
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
    assert.equal(first.manifest.annotated_tag, tag);
    assert.equal(first.manifest.npm_integrity, first.manifest.sha512);
    assertArtifact(first.manifestPath, first.tarball);
    assert.throws(
      () =>
        createManifest({
          sha,
          tag,
          version,
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
          tag,
          version,
          outDir: outputDirectory("dirty-pack-"),
        }),
      /repository is dirty/,
    );
    fakeTools({ head: "b".repeat(40) });
    assert.throws(
      () =>
        createManifest({
          sha,
          tag,
          version,
          outDir: outputDirectory("mismatch-pack-"),
        }),
      /HEAD does not match/,
    );
    fakeTools({ noTarball: true });
    assert.throws(
      () =>
        createManifest({
          sha,
          tag,
          version,
          outDir: outputDirectory("empty-pack-"),
        }),
      /exactly one tarball/,
    );
    fakeTools({ extraTarball: true });
    assert.throws(
      () =>
        createManifest({
          sha,
          tag,
          version,
          outDir: outputDirectory("multiple-pack-"),
        }),
      /exactly one tarball/,
    );
    fakeTools({ packageVersion: "9.9.9" });
    assert.throws(
      () =>
        createManifest({
          sha,
          tag,
          version,
          outDir: outputDirectory("identity-pack-"),
        }),
      /identity/,
    );
  });
  it("rejects lifecycle output without a final JSON array", () => {
    fakeTools({
      packOutput: `> @innocarpe/carpeos@${version} prepack\ncomplete`,
    });
    assert.throws(
      () =>
        createManifest({
          sha,
          tag,
          version,
          outDir: outputDirectory("malformed-pack-"),
        }),
      /npm pack did not return JSON/,
    );
  });

  it("verifies exact published gitHead without fetching an attestation", async () => {
    const manifestPath = registryManifest();
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify(registryMetadata({ gitHead: sha })), { status: 200 });
    };
    try {
      assert.deepEqual(await verifyRegistry(manifestPath), {
        package_name: "@innocarpe/carpeos",
        version: "3.1.0",
        npm_integrity: integrity,
        git_sha: sha,
        source_identity: "gitHead",
      });
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it("rejects an HTTP registry before fetching", async () => {
    const manifestPath = registryManifest();
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error("must not fetch");
    };
    try {
      await assert.rejects(
        verifyRegistry(manifestPath, "http://registry.example.test"),
        /registry URL is invalid/,
      );
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("verifies missing gitHead with canonical exact SLSA provenance", async () => {
    const manifestPath = registryManifest();
    const originalFetch = globalThis.fetch;
    const registry = "https://registry.example.test/npm";
    const expectedAttestation =
      "https://registry.example.test/npm/-/npm/v1/attestations/%40innocarpe%2Fcarpeos@3.1.0";
    const requests = [];
    globalThis.fetch = async (url, options) => {
      requests.push({ url: String(url), options });
      if (requests.length === 1)
        return new Response(
          JSON.stringify(
            registryMetadata({
              attestations: {
                url: "https://untrusted.example.test/attestations",
                provenance: { predicateType: "https://slsa.dev/provenance/v1" },
              },
            }),
          ),
          { status: 200 },
        );
      assert.equal(String(url), expectedAttestation);
      return new Response(JSON.stringify(provenanceResponse(provenanceStatement())), {
        status: 200,
      });
    };
    try {
      assert.deepEqual(await verifyRegistry(manifestPath, registry), {
        package_name: "@innocarpe/carpeos",
        version: "3.1.0",
        npm_integrity: integrity,
        git_sha: sha,
        source_identity: "slsa-provenance",
        provenance_invocation: "https://github.com/innocarpe/CarpeOS/actions/runs/123/attempts/1",
      });
      assert.equal(requests.length, 2);
      assert.deepEqual(
        requests.map((request) => request.options),
        [
          { headers: { accept: "application/json" }, redirect: "error" },
          { headers: { accept: "application/json" }, redirect: "error" },
        ],
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects a conflicting gitHead without falling back to provenance", async () => {
    const manifestPath = registryManifest();
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(
        JSON.stringify(
          registryMetadata({
            gitHead: "b".repeat(40),
            attestations: { provenance: { predicateType: "https://slsa.dev/provenance/v1" } },
          }),
        ),
        { status: 200 },
      );
    };
    try {
      await assert.rejects(
        verifyRegistry(manifestPath),
        /registry metadata does not match manifest/,
      );
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects missing SLSA provenance when gitHead is absent", async () => {
    const manifestPath = registryManifest();
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify(registryMetadata()), { status: 200 });
    };
    try {
      await assert.rejects(
        verifyRegistry(manifestPath),
        /registry metadata does not match manifest/,
      );
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects provenance with a wrong resolved source commit", async () => {
    const manifestPath = registryManifest();
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1)
        return new Response(
          JSON.stringify(
            registryMetadata({
              attestations: { provenance: { predicateType: "https://slsa.dev/provenance/v1" } },
            }),
          ),
          { status: 200 },
        );
      return new Response(
        JSON.stringify(provenanceResponse(provenanceStatement({ commit: "b".repeat(40) }))),
        { status: 200 },
      );
    };
    try {
      await assert.rejects(verifyRegistry(manifestPath), /SLSA provenance does not match manifest/);
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects provenance with a wrong subject digest", async () => {
    const manifestPath = registryManifest();
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1)
        return new Response(
          JSON.stringify(
            registryMetadata({
              attestations: { provenance: { predicateType: "https://slsa.dev/provenance/v1" } },
            }),
          ),
          { status: 200 },
        );
      return new Response(
        JSON.stringify(provenanceResponse(provenanceStatement({ digest: "f".repeat(128) }))),
        { status: 200 },
      );
    };
    try {
      await assert.rejects(verifyRegistry(manifestPath), /SLSA provenance does not match manifest/);
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it("rejects provenance statement identity mutations", async () => {
    const mutations = [
      ["statement type", (statement) => (statement._type = "https://example.test/Statement/v1")],
      [
        "statement predicate type",
        (statement) => (statement.predicateType = "https://example.test/provenance/v1"),
      ],
      ["subject package", (statement) => (statement.subject[0].name = "pkg:npm/other@3.1.0")],
      [
        "subject ambiguity",
        (statement) => statement.subject.push(structuredClone(statement.subject[0])),
      ],
      [
        "build type",
        (statement) =>
          (statement.predicate.buildDefinition.buildType = "https://example.test/build/v1"),
      ],
      [
        "repository",
        (statement) =>
          (statement.predicate.buildDefinition.externalParameters.workflow.repository =
            "https://github.com/example/repo"),
      ],
      [
        "tag ref",
        (statement) =>
          (statement.predicate.buildDefinition.externalParameters.workflow.ref =
            "refs/tags/v0.0.0"),
      ],
      [
        "workflow path",
        (statement) =>
          (statement.predicate.buildDefinition.externalParameters.workflow.path =
            ".github/workflows/other.yml"),
      ],
      [
        "event",
        (statement) =>
          (statement.predicate.buildDefinition.internalParameters.github.event_name =
            "workflow_dispatch"),
      ],
      [
        "dependency URI",
        (statement) =>
          (statement.predicate.buildDefinition.resolvedDependencies[0].uri =
            "git+https://github.com/example/repo@refs/tags/v3.1.0"),
      ],
      [
        "dependency ambiguity",
        (statement) =>
          statement.predicate.buildDefinition.resolvedDependencies.push(
            structuredClone(statement.predicate.buildDefinition.resolvedDependencies[0]),
          ),
      ],
      [
        "builder",
        (statement) => (statement.predicate.runDetails.builder.id = "https://example.test/builder"),
      ],
      [
        "invocation",
        (statement) =>
          (statement.predicate.runDetails.metadata.invocationId =
            "https://github.com/innocarpe/CarpeOS/actions/runs/x/attempts/1"),
      ],
    ];
    for (const [name, mutate] of mutations) {
      const manifestPath = registryManifest();
      const originalFetch = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        if (calls === 1)
          return new Response(
            JSON.stringify(
              registryMetadata({
                attestations: { provenance: { predicateType: "https://slsa.dev/provenance/v1" } },
              }),
            ),
            { status: 200 },
          );
        const statement = structuredClone(provenanceStatement());
        mutate(statement);
        return new Response(JSON.stringify(provenanceResponse(statement)), { status: 200 });
      };
      try {
        await assert.rejects(
          verifyRegistry(manifestPath),
          /SLSA provenance does not match manifest/,
          name,
        );
        assert.equal(calls, 2, name);
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  });

  it("rejects ambiguous SLSA attestations and malformed provenance envelopes", async () => {
    const cases = [
      [
        "ambiguous attestations",
        () => {
          const response = provenanceResponse(provenanceStatement());
          response.attestations.push(structuredClone(response.attestations[0]));
          return response;
        },
        /SLSA provenance is missing or ambiguous/,
      ],
      [
        "malformed envelope",
        () => {
          const response = provenanceResponse(provenanceStatement());
          response.attestations[0].bundle.dsseEnvelope.payload = "not-base64!";
          return response;
        },
        /SLSA provenance envelope is invalid/,
      ],
    ];
    for (const [name, makeResponse, error] of cases) {
      const manifestPath = registryManifest();
      const originalFetch = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        if (calls === 1)
          return new Response(
            JSON.stringify(
              registryMetadata({
                attestations: { provenance: { predicateType: "https://slsa.dev/provenance/v1" } },
              }),
            ),
            { status: 200 },
          );
        return new Response(JSON.stringify(makeResponse()), { status: 200 });
      };
      try {
        await assert.rejects(verifyRegistry(manifestPath), error, name);
        assert.equal(calls, 2, name);
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  });
});
