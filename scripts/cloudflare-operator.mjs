#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PRIVATE_CONFIG_PARTS = [".carpeos", "cloudflare", "wrangler.toml"];
const WORKER_MAIN_PARTS = ["apps", "carpeos-sync-worker", "src", "index.ts"];
const WORKER_MIGRATIONS_PARTS = ["apps", "carpeos-sync-worker", "migrations"];

export const VALIDATE_SUCCESS_MESSAGE = "Private Cloudflare config validated.";

const DOCUMENTED_PLACEHOLDER_VALUES = new Set([
  "00000000-0000-0000-0000-000000000000",
  "carpeos-protected-values",
  "carpeos-protected-values-private-example",
  "carpeos-sync-private-example",
  "carpeos-sync-worker",
  "carpeos_sync",
  "carpeos_sync_private_example",
  "d1-database-id-from-cloudflare",
  "local",
  "private-example",
]);

function findRepoRoot(startDirectory = process.cwd()) {
  let candidate = resolve(startDirectory);

  while (true) {
    if (existsSync(join(candidate, ".git"))) {
      return candidate;
    }

    const parent = dirname(candidate);
    if (parent === candidate) {
      throw new Error("unable to find the repository root");
    }
    candidate = parent;
  }
}

function fileMode(filePath) {
  return lstatSync(filePath).mode & 0o7777;
}

function assertPrivateModes(configDirectory, configPath) {
  const directoryStat = lstatSync(configDirectory);
  if (!directoryStat.isDirectory()) {
    throw new Error("private config parent must be a directory");
  }
  if (fileMode(configDirectory) !== 0o700) {
    throw new Error("private config parent directory permissions must be 0700");
  }

  const configStat = lstatSync(configPath);
  if (!configStat.isFile()) {
    throw new Error("private config must be a regular file");
  }
  if (fileMode(configPath) !== 0o600) {
    throw new Error("private config file permissions must be 0600");
  }
}

function runGit(repoRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    throw new Error(`unable to verify private config with Git: ${result.error.message}`);
  }
  return result;
}

function assertIgnoredAndUntracked(repoRoot, configPath) {
  const repoRelativePath = relative(repoRoot, configPath);
  const tracked = runGit(repoRoot, ["ls-files", "--cached", "--", repoRelativePath]);

  if (tracked.status !== 0) {
    throw new Error("unable to verify whether the private config is tracked");
  }
  if (tracked.stdout.trim() !== "") {
    throw new Error("private config must be untracked");
  }

  const ignored = runGit(repoRoot, ["check-ignore", "--quiet", "--", repoRelativePath]);
  if (ignored.status === 1) {
    throw new Error("private config must be ignored by Git");
  }
  if (ignored.status !== 0) {
    throw new Error("unable to verify whether the private config is ignored");
  }
}

function parseStringAssignment(line) {
  const match = line.match(
    /^\s*([A-Za-z0-9_-]+)\s*=\s*(?:"((?:\\.|[^"])*)"|'([^']*)')\s*(?:#.*)?$/,
  );
  if (!match) {
    return undefined;
  }

  return {
    key: match[1],
    value: match[2] ?? match[3],
  };
}

function parsePrivateConfig(content) {
  const config = {
    d1Databases: [],
    r2Buckets: [],
    root: {},
    vars: {},
  };
  let target = config.root;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "[[d1_databases]]") {
      target = {};
      config.d1Databases.push(target);
      continue;
    }
    if (trimmed === "[[r2_buckets]]") {
      target = {};
      config.r2Buckets.push(target);
      continue;
    }
    if (trimmed === "[vars]") {
      target = config.vars;
      continue;
    }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      target = {};
      continue;
    }

    const assignment = parseStringAssignment(line);
    if (assignment) {
      target[assignment.key] = assignment.value;
    }
  }

  return config;
}

function requireValue(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`private config must define ${label}`);
  }
  return value;
}

function assertExactRepoTarget(value, label, configPath, repoRoot, targetParts) {
  const configuredPath = requireValue(value, label);
  const expectedPath = join(repoRoot, ...targetParts);
  if (resolve(dirname(configPath), configuredPath) !== expectedPath) {
    throw new Error(`private config ${label} must resolve to repo-local ${targetParts.join("/")}`);
  }
}

