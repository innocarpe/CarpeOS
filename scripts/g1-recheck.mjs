#!/usr/bin/env node
/**
 * G1 clean-profile recheck for published @innocarpe/carpeos.
 *
 * Usage:
 *   node scripts/g1-recheck.mjs [--version 0.2.1] [--skip-smoke] [--json]
 *
 * Creates a temporary home + bin-dir, runs setup plan/run/doctor, then
 * project identify. Optionally runs monorepo `pnpm smoke:mcp` when executed
 * from a CarpeOS checkout with dependencies installed.
 *
 * Does not register MCP on agent hosts (register-mcp false) so the recheck
 * isolates runtime home creation, wrappers, and store init.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const out = { version: "0.2.1", skipSmoke: false, json: false, keep: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--skip-smoke") out.skipSmoke = true;
    else if (a === "--json") out.json = true;
    else if (a === "--keep") out.keep = true;
    else if (a === "--version") {
      out.version = argv[++i];
      if (!out.version) throw new Error("--version requires a value");
    } else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`unexpected argument: ${a}`);
  }
  return out;
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd ?? root,
    env: opts.env ?? process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function parseJsonLoose(text) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{") || l.startsWith("["));
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      // continue
    }
  }
  return null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      "Usage: node scripts/g1-recheck.mjs [--version X.Y.Z] [--skip-smoke] [--json] [--keep]\n",
    );
    process.exit(0);
  }

  const cleanHome = mkdtempSync(join(tmpdir(), "carpeos-g1-home-"));
  const cleanBin = mkdtempSync(join(tmpdir(), "carpeos-g1-bin-"));
  chmodSync(cleanHome, 0o700);
  chmodSync(cleanBin, 0o700);

  const steps = [];
  const env = { ...process.env, CARPEOS_HOME: cleanHome, PATH: process.env.PATH };

  const record = (name, result, extra = {}) => {
    steps.push({
      name,
      status: result.status,
      ok: result.status === 0,
      ...extra,
    });
  };

  // version (assume already installed; do not mutate global npm unless version flag needs install)
  const version = run("carpeos", ["version"], { env });
  const versionJson = parseJsonLoose(version.stdout + version.stderr);
  record("carpeos version", version, { version: versionJson?.version ?? null });
  if (versionJson?.version !== args.version) {
    steps.push({
      name: "version match",
      ok: false,
      status: 1,
      expected: args.version,
      actual: versionJson?.version ?? null,
      hint: `npm install -g @innocarpe/carpeos@${args.version}`,
    });
  } else {
    steps.push({ name: "version match", ok: true, status: 0, version: args.version });
  }

  const setupFlags = [
    "--home",
    cleanHome,
    "--bin-dir",
    cleanBin,
    "--trust-zone",
    "tz_local_default",
    "--register-mcp",
    "false",
  ];

  record("setup plan", run("carpeos", ["setup", "plan", ...setupFlags], { env }));
  record("setup run --apply", run("carpeos", ["setup", "run", "--apply", ...setupFlags], { env }));
  record(
    "setup doctor",
    run("carpeos", ["setup", "doctor", "--home", cleanHome, "--bin-dir", cleanBin], { env }),
  );

  const identify = run("carpeos", ["project", "identify", "--home", cleanHome], { env });
  const identifyJson = parseJsonLoose(identify.stdout + identify.stderr);
  record("project identify", identify, {
    trust_zone_id: identifyJson?.trust_zone_id ?? null,
    trust_zone_source: identifyJson?.trust_zone_source ?? null,
  });

  let smoke = { status: 0, stdout: "", stderr: "" };
  if (!args.skipSmoke) {
    if (!existsSync(join(root, "package.json"))) {
      smoke = { status: 1, stdout: "", stderr: "not a monorepo root; use --skip-smoke" };
    } else {
      smoke = run("pnpm", ["smoke:mcp"], { cwd: root, env: process.env });
    }
    record("pnpm smoke:mcp", smoke);
  } else {
    steps.push({ name: "pnpm smoke:mcp", ok: true, status: 0, skipped: true });
  }

  const ok = steps.every((s) => s.ok);
  const summary = {
    ok,
    package_version_expected: args.version,
    package_version_actual: versionJson?.version ?? null,
    clean_home: cleanHome,
    clean_bin: cleanBin,
    steps,
    recorded_at: new Date().toISOString(),
  };

  if (!args.keep) {
    try {
      rmSync(cleanHome, { recursive: true, force: true });
      rmSync(cleanBin, { recursive: true, force: true });
      summary.cleaned = true;
    } catch {
      summary.cleaned = false;
    }
  } else {
    summary.cleaned = false;
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(
      `G1 recheck: ${ok ? "PASS" : "FAIL"} (@innocarpe/carpeos@${args.version})\n`,
    );
    for (const s of steps) {
      const mark = s.ok ? "✓" : "✗";
      const skip = s.skipped ? " (skipped)" : "";
      process.stdout.write(`  ${mark} ${s.name}${skip}\n`);
    }
    if (!ok) {
      process.stdout.write("\nFailed step details (stderr tails):\n");
      // no stored stderr in steps for brevity; re-run with --json for structure
    }
  }

  process.exit(ok ? 0 : 1);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
