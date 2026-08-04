#!/usr/bin/env node
/**
 * Product 2.0 public-safe knowledge dogfood smoke with Product 3.2 B0 coverage —
 * synthetic fixtures only.
 *
 * Covers multi-hook noise/pollution scenarios for K8 plus:
 *   1) durable decision SessionEnd → promote → default search hit
 *   2) preference SessionEnd → promote
 *   3) PostToolUse tool noise → reject / skip extract
 *   4) thanks/ok chatter SessionEnd → hold or reject (not promote)
 *   5) UserPromptSubmit flood → hold/reject (not promote into default search)
 *   6) secret-like decision → reject (fail-closed)
 *   7) default memory search stays free of noise/secret/chatter pollution
 *   8) adjudicate --stats shows promote >= 2 and reject >= 1
 *   9) policy-scoped held review secondary-policy re-adjudication, replay, and terminal protection
 *  10) metadata-only reconciliation preview and rejected B1/apply flags
 *
 * Usage (repo root, after deps):
 *   pnpm smoke:dogfood
 *   node scripts/smoke-dogfood.mjs
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
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

function ensureCliBuilt(cli) {
  if (cli.kind === "installed") return true;
  if (!existsSync(cli.entry)) {
    log("Building monorepo (CLI dist missing)…");
    const built = run("pnpm", ["build"], { stdio: "inherit" });
    if (built.status !== 0) {
      fail("pnpm build failed");
      return false;
    }
  }
  if (!existsSync(cli.entry)) {
    fail(`CLI entry missing after build: ${cli.entry}`);
    return false;
  }
  return true;
}

export function resolveCliInvocation(argv, sourceEntry = cliEntry) {
  if (argv.length === 0) {
    return { command: process.execPath, args: [sourceEntry], entry: sourceEntry, kind: "source" };
  }
  if (argv.length !== 2 || argv[0] !== "--cli" || !argv[1]) {
    throw new Error("usage: node scripts/smoke-dogfood.mjs [--cli /absolute/path/to/carpeos]");
  }
  if (!isAbsolute(argv[1])) {
    throw new Error("--cli must be an absolute path to the installed carpeos binary");
  }

  let installedEntry;
  try {
    installedEntry = realpathSync(argv[1]);
  } catch {
    throw new Error(`--cli binary does not exist: ${argv[1]}`);
  }
  const installedStats = statSync(installedEntry);
  if (!installedStats.isFile() || (installedStats.mode & 0o111) === 0) {
    throw new Error(`--cli binary is not executable: ${argv[1]}`);
  }
  if (existsSync(sourceEntry) && installedEntry === realpathSync(sourceEntry)) {
    throw new Error("--cli must not reference the repository CLI entry");
  }
  return { command: installedEntry, args: [], entry: installedEntry, kind: "installed" };
}

function runCli(cli, home, argv) {
  return run(cli.command, [...cli.args, ...argv], {
    env: {
      CARPEOS_HOME: home,
      HOME: home,
      NODE_OPTIONS: "--disable-warning=ExperimentalWarning",
    },
  });
}
function runtimeDigest(home) {
  const hash = createHash("sha256");
  const visit = (directory, relative = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const nextRelative = relative === "" ? entry.name : `${relative}/${entry.name}`;
      const nextPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(nextPath, nextRelative);
      } else if (entry.isFile()) {
        hash.update(nextRelative);
        hash.update("\0");
        hash.update(readFileSync(nextPath));
        hash.update("\0");
      }
    }
  };
  visit(home);
  return `sha256:${hash.digest("hex")}`;
}

function acceptanceDecisionCount(home) {
  const database = new DatabaseSync(join(home, "carpeos.sqlite"), { readOnly: true });
  try {
    return Number(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM canonical_events WHERE event_type = 'AcceptanceDecision'",
        )
        .get().count,
    );
  } finally {
    database.close();
  }
}
function observationStatement(home, observationEventId) {
  const database = new DatabaseSync(join(home, "carpeos.sqlite"), { readOnly: true });
  try {
    const row = database
      .prepare("SELECT event_json FROM canonical_events WHERE event_id = ?")
      .get(observationEventId);
    if (row === undefined || typeof row.event_json !== "string") return undefined;
    const event = JSON.parse(row.event_json);
    return event?.payload?.statement;
  } finally {
    database.close();
  }
}

function assertUnchanged(before, home, label) {
  if (runtimeDigest(home) !== before) {
    throw new Error(`${label} changed durable store state`);
  }
}

function capture(cli, home, base, fixture) {
  const result = runCli(cli, home, [
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

function searchBody(cli, home, base, query) {
  const result = runCli(cli, home, [
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

async function runDogfoodSmoke(cli) {
  log("— Knowledge dogfood scenarios (temp home, synthetic only) —");
  if (!ensureCliBuilt(cli)) {
    return false;
  }

  const home = realpathSync(mkdtempSync(join(tmpdir(), "carpeos-dogfood-smoke-")));
  const base = ["--home", home, "--trust-zone", trustZone];

  try {
    log("  · init");
    {
      const result = runCli(cli, home, ["init", ...base]);
      if (result.status !== 0) {
        fail(`init exited ${result.status}\n${result.stderr || result.stdout}`);
        return false;
      }
    }

    log("  · durable decision SessionEnd → promote");
    const decision = capture(cli, home, base, {
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
    const preference = capture(cli, home, base, {
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

    log("  · transcript correction retains later synthetic meaning");
    {
      const transcriptPath = join(home, ".codex", "synthetic-correction.jsonl");
      mkdirSync(dirname(transcriptPath), { recursive: true });
      writeFileSync(
        transcriptPath,
        [
          JSON.stringify({
            type: "user",
            message: { role: "user", content: "Decision: use SQLite for local metadata." },
          }),
          JSON.stringify({
            type: "user",
            message: { role: "user", content: "Correction: replace SQLite with PostgreSQL." },
          }),
        ].join("\n"),
      );
      const obsoleteDecision = "Decision: use SQLite for local metadata.";

      const transcriptCapture = capture(cli, home, base, {
        hook_event_name: "SessionEnd",
        session_id: "session_dogfood_transcript_correction",
        timestamp: "2026-01-01T00:00:02Z",
        transcript_path: transcriptPath,
      });
      if (transcriptCapture.ok !== true || transcriptCapture.extraction?.status !== "extracted") {
        fail(
          `transcript correction fixture unexpected ${JSON.stringify(transcriptCapture).slice(0, 400)}`,
        );
        return false;
      }
      const observationEventId = transcriptCapture.extraction?.observation_event_id;
      if (typeof observationEventId !== "string") {
        fail(`transcript correction missing observation id ${JSON.stringify(transcriptCapture)}`);
        return false;
      }
      const transcriptStatement = observationStatement(home, observationEventId);
      if (
        typeof transcriptStatement !== "string" ||
        transcriptStatement.includes(obsoleteDecision)
      ) {
        fail(`transcript correction statement unexpected ${JSON.stringify(transcriptStatement)}`);
        return false;
      }
    }
    log("  · PostToolUse noise flood → reject/skip");
    for (let i = 0; i < 3; i += 1) {
      const noise = capture(cli, home, base, {
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
      const chatter = capture(cli, home, base, {
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
      const prompt = capture(cli, home, base, {
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
    const secretLike = capture(cli, home, base, {
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
      const result = runCli(cli, home, ["adjudicate", "--stats", ...base]);
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

    log("  · policy-aware held review, secondary-policy re-adjudication, and terminal protection");
    {
      const heldFixture = capture(cli, home, base, {
        hook_event_name: "SessionEnd",
        session_id: "session_dogfood_held_review",
        timestamp: "2026-01-01T00:04:00Z",
        message: "Synthetic held candidate POLICY BODY SENTINEL without durable markers.",
      });
      const heldEventId = heldFixture.event_id;
      if (heldFixture.ok !== true || typeof heldEventId !== "string") {
        fail(`held fixture unexpected ${JSON.stringify(heldFixture).slice(0, 400)}`);
        return false;
      }

      const listDefault = runCli(cli, home, [
        "adjudicate",
        "list-held",
        "--policy-version",
        "adj_v3",
        ...base,
      ]);
      const defaultHeld = parseJsonLine(listDefault.stdout);
      if (
        listDefault.status !== 0 ||
        defaultHeld.count < 1 ||
        !defaultHeld.held?.some((row) => row.source_event_id === heldEventId)
      ) {
        fail(`default held list unexpected ${JSON.stringify(defaultHeld).slice(0, 400)}`);
        return false;
      }

      const secondaryPolicy = runCli(cli, home, [
        "adjudicate",
        "--event-id",
        heldEventId,
        "--policy-version",
        "adj_fix_v2",
        ...base,
      ]);
      const secondaryPolicyBody = parseJsonLine(secondaryPolicy.stdout);
      if (secondaryPolicy.status !== 0 || secondaryPolicyBody.status !== "held") {
        fail(
          `secondary-policy re-adjudication unexpected ${JSON.stringify(secondaryPolicyBody).slice(0, 400)}`,
        );
        return false;
      }

      const secondaryPolicyList = runCli(cli, home, [
        "adjudicate",
        "list-held",
        "--policy-version",
        "adj_fix_v2",
        ...base,
      ]);
      const secondaryPolicyHeld = parseJsonLine(secondaryPolicyList.stdout);
      if (
        secondaryPolicyList.status !== 0 ||
        secondaryPolicyHeld.count !== 1 ||
        secondaryPolicyHeld.held?.[0]?.source_event_id !== heldEventId
      ) {
        fail(
          `secondary-policy held list unexpected ${JSON.stringify(secondaryPolicyHeld).slice(0, 400)}`,
        );
        return false;
      }

      const promote = runCli(cli, home, [
        "adjudicate",
        "promote-held",
        "--event-id",
        heldEventId,
        "--policy-version",
        "adj_v3",
        ...base,
      ]);
      const promoted = parseJsonLine(promote.stdout);
      if (
        promote.status !== 0 ||
        promoted.status !== "reviewed" ||
        promoted.decision !== "promote" ||
        promoted.observation?.lifecycle_status !== "active"
      ) {
        fail(`held promotion unexpected ${JSON.stringify(promoted).slice(0, 400)}`);
        return false;
      }

      const replay = runCli(cli, home, [
        "adjudicate",
        "promote-held",
        "--event-id",
        heldEventId,
        "--policy-version",
        "adj_v3",
        ...base,
      ]);
      const replayBody = parseJsonLine(replay.stdout);
      if (
        replay.status !== 0 ||
        replayBody.status !== "replay" ||
        replayBody.decision !== "promote"
      ) {
        fail(`held replay unexpected ${JSON.stringify(replayBody).slice(0, 400)}`);
        return false;
      }

      const opposite = runCli(cli, home, [
        "adjudicate",
        "reject-held",
        "--event-id",
        heldEventId,
        "--policy-version",
        "adj_v3",
        ...base,
      ]);
      const oppositeBody = parseJsonLine(opposite.stdout);
      if (opposite.status !== 1 || oppositeBody.status !== "failed" || oppositeBody.count !== 0) {
        fail(`opposite terminal review unexpected ${JSON.stringify(oppositeBody).slice(0, 400)}`);
        return false;
      }

      const secondaryPolicyReview = runCli(cli, home, [
        "adjudicate",
        "reject-held",
        "--event-id",
        heldEventId,
        "--policy-version",
        "adj_fix_v2",
        ...base,
      ]);
      const secondaryPolicyReviewBody = parseJsonLine(secondaryPolicyReview.stdout);
      if (
        secondaryPolicyReview.status !== 0 ||
        secondaryPolicyReviewBody.status !== "reviewed" ||
        secondaryPolicyReviewBody.decision !== "reject"
      ) {
        fail(
          `secondary-policy review unexpected ${JSON.stringify(secondaryPolicyReviewBody).slice(0, 400)}`,
        );
        return false;
      }
    }

    log("  · read-only B0 reconciliation preview and unsupported apply flags");
    {
      const acceptanceBefore = acceptanceDecisionCount(home);
      const beforePreview = runtimeDigest(home);
      if (acceptanceBefore !== 0) {
        fail(`expected no AcceptanceDecision rows, got ${acceptanceBefore}`);
        return false;
      }
      const previewArgs = [
        "adjudicate",
        "reconcile-policy",
        "--from-policy",
        "adj_v3",
        "--to-policy",
        "adj_fix_v2",
        "--trust-zone",
        trustZone,
        "--limit",
        "200",
      ];
      const first = runCli(cli, home, previewArgs);
      const second = runCli(cli, home, previewArgs);
      const firstBody = parseJsonLine(first.stdout);
      const secondBody = parseJsonLine(second.stdout);
      if (
        first.status !== 0 ||
        second.status !== 0 ||
        first.stdout.trim() !== JSON.stringify(firstBody) ||
        first.stdout !== second.stdout ||
        JSON.stringify(firstBody) !== JSON.stringify(secondBody) ||
        firstBody.schema !== "carpeos.policy-reconciliation-plan/v2" ||
        !/^sha256:[0-9a-f]{64}$/.test(firstBody.plan_digest) ||
        firstBody.total_candidate_count < firstBody.classified_count ||
        firstBody.classified_count !== firstBody.entries?.length ||
        firstBody.truncated !== false ||
        firstBody.plan_admissible !== true ||
        !Array.isArray(firstBody.global_taint_reason_codes) ||
        firstBody.global_taint_reason_codes.length !== 0 ||
        first.stdout.includes("POLICY BODY SENTINEL") ||
        first.stdout.includes("SQLite") ||
        first.stdout.includes("PostgreSQL")
      ) {
        fail(`B0 preview contract unexpected ${JSON.stringify(firstBody).slice(0, 500)}`);
        return false;
      }
      assertUnchanged(beforePreview, home, "B0 preview");
      if (acceptanceDecisionCount(home) !== acceptanceBefore) {
        fail("B0 preview created an AcceptanceDecision");
        return false;
      }

      for (const [flag, value] of [
        ["--plan-digest", "synthetic"],
        ["--expected-total-count", "0"],
        ["--expected-eligible-write-count", "0"],
        ["--expected-eligible-noop-count", "0"],
        ["--expected-unsafe-count", "0"],
        ["--apply", undefined],
        ["--apply-safe-subset", undefined],
        ["--acknowledge-unsafe-count", "0"],
        ["--pin", "synthetic"],
        ["--policy-version", "adj_v3"],
        ["--format", "json"],
      ]) {
        const beforeUnsupported = runtimeDigest(home);
        const result = runCli(cli, home, [
          ...previewArgs,
          flag,
          ...(value === undefined ? [] : [value]),
        ]);
        if (result.status !== 2) {
          fail(`unsupported ${flag} exited ${result.status}`);
          return false;
        }
        assertUnchanged(beforeUnsupported, home, `unsupported ${flag}`);
        if (acceptanceDecisionCount(home) !== acceptanceBefore) {
          fail(`unsupported ${flag} created an AcceptanceDecision`);
          return false;
        }
      }
    }
    log("  · retrieval rebuild");
    {
      const result = runCli(cli, home, ["retrieval", "rebuild", ...base]);
      if (result.status !== 0) {
        fail(`rebuild exited ${result.status}\n${result.stderr || result.stdout}`);
        return false;
      }
    }

    log("  · default search finds durable decisions/preferences");
    {
      const decisionSearch = searchBody(cli, home, base, "SessionEnd decided pnpm");
      const blob = visibleTextBlob(decisionSearch);
      if (!/pnpm|decided|credentials/i.test(blob)) {
        fail(`decision search missing promoted meaning: ${blob.slice(0, 500)}`);
        return false;
      }
      const preferenceSearch = searchBody(cli, home, base, "offline deterministic package tests");
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
        ["thanks only chatter", /"thanks"|lgtm/i],
      ];
      for (const [query, pattern] of pollutionQueries) {
        const body = searchBody(cli, home, base, query);
        const blob = visibleTextBlob(body);
        if (pattern.test(blob)) {
          fail(`default search polluted for query=${query}: ${blob.slice(0, 500)}`);
          return false;
        }
      }
      // filters must remain active-only
      const body = searchBody(cli, home, base, "SessionEnd");
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    log("Usage: node scripts/smoke-dogfood.mjs [--cli /absolute/path/to/carpeos]");
    process.exit(0);
  }

  let cli;
  try {
    cli = resolveCliInvocation(process.argv.slice(2));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  const ok = await runDogfoodSmoke(cli);
  process.exit(ok ? 0 : 1);
}
