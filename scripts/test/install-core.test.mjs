import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildConfig,
  doctorInstall,
  installLocal,
  isTrustZoneId,
  renderMcpEnv,
  renderWrapper,
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
});
