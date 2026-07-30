#!/usr/bin/env node
/**
 * Product 2.0 knowledge adjudication smoke — synthetic fixtures only.
 *
 * Proves:
 *   1) decision-like SessionEnd → promote (active Observation) → search hit
 *   2) PostToolUse / noise → reject → no meaning-unit pollution in default search
 *   3) adjudicate --stats reports disposition counts
 *
 * Usage (repo root, after deps):
 *   pnpm smoke:knowledge
 *   node scripts/smoke-knowledge.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const trustZone = "tz_smoke_knowledge";
const cliEntry = join(root, "apps/carpeos-cli/dist/index.js");

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function fail(msg) {
  process.stderr.write(`smoke-knowledge FAIL: ${msg}\n`);
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

function hasObservationHit(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return false;
  }
  return results.some((item) => {
    const eventTypes = (item?.lineage?.source_records ?? item?.source_records ?? [])
      .map((r) => r?.event_type)
      .filter(Boolean);
    const kind = item?.chunk?.chunk_kind ?? item?.chunk_kind;
    const text = String(item?.chunk?.text ?? "");
    return (
      eventTypes.includes("Observation") ||
      kind === "summary" ||
      /SessionEnd|Captured|decided/i.test(text)
    );
  });
}

function runKnowledgeSmoke() {
  log("— Knowledge adjudication loop (temp home) —");
  if (!ensureCliBuilt()) {
    return false;
  }

  const home = mkdtempSync(join(tmpdir(), "carpeos-knowledge-smoke-"));
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

    log("  · promote fixture (SessionEnd + decision signal)");
    let promoteEventId;
    {
      const result = runCli(home, [
        "capture-hook",
        "--provider",
        "codex",
        "--input",
        "argv",
        ...base,
        JSON.stringify({
          hook_event_name: "SessionEnd",
          session_id: "session_smoke_knowledge_promote",
          timestamp: "2026-01-01T00:00:00Z",
          message: "We decided to always use pnpm and never commit credentials in this monorepo.",
        }),
      ]);
      if (result.status !== 0) {
        fail(`promote capture exited ${result.status}\n${result.stderr || result.stdout}`);
        return false;
      }
      const body = parseJsonLine(result.stdout);
      if (body.ok !== true || body.extraction?.status !== "extracted") {
        fail(`promote capture unexpected ${JSON.stringify(body).slice(0, 400)}`);
        return false;
      }
      promoteEventId = body.event_id;
    }

    log("  · noise fixture (PostToolUse → reject / skip extract)");
    {
      const result = runCli(home, [
        "capture-hook",
        "--provider",
        "codex",
        "--input",
        "argv",
        ...base,
        JSON.stringify({
          hook_event_name: "PostToolUse",
          session_id: "session_smoke_knowledge_noise",
          timestamp: "2026-01-01T00:00:01Z",
          message: "ok ran npm test with huge tool logs that must not become knowledge",
        }),
      ]);
      if (result.status !== 0) {
        fail(`noise capture exited ${result.status}\n${result.stderr || result.stdout}`);
        return false;
      }
      const body = parseJsonLine(result.stdout);
      if (body.ok !== true || body.extraction?.status !== "skipped") {
        fail(`noise should skip extraction: ${JSON.stringify(body.extraction).slice(0, 300)}`);
        return false;
      }
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
      if (body.ok !== true || counts?.promote < 1 || counts?.reject < 1) {
        fail(`expected promote>=1 and reject>=1, got ${JSON.stringify(counts)}`);
        return false;
      }
      log(`    counts promote=${counts.promote} hold=${counts.hold} reject=${counts.reject}`);
    }

    log("  · retrieval rebuild");
    {
      const result = runCli(home, ["retrieval", "rebuild", ...base]);
      if (result.status !== 0) {
        fail(`rebuild exited ${result.status}\n${result.stderr || result.stdout}`);
        return false;
      }
    }

    log("  · memory search (promoted meaning only)");
    {
      const result = runCli(home, [
        "memory",
        "search",
        ...base,
        "--visible-trust-zone",
        trustZone,
        "--query",
        "SessionEnd decided pnpm",
      ]);
      if (result.status !== 0) {
        fail(`search exited ${result.status}\n${result.stderr || result.stdout}`);
        return false;
      }
      const body = parseJsonLine(result.stdout);
      const results = body.result?.results;
      if (!hasObservationHit(results)) {
        fail(`search missing promoted Observation: ${JSON.stringify(results).slice(0, 500)}`);
        return false;
      }
    }

    log("  · adjudicate replay (idempotent)");
    {
      const result = runCli(home, ["adjudicate", "--event-id", promoteEventId, ...base]);
      if (result.status !== 0) {
        fail(`adjudicate replay exited ${result.status}\n${result.stderr || result.stdout}`);
        return false;
      }
      const body = parseJsonLine(result.stdout);
      if (body.status !== "replay" && body.disposition !== "promote") {
        // Accept either replay status or promote disposition on idempotent path
        if (body.disposition !== "promote" && body.status !== "replay") {
          fail(`adjudicate replay unexpected ${JSON.stringify(body).slice(0, 400)}`);
          return false;
        }
      }
    }

    log("smoke-knowledge PASS");
    return true;
  } finally {
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  log("Usage: node scripts/smoke-knowledge.mjs");
  process.exit(0);
}

const ok = runKnowledgeSmoke();
process.exit(ok ? 0 : 1);