function validateConfigValues(content, configPath, repoRoot) {
  const parsed = parsePrivateConfig(content);
  const d1Database = parsed.d1Databases.find((database) => database.binding === "DB");
  const r2Bucket = parsed.r2Buckets.find((bucket) => bucket.binding === "PROTECTED_VALUES");

  assertExactRepoTarget(parsed.root.main, "main", configPath, repoRoot, WORKER_MAIN_PARTS);
  assertExactRepoTarget(
    d1Database?.migrations_dir,
    "migrations_dir",
    configPath,
    repoRoot,
    WORKER_MIGRATIONS_PARTS,
  );

  const values = {
    bucketName: requireValue(r2Bucket?.bucket_name, "R2 bucket_name"),
    d1DatabaseId: requireValue(d1Database?.database_id, "D1 database_id"),
    d1DatabaseName: requireValue(d1Database?.database_name, "D1 database_name"),
    environment: requireValue(parsed.vars.CARPEOS_ENV, "CARPEOS_ENV"),
    workerName: requireValue(parsed.root.name, "Worker name"),
  };

  for (const [label, value] of Object.entries(values)) {
    if (DOCUMENTED_PLACEHOLDER_VALUES.has(value.toLowerCase())) {
      throw new Error(`private config contains a documented placeholder value for ${label}`);
    }
  }

  return values;
}

export function validatePrivateConfig({
  configPath = process.env.CARPEOS_CF_CONFIG,
  repoRoot = findRepoRoot(),
} = {}) {
  if (typeof configPath !== "string" || configPath.trim() === "") {
    throw new Error("CARPEOS_CF_CONFIG is required");
  }
  if (!isAbsolute(configPath)) {
    throw new Error("CARPEOS_CF_CONFIG must be an absolute path");
  }

  const absoluteRepoRoot = resolve(repoRoot);
  const expectedConfigPath = join(absoluteRepoRoot, ...PRIVATE_CONFIG_PARTS);
  const resolvedConfigPath = resolve(configPath);
  if (resolvedConfigPath !== expectedConfigPath) {
    throw new Error(
      "CARPEOS_CF_CONFIG must resolve to repo-local .carpeos/cloudflare/wrangler.toml",
    );
  }
  if (!existsSync(resolvedConfigPath)) {
    throw new Error("private config file does not exist");
  }

  const realRepoRoot = realpathSync(absoluteRepoRoot);
  const realConfigPath = realpathSync(resolvedConfigPath);
  const expectedRealConfigPath = join(realRepoRoot, ...PRIVATE_CONFIG_PARTS);
  if (realConfigPath !== expectedRealConfigPath) {
    throw new Error(
      "CARPEOS_CF_CONFIG must resolve to repo-local .carpeos/cloudflare/wrangler.toml",
    );
  }

  assertPrivateModes(dirname(realConfigPath), realConfigPath);
  assertIgnoredAndUntracked(realRepoRoot, realConfigPath);
  const values = validateConfigValues(
    readFileSync(realConfigPath, "utf8"),
    realConfigPath,
    realRepoRoot,
  );

  return {
    configPath: resolvedConfigPath,
    ...values,
  };
}

export function runOperator({
  command,
  configPath = process.env.CARPEOS_CF_CONFIG,
  repoRoot = findRepoRoot(),
  spawn = spawnSync,
} = {}) {
  if (!["deploy", "migrate", "validate"].includes(command)) {
    throw new Error("operator action must be validate, deploy, or migrate");
  }

  const validated = validatePrivateConfig({ configPath, repoRoot });
  let args;
  if (command === "migrate") {
    args = [
      "d1",
      "migrations",
      "apply",
      validated.d1DatabaseName,
      "--remote",
      "--config",
      validated.configPath,
    ];
  } else if (command === "validate") {
    const dryRunDirectory = join(dirname(validated.configPath), "dry-run");
    args = ["deploy", "--dry-run", "--outdir", dryRunDirectory, "--config", validated.configPath];
  } else {
    args = ["deploy", "--config", validated.configPath];
  }

  const result = spawn("wrangler", args, {
    cwd: resolve(repoRoot),
    stdio: command === "validate" ? "ignore" : "inherit",
  });
  if (result.error) {
    throw new Error(`Wrangler ${command} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Wrangler ${command} failed with status ${result.status}`);
  }

  return {
    ...validated,
    command,
    status: result.status,
  };
}

export function main(argv, { log = console.log, operator = runOperator } = {}) {
  const [command, ...extraArguments] = argv;
  if (extraArguments.length > 0) {
    throw new Error("operator accepts exactly one action");
  }

  operator({ command });
  if (command === "validate") {
    log(VALIDATE_SUCCESS_MESSAGE);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
