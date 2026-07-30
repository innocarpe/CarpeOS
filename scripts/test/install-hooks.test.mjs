import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  captureHookCommand,
  doctorCaptureHooks,
  installCaptureHooks,
  isCarpeosCaptureCommand,
  loadHookTemplate,
  materializeHookTemplate,
  mergeHostHooks,
  probeHostHooks,
  uninstallCaptureHooks,
  uninstallHostHooks,
} from "../lib/install-hooks.mjs";
import { defaultRepoRoot } from "../lib/install-core.mjs";

describe("install-hooks", () => {
  const repoRoot = defaultRepoRoot();
  const templateDir = join(repoRoot, "adapters");
  const binDir = "/tmp/carpeos-user-bin";

  it("builds absolute capture-hook commands", () => {
    const cmd = captureHookCommand(binDir, "claude");
    assert.match(cmd, /capture-hook --provider claude --fail-open --quiet/);
    assert.match(cmd, /\/tmp\/carpeos-user-bin\/carpeos/);
    assert.equal(isCarpeosCaptureCommand(cmd, "claude"), true);
    assert.equal(isCarpeosCaptureCommand(cmd, "codex"), false);
    assert.equal(
      isCarpeosCaptureCommand(
        "carpeos capture-hook --provider claude --fail-open --quiet",
        "claude",
      ),
      true,
    );
  });

  it("merges without wiping user hooks and is idempotent", () => {
    const existing = {
      hooks: {
        SessionStart: [
          {
            hooks: [
              { type: "command", command: "echo user-hook" },
              {
                type: "command",
                command: "carpeos capture-hook --provider claude --fail-open --quiet",
              },
            ],
          },
        ],
        Stop: [
          {
            hooks: [{ type: "command", command: "notify-send done" }],
          },
        ],
      },
    };
    const template = materializeHookTemplate(
      {
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command: "carpeos capture-hook --provider claude --fail-open --quiet",
                  timeout: 5,
                  async: true,
                },
              ],
            },
          ],
          SessionEnd: [
            {
              hooks: [
                {
                  type: "command",
                  command: "carpeos capture-hook --provider claude --fail-open --quiet",
                  timeout: 5,
                  async: true,
                },
              ],
            },
          ],
        },
      },
      "claude",
      binDir,
    );

    const first = mergeHostHooks(existing, template, "claude");
    assert.equal(first.changed, true);
    const sessionStartHooks = first.merged.hooks.SessionStart[0].hooks;
    assert.equal(
      sessionStartHooks.some((h) => h.command === "echo user-hook"),
      true,
    );
    assert.equal(
      sessionStartHooks.filter((h) => isCarpeosCaptureCommand(h.command, "claude")).length,
      1,
    );
    assert.match(
      sessionStartHooks.find((h) => isCarpeosCaptureCommand(h.command, "claude")).command,
      /carpeos-user-bin/,
    );
    assert.equal(first.merged.hooks.Stop[0].hooks[0].command, "notify-send done");
    assert.ok(first.merged.hooks.SessionEnd);

    const second = mergeHostHooks(first.merged, template, "claude");
    // Second pass may report changed=false when already absolute+identical.
    const again = mergeHostHooks(second.merged, template, "claude");
    assert.equal(
      again.merged.hooks.SessionStart[0].hooks.filter((h) =>
        isCarpeosCaptureCommand(h.command, "claude"),
      ).length,
      1,
    );
  });

  it("uninstall removes only CarpeOS entries", () => {
    const existing = {
      hooks: {
        SessionStart: [
          {
            hooks: [
              { type: "command", command: "echo keep" },
              {
                type: "command",
                command: captureHookCommand(binDir, "codex"),
              },
            ],
          },
        ],
      },
    };
    const result = uninstallHostHooks(existing, "codex");
    assert.equal(result.changed, true);
    assert.deepEqual(result.merged.hooks.SessionStart[0].hooks, [
      { type: "command", command: "echo keep" },
    ]);
  });

  it("installCaptureHooks writes merged files under a fake user home", () => {
    const dir = mkdtempSync(join(tmpdir(), "carpeos-hooks-"));
    try {
      const userHome = join(dir, "home");
      const bin = join(dir, "bin");
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, "carpeos"), "#!/bin/sh\n", { mode: 0o755 });

      // Pre-seed a Claude settings file with a user hook.
      const claudePath = join(userHome, ".claude", "settings.json");
      mkdirSync(join(userHome, ".claude"), { recursive: true });
      writeFileSync(
        claudePath,
        `${JSON.stringify(
          {
            hooks: {
              Stop: [{ hooks: [{ type: "command", command: "echo keep-me" }] }],
            },
          },
          null,
          2,
        )}\n`,
      );

      const env = { HOME: userHome };
      const { results } = installCaptureHooks({
        hosts: ["claude"],
        binDir: bin,
        templateDir,
        env,
        log: () => {},
      });
      assert.equal(results[0].status, "installed");
      const written = JSON.parse(readFileSync(claudePath, "utf8"));
      assert.equal(written.hooks.Stop[0].hooks[0].command, "echo keep-me");
      const startCmd = written.hooks.SessionStart[0].hooks.find((h) =>
        isCarpeosCaptureCommand(h.command, "claude"),
      ).command;
      assert.match(startCmd, new RegExp(bin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

      const probe = probeHostHooks({
        host: "claude",
        configPath: claudePath,
        binDir: bin,
      });
      assert.equal(probe.status, "installed");

      const doctor = doctorCaptureHooks({
        hosts: ["claude"],
        binDir: bin,
        env,
      });
      assert.equal(doctor.probes[0].status, "installed");

      const un = uninstallCaptureHooks({
        hosts: ["claude"],
        binDir: bin,
        templateDir,
        env,
        log: () => {},
      });
      assert.equal(un.results[0].status, "uninstalled");
      const after = JSON.parse(readFileSync(claudePath, "utf8"));
      assert.equal(after.hooks.Stop[0].hooks[0].command, "echo keep-me");
      assert.equal(after.hooks.SessionStart, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads real adapter templates for all three hosts", () => {
    for (const host of ["claude", "codex", "grok"]) {
      const template = loadHookTemplate(host, templateDir);
      const materialized = materializeHookTemplate(template, host, binDir);
      assert.ok(materialized.hooks);
      const firstEvent = Object.keys(materialized.hooks)[0];
      const cmd = materialized.hooks[firstEvent][0].hooks[0].command;
      assert.match(cmd, new RegExp(`--provider ${host}`));
      assert.match(cmd, /carpeos-user-bin/);
    }
  });
});
