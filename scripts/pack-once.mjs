#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = join(root, "packages/carpeos");
const packageJsonPath = join(packageDir, "package.json");
const manifestName = "release-artifact.json";
const shaPattern = /^[0-9a-f]{40}$/;
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const slsaPredicateType = "https://slsa.dev/provenance/v1";
const statementType = "https://in-toto.io/Statement/v1";
const githubActionsBuildType =
  "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1";
const githubRepository = "https://github.com/innocarpe/CarpeOS";
const githubWorkflowPath = ".github/workflows/release.yml";
const githubHostedBuilder = "https://github.com/actions/runner/github-hosted";

function fail(message) {
  throw new Error(`pack-once: ${message}`);
}

function command(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", ...options });
  if (result.status !== 0)
    fail(`${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim();
}

function required(options, name) {
  const value = options[name];
  if (!value) fail(`--${name} is required`);
  return value;
}

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!flag?.startsWith("--") || argv[index + 1]?.startsWith("--"))
      fail(`invalid option ${flag || ""}`);
    options[flag.slice(2)] = argv[index + 1];
  }
  return options;
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
function parsePackOutput(output) {
  try {
    return JSON.parse(output);
  } catch {
    const arrayStart = output.lastIndexOf("\n[");
    if (arrayStart === -1) fail("npm pack did not return JSON");
    try {
      return JSON.parse(output.slice(arrayStart + 1));
    } catch {
      fail("npm pack did not return JSON");
    }
  }
}

function packageIdentity(tarball) {
  const contents = command("tar", ["-xOf", tarball, "package/package.json"]);
  try {
    const pkg = JSON.parse(contents);
    if (typeof pkg.name !== "string" || typeof pkg.version !== "string")
      fail("tarball package.json lacks name or version");
    return { name: pkg.name, version: pkg.version };
  } catch (error) {
    if (error.message.startsWith("pack-once:")) throw error;
    fail(`cannot parse tarball package.json: ${error.message}`);
  }
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sha512(path) {
  return createHash("sha512").update(readFileSync(path)).digest("base64");
}

function assertReleaseState({ sha, tag, version }) {
  if (!shaPattern.test(sha)) fail("--sha must be a full lowercase 40-character git SHA");
  if (!tag.startsWith("v") || tag.slice(1) !== version) fail("--tag must be v<version>");
  if (!versionPattern.test(version)) fail("--version must be a SemVer version");
  if (command("git", ["status", "--porcelain"]) !== "") fail("repository is dirty");
  if (command("git", ["rev-parse", "HEAD"]) !== sha) fail("HEAD does not match --sha");
  if (command("git", ["cat-file", "-t", tag]) !== "tag") fail(`${tag} is not an annotated tag`);
  if (command("git", ["rev-list", "-n", "1", tag]) !== sha)
    fail(`${tag} does not resolve to --sha`);
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (pkg.version !== version)
    fail(`package version ${pkg.version} does not match --version ${version}`);
  return pkg.name;
}

export function createManifest({ sha, tag, version, outDir }) {
  const packageName = assertReleaseState({ sha, tag, version });
  const output = resolve(root, outDir);
  if (existsSync(output))
    fail(`output directory already exists; refusing to repack: ${relative(root, output)}`);
  mkdirSync(output, { recursive: false });
  const npmVersion = command("npm", ["--version"]);
  const packed = command("npm", ["pack", "--json", "--pack-destination", output], {
    cwd: packageDir,
  });
  const result = parsePackOutput(packed);
  const tarballs = readdirSync(output).filter((entry) => entry.endsWith(".tgz"));
  if (
    tarballs.length !== 1 ||
    !Array.isArray(result) ||
    result.length !== 1 ||
    result[0]?.filename !== tarballs[0]
  )
    fail("packing must produce exactly one tarball");
  const filename = tarballs[0];
  const tarball = join(output, filename);
  const identity = packageIdentity(tarball);
  if (identity.name !== packageName || identity.version !== version)
    fail("tarball package identity does not match approved release");
  const bytes = statSync(tarball).size;
  if (!Number.isSafeInteger(bytes) || bytes <= 0) fail("tarball byte count is invalid");
  const digest256 = sha256(tarball);
  const digest512 = sha512(tarball);
  const manifest = {
    schema: "carpeos.release-artifact/v1",
    git_sha: sha,
    annotated_tag: tag,
    package_name: identity.name,
    version,
    filename,
    bytes,
    sha256: `sha256:${digest256}`,
    sha512: `sha512-${digest512}`,
    npm_integrity: `sha512-${digest512}`,
    creation_tool: "npm",
    creation_tool_version: npmVersion,
  };
  writeFileSync(join(output, manifestName), stableJson(manifest), "utf8");
  return { manifest, manifestPath: join(output, manifestName), tarball };
}

export function readManifest(manifestPath) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail(`cannot read manifest: ${error.message}`);
  }
  const expected = [
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
  ];
  if (
    Object.keys(manifest).join(",") !== expected.join(",") ||
    manifest.schema !== "carpeos.release-artifact/v1"
  )
    fail("manifest schema is invalid");
  if (
    !shaPattern.test(manifest.git_sha) ||
    !versionPattern.test(manifest.version) ||
    manifest.annotated_tag !== `v${manifest.version}` ||
    manifest.package_name !== "@innocarpe/carpeos" ||
    !/^[^/]+\.tgz$/.test(manifest.filename)
  )
    fail("manifest release binding is invalid");
  if (
    !Number.isSafeInteger(manifest.bytes) ||
    manifest.bytes <= 0 ||
    !/^sha256:[0-9a-f]{64}$/.test(manifest.sha256) ||
    !/^sha512-[A-Za-z0-9+/]{86}==$/.test(manifest.sha512) ||
    manifest.sha512 !== manifest.npm_integrity ||
    manifest.creation_tool !== "npm" ||
    typeof manifest.creation_tool_version !== "string" ||
    manifest.creation_tool_version.length === 0
  )
    fail("manifest artifact hashes are invalid");
  return manifest;
}

export function assertArtifact(manifestPath, tarballPath) {
  const manifest = readManifest(manifestPath);
  const expectedPath = resolve(dirname(manifestPath), manifest.filename);
  if (resolve(tarballPath) !== expectedPath) fail("tarball path is not the manifest artifact path");
  if (!existsSync(expectedPath) || statSync(expectedPath).size !== manifest.bytes)
    fail("tarball bytes do not match manifest");
  if (
    `sha256:${sha256(expectedPath)}` !== manifest.sha256 ||
    `sha512-${sha512(expectedPath)}` !== manifest.sha512
  )
    fail("tarball hashes do not match manifest");
  const identity = packageIdentity(expectedPath);
  if (identity.name !== manifest.package_name || identity.version !== manifest.version)
    fail("tarball identity does not match manifest");
  return manifest;
}
function canonicalRegistryBase(registry) {
  let base;
  try {
    base = new URL(registry);
  } catch {
    fail("registry URL is invalid");
  }
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash)
    fail("registry URL is invalid");
  return `${base.origin}${base.pathname.replace(/\/+$/, "")}`;
}

function canonicalAttestationEndpoint(registry, manifest) {
  return `${canonicalRegistryBase(registry)}/-/npm/v1/attestations/${encodeURIComponent(manifest.package_name)}@${encodeURIComponent(manifest.version)}`;
}

function provenanceInvocation(statement, manifest) {
  const expectedSubject = `pkg:npm/%40innocarpe/carpeos@${manifest.version}`;
  const expectedDigest = Buffer.from(manifest.sha512.slice("sha512-".length), "base64").toString(
    "hex",
  );
  const expectedRef = `refs/tags/v${manifest.version}`;
  const expectedDependency = `git+https://github.com/innocarpe/CarpeOS@${expectedRef}`;
  const subject = statement?.subject;
  const predicate = statement?.predicate;
  const buildDefinition = predicate?.buildDefinition;
  const workflow = buildDefinition?.externalParameters?.workflow;
  const dependencies = buildDefinition?.resolvedDependencies;
  const invocation = predicate?.runDetails?.metadata?.invocationId;
  const invocationPrefix = `${githubRepository}/actions/runs/`;
  if (
    statement?._type !== statementType ||
    statement?.predicateType !== slsaPredicateType ||
    !Array.isArray(subject) ||
    subject.length !== 1 ||
    subject[0]?.name !== expectedSubject ||
    subject[0]?.digest?.sha512 !== expectedDigest ||
    buildDefinition?.buildType !== githubActionsBuildType ||
    workflow?.repository !== githubRepository ||
    workflow?.ref !== expectedRef ||
    workflow?.path !== githubWorkflowPath ||
    buildDefinition?.internalParameters?.github?.event_name !== "push" ||
    !Array.isArray(dependencies) ||
    dependencies.length !== 1 ||
    dependencies[0]?.uri !== expectedDependency ||
    dependencies[0]?.digest?.gitCommit !== manifest.git_sha ||
    predicate?.runDetails?.builder?.id !== githubHostedBuilder ||
    typeof invocation !== "string" ||
    !invocation.startsWith(invocationPrefix) ||
    !/^\d+\/attempts\/\d+$/.test(invocation.slice(invocationPrefix.length))
  )
    fail("SLSA provenance does not match manifest");
  return invocation;
}

async function verifyProvenance(registry, manifest) {
  const response = await fetch(canonicalAttestationEndpoint(registry, manifest), {
    headers: { accept: "application/json" },
    redirect: "error",
  });
  if (!response.ok) fail(`provenance lookup failed with HTTP ${response.status}`);
  let provenance;
  try {
    provenance = await response.json();
  } catch {
    fail("provenance response is invalid");
  }
  const attestations = provenance?.attestations;
  const matching = Array.isArray(attestations)
    ? attestations.filter((attestation) => attestation?.predicateType === slsaPredicateType)
    : [];
  if (matching.length !== 1) fail("SLSA provenance is missing or ambiguous");
  const envelope = matching[0]?.bundle?.dsseEnvelope;
  if (
    envelope?.payloadType !== "application/vnd.in-toto+json" ||
    typeof envelope?.payload !== "string" ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(envelope.payload) ||
    Buffer.from(envelope.payload, "base64").toString("base64") !== envelope.payload
  )
    fail("SLSA provenance envelope is invalid");
  let statement;
  try {
    statement = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
  } catch {
    fail("SLSA provenance payload is invalid");
  }
  return provenanceInvocation(statement, manifest);
}

export async function verifyRegistry(manifestPath, registry = "https://registry.npmjs.org") {
  const manifest = readManifest(manifestPath);
  const registryBase = canonicalRegistryBase(registry);
  const endpoint = `${registryBase}/${encodeURIComponent(manifest.package_name)}/${encodeURIComponent(manifest.version)}`;
  const response = await fetch(endpoint, {
    headers: { accept: "application/json" },
    redirect: "error",
  });
  if (!response.ok) fail(`registry lookup failed with HTTP ${response.status}`);
  let published;
  try {
    published = await response.json();
  } catch {
    fail("registry metadata is invalid");
  }
  if (
    published.name !== manifest.package_name ||
    published.version !== manifest.version ||
    published.dist?.integrity !== manifest.npm_integrity
  )
    fail("registry metadata does not match manifest");
  if (typeof published.gitHead === "string") {
    if (published.gitHead !== manifest.git_sha) fail("registry metadata does not match manifest");
    return {
      package_name: published.name,
      version: published.version,
      npm_integrity: published.dist.integrity,
      git_sha: manifest.git_sha,
      source_identity: "gitHead",
    };
  }
  if (
    published.gitHead !== undefined ||
    published.dist?.attestations?.provenance?.predicateType !== slsaPredicateType
  )
    fail("registry metadata does not match manifest");
  const invocation = await verifyProvenance(registryBase, manifest);
  return {
    package_name: published.name,
    version: published.version,
    npm_integrity: published.dist.integrity,
    git_sha: manifest.git_sha,
    source_identity: "slsa-provenance",
    provenance_invocation: invocation,
  };
}

async function main(argv = process.argv.slice(2)) {
  const [action, ...rest] = argv;
  const options = parseOptions(rest);
  if (action === "pack") {
    const output = createManifest({
      sha: required(options, "sha"),
      tag: required(options, "tag"),
      version: required(options, "version"),
      outDir: required(options, "out-dir"),
    });
    process.stdout.write(
      stableJson({
        manifest: relative(root, output.manifestPath),
        tarball: relative(root, output.tarball),
      }),
    );
    return;
  }
  if (action === "assert-artifact") {
    assertArtifact(required(options, "manifest"), required(options, "tarball"));
    return;
  }
  if (action === "verify-registry") {
    const verified = await verifyRegistry(required(options, "manifest"), options.registry);
    process.stdout.write(stableJson(verified));
    return;
  }
  fail(
    "usage: pack --sha <sha> --tag <tag> --version <version> --out-dir <directory> | assert-artifact --manifest <path> --tarball <path> | verify-registry --manifest <path> [--registry <url>]",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
