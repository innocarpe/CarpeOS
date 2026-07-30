/**
 * Runtime setup entry for npm-global installs.
 * Copied into dist/setup/run-setup.mjs at package build time.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  doctorInstall,
  formatSetupHelp,
  formatSetupPlanHuman,
  installLocal,
  parseSetupArgs,
  resolveSetupPlan,
  runSetupHooks,
} from "./install-core.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// dist/setup -> dist -> package root
const packageRoot = resolve(here, "../..");

/**
 * @param {unknown} value
 */
function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/**
 * @param {ReturnType<typeof resolveSetupPlan>} plan
 */
function printPlan(plan) {
  if (plan.json) {
    printJson({
      ok: true,
      mode: "plan",
      plan: {
        command: plan.command,
        apply: plan.apply,
        home: plan.home,
        bin_dir: plan.binDir,
        workspace_root: plan.workspaceRoot,
        trust_zone_id: plan.trustZoneId,
        register_mcp: plan.registerMcp,
        distribution: plan.distribution,
        actions: plan.actions,
      },
    });
    return;
  }
  process.stdout.write(formatSetupPlanHuman(plan));
}

/**
 * @param {string} home
 * @param {boolean} asJson
 * @param {boolean} [requireHooks]
 */
function runDoctor(home, asJson, requireHooks = false) {
  const configPath = join(home, "config.json");
  if (!existsSync(configPath)) {
    process.stderr.write(`no install config at ${configPath}; run: carpeos setup run --apply\n`);
    return 1;
  }
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const doctor = doctorInstall({ config, requireHooks });
  if (asJson) {
    printJson({ ok: doctor.ok, doctor });
  } else {
    process.stdout.write(
      doctor.ok ? "CarpeOS setup doctor: PASS\n" : "CarpeOS setup doctor: FAIL\n",
    );
    if (doctor.hook_warnings?.length) {
      process.stdout.write(`hook warnings: ${doctor.hook_warnings.join("; ")}\n`);
    }
    printJson({ ok: doctor.ok, doctor });
  }
  return doctor.ok ? 0 : 1;
}

/**
 * @param {string} home
 * @param {boolean} asJson
 */
function runShow(home, asJson) {
  const configPath = join(home, "config.json");
  if (!existsSync(configPath)) {
    process.stderr.write(`no install config at ${configPath}; run: carpeos setup run --apply\n`);
    return 1;
  }
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  if (asJson) {
    printJson({ ok: true, config });
  } else {
    process.stdout.write(`CarpeOS install config (${configPath})\n`);
    printJson(config);
  }
  return 0;
}

export async function runSetup(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseSetupArgs(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }

  if (args.help) {
    process.stdout.write(formatSetupHelp({ programName: "carpeos setup" }));
    return 0;
  }

  // Wrappers must call package bin entrypoints (setup/doctor routing). dist/* is the
  // bundled monorepo CLI and does not understand `carpeos setup`.
  const cliEntry = join(packageRoot, "bin/carpeos.js");
  const mcpEntry = join(packageRoot, "bin/carpeos-mcp-server.js");
  const distCli = join(packageRoot, "dist/cli.js");
  const distMcp = join(packageRoot, "dist/mcp-server.js");

  let plan;
  try {
    plan = resolveSetupPlan(args, {
      distribution: "npm",
      cliEntry,
      mcpEntry,
      defaultRepoRoot: packageRoot,
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }

  if (args.command === "doctor") {
    return runDoctor(plan.home, plan.json, plan.requireHooks);
  }

  if (args.command === "show") {
    return runShow(plan.home, plan.json);
  }

  if (args.command === "hooks") {
    try {
      if (!plan.json && (plan.hooksCommand === "plan" || !plan.apply)) {
        process.stdout.write(formatSetupPlanHuman(plan));
      }
      const result = runSetupHooks(plan);
      printJson(result);
      return result.ok ? 0 : 1;
    } catch (error) {
      process.stderr.write(
        `hooks failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return 1;
    }
  }

  if (args.command === "plan" || !plan.apply) {
    printPlan(plan);
    return 0;
  }

  if (
    !existsSync(cliEntry) ||
    !existsSync(mcpEntry) ||
    !existsSync(distCli) ||
    !existsSync(distMcp)
  ) {
    process.stderr.write("package install incomplete; reinstall @innocarpe/carpeos\n");
    return 1;
  }

  if (!plan.json) {
    process.stdout.write(formatSetupPlanHuman(plan));
    process.stdout.write("Applying setup…\n\n");
  }

  try {
    const result = installLocal({
      repoRoot: packageRoot,
      home: plan.home,
      binDir: plan.binDir,
      workspaceRoot: plan.workspaceRoot,
      trustZoneId: plan.trustZoneId,
      nodePath: plan.nodePath,
      skipBuild: true,
      skipMcp: plan.skipMcp,
      hosts: plan.hostList,
      registerHooks: plan.registerHooksEnabled,
      hookHosts: plan.hookHostList,
      dryRun: false,
      cliEntry,
      mcpEntry,
      distribution: "npm",
    });

    const payload = {
      ok: result.doctor.ok,
      distribution: "npm",
      home: plan.home,
      bin_dir: plan.binDir,
      workspace_root: plan.workspaceRoot,
      trust_zone_id: plan.trustZoneId,
      register_mcp: plan.registerMcp,
      register_hooks: plan.registerHooks,
      package_root: packageRoot,
      hosts: result.hostResults,
      hooks: result.hookResults,
      doctor: result.doctor,
      path_hint: result.state.path_hint,
      next: [
        "Open a new shell (or run: hash -r)",
        "carpeos setup doctor",
        "carpeos setup show",
        "carpeos setup hooks install --apply   # if capture hooks not installed yet",
        "carpeos init --help",
      ],
    };

    if (plan.json) {
      printJson(payload);
    } else {
      process.stdout.write("Setup complete.\n");
      printJson(payload);
      if (plan.deprecatedYes) {
        process.stderr.write("note: --yes is deprecated; prefer: carpeos setup run --apply\n");
      }
    }
    return result.doctor.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `setup failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runSetup().then((code) => {
    process.exitCode = code;
  });
}
