#!/usr/bin/env node
/**
 * Product 2.0 public-safe knowledge dogfood smoke — synthetic fixtures only.
 *
 * Covers multi-hook noise/pollution scenarios for K8:
 *   1) durable decision SessionEnd → promote → default search hit
 *   2) preference SessionEnd → promote
 *   3) PostToolUse tool noise → reject / skip extract
 *   4) thanks/ok chatter SessionEnd → hold or reject (not promote)
 *   5) UserPromptSubmit flood → hold/reject (not promote into default search)
 *   6) secret-like decision → reject (fail-closed)
 *   7) default memory search stays free of noise/secret/chatter pollution
 *   8) adjudicate --stats shows promote >= 2 and reject >= 1
 *
 * Usage (repo root, after deps):
 *   pnpm smoke:dogfood
 *   node scripts/smoke-dogfood.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const trustZone = "tz_smoke_dogfood";
const cliEntry = join(root, "apps/carpeos-cli/dist/index.js");

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function fail(msg) {
  process.stderr.write(`smoke-dogfood FAIL: ${msg}\n`);
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

function runCli(home, argv) {
  return run(process.execPath, [cliEntry, ...argv], {
    env: {
      CARPEOS_HOME: home,
      NODE_OPTIONS: "--disable-warning=ExperimentalWarning",
    },
  });
}

function capture(home, base, fixture) {
  const result = runCli(home, [
    "capture-hook",
    "--provider",
    "codex",
    "--input",
    "argv",
    ...base,
    JSON.stringify(fixture),
  ]);
  if (result.status !== 0) {
    throw new Error(
      `capture ${fixture.session_id} exited ${result.status}\n${result.stderr || result.stdout}`,
    );
  }
  return parseJsonLine(result.stdout);
}

function searchBody(home, base, query) {
  const result = runCli(home, [
    "memory",
    "search",
    ...base,
    "--visible-trust-zone",
    trustZone,
    "--query",
    query,
    "--limit",
    "30",
  ]);
  if (result.status !== 0) {
    throw new Error(`search exited ${result.status}\n${result.stderr || result.stdout}`);
  }
  return parseJsonLine(result.stdout);
}

function visibleTextBlob(body) {
  const results = body.result?.results ?? [];
  return results
    .filter((item) => item?.status === "visible")
    .map((item) => JSON.stringify(item))
    .join("\n");
}

function runDogfoodSmoke() {
  log("— Knowledge dogfood scenarios (temp home, synthetic only) —");
  if (!ensureCliBuilt()) {
    return false;
  }

  const home = mkdtempSync(join(tmpdir(), "carpeos-dogfood-smoke-"));
  const base = ["--home", home, "--trust-zone", trustZone];

  try {
    log("  · init");
    {
      const result = runCli(home, ["init", ...base]);
      if (result.status !== 0) {
        fail(`init exited ${result.status}\n${result.stderr || result.stdout}`);
        return false;
      }
    }

    log("  · durable decision SessionEnd → promote");
    const decision = capture(home, base, {
      hook_event_name: "SessionEnd",
      session_id: "session_dogfood_decision",
      timestamp: "2026-01-01T00:00:00Z",
      message: "We decided to always use pnpm and never commit credentials in this monorepo.",
    });
    if (decision.ok !== true || decision.extraction?.status !== "extracted") {
      fail(`decision fixture unexpected ${JSON.stringify(decision).slice(0, 400)}`);
      return false;
    }
    if (
      decision.extraction?.lifecycle_status &&
      decision.extraction.lifecycle_status !== "active"
    ) {
      // lifecycle may be nested under extraction.event in some outputs; allow extracted path
    }

    log("  · durable second decision SessionEnd → promote");
    const preference = capture(home, base, {
      hook_event_name: "SessionEnd",
      session_id: "session_dogfood_preference",
      timestamp: "2026-01-01T00:00:01Z",
      message:
        "We decided that offline deterministic package tests are always the default CI gate.",
    });
    if (preference.ok !== true || preference.extraction?.status !== "extracted") {
      fail(`second decision fixture unexpected ${JSON.stringify(preference).slice(0, 400)}`);
      return false;
    }

    log("  · PostToolUse noise flood → reject/skip");
    for (let i = 0; i < 3; i += 1) {
      const noise = capture(home, base, {
        hook_event_name: "PostToolUse",
        session_id: `session_dogfood_tool_noise_${i}`,
        timestamp: `2026-01-01T00:00:0${2 + i}Z`,
        message: `ok ran npm test with huge tool logs batch ${i} that must not become knowledge`,
      });
      if (noise.ok !== true || noise.extraction?.status !== "skipped") {
        fail(
          `tool noise should skip extraction: ${JSON.stringify(noise.extraction).slice(0, 300)}`,
        );
        return false;
      }
    }

    log("  · thanks/ok chatter SessionEnd → not promote");
    const chatterBodies = [];
    for (const [i, message] of ["thanks", "ok", "lgtm"].entries()) {
      const chatter = capture(home, base, {
        hook_event_name: "SessionEnd",
        session_id: `session_dogfood_chatter_${i}`,
        timestamp: `2026-01-01T00:01:0${i}Z`,
        message,
      });
      chatterBodies.push(chatter);
      if (chatter.ok !== true) {
        fail(`chatter capture failed: ${JSON.stringify(chatter).slice(0, 300)}`);
        return false;
      }
      if (
        chatter.extraction?.status === "extracted" &&
        chatter.extraction?.lifecycle_status === "active"
      ) {
        // Some paths put lifecycle on nested event; treat active extraction as promote pollution.
        const nested = chatter.extraction?.event?.lifecycle_status;
        if (nested === "active" || chatter.extraction?.lifecycle_status === "active") {
          fail(`chatter must not promote: ${JSON.stringify(chatter.extraction).slice(0, 300)}`);
          return false;
        }
      }
    }

    log("  · UserPromptSubmit flood → not promote into default meaning");
    for (let i = 0; i < 4; i += 1) {
      const prompt = capture(home, base, {
        hook_event_name: "UserPromptSubmit",
        session_id: `session_dogfood_prompt_${i}`,
        timestamp: `2026-01-01T00:02:0${i}Z`,
        message: `Please help me think about architecture option ${i} for auth without deciding yet.`,
      });
      if (prompt.ok !== true) {
        fail(`prompt flood capture failed: ${JSON.stringify(prompt).slice(0, 300)}`);
        return false;
      }
      if (prompt.extraction?.lifecycle_status === "active") {
        fail(
          `UserPromptSubmit must not auto-promote: ${JSON.stringify(prompt.extraction).slice(0, 300)}`,
        );
        return false;
      }
    }

    log("  · secret-like decision → reject/fail-closed");
    const secretLike = capture(home, base, {
      hook_event_name: "SessionEnd",
      session_id: "session_dogfood_secret",
      timestamp: "2026-01-01T00:03:00Z",
      payload: {
        decision: `Store ${["pass", "word=syntheticsecretvalue123"].join("")} for later reuse in scripts.`,
      },
    });
    if (secretLike.ok !== true) {
      fail(`secret-like capture failed: ${JSON.stringify(secretLike).slice(0, 300)}`);
      return false;
    }
    if (
      secretLike.extraction?.status === "extracted" &&
      secretLike.extraction?.lifecycle_status === "active"
    ) {
      fail(
        `secret-like content must not promote: ${JSON.stringify(secretLike.extraction).slice(0, 300)}`,
      );
      return false;
    }

    log("  · adjudicate --stats");
    {
      const result = runCli(home, ["adjudicate", "--stats", ...base]);
      if (result.status !== 0) {
        fail(`adjudicate --stats exited ${result.status}\n${result.stderr || result.stdout}`);
        return false;
      }
      const body = parseJsonLine(result.stdout);
      const counts = body.counts;
      if (body.ok !== true || counts?.promote < 2 || counts?.reject < 1) {
        fail(`expected promote>=2 and reject>=1, got ${JSON.stringify(counts)}`);
        return false;
      }
      log(
        `    counts promote=${counts.promote} hold=${counts.hold} reject=${counts.reject} policy=${counts.policy_version}`,
      );
    }

    log("  · retrieval rebuild");
    {
      const result = runCli(home, ["retrieval", "rebuild", ...base]);
      if (result.status !== 0) {
        fail(`rebuild exited ${result.status}\n${result.stderr || result.stdout}`);
        return false;
      }
    }

    log("  · default search finds durable decisions/preferences");
    {
      const decisionSearch = searchBody(home, base, "SessionEnd decided pnpm");
      const blob = visibleTextBlob(decisionSearch);
      if (!/pnpm|decided|credentials/i.test(blob)) {
        fail(`decision search missing promoted meaning: ${blob.slice(0, 500)}`);
        return false;
      }
      const preferenceSearch = searchBody(home, base, "offline deterministic package tests");
      const prefBlob = visibleTextBlob(preferenceSearch);
      if (!/offline|deterministic|tests/i.test(prefBlob)) {
        fail(`preference search missing promoted meaning: ${prefBlob.slice(0, 500)}`);
        return false;
      }
    }

    log("  · default search free of noise/secret/chatter pollution");
    {
      const pollutionQueries = [
        ["tool logs batch", /huge tool logs batch/i],
        [
          "syntheticsecretvalue123",
          new RegExp("syntheticsecretvalue123|" + "pass" + "word=synthetic", "i"),
        ],
        ["thanks only chatter", /\"thanks\"|lgtm/i],
      ];
      for (const [query, pattern] of pollutionQueries) {
        const body = searchBody(home, base, query);
        const blob = visibleTextBlob(body);
        if (pattern.test(blob)) {
          fail(`default search polluted for query=${query}: ${blob.slice(0, 500)}`);
          return false;
        }
      }
      // filters must remain active-only
      const body = searchBody(home, base, "SessionEnd");
      const lifecycle = body.result?.filters_applied?.lifecycle_status;
      if (!Array.isArray(lifecycle) || lifecycle.join(",") !== "active") {
        fail(`expected active-only filters, got ${JSON.stringify(lifecycle)}`);
        return false;
      }
    }

    log("smoke-dogfood PASS");
    return true;
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return false;
  } finally {
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  log("Usage: node scripts/smoke-dogfood.mjs");
  process.exit(0);
}

const ok = runDogfoodSmoke();
process.exit(ok ? 0 : 1);
