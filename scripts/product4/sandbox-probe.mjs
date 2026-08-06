#!/usr/bin/env node
/**
 * In-sandbox Product 4 control probe.
 *
 * Run only inside bubblewrap after setpriv --no-new-privs. Requires identity
 * and roots via PRODUCT4_* env (host absolute paths bind-mounted into the
 * namespace). Writes a measured observation JSON to the output path.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectSandboxProbeObservation } from "./p02-runner.mjs";

function requireEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${name} is required for the sandbox probe`);
  return value;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const outputPath = resolve(process.argv[2] ?? "/output/sandbox-probe.json");
    const observation = collectSandboxProbeObservation({
      identity: {
        head_sha: requireEnv("PRODUCT4_HEAD_SHA"),
        base_sha: requireEnv("PRODUCT4_BASE_SHA"),
        tree_sha256: requireEnv("PRODUCT4_TREE_SHA256"),
        fixture_sha256: requireEnv("PRODUCT4_FIXTURE_SHA256"),
        policy_sha256: requireEnv("PRODUCT4_POLICY_SHA256"),
        context: requireEnv("PRODUCT4_CONTEXT"),
      },
      roots: {
        candidate_root: requireEnv("PRODUCT4_CANDIDATE_ROOT"),
        workspace_root: requireEnv("PRODUCT4_WORKSPACE_ROOT"),
        cli_root: requireEnv("PRODUCT4_CLI_ROOT"),
        home: requireEnv("PRODUCT4_HOME_ROOT"),
        output: requireEnv("PRODUCT4_OUTPUT_ROOT"),
      },
    });
    writeFileSync(outputPath, `${JSON.stringify(observation)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 23;
  }
}
