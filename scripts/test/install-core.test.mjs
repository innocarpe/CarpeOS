import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildConfig,
  doctorInstall,
  formatSetupHelp,
  formatSetupPlanHuman,
  installLocal,
  isTrustZoneId,
  parseSetupArgs,
  renderMcpEnv,
  renderWrapper,
  resolveSetupPlan,
  shellQuote,
  trustZoneFromHostname,
} from "../lib/install-core.mjs";

describe("install-core", () => {
  it("builds valid trust zone ids from hostnames", () => {
    const id = trustZoneFromHostname("MacBook-Pro.local");
    assert.equal(isTrustZoneId(id), true);
    assert.match(id, /^tz_/);
  });

  it("renders wrappers and mcp env without embedding secrets patterns poorly", () => {
    const config = buildConfig({
      repoRoot: "/tmp/carpeos-repo",
      home: "/tmp/carpeos-home",
      binDir: "/tmp/carpeos-bin",
      trustZoneId: "tz_local_default",
      workspaceRoot: "/tmp/workspace",
      nodePath: "/usr/bin/node",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    const env = renderMcpEnv(config);
    assert.match(env, /CARPEOS_MCP_TRUST_ZONE='tz_local_default'/);
    const cli = renderWrapper(config, "cli");
    assert.match(cli, /carpeos-cli\/dist\/index\.js/);
    assert.doesNotMatch(cli, /\. mcp\.env/);
    const mcp = renderWrapper(config, "mcp");
    assert.match(mcp, /mcp\.env/);
    assert.equal(shellQuote("a'b"), `'a'\\''b'`);
  });

  it("prefers npm package bin entrypoints so wrappers keep setup routing", () => {
    const dir = mkdtempSync(join(tmpdir(), "carpeos-npm-layout-"));
    try {
      const binDir = join(dir, "bin");
      const distDir = join(dir, "dist");
      mkdirSync(binDir, { recursive: true });
      mkdirSync(distDir, { recursive: true });
      writeFileSync(join(binDir, "carpeos.js"), "#!/usr/bin/env node\n");
      writeFileSync(join(binDir, "carpeos-mcp-server.js"), "#!/usr/bin/env node\n");
      writeFileSync(join(distDir, "cli.js"), "");
      writeFileSync(join(distDir, "mcp-server.js"), "");
      const config = buildConfig({
        repoRoot: dir,
        home: join(dir, "home"),
        binDir: join(dir, "user-bin"),
        trustZoneId: "tz_local_default",
        workspaceRoot: dir,
        nodePath: "/usr/bin/node",
        updatedAt: "2026-01-01T00:00:00Z",
      });
      assert.equal(config.distribution, "npm");
      assert.equal(config.cli_entry, join(dir, "bin/carpeos.js"));
      assert.equal(config.mcp_entry, join(dir, "bin/carpeos-mcp-server.js"));
      const cli = renderWrapper(config, "cli");
      assert.match(cli, /bin\/carpeos\.js/);
      assert.doesNotMatch(cli, /dist\/cli\.js/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dry-run install records planned steps", () => {
    const result = installLocal({
      repoRoot: "/tmp/carpeos-repo",
      home: "/tmp/carpeos-home-dry",
      binDir: "/tmp/carpeos-bin-dry",
      workspaceRoot: "/tmp/workspace",
      trustZoneId: "tz_local_default",
      nodePath: "/usr/bin/node",
      dryRun: true,
      skipBuild: true,
      skipMcp: true,
      writeFile: () => {
        throw new Error("writeFile must not run in dry-run");
      },
      mkdir: () => {
        throw new Error("mkdir must not run in dry-run");
      },
      chmod: () => {},
      exists: () => false,
      log: () => {},
    });
    assert.equal(result.config.trust_zone_id, "tz_local_default");
    assert.ok(result.steps.filter((step) => step.action === "write").length >= 3);
    assert.ok(result.steps.some((step) => step.action === "init" && step.dryRun));
  });

  it("doctor fails when wrappers are missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "carpeos-doctor-"));
    try {
      const config = buildConfig({
        repoRoot: join(dir, "repo"),
        home: join(dir, "home"),
        binDir: join(dir, "bin"),
        trustZoneId: "tz_local_default",
        workspaceRoot: dir,
        nodePath: process.execPath,
      });
      const doctor = doctorInstall({
        config,
        exists: () => false,
        skipHostProbe: true,
        run: () => ({ status: 1, stdout: "", stderr: "no" }),
      });
      assert.equal(doctor.ok, false);
      assert.ok(doctor.failures.length > 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parseSetupArgs defaults empty argv to help", () => {
    const args = parseSetupArgs([]);
    assert.equal(args.help, true);
    assert.equal(args.command, "run");
    assert.equal(args.apply, false);
  });

  it("parseSetupArgs accepts commands and --apply", () => {
    const plan = parseSetupArgs(["plan"]);
    assert.equal(plan.command, "plan");
    assert.equal(plan.apply, false);

    const apply = parseSetupArgs(["run", "--apply", "--home", "/tmp/carpeos-home"]);
    assert.equal(apply.command, "run");
    assert.equal(apply.apply, true);
    assert.equal(apply.home, "/tmp/carpeos-home");
    assert.equal(apply.deprecatedYes, false);

    const legacy = parseSetupArgs(["--yes", "--register-mcp", "claude"]);
    assert.equal(legacy.apply, true);
    assert.equal(legacy.deprecatedYes, true);
    assert.equal(legacy.registerMcp, "claude");

    const dry = parseSetupArgs(["run", "--dry-run"]);
    assert.equal(dry.command, "plan");
  });

  it("parseSetupArgs rejects unknown options and commands", () => {
    assert.throws(() => parseSetupArgs(["--nope"]), /unknown option/);
    assert.throws(() => parseSetupArgs(["explode"]), /unknown setup command/);
  });

  it("resolveSetupPlan is plan-only without --apply", () => {
    const args = parseSetupArgs([
      "run",
      "--home",
      "/tmp/carpeos-plan-home",
      "--bin-dir",
      "/tmp/carpeos-plan-bin",
      "--workspace-root",
      "/tmp/ws",
      "--trust-zone",
      "tz_local_default",
      "--register-mcp",
      "none",
    ]);
    const plan = resolveSetupPlan(args, {
      env: { HOME: "/tmp" },
      distribution: "npm",
      defaultRepoRoot: "/tmp/repo",
    });
    assert.equal(plan.apply, false);
    assert.equal(plan.home, "/tmp/carpeos-plan-home");
    assert.equal(plan.binDir, "/tmp/carpeos-plan-bin");
    assert.equal(plan.skipMcp, true);
    const human = formatSetupPlanHuman(plan);
    assert.match(human, /apply changes:\s+no/);
    assert.match(human, /--apply/);
    assert.match(formatSetupHelp(), /COMMANDS/);
  });

  it("resolveSetupPlan applies only for run --apply", () => {
    const args = parseSetupArgs(["run", "--apply", "--register-mcp", "codex,grok"]);
    const plan = resolveSetupPlan(args, {
      env: { HOME: "/tmp", CARPEOS_HOME: "/tmp/.carpeos-x" },
      defaultRepoRoot: "/tmp/repo",
    });
    assert.equal(plan.apply, true);
    assert.deepEqual(plan.hostList, ["codex", "grok"]);
    assert.equal(plan.home, "/tmp/.carpeos-x");
  });
});
