#!/usr/bin/env node
/**
 * One-stop local installer for a CarpeOS git checkout.
 *
 * Usage:
 *   node scripts/install-local.mjs plan
 *   node scripts/install-local.mjs run --apply
 *   node scripts/install-local.mjs doctor
 *   node scripts/install-local.mjs show
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import {
  doctorInstall,
  formatSetupHelp,
  formatSetupPlanHuman,
  installLocal,
  parseSetupArgs,
  resolveSetupPlan,
  runSetupHooks,
} from "./lib/install-core.mjs";

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
        repo_root: plan.repoRoot,
        skip_build: plan.skipBuild,
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
    process.stderr.write(
      `no install config at ${configPath}; run: node scripts/install-local.mjs run --apply\n`,
    );
    return 1;
  }
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const doctor = doctorInstall({ config, requireHooks });
  if (asJson) {
    printJson({ ok: doctor.ok, doctor });
  } else {
    process.stdout.write(
      doctor.ok ? "CarpeOS install doctor: PASS\n" : "CarpeOS install doctor: FAIL\n",
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
    process.stderr.write(
      `no install config at ${configPath}; run: node scripts/install-local.mjs run --apply\n`,
    );
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

function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseSetupArgs(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
    return;
  }

  if (args.help) {
    process.stdout.write(
      formatSetupHelp({
        programName: "node scripts/install-local.mjs",
        includeRepoRoot: true,
      }),
    );
    return;
  }

  let plan;
  try {
    plan = resolveSetupPlan(args, { distribution: "git" });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
    return;
  }

  if (args.command === "doctor") {
    process.exitCode = runDoctor(plan.home, plan.json, plan.requireHooks);
    return;
  }

  if (args.command === "show") {
    process.exitCode = runShow(plan.home, plan.json);
    return;
  }

  if (args.command === "hooks") {
    try {
      if (!plan.json && (plan.hooksCommand === "plan" || !plan.apply)) {
        process.stdout.write(formatSetupPlanHuman(plan));
      }
      const result = runSetupHooks(plan);
      if (plan.json) {
        printJson(result);
      } else {
        printJson(result);
      }
      process.exitCode = result.ok ? 0 : 1;
    } catch (error) {
      process.stderr.write(
        `hooks failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    }
    return;
  }

  if (args.command === "plan" || !plan.apply) {
    printPlan(plan);
    return;
  }

  if (!plan.json) {
    process.stdout.write(formatSetupPlanHuman(plan));
    process.stdout.write("Applying setup…\n\n");
  }

  try {
    const result = installLocal({
      repoRoot: plan.repoRoot,
      home: plan.home,
      binDir: plan.binDir,
      workspaceRoot: plan.workspaceRoot,
      trustZoneId: plan.trustZoneId,
      nodePath: plan.nodePath,
      skipBuild: plan.skipBuild,
      skipMcp: plan.skipMcp,
      hosts: plan.hostList,
      registerHooks: plan.registerHooksEnabled,
      hookHosts: plan.hookHostList,
      dryRun: false,
    });

    const payload = {
      ok: result.doctor.ok,
      dry_run: false,
      home: result.config.home,
      bin_dir: result.config.bin_dir,
      workspace_root: result.config.workspace_root,
      trust_zone_id: result.config.trust_zone_id,
      register_mcp: plan.registerMcp,
      register_hooks: plan.registerHooks,
      hosts: result.hostResults,
      hooks: result.hookResults,
      doctor: result.doctor,
      path_hint: result.state.path_hint,
    };

    if (plan.json) {
      printJson(payload);
    } else {
      process.stdout.write("Install complete.\n");
      printJson(payload);
      if (plan.deprecatedYes) {
        process.stderr.write(
          "note: --yes is deprecated; prefer: node scripts/install-local.mjs run --apply\n",
        );
      }
    }
    process.exitCode = result.doctor.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `install failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

main();
