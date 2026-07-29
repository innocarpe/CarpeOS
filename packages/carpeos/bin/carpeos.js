#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const distCli = join(root, "..", "dist", "cli.js");
const setupEntry = join(root, "..", "dist", "setup", "run-setup.mjs");

const argv = process.argv.slice(2);
if (argv[0] === "setup" || argv[0] === "doctor") {
  const setupArgv = argv[0] === "doctor" ? ["--doctor", ...argv.slice(1)] : argv.slice(1);
  const result = spawnSync(process.execPath, [setupEntry, ...setupArgv], {
    stdio: "inherit",
    env: process.env,
  });
  process.exit(result.status ?? 1);
}

// Ensure Node runs the bundled CLI as main (import.meta.url main check).
const result = spawnSync(process.execPath, [distCli, ...argv], {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
