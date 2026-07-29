/**
 * Runtime setup entry for npm-global installs.
 * Copied into dist/setup/run-setup.mjs at package build time.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_TRUST_ZONE,
  defaultBinDir,
  defaultHome,
  doctorInstall,
  installLocal,
  isTrustZoneId,
  trustZoneFromHostname,
} from "./install-core.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// dist/setup -> dist -> package root
const packageRoot = resolve(here, "../..");

function parseArgs(argv) {
  const out = {
    yes: false,
    dryRun: false,
    doctor: false,
    skipMcp: false,
    help: false,
    home: "",
    binDir: "",
    workspaceRoot: "",
    trustZone: "",
    hosts: "auto",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--yes" || arg === "-y") out.yes = true;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--doctor") out.doctor = true;
    else if (arg === "--skip-mcp") out.skipMcp = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--home") out.home = argv[++i] ?? "";
    else if (arg === "--bin-dir") out.binDir = argv[++i] ?? "";
    else if (arg === "--workspace-root") out.workspaceRoot = argv[++i] ?? "";
    else if (arg === "--trust-zone") out.trustZone = argv[++i] ?? "";
    else if (arg === "--hosts") out.hosts = argv[++i] ?? "auto";
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function printHelp() {
  process.stdout.write(`carpeos setup — configure local runtime and agent MCP hosts

Usage:
  carpeos setup --yes
  carpeos setup --doctor
  carpeos setup --dry-run

After npm install -g @innocarpe/carpeos, run setup once per machine.
`);
}

export async function runSetup(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }

  const home = args.home ? resolve(args.home) : defaultHome();
  const binDir = args.binDir ? resolve(args.binDir) : defaultBinDir();
  const workspaceRoot = args.workspaceRoot
    ? resolve(args.workspaceRoot)
    : process.env.HOME || homedir();
  let trustZone = args.trustZone || DEFAULT_TRUST_ZONE;
  if (trustZone === "auto") trustZone = trustZoneFromHostname();
  if (!isTrustZoneId(trustZone)) {
    throw new Error(`invalid trust zone: ${trustZone}`);
  }

  // For npm installs, install_root is the package itself (has dist/cli.js).
  const installRoot = packageRoot;
  const cliEntry = join(packageRoot, "dist/cli.js");
  const mcpEntry = join(packageRoot, "dist/mcp-server.js");

  if (args.doctor) {
    const configPath = join(home, "config.json");
    if (!existsSync(configPath)) {
      process.stderr.write(`no install config at ${configPath}; run: carpeos setup --yes\n`);
      return 1;
    }
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const doctor = doctorInstall({ config });
    process.stdout.write(`${JSON.stringify({ ok: doctor.ok, doctor }, null, 2)}\n`);
    return doctor.ok ? 0 : 1;
  }

  if (!args.dryRun && !args.yes) {
    process.stderr.write("Refusing to modify the machine without --yes (or use --dry-run).\n");
    return 2;
  }

  if (!existsSync(cliEntry) || !existsSync(mcpEntry)) {
    throw new Error("package dist missing; reinstall @innocarpe/carpeos");
  }

  const hosts =
    args.hosts === "auto"
      ? undefined
      : args.hosts
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);

  // Adapt installLocal: skip monorepo build; point entries at package dist.
  const result = installLocal({
    repoRoot: installRoot,
    home,
    binDir,
    workspaceRoot,
    trustZoneId: trustZone,
    nodePath: process.execPath,
    skipBuild: true,
    skipMcp: args.skipMcp,
    hosts,
    dryRun: args.dryRun,
    cliEntry,
    mcpEntry,
    distribution: "npm",
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: result.doctor.ok || args.dryRun,
        distribution: "npm",
        home,
        bin_dir: binDir,
        package_root: installRoot,
        hosts: result.hostResults,
        path_hint: result.state.path_hint,
        next: "Open a new shell (or hash -r), then: carpeos --help",
      },
      null,
      2,
    )}\n`,
  );
  return result.doctor.ok || args.dryRun ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSetup().then((code) => {
    process.exitCode = code;
  });
}
