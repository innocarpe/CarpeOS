import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import {
  main,
  runOperator,
  VALIDATE_SUCCESS_MESSAGE,
  validatePrivateConfig,
} from "../cloudflare-operator.mjs";

function validConfig() {
  const syntheticDatabaseId = ["11111111", "2222", "4333", "8444", "555555555555"].join("-");
  return `name = "unit-test-sync-worker"
main = "../../apps/carpeos-sync-worker/src/index.ts"
compatibility_date = "2026-07-29"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "unit_test_sync"
database_id = "${syntheticDatabaseId}"
migrations_dir = "../../apps/carpeos-sync-worker/migrations"

[[r2_buckets]]
binding = "PROTECTED_VALUES"
bucket_name = "unit-test-protected-values"

[vars]
CARPEOS_ENV = "unit-test"
`;
}

function git(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
}

function createFixture({ config = validConfig(), ignored = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "carpeos-cloudflare-operator-"));
  const configDir = join(root, ".carpeos", "cloudflare");
  const configPath = join(configDir, "wrangler.toml");

  git(root, ["init", "--quiet"]);
  if (ignored) {
    writeFileSync(join(root, ".gitignore"), ".carpeos/\n", { mode: 0o644 });
  }
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  chmodSync(configDir, 0o700);
  writeFileSync(configPath, config, { mode: 0o600 });
  chmodSync(configPath, 0o600);

  return {
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    configDir,
    configPath,
    root,
  };
}

