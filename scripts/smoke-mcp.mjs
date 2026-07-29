#!/usr/bin/env node
/**
 * G5 MCP smoke gate — named, CI-friendly proof for:
 *   - MCP tool list (stdio)
 *   - memory_context_pack application tests
 *   - CLI path: init → capture → rebuild → search → context-pack
 *
 * Usage (repo root, after deps):
 *   pnpm smoke:mcp
 *   node scripts/smoke-mcp.mjs
 *   node scripts/smoke-mcp.mjs --cli-only
 *   node scripts/smoke-mcp.mjs --unit-only
 *
 * Synthetic data only. Temp home under os.tmpdir(); never commits private paths.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const trustZone = "tz_smoke_g5";
const cliEntry = join(root, "apps/carpeos-cli/dist/index.js");

const args = new Set(process.argv.slice(2));
const cliOnly = args.has("--cli-only");
const unitOnly = args.has("--unit-only");
const help = args.has("--help") || args.has("-h");

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function fail(msg) {
  process.stderr.write(`smoke-mcp FAIL: ${msg}\n`);
  process.exitCode = 1;
}

function run(cmd, cmdArgs, opts = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...(opts.env ?? {}) },
    stdio: opts.stdio ?? ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

function parseJsonLine(text) {
  const line = text
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.startsWith("{"));
  if (!line) {
    throw new Error(`expected JSON object in output, got: ${text.slice(0, 200)}`);
  }
  return JSON.parse(line);
}

function ensureCliBuilt() {
  if (!existsSync(cliEntry)) {
    log("Building monorepo (CLI dist missing)…");
    const built = run("pnpm", ["build"], { stdio: "inherit" });
    if (built.status !== 0) {
      fail("pnpm build failed");
      return false;
    }
  }
  if (!existsSync(cliEntry)) {
    fail(`CLI entry missing after build: ${cliEntry}`);
    return false;
  }
  return true;
}

function runUnitSmokes() {
  log("— Unit / MCP application smokes —");
  const suites = [
    {
      name: "mcp-server stdio (tool list + client call)",
      args: ["--filter", "@carpeos/mcp-server", "exec", "vitest", "run", "test/stdio.test.ts"],
    },
    {
      name: "mcp-server app (memory_context_pack classification)",
      args: ["--filter", "@carpeos/mcp-server", "exec", "vitest", "run", "test/mcp-app.test.ts"],
    },
    {
      name: "mcp-server expert-slots",
      args: ["--filter", "@carpeos/mcp-server", "exec", "vitest", "run", "test/expert-slots.test.ts"],
    },
    {
      name: "cli retrieval + context-pack",
      args: ["--filter", "@carpeos/cli", "exec", "vitest", "run", "test/retrieval-cli.test.ts"],
    },
  ];

  for (const suite of suites) {
    log(`  · ${suite.name}`);
    const result = run("pnpm", suite.args, { stdio: "inherit" });
    if (result.status !== 0) {
      fail(`unit smoke failed: ${suite.name}`);
      return false;
    }
  }
  log("  unit smokes PASS");
  return true;
}

function runCliSmoke() {
  log("— CLI process smoke (temp home) —");
  if (!ensureCliBuilt()) return false;

  const home = mkdtempSync(join(tmpdir(), "carpeos-mcp-smoke-"));
  const base = ["--home", home, "--trust-zone", trustZone];

  try {
    const steps = [
      {
        name: "init",
        argv: ["init", ...base],
        check: (body) => body.ok === true && body.command === "init" && body.trust_zone_id === trustZone,
      },
      {
        name: "capture-hook",
        argv: [
          "capture-hook",
          "--provider",
          "codex",
          "--input",
          "argv",
          ...base,
          JSON.stringify({
            hook_event_name: "SessionEnd",
            session_id: "session_smoke_g5",
            timestamp: "2026-01-01T00:00:00Z",
            message: "synthetic g5 smoke alpha",
          }),
        ],
        check: (body) => body.ok === true && body.command === "capture-hook" && body.status === "captured",
      },
      {
        name: "retrieval rebuild",
        argv: ["retrieval", "rebuild", ...base],
        check: (body) => body.ok === true && body.command === "retrieval rebuild",
      },
      {
        name: "memory search",
        argv: [
          "memory",
          "search",
          ...base,
          "--visible-trust-zone",
          trustZone,
          "--query",
          "synthetic",
        ],
        check: (body) => body.ok === true && body.command === "memory search" && body.result !== undefined,
      },
      {
        name: "memory context-pack",
        argv: [
          "memory",
          "context-pack",
          ...base,
          "--visible-trust-zone",
          trustZone,
          "--task",
          "G5 smoke: summarize synthetic work",
          "--max-items",
          "16",
          "--max-characters",
          "8000",
        ],
        check: (body) => {
          if (body.ok !== true || body.command !== "memory context-pack") return false;
          const pack = body.pack;
          if (pack === null || typeof pack !== "object") return false;
          // Pack shape used by agents / MCP tool
          for (const key of [
            "schema_version",
            "tool",
            "accepted_facts",
            "evidence_summaries",
            "budget",
          ]) {
            if (!(key in pack)) return false;
          }
          return pack.tool === "memory_context_pack" && pack.schema_version === "v1";
        },
      },
    ];

    for (const step of steps) {
      log(`  · ${step.name}`);
      const result = run(process.execPath, [cliEntry, ...step.argv], {
        env: {
          CARPEOS_HOME: home,
          NODE_OPTIONS: "--disable-warning=ExperimentalWarning",
        },
      });
      if (result.status !== 0) {
        fail(`${step.name} exited ${result.status}\n${result.stderr || result.stdout}`);
        return false;
      }
      let body;
      try {
        body = parseJsonLine(result.stdout);
      } catch (error) {
        fail(`${step.name}: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
      if (!step.check(body)) {
        fail(`${step.name}: unexpected payload ${JSON.stringify(body).slice(0, 400)}`);
        return false;
      }
    }

    log("  CLI process smoke PASS");
    return true;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function main() {
  if (help) {
    process.stdout.write(`G5 MCP smoke gate

Usage:
  node scripts/smoke-mcp.mjs
  node scripts/smoke-mcp.mjs --cli-only
  node scripts/smoke-mcp.mjs --unit-only

Runs synthetic local proofs for MCP tool list, memory search, and context-pack.
`);
    return;
  }

  log("CarpeOS MCP smoke (G5)");
  log(`  root: ${root}`);

  let ok = true;
  if (!cliOnly) {
    ok = runUnitSmokes() && ok;
  }
  if (!unitOnly) {
    ok = runCliSmoke() && ok;
  }

  if (!ok) {
    process.exitCode = 1;
    process.stderr.write("smoke-mcp: FAILED\n");
    return;
  }
  log("smoke-mcp: PASS");
}

main();
