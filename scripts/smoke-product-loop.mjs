#!/usr/bin/env node
/**
 * Product 1.0 E2E gate — named CI proof for the core loop:
 *   capture fixture → extract → rebuild → search → context-pack
 *
 * Asserts meaningful Observation units (not only EvidenceArtifact metadata).
 * Synthetic data only; temp home under os.tmpdir(); no private paths.
 *
 * Usage (repo root, after deps):
 *   pnpm smoke:product
 *   node scripts/smoke-product-loop.mjs
 *
 * Related: pnpm smoke:mcp (G5 MCP tool/list + broader unit smokes).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const trustZone = "tz_smoke_product";
const cliEntry = join(root, "apps/carpeos-cli/dist/index.js");

const args = new Set(process.argv.slice(2));
const help = args.has("--help") || args.has("-h");

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function fail(msg) {
  process.stderr.write(`smoke-product FAIL: ${msg}\n`);
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

/**
 * @param {string} home
 * @param {string[]} argv
 */
function runCli(home, argv) {
  return run(process.execPath, [cliEntry, ...argv], {
    env: {
      CARPEOS_HOME: home,
      NODE_OPTIONS: "--disable-warning=ExperimentalWarning",
    },
  });
}

function sourceEventTypes(item) {
  return (item?.lineage?.source_records ?? item?.source_records ?? [])
    .map((record) => record?.event_type)
    .filter(Boolean);
}

function describeSearchTopHit(home, results) {
  const top = Array.isArray(results) ? results[0] : undefined;
  return JSON.stringify({
    result_count: Array.isArray(results) ? results.length : 0,
    top_status: top?.status,
    top_chunk_id: top?.chunk_id,
    top_chunk_kind:
      top?.chunk?.chunk_kind ?? top?.chunk_kind ?? indexedChunkKind(home, top?.chunk_id),
    top_text: String(top?.text ?? top?.chunk?.text ?? "").slice(0, 180),
    top_source_event_types: sourceEventTypes(top),
  });
}

