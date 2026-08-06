#!/usr/bin/env node
/**
 * Local pre-PR gate that mirrors GitHub PR lean CI and fails closed before push.
 *
 * Modes:
 *   quick  — format + lint + public-boundary + path-scoped tests (fast agent loop)
 *   pr     — PR lean mirror (default): same invariants as `pnpm check`, parallelized
 *   full   — pr + optional smokes (main-full subset; slower)
 *
 * Usage:
 *   pnpm preflight
 *   pnpm preflight:quick
 *   node scripts/preflight.mjs --mode=pr --base=origin/main
 *   node scripts/preflight.mjs --mode=pr --fix-format
 *   make preflight
 *
 * Exit codes:
 *   0 success
 *   1 check failure
 *   2 usage / git hygiene failure
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODES = new Set(["quick", "pr", "full"]);
const DEFAULT_BASE = "origin/main";

function parseArgs(argv) {
  const options = {
    mode: "pr",
    base: DEFAULT_BASE,
    fixFormat: false,
    skipFetch: false,
    skipConflict: false,
    help: false,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--fix-format") options.fixFormat = true;
    else if (arg === "--skip-fetch") options.skipFetch = true;
    else if (arg === "--skip-conflict") options.skipConflict = true;
    else if (arg.startsWith("--mode=")) options.mode = arg.slice("--mode=".length);
    else if (arg.startsWith("--base=")) options.base = arg.slice("--base=".length);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!MODES.has(options.mode)) {
    throw new Error(`--mode must be one of ${[...MODES].join("|")} (got ${options.mode})`);
  }
  return options;
}

function printHelp() {
  process.stdout.write(`CarpeOS local preflight (PR-lean mirror)

Usage:
  node scripts/preflight.mjs [--mode=quick|pr|full] [--base=origin/main] [--fix-format]

Modes:
  quick  format + lint + public-boundary + scoped tests (agent iteration)
  pr     default — parallel PR lean gate equivalent to CI Checks (pnpm check)
  full   pr + smoke scripts used on main-full (optional, slower)

Flags:
  --fix-format     run biome format --write before format:check
  --skip-fetch     do not git fetch the base ref
  --skip-conflict  skip merge-tree conflict probe vs base
  --base=<ref>     comparison base (default origin/main)

Makefile:
  make preflight
  make preflight-quick
  make preflight-pr
  make preflight-full

What this does NOT cover (still needs GHA / Linux):
  - Product 4 bubblewrap live sandbox on ubuntu-latest
  - Gitleaks secret-scan workflow
  - main-full evals beyond the smoke subset in --mode=full
`);
}

function run(command, args, { label, cwd = ROOT, env = process.env } = {}) {
  const started = Date.now();
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolvePromise({
        label,
        command: [command, ...args].join(" "),
        code: 127,
        ms: Date.now() - started,
        stdout,
        stderr: `${stderr}${error.message}\n`,
        ok: false,
      });
    });
    child.on("close", (code) => {
      resolvePromise({
        label,
        command: [command, ...args].join(" "),
        code: code ?? 1,
        ms: Date.now() - started,
        stdout,
        stderr,
        ok: (code ?? 1) === 0,
      });
    });
  });
}

async function runParallel(jobs, { concurrency = Math.max(2, Math.min(cpus().length, 6)) } = {}) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < jobs.length) {
      const current = index;
      index += 1;
      results[current] = await jobs[current]();
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function printResult(result) {
  const status = result.ok ? "PASS" : "FAIL";
  const color = result.ok ? "\u001b[32m" : "\u001b[31m";
  const reset = "\u001b[0m";
  process.stdout.write(
    `${color}${status}${reset}  ${result.label.padEnd(28)} ${(result.ms / 1000).toFixed(1)}s  ${result.command}\n`,
  );
  if (!result.ok) {
    const tail = [result.stdout, result.stderr]
      .filter(Boolean)
      .join("\n")
      .split("\n")
      .slice(-40)
      .join("\n");
    if (tail.trim()) process.stdout.write(`${tail}\n`);
  }
}

async function gitRefExists(ref) {
  const result = await run("git", ["rev-parse", "--verify", "--quiet", ref], {
    label: `git-ref ${ref}`,
  });
  return result.ok;
}

async function ensureBase(options) {
  if (!options.skipFetch && options.base.startsWith("origin/")) {
    const remoteRef = options.base.slice("origin/".length);
    const fetch = await run("git", ["fetch", "origin", remoteRef, "--quiet"], {
      label: "git fetch base",
    });
    printResult(fetch);
    if (!fetch.ok) return fetch;
  }
  if (!(await gitRefExists(options.base))) {
    return {
      label: "git base ref",
      command: `git rev-parse ${options.base}`,
      code: 2,
      ms: 0,
      stdout: "",
      stderr: `base ref not found: ${options.base}\n`,
      ok: false,
    };
  }
  return {
    label: "git base ref",
    command: options.base,
    code: 0,
    ms: 0,
    stdout: "",
    stderr: "",
    ok: true,
  };
}

async function conflictProbe(base) {
  const mergeBase = await run("git", ["merge-base", base, "HEAD"], { label: "git merge-base" });
  if (!mergeBase.ok) return mergeBase;
  const baseSha = mergeBase.stdout.trim();
  // Prefer modern merge-tree --write-tree (exit 1 on conflict) when available.
  const modern = await run("git", ["merge-tree", "--write-tree", base, "HEAD"], {
    label: "git merge-tree --write-tree",
  });
  if (modern.code === 0) {
    return { ...modern, ok: true, label: "git merge-tree (clean)" };
  }
  if (modern.code === 1 && /CONFLICT/i.test(`${modern.stdout}\n${modern.stderr}`)) {
    return {
      ...modern,
      ok: false,
      label: "git merge-tree conflict probe",
      stderr: `${modern.stderr}\nmerge-tree reports conflicts vs ${base}. Rebase onto ${base} before opening a PR.\n`,
    };
  }
  // Older git: fall back to three-arg merge-tree and scan structured conflict headers only.
  const tree = await run("git", ["merge-tree", baseSha, base, "HEAD"], {
    label: "git merge-tree conflict probe",
  });
  const text = `${tree.stdout}\n${tree.stderr}`;
  const hasConflict = /^changed in both\b/m.test(text) || /^CONFLICT \(/m.test(text);
  if (hasConflict) {
    return {
      ...tree,
      ok: false,
      code: 1,
      stderr: `${tree.stderr}\nmerge-tree reports conflicts vs ${base}. Rebase onto ${base} before opening a PR.\n`,
    };
  }
  return { ...tree, ok: true, label: "git merge-tree (clean)" };
}

async function changedFiles(base) {
  const result = await run("git", ["diff", "--name-only", `${base}...HEAD`], {
    label: "git changed files",
  });
  if (!result.ok) return { result, files: [] };
  const files = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return { result, files };
}

function product4Touched(files) {
  return files.some(
    (file) =>
      file.startsWith("scripts/product4/") ||
      file.startsWith("scripts/test/product4-") ||
      file.startsWith("schemas/product4") ||
      file.startsWith("spec/product4/") ||
      file.startsWith(".github/workflows/product-4-"),
  );
}

function workflowTouched(files) {
  return files.some((file) => file.startsWith(".github/workflows/"));
}

function pnpm(args, label) {
  return () => run("pnpm", args, { label });
}

function listTestFiles(relativeDir, predicate) {
  const dir = resolve(ROOT, relativeDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".test.mjs") && predicate(name))
    .map((name) => join(relativeDir, name))
    .sort();
}

function nodeTest(files, label) {
  if (files.length === 0) {
    return async () => ({
      label,
      command: "node --test <no files>",
      code: 0,
      ms: 0,
      stdout: "",
      stderr: "",
      ok: true,
    });
  }
  return () => run(process.execPath, ["--test", ...files], { label });
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    printHelp();
    return;
  }

  process.chdir(ROOT);
  if (!existsSync(resolve(ROOT, "package.json"))) {
    process.stderr.write("preflight must run from a CarpeOS checkout root\n");
    process.exitCode = 2;
    return;
  }

  process.stdout.write(
    `\nCarpeOS preflight  mode=${options.mode}  base=${options.base}  cpus=${cpus().length}\n\n`,
  );

  const failures = [];
  const baseCheck = await ensureBase(options);
  if (!baseCheck.ok) {
    printResult(baseCheck);
    process.exitCode = 2;
    return;
  }

  if (!options.skipConflict) {
    const conflict = await conflictProbe(options.base);
    printResult(conflict);
    if (!conflict.ok) {
      process.stdout.write(
        `\nPREFLIGHT FAIL  merge conflict vs ${options.base}\n` +
          `Rebase first: git fetch origin && git rebase ${options.base}\n` +
          `Do not open/update a PR until this is green.\n`,
      );
      process.exitCode = 1;
      return;
    }
  }

  const { result: changedResult, files } = await changedFiles(options.base);
  printResult({ ...changedResult, ok: true, label: `changed files (${files.length})` });
  if (files.length > 0) {
    process.stdout.write(
      `  paths: ${files.slice(0, 12).join(", ")}${files.length > 12 ? ", …" : ""}\n`,
    );
  }

  if (options.fixFormat) {
    const formatWrite = await run("pnpm", ["format"], { label: "biome format --write" });
    printResult(formatWrite);
    if (!formatWrite.ok) failures.push(formatWrite);
  }

  // Phase 1 — independent cheap gates in parallel (always for every mode).
  const phase1 = await runParallel([
    pnpm(["format:check"], "format:check"),
    pnpm(["lint"], "lint"),
    pnpm(["public-boundary"], "public-boundary"),
  ]);
  const phase1Failures = [];
  for (const result of phase1) {
    printResult(result);
    if (!result.ok) phase1Failures.push(result);
  }
  // Fail closed early: do not burn build/test minutes on format/lint nits.
  if (phase1Failures.length > 0) {
    process.stdout.write(
      `\nPREFLIGHT FAIL  ${phase1Failures.length} cheap gate(s)  mode=${options.mode}\n` +
        `Fix format/lint/public-boundary first (try: make preflight-fix).\n` +
        `Do not open/update a PR until this is green.\n`,
    );
    process.exitCode = 1;
    return;
  }

  if (options.mode === "quick") {
    const scoped = [];
    const product4Tests = listTestFiles("scripts/test", (name) => name.startsWith("product4-"));
    const allScriptTests = listTestFiles("scripts/test", () => true);
    if (product4Touched(files) || files.length === 0) {
      scoped.push(nodeTest(product4Tests, "product4 unit tests"));
    }
    if (workflowTouched(files) || product4Touched(files)) {
      scoped.push(
        nodeTest(
          product4Tests.filter((file) => file.endsWith("product4-workflows.test.mjs")),
          "product4 workflow contracts",
        ),
      );
    }
    if (scoped.length === 0) {
      scoped.push(nodeTest(allScriptTests, "scripts unit tests (fallback)"));
    }
    const phaseQuick = await runParallel(scoped);
    for (const result of phaseQuick) {
      printResult(result);
      if (!result.ok) failures.push(result);
    }
  } else {
    // Phase 2 — build once (required for typecheck/tests that consume dist).
    const build = await run("pnpm", ["build"], { label: "build" });
    printResult(build);
    if (!build.ok) failures.push(build);

    // Phase 3 — typecheck + test in parallel after a successful build.
    if (build.ok) {
      const phase3 = await runParallel([pnpm(["typecheck"], "typecheck"), pnpm(["test"], "test")]);
      for (const result of phase3) {
        printResult(result);
        if (!result.ok) failures.push(result);
      }
    }
  }

  if (options.mode === "full") {
    const smokes = await runParallel(
      [
        pnpm(["smoke:dogfood"], "smoke:dogfood"),
        pnpm(["smoke:mcp"], "smoke:mcp"),
        pnpm(["smoke:product"], "smoke:product"),
        pnpm(["smoke:knowledge"], "smoke:knowledge"),
      ],
      { concurrency: 2 },
    );
    for (const result of smokes) {
      printResult(result);
      if (!result.ok) failures.push(result);
    }
  }

  process.stdout.write("\n--- Local coverage gaps (still need GHA) ---\n");
  process.stdout.write(
    [
      "- Product 4 bubblewrap sandbox on ubuntu-latest (macOS cannot prove B1/B3 live)",
      "- Gitleaks secret-scan workflow",
      "- main-full capture/retrieval evals (use --mode=full for smokes only)",
      "",
    ].join("\n"),
  );

  if (failures.length > 0) {
    process.stdout.write(
      `\nPREFLIGHT FAIL  ${failures.length} step(s)  mode=${options.mode}\n` +
        `Fix locally, re-run: pnpm preflight --mode=${options.mode}\n` +
        `Do not open/update a PR until this is green.\n`,
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `\nPREFLIGHT PASS  mode=${options.mode}\n` +
      `Safe to push/open PR from a hygiene perspective (CI still re-runs on GHA).\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 2;
});