describe("cloudflare operator private config validation", () => {
  it("accepts one complete synthetic ignored config", () => {
    const fixture = createFixture();
    try {
      const result = validatePrivateConfig({
        configPath: fixture.configPath,
        repoRoot: fixture.root,
      });

      assert.equal(result.configPath, fixture.configPath);
      assert.equal(result.d1DatabaseName, "unit_test_sync");
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects a missing environment path and a missing config file", () => {
    const fixture = createFixture();
    try {
      assert.throws(
        () =>
          validatePrivateConfig({
            configPath: undefined,
            repoRoot: fixture.root,
          }),
        /CARPEOS_CF_CONFIG is required/,
      );
      rmSync(fixture.configPath);
      assert.throws(
        () =>
          validatePrivateConfig({
            configPath: fixture.configPath,
            repoRoot: fixture.root,
          }),
        /private config file does not exist/,
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects relative paths and files outside repo-local .carpeos/cloudflare", () => {
    const fixture = createFixture();
    const outside = join(fixture.root, "wrangler.toml");
    try {
      writeFileSync(outside, validConfig(), { mode: 0o600 });
      assert.throws(
        () =>
          validatePrivateConfig({
            configPath: ".carpeos/cloudflare/wrangler.toml",
            repoRoot: fixture.root,
          }),
        /must be an absolute path/,
      );
      assert.throws(
        () =>
          validatePrivateConfig({
            configPath: outside,
            repoRoot: fixture.root,
          }),
        /must resolve to repo-local .carpeos\/cloudflare\/wrangler.toml/,
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects tracked and unignored configs", () => {
    const tracked = createFixture();
    const unignored = createFixture({ ignored: false });
    try {
      git(tracked.root, ["add", "--force", ".carpeos/cloudflare/wrangler.toml"]);
      assert.throws(
        () =>
          validatePrivateConfig({
            configPath: tracked.configPath,
            repoRoot: tracked.root,
          }),
        /must be untracked/,
      );
      assert.throws(
        () =>
          validatePrivateConfig({
            configPath: unignored.configPath,
            repoRoot: unignored.root,
          }),
        /must be ignored by Git/,
      );
    } finally {
      tracked.cleanup();
      unignored.cleanup();
    }
  });

  it("rejects broad directory and file permissions", () => {
    const fixture = createFixture();
    try {
      chmodSync(fixture.configDir, 0o755);
      assert.throws(
        () =>
          validatePrivateConfig({
            configPath: fixture.configPath,
            repoRoot: fixture.root,
          }),
        /parent directory permissions must be 0700/,
      );

      chmodSync(fixture.configDir, 0o700);
      chmodSync(fixture.configPath, 0o644);
      assert.throws(
        () =>
          validatePrivateConfig({
            configPath: fixture.configPath,
            repoRoot: fixture.root,
          }),
        /file permissions must be 0600/,
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects placeholder resource values before spawning Wrangler", () => {
    const fixture = createFixture({
      config: validConfig().replace(
        "11111111-2222-4333-8444-555555555555",
        "00000000-0000-0000-0000-000000000000",
      ),
    });
    const calls = [];
    try {
      assert.throws(
        () =>
          runOperator({
            command: "deploy",
            configPath: fixture.configPath,
            repoRoot: fixture.root,
            spawn: (...args) => {
              calls.push(args);
              return { status: 0 };
            },
          }),
        /placeholder value/,
      );
      assert.equal(calls.length, 0);
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects a redirected Worker main before spawning Wrangler", () => {
    const fixture = createFixture({
      config: validConfig().replace(
        'main = "../../apps/carpeos-sync-worker/src/index.ts"',
        'main = "../../apps/carpeos-sync-worker/src/redirected.ts"',
      ),
    });
    const calls = [];
    try {
      assert.throws(
        () =>
          runOperator({
            command: "deploy",
            configPath: fixture.configPath,
            repoRoot: fixture.root,
            spawn: (...args) => {
              calls.push(args);
              return { status: 0 };
            },
          }),
        /main must resolve to repo-local apps\/carpeos-sync-worker\/src\/index\.ts/,
      );
      assert.equal(calls.length, 0);
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects a redirected migrations directory before spawning Wrangler", () => {
    const fixture = createFixture({
      config: validConfig().replace(
        'migrations_dir = "../../apps/carpeos-sync-worker/migrations"',
        'migrations_dir = "../../apps/carpeos-sync-worker/redirected-migrations"',
      ),
    });
    const calls = [];
    try {
      assert.throws(
        () =>
          runOperator({
            command: "migrate",
            configPath: fixture.configPath,
            repoRoot: fixture.root,
            spawn: (...args) => {
              calls.push(args);
              return { status: 0 };
            },
          }),
        /migrations_dir must resolve to repo-local apps\/carpeos-sync-worker\/migrations/,
      );
      assert.equal(calls.length, 0);
    } finally {
      fixture.cleanup();
    }
  });

  it("dispatches migration and deploy with the validated explicit config", () => {
    const fixture = createFixture();
    const calls = [];
    const fakeSpawn = (...args) => {
      calls.push(args);
      return { status: 0 };
    };

    try {
      runOperator({
        command: "migrate",
        configPath: fixture.configPath,
        repoRoot: fixture.root,
        spawn: fakeSpawn,
      });
      runOperator({
        command: "deploy",
        configPath: fixture.configPath,
        repoRoot: fixture.root,
        spawn: fakeSpawn,
      });

      assert.deepEqual(calls[0][1], [
        "d1",
        "migrations",
        "apply",
        "unit_test_sync",
        "--remote",
        "--config",
        fixture.configPath,
      ]);
      assert.deepEqual(calls[1][1], ["deploy", "--config", fixture.configPath]);
    } finally {
      fixture.cleanup();
    }
  });

  it("dispatches validation through an injected dry-run runner", () => {
    const fixture = createFixture();
    const calls = [];
    const fakeSpawn = (...args) => {
      calls.push(args);
      return { status: 0 };
    };

    try {
      runOperator({
        command: "validate",
        configPath: fixture.configPath,
        repoRoot: fixture.root,
        spawn: fakeSpawn,
      });

      assert.deepEqual(calls, [
        [
          "wrangler",
          [
            "deploy",
            "--dry-run",
            "--outdir",
            join(fixture.configDir, "dry-run"),
            "--config",
            fixture.configPath,
          ],
          {
            cwd: fixture.root,
            stdio: "ignore",
          },
        ],
      ]);
    } finally {
      fixture.cleanup();
    }
  });

  it("prints only the fixed non-sensitive validation success message", () => {
    const messages = [];
    const privateResult = {
      bucketName: "operator-owned-bucket",
      configPath: join(tmpdir(), "operator-owned", "wrangler.toml"),
      d1DatabaseId: ["aaaa", "bbbb", "cccc", "dddd"].join("-"),
      d1DatabaseName: "operator_owned_database",
      workerName: "operator-owned-worker",
    };

    main(["validate"], {
      log: (message) => messages.push(message),
      operator: () => privateResult,
    });

    assert.deepEqual(messages, [VALIDATE_SUCCESS_MESSAGE]);
    for (const privateValue of Object.values(privateResult)) {
      assert.doesNotMatch(messages[0], new RegExp(privateValue));
    }
  });

  it("routes remote package commands through the operator", () => {
    const workerPackage = JSON.parse(
      readFileSync(new URL("../../apps/carpeos-sync-worker/package.json", import.meta.url), "utf8"),
    );
    const expectedScripts = {
      "cloudflare:validate": "node ../../scripts/cloudflare-operator.mjs validate",
      "d1:migrations:remote": "node ../../scripts/cloudflare-operator.mjs migrate",
      deploy: "node ../../scripts/cloudflare-operator.mjs deploy",
    };

    for (const [name, command] of Object.entries(expectedScripts)) {
      assert.equal(workerPackage.scripts[name], command);
      assert.doesNotMatch(command, /(?:^|\s)wrangler(?:\s|$)/);
    }
  });

  it("documents operator package scripts with explicit run commands", () => {
    const documentedScripts = new Map([
      [
        new URL("../../docs/guides/cloudflare-sync.md", import.meta.url),
        ["d1:migrations:local", "d1:migrations:remote"],
      ],
      [
        new URL("../../docs/guides/private-cloudflare-operator-config.md", import.meta.url),
        ["cloudflare:validate", "d1:migrations:remote", "deploy"],
      ],
    ]);

    for (const [guide, scripts] of documentedScripts) {
      const contents = readFileSync(guide, "utf8");
      for (const script of scripts) {
        assert.match(contents, new RegExp(`pnpm --filter @carpeos/sync-worker run ${script}`));
        assert.doesNotMatch(contents, new RegExp(`pnpm --filter @carpeos/sync-worker ${script}`));
      }
    }
  });
});