function indexedChunkKind(home, chunkId) {
  if (typeof chunkId !== "string" || chunkId.length === 0) {
    return undefined;
  }
  const result = spawnSync(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "-e",
      `
        const { DatabaseSync } = await import("node:sqlite");
        const db = new DatabaseSync(process.argv[1], { readOnly: true });
        try {
          const row = db.prepare("SELECT chunk_kind FROM retrieval_chunks WHERE chunk_id = ?").get(process.argv[2]);
          if (typeof row?.chunk_kind === "string") process.stdout.write(row.chunk_kind);
        } finally {
          db.close();
        }
      `,
      join(home, "carpeos.sqlite"),
      chunkId,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (result.status !== 0) {
    return undefined;
  }
  return result.stdout.trim() || undefined;
}

function hasObservationHit(home, results) {
  if (!Array.isArray(results) || results.length === 0) {
    return false;
  }
  const top = results[0];
  const kind = top?.chunk?.chunk_kind ?? top?.chunk_kind ?? indexedChunkKind(home, top?.chunk_id);
  const text = String(top?.text ?? top?.chunk?.text ?? "");
  const eventTypes = sourceEventTypes(top);
  return (
    top?.status === "visible" &&
    kind === "summary" &&
    eventTypes.includes("Observation") &&
    /Captured codex SessionEnd evidence/i.test(text)
  );
}

function runProductLoop() {
  log("— Product loop (temp home) —");
  if (!ensureCliBuilt()) {
    return false;
  }

  const home = mkdtempSync(join(tmpdir(), "carpeos-product-smoke-"));
  const base = ["--home", home, "--trust-zone", trustZone];
  /** @type {string | undefined} */
  let evidenceEventId;

  try {
    // 1) init
    log("  · init");
    {
      const result = runCli(home, ["init", ...base]);
      if (result.status !== 0) {
        fail(`init exited ${result.status}\n${result.stderr || result.stdout}`);
        return false;
      }
      const body = parseJsonLine(result.stdout);
      if (body.ok !== true || body.command !== "init" || body.trust_zone_id !== trustZone) {
        fail(`init unexpected payload ${JSON.stringify(body).slice(0, 300)}`);
        return false;
      }
    }

    // 2) capture fixture (auto extract ON for eligible SessionEnd)
    log("  · capture-hook (SessionEnd → extract)");
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
          session_id: "session_smoke_product",
          timestamp: "2026-01-01T00:00:00Z",
          message: "synthetic product loop alpha",
        }),
      ]);
      if (result.status !== 0) {
        fail(`capture-hook exited ${result.status}\n${result.stderr || result.stdout}`);
        return false;
      }
      const body = parseJsonLine(result.stdout);
      if (
        body.ok !== true ||
        body.command !== "capture-hook" ||
        body.status !== "captured" ||
        body.extraction?.status !== "extracted"
      ) {
        fail(`capture-hook unexpected payload ${JSON.stringify(body).slice(0, 400)}`);
        return false;
      }
      evidenceEventId = body.event_id;
      if (typeof evidenceEventId !== "string" || !evidenceEventId.startsWith("evt_")) {
        fail(`capture-hook missing event_id: ${JSON.stringify(body).slice(0, 200)}`);
        return false;
      }
    }

    // 3) explicit extract (idempotent replay)
    log("  · extract --event-id (replay)");
    {
      const result = runCli(home, ["extract", "--event-id", evidenceEventId, ...base]);
      if (result.status !== 0) {
        fail(`extract exited ${result.status}\n${result.stderr || result.stdout}`);
        return false;
      }
      const body = parseJsonLine(result.stdout);
      if (body.ok !== true || body.command !== "extract" || body.status !== "replay") {
        fail(`extract unexpected payload ${JSON.stringify(body).slice(0, 400)}`);
        return false;
      }
    }

    // 4) ineligible hook still captures without inventing Observation
    log("  · capture-hook (PostToolUse → extract skipped)");
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
          session_id: "session_smoke_product",
          timestamp: "2026-01-01T00:00:01Z",
          message: "synthetic product tool noise",
        }),
      ]);
      if (result.status !== 0) {
        fail(`PostToolUse capture exited ${result.status}\n${result.stderr || result.stdout}`);
        return false;
      }
      const body = parseJsonLine(result.stdout);
      if (body.ok !== true || body.status !== "captured") {
        fail(`PostToolUse capture unexpected ${JSON.stringify(body).slice(0, 300)}`);
        return false;
      }
      if (body.extraction?.status !== "skipped") {
        fail(
          `PostToolUse should skip extraction, got ${JSON.stringify(body.extraction).slice(0, 200)}`,
        );
        return false;
      }
    }

    // 5) rebuild
    log("  · retrieval rebuild");
    {
      const result = runCli(home, ["retrieval", "rebuild", ...base]);
      if (result.status !== 0) {
        fail(`rebuild exited ${result.status}\n${result.stderr || result.stdout}`);
        return false;
      }
      const body = parseJsonLine(result.stdout);
      if (body.ok !== true || body.command !== "retrieval rebuild") {
        fail(`rebuild unexpected payload ${JSON.stringify(body).slice(0, 300)}`);
        return false;
      }
    }

    // 6) search meaningful units
    log("  · memory search (Observation first-class)");
    {
      const result = runCli(home, [
        "memory",
        "search",
        ...base,
        "--visible-trust-zone",
        trustZone,
        "--query",
        "Captured SessionEnd",
      ]);
      if (result.status !== 0) {
        fail(`search exited ${result.status}\n${result.stderr || result.stdout}`);
        return false;
      }
      const body = parseJsonLine(result.stdout);
      if (body.ok !== true || body.command !== "memory search") {
        fail(`search unexpected payload ${JSON.stringify(body).slice(0, 300)}`);
        return false;
      }
      const results = body.result?.results;
      if (!hasObservationHit(home, results)) {
        fail(
          `search top hit was not the expected Observation summary: ${describeSearchTopHit(home, results)}`,
        );
        return false;
      }
    }

    // 7) context-pack
    log("  · memory context-pack (observations section)");
    {
      const result = runCli(home, [
        "memory",
        "context-pack",
        ...base,
        "--visible-trust-zone",
        trustZone,
        "--task",
        "product smoke: summarize synthetic session",
        "--max-items",
        "16",
        "--max-characters",
        "8000",
      ]);
      if (result.status !== 0) {
        fail(`context-pack exited ${result.status}\n${result.stderr || result.stdout}`);
        return false;
      }
      const body = parseJsonLine(result.stdout);
      if (body.ok !== true || body.command !== "memory context-pack") {
        fail(`context-pack unexpected payload ${JSON.stringify(body).slice(0, 300)}`);
        return false;
      }
      const pack = body.pack;
      if (pack === null || typeof pack !== "object") {
        fail("context-pack missing pack object");
        return false;
      }
      for (const key of [
        "schema_version",
        "tool",
        "accepted_facts",
        "observations",
        "evidence_summaries",
        "budget",
      ]) {
        if (!(key in pack)) {
          fail(`context-pack missing key ${key}`);
          return false;
        }
      }
      if (pack.tool !== "memory_context_pack" || pack.schema_version !== "v1") {
        fail(`context-pack bad tool/schema: ${pack.tool}/${pack.schema_version}`);
        return false;
      }
      if (!Array.isArray(pack.observations) || pack.observations.length < 1) {
        fail(`context-pack observations empty: ${JSON.stringify(pack.observations).slice(0, 200)}`);
        return false;
      }
    }

    log("  product loop PASS");
    return true;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function main() {
  if (help) {
    process.stdout.write(`Product 1.0 E2E smoke gate

Usage:
  node scripts/smoke-product-loop.mjs
  pnpm smoke:product

Covers: init → capture+extract → extract replay → PostToolUse skip →
rebuild → search (Observation) → context-pack (observations).
Synthetic local only.
`);
    return;
  }

  log("CarpeOS product loop smoke (1.0 gate)");
  log(`  root: ${root}`);

  const ok = runProductLoop();
  if (!ok) {
    process.exitCode = 1;
    process.stderr.write("smoke-product: FAILED\n");
    return;
  }
  process.stdout.write("smoke-product: PASS\n");
}

main();
