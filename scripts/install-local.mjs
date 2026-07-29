#!/usr/bin/env node
/**
 * One-stop local installer for a CarpeOS git checkout.
 *
 * Usage:
 *   node scripts/install-local.mjs --yes
 *   node scripts/install-local.mjs --dry-run
 *   node scripts/install-local.mjs --doctor
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import {
  DEFAULT_TRUST_ZONE,
  defaultBinDir,
  defaultHome,
  defaultRepoRoot,
  doctorInstall,
  installLocal,
  isTrustZoneId,
  parseInstallArgs as parseInstallArgsBase,
  trustZoneFromHostname,
} from "./lib/install-core.mjs";

function printHelp() {
  process.stdout.write(`CarpeOS one-stop local installer

Usage:
  node scripts/install-local.mjs --yes [options]
  node scripts/install-local.mjs --dry-run
  node scripts/install-local.mjs --doctor

Options:
  --home <path>             Runtime home (default: $CARPEOS_HOME or ~/.carpeos)
  --bin-dir <path>          Wrapper install dir (default: ~/.local/bin)
  --workspace-root <path>   Default workspace root for MCP (default: $HOME)
  --trust-zone <id|auto>    Trust zone id (default: tz_local_default; auto=host-based)
  --hosts <list>            auto|claude,codex,grok (default: auto)
  --repo-root <path>        Checkout root (default: auto-detect)
  --skip-build              Skip pnpm install/build
  --skip-mcp                Skip host MCP registration
  --dry-run                 Print plan only
  --doctor                  Run doctor against existing install only
  --yes, -y                 Required for real install (safety)
  --help, -h                Show help
`);
}

function parseArgs(argv) {
  const filtered = [];
  let doctor = false;
  for (const arg of argv) {
    if (arg === "--doctor") {
      doctor = true;
    } else {
      filtered.push(arg);
    }
  }
  return { ...parseInstallArgsBase(filtered), doctor };
}

function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
    return;
  }

  if (args.help) {
    printHelp();
    return;
  }

  const repoRoot =
    typeof args.repoRoot === "string" && args.repoRoot
      ? resolve(String(args.repoRoot))
      : defaultRepoRoot();
  const home =
    typeof args.home === "string" && args.home ? resolve(String(args.home)) : defaultHome();
  const binDir =
    typeof args.binDir === "string" && args.binDir ? resolve(String(args.binDir)) : defaultBinDir();
  const workspaceRoot =
    typeof args.workspaceRoot === "string" && args.workspaceRoot
      ? resolve(String(args.workspaceRoot))
      : process.env.HOME || homedir();

  let trustZone =
    typeof args.trustZone === "string" && args.trustZone
      ? String(args.trustZone)
      : DEFAULT_TRUST_ZONE;
  if (trustZone === "auto") {
    trustZone = trustZoneFromHostname();
  }
  if (!isTrustZoneId(trustZone)) {
    process.stderr.write(`invalid --trust-zone: ${trustZone}\n`);
    process.exitCode = 2;
    return;
  }

  if (args.doctor) {
    const configPath = join(home, "config.json");
    if (!existsSync(configPath)) {
      process.stderr.write(`no install config at ${configPath}; run install first\n`);
      process.exitCode = 1;
      return;
    }
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const doctor = doctorInstall({ config });
    process.stdout.write(`${JSON.stringify({ ok: doctor.ok, doctor }, null, 2)}\n`);
    process.exitCode = doctor.ok ? 0 : 1;
    return;
  }

  if (!args.dryRun && !args.yes) {
    process.stderr.write("Refusing to modify the machine without --yes (or use --dry-run).\n");
    process.exitCode = 2;
    return;
  }

  /** @type {string[] | undefined} */
  let hosts;
  if (args.hosts === "auto") {
    hosts = undefined;
  } else if (typeof args.hosts === "string") {
    hosts = String(args.hosts)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  try {
    const result = installLocal({
      repoRoot,
      home,
      binDir,
      workspaceRoot,
      trustZoneId: trustZone,
      nodePath: process.execPath,
      skipBuild: Boolean(args.skipBuild),
      skipMcp: Boolean(args.skipMcp),
      hosts,
      dryRun: Boolean(args.dryRun),
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: result.doctor.ok,
          dry_run: Boolean(args.dryRun),
          home: result.config.home,
          bin_dir: result.config.bin_dir,
          trust_zone_id: result.config.trust_zone_id,
          hosts: result.hostResults,
          doctor: result.doctor,
          path_hint: result.state.path_hint,
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = result.doctor.ok || args.dryRun ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `install failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

main();
