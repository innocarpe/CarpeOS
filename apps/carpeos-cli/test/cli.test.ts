import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ADJUDICATION_POLICY_VERSION } from "@carpeos/capture";
import { LocalCaptureStore, StaticKeyProvider } from "@carpeos/local-store";
import type {
  ProtectedValueMetadata,
  ProtectedValueUploadIntent,
  ProtectedValueUploadReceipt,
  SyncPullRequest,
  SyncPushRequest,
  SyncPushResult,
} from "@carpeos/schema";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

const packageRoot = resolve(import.meta.dirname, "..");
const cliPath = join(packageRoot, "dist", "index.js");
const createdDirs: string[] = [];
const syncKey = new Uint8Array(32).fill(7);
const syncCredential = "synthetic_sync_credential_00000000000000000001";

beforeAll(() => {
  execFileSync(
    process.execPath,
    [
      resolve(packageRoot, "..", "..", "node_modules", "typescript", "bin", "tsc"),
      "-p",
      join(packageRoot, "tsconfig.json"),
    ],
    {
      stdio: "pipe",
    },
  );
});

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("carpeos CLI", () => {
  it("prints package version as JSON", async () => {
    const viaCommand = await captureHelp(["version"]);
    expect(viaCommand.status).toBe(0);
    const body = JSON.parse(viaCommand.stdout) as {
      ok: boolean;
      command: string;
      name: string;
      version: string;
      node: string;
    };
    expect(body).toMatchObject({
      ok: true,
      command: "version",
      name: "@innocarpe/carpeos",
    });
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(body.node).toMatch(/^v\d+/);

    const viaFlag = await captureHelp(["--version"]);
    expect(viaFlag.status).toBe(0);
    expect(JSON.parse(viaFlag.stdout)).toMatchObject({ ok: true, command: "version" });
  });

  it("prints human help for empty argv, --help, help, and command topics", async () => {
    const empty = await captureHelp([]);
    expect(empty.status).toBe(0);
    expect(empty.stdout).toContain("USAGE");

    const flag = await captureHelp(["--help"]);
    expect(flag.status).toBe(0);
    expect(flag.stdout).toContain("USAGE");
    expect(flag.stdout).toContain("memory");
    expect(flag.stdout).toContain("carpeos setup");

    const short = await captureHelp(["-h"]);
    expect(short.status).toBe(0);
    expect(short.stdout).toContain("COMMANDS");

    const topic = await captureHelp(["help", "memory"]);
    expect(topic.status).toBe(0);
    expect(topic.stdout).toContain("context-pack");
    expect(topic.stdout).toContain("--visible-trust-zone");

    const nested = await captureHelp(["memory", "--help"]);
    expect(nested.status).toBe(0);
    expect(nested.stdout).toContain("carpeos memory");

    const setupTopic = await captureHelp(["help", "setup"]);
    expect(setupTopic.status).toBe(0);
    expect(setupTopic.stdout).toContain("run --apply");

    const adjudicateTopic = await captureHelp(["help", "adjudicate"]);
    expect(adjudicateTopic.status).toBe(0);
    expect(adjudicateTopic.stdout).toContain("list-held");
    expect(adjudicateTopic.stdout).toContain("promote-held");
    expect(adjudicateTopic.stdout).toContain("reject-held");
    expect(adjudicateTopic.stdout).toContain("history");
    const memoryTopic = await captureHelp(["help", "memory"]);
    expect(memoryTopic.status).toBe(0);
    expect(memoryTopic.stdout).toContain("--include-held");
    expect(adjudicateTopic.stdout).toContain("--policy-version");
    expect(adjudicateTopic.stdout).toContain("Neither path creates an AcceptanceDecision");
    expect(adjudicateTopic.stdout).toContain("adj_v3");
  });

  it("initializes, identifies a project, captures without plaintext output, and replays", () => {
    const context = makeContext();
    const initialized = runJson(["init"], context);
    expect(initialized.status).toBe(0);
    expect(initialized.stdout).toMatchObject({ ok: true, command: "init" });

    const identified = runJson(["project", "identify"], context);
    expect(identified.status).toBe(0);
    expect(identified.stdout.project_id).toBe(initialized.stdout.project_id);

    const raw = JSON.stringify({
      hook_event_name: "SessionEnd",
      session_id: "session_synthetic",
      turn_id: "turn_synthetic",
      timestamp: "2026-01-01T00:00:00Z",
      message: "SYNTHETIC_CLI_PRIVATE_SENTINEL",
    });
    const first = runJson(["capture-hook", "--no-extract", "--provider", "codex"], context, raw);
    expect(first.status).toBe(0);
    expect(first.stdout).toMatchObject({
      ok: true,
      command: "capture-hook",
      status: "captured",
      event_type: "EvidenceArtifact",
    });
    expect(first.rawStdout).not.toContain("SYNTHETIC_CLI_PRIVATE_SENTINEL");

    const replay = runJson(["capture-hook", "--no-extract", "--provider", "codex"], context, raw);
    expect(replay.status).toBe(0);
    expect(replay.stdout.status).toBe("replay");
    expect(replay.stdout.event_id).toBe(first.stdout.event_id);

    const status = runJson(["outbox", "status"], context);
    expect(status.stdout).toMatchObject({
      ok: true,
      status: { pending: 1, leased: 0, delivered: 0 },
      errors: [],
    });
  });

  it("extracts Observation by default on eligible capture-hook", () => {
    const context = makeContext();
    runJson(["init"], context);
    const captured = runJson(
      ["capture-hook", "--provider", "codex"],
      context,
      JSON.stringify({
        hook_event_name: "SessionEnd",
        session_id: "session_extract",
        timestamp: "2026-01-01T00:00:00Z",
        message: "SYNTHETIC_EXTRACT_SENTINEL",
      }),
    );
    expect(captured.status).toBe(0);
    const capturedOut = captured.stdout as {
      event_id?: string;
      extraction?: { status?: string; observation_event_id?: string };
    };
    expect(capturedOut.extraction?.status).toBe("extracted");
    expect(capturedOut.extraction?.observation_event_id).toMatch(/^evt_/);
    expect(captured.rawStdout).not.toContain("SYNTHETIC_EXTRACT_SENTINEL");

    const extract = runJson(["extract", "--event-id", String(capturedOut.event_id)], context);
    expect(extract.status).toBe(0);
    expect((extract.stdout as { status?: string }).status).toBe("replay");

    const status = runJson(["outbox", "status"], context);
    expect((status.stdout as { status?: { pending?: number } }).status?.pending).toBe(2);
  });

  it("records disposition history across policy versions", () => {
    const context = makeContext();
    runJson(["init"], context);
    const captured = runJson(
      ["capture-hook", "--provider", "codex"],
      context,
      JSON.stringify({
        hook_event_name: "SessionEnd",
        session_id: "session_cli_policy_history",
        timestamp: "2026-01-01T00:00:00Z",
        message: "We decided to always use pnpm and never commit credentials in this monorepo.",
      }),
    );
    expect(captured.status).toBe(0);
    const eventId = String(captured.stdout.event_id);

    const first = runJson(["adjudicate", "--event-id", eventId], context);
    expect(first.status).toBe(0);
    expect(first.stdout).toMatchObject({
      ok: true,
      command: "adjudicate",
      policy_version: ADJUDICATION_POLICY_VERSION,
    });

    const second = runJson(
      [
        "adjudicate",
        "--event-id",
        eventId,
        "--policy-version",
        "adj_test_v2",
        "--signal-text",
        "thanks",
      ],
      context,
    );
    expect(second.status).toBe(0);
    expect(second.stdout).toMatchObject({
      ok: true,
      policy_version: "adj_test_v2",
    });

    const history = runJson(["adjudicate", "history", "--event-id", eventId], context);
    expect(history.status).toBe(0);
    expect(history.stdout).toMatchObject({
      ok: true,
      command: "adjudicate",
      mode: "history",
      source_event_id: eventId,
      count: 2,
    });
    const rows = history.stdout.history as Array<{ policy_version: string }>;
    expect(rows.map((row) => row.policy_version).sort()).toEqual(
      ["adj_test_v2", ADJUDICATION_POLICY_VERSION].sort(),
    );
  });

  it("defaults memory search to active-only and opts into draft/held with --include-held", () => {
    const context = makeContext();
    const initialized = runJson(["init"], context);
    expect(initialized.status).toBe(0);
    const trustZone = String(initialized.stdout.trust_zone_id);
    // Ensure the local index has at least one meaning unit.
    expect(
      runJson(
        ["capture-hook", "--provider", "codex", "--trust-zone", trustZone],
        context,
        JSON.stringify({
          hook_event_name: "SessionEnd",
          session_id: "session_held_search_promote",
          timestamp: "2026-01-01T00:00:00Z",
          message: "We decided to always use pnpm and never commit credentials in this monorepo.",
        }),
      ).status,
    ).toBe(0);
    // Also create a held draft so the operator queue is non-empty.
    expect(
      runJson(
        ["capture-hook", "--provider", "codex", "--trust-zone", trustZone],
        context,
        JSON.stringify({
          hook_event_name: "SessionEnd",
          session_id: "session_held_search_hold",
          timestamp: "2026-01-01T00:00:00Z",
          payload: { kind: "empty" },
        }),
      ).status,
    ).toBe(0);
    expect(
      (
        runJson(
          [
            "adjudicate",
            "list-held",
            "--trust-zone",
            trustZone,
            "--policy-version",
            ADJUDICATION_POLICY_VERSION,
          ],
          context,
        ).stdout.held as unknown[]
      ).length,
    ).toBeGreaterThan(0);
    expect(runJson(["retrieval", "rebuild", "--trust-zone", trustZone], context).status).toBe(0);

    const defaultSearch = runJson(
      [
        "memory",
        "search",
        "--query",
        "pnpm",
        "--limit",
        "20",
        "--trust-zone",
        trustZone,
        "--visible-trust-zone",
        trustZone,
      ],
      context,
    );
    expect(defaultSearch.status).toBe(0);
    expect(
      (defaultSearch.stdout.result as { filters_applied?: { lifecycle_status?: string[] } })
        .filters_applied?.lifecycle_status,
    ).toEqual(["active"]);

    const heldSearch = runJson(
      [
        "memory",
        "search",
        "--query",
        "pnpm",
        "--include-held",
        "--limit",
        "20",
        "--trust-zone",
        trustZone,
        "--visible-trust-zone",
        trustZone,
      ],
      context,
    );
    expect(heldSearch.status).toBe(0);
    expect(
      (heldSearch.stdout.result as { filters_applied?: { lifecycle_status?: string[] } })
        .filters_applied?.lifecycle_status,
    ).toEqual(["active", "draft"]);
  });

  it("returns policy-scoped, body-free held receipts and terminal reviews", () => {
    const context = makeContext();
    runJson(["init"], context);
    const captureHeld = (sessionId: string, message: string) =>
      runJson(
        ["capture-hook", "--provider", "codex"],
        context,
        JSON.stringify({
          hook_event_name: "SessionEnd",
          session_id: sessionId,
          timestamp: "2026-01-01T00:00:00Z",
          message,
        }),
      );

    const promoteCandidate = captureHeld(
      "session_cli_held_promote",
      "Synthetic held candidate alpha without durable markers.",
    );
    const rejectCandidate = captureHeld(
      "session_cli_held_reject",
      "Synthetic held candidate beta without durable markers.",
    );
    expect(promoteCandidate.status).toBe(0);
    expect(rejectCandidate.status).toBe(0);
    const promoteEventId = String(promoteCandidate.stdout.event_id);
    const rejectEventId = String(rejectCandidate.stdout.event_id);
    const secondPolicy = runJson(
      ["adjudicate", "--event-id", promoteEventId, "--policy-version", "adj_test_v2"],
      context,
    );
    expect(secondPolicy.stdout).toMatchObject({ status: "held", policy_version: "adj_test_v2" });
    const secondPolicyHeld = runJson(
      ["adjudicate", "list-held", "--policy-version", "adj_test_v2"],
      context,
    );
    expect(secondPolicyHeld.stdout).toMatchObject({
      policy_version: "adj_test_v2",
      count: 1,
    });

    const listed = runJson(
      ["adjudicate", "list-held", "--limit", "10", "--policy-version", ADJUDICATION_POLICY_VERSION],
      context,
    );
    expect(listed.status).toBe(0);
    expect(listed.stdout).toMatchObject({
      ok: true,
      command: "adjudicate",
      mode: "list-held",
      policy_version: ADJUDICATION_POLICY_VERSION,
      count: 2,
    });
    const held = listed.stdout.held as Array<{ source_event_id: string }>;
    expect(held.map((item) => item.source_event_id).sort()).toEqual(
      [promoteEventId, rejectEventId].sort(),
    );
    expect(JSON.stringify(listed.stdout)).not.toContain("Synthetic held candidate");
    expect(held.every((item) => !("statement" in item))).toBe(true);

    const promoted = runJson(
      [
        "adjudicate",
        "promote-held",
        "--event-id",
        promoteEventId,
        "--policy-version",
        ADJUDICATION_POLICY_VERSION,
      ],
      context,
    );
    expect(promoted.status).toBe(0);
    expect(promoted.stdout).toMatchObject({
      ok: true,
      mode: "promote-held",
      status: "reviewed",
      decision: "promote",
      policy_version: ADJUDICATION_POLICY_VERSION,
      count: 1,
      observation: { lifecycle_status: "active" },
    });

    const rejected = runJson(
      [
        "adjudicate",
        "reject-held",
        "--event-id",
        rejectEventId,
        "--policy-version",
        ADJUDICATION_POLICY_VERSION,
      ],
      context,
    );
    expect(rejected.status).toBe(0);
    expect(rejected.stdout).toMatchObject({
      ok: true,
      mode: "reject-held",
      status: "reviewed",
      decision: "reject",
      policy_version: ADJUDICATION_POLICY_VERSION,
      count: 1,
    });
    expect(
      runJson(["adjudicate", "list-held", "--policy-version", ADJUDICATION_POLICY_VERSION], context)
        .stdout,
    ).toMatchObject({ count: 0, policy_version: ADJUDICATION_POLICY_VERSION });

    expect(
      runJson(
        [
          "adjudicate",
          "promote-held",
          "--event-id",
          promoteEventId,
          "--policy-version",
          ADJUDICATION_POLICY_VERSION,
        ],
        context,
      ).stdout,
    ).toMatchObject({ status: "replay", decision: "promote", count: 1 });
    const conflict = runJson(
      [
        "adjudicate",
        "reject-held",
        "--event-id",
        promoteEventId,
        "--policy-version",
        ADJUDICATION_POLICY_VERSION,
      ],
      context,
    );
    expect(conflict.status).toBe(1);
    expect(conflict.stdout).toMatchObject({ ok: false, status: "failed", count: 0 });

    const unknown = runJson(
      [
        "adjudicate",
        "promote-held",
        "--event-id",
        promoteEventId,
        "--policy-version",
        "adj_unknown_v9",
      ],
      context,
    );
    expect(unknown.status).toBe(1);
    expect(unknown.stdout).toMatchObject({
      ok: false,
      status: "failed",
      policy_version: "adj_unknown_v9",
      count: 0,
    });
    const secondPolicyRejected = runJson(
      [
        "adjudicate",
        "reject-held",
        "--event-id",
        promoteEventId,
        "--policy-version",
        "adj_test_v2",
      ],
      context,
    );
    expect(secondPolicyRejected.stdout).toMatchObject({
      status: "reviewed",
      policy_version: "adj_test_v2",
      count: 1,
    });
    expect(
      runJson(["adjudicate", "list-held", "--policy-version", ADJUDICATION_POLICY_VERSION], context)
        .stdout,
    ).toMatchObject({ count: 0 });

    const missingPolicy = runJson(["adjudicate", "list-held"], context);
    expect(missingPolicy.status).toBe(2);
    const invalidPolicy = runJson(
      ["adjudicate", "list-held", "--policy-version", "invalid policy"],
      context,
    );
    expect(invalidPolicy.status).toBe(2);
    expect(invalidPolicy.stderr).toMatchObject({ ok: false, error: { code: "invalid_usage" } });

    const invalidLimit = runJson(
      [
        "adjudicate",
        "list-held",
        "--limit",
        "201",
        "--policy-version",
        ADJUDICATION_POLICY_VERSION,
      ],
      context,
    );
    expect(invalidLimit.status).toBe(2);
    expect(invalidLimit.stderr).toMatchObject({ ok: false, error: { code: "invalid_usage" } });
  });

  it("surfaces outbox last_error on outbox status and sync status", () => {
    const context = makeContext();
    const captured = runJson(
      ["capture-hook", "--no-extract", "--provider", "codex", "--trust-zone", "tz_error_surface"],
      context,
      JSON.stringify({
        hook_event_name: "SessionEnd",
        session_id: "session_error_surface",
        message: "needs error surface",
      }),
    );
    expect(captured.status).toBe(0);
    const outboxId = captured.stdout.outbox_id;
    const leased = runJson(["outbox", "lease", "--limit", "1", "--lease-ms", "60000"], context);
    expect(leased.status).toBe(0);
    const lease = leased.stdout.lease as { lease_id?: string };
    const leaseId = String(lease.lease_id);
    const retried = runJson(
      [
        "outbox",
        "retry",
        "--outbox-id",
        String(outboxId),
        "--lease-id",
        leaseId,
        "--delay-ms",
        "0",
        "--error",
        "synthetic_block_reason",
      ],
      context,
    );
    expect(retried.status).toBe(0);

    const outboxStatus = runJson(["outbox", "status"], context);
    expect(outboxStatus.status).toBe(0);
    expect(outboxStatus.stdout).toMatchObject({
      ok: true,
      status: { pending: 1, leased: 0, delivered: 0 },
      errors: [
        {
          outbox_id: outboxId,
          state: "pending",
          last_error: "synthetic_block_reason",
          trust_zone_id: "tz_error_surface",
        },
      ],
    });

    const syncStatus = runJson(["sync", "status", "--trust-zone", "tz_error_surface"], context);
    expect(syncStatus.status).toBe(0);
    expect(syncStatus.stdout).toMatchObject({
      ok: true,
      local: {
        outbox_errors: [
          {
            outbox_id: outboxId,
            last_error: "synthetic_block_reason",
            trust_zone_id: "tz_error_surface",
          },
        ],
      },
    });
  });

  it("defaults capture trust zone from config.json then env, with --trust-zone winning", () => {
    const context = makeContext();
    writeFileSync(
      join(context.home, "config.json"),
      `${JSON.stringify({ trust_zone_id: "tz_local_default", schema_version: "v1" }, null, 2)}\n`,
      { mode: 0o600 },
    );

    const fromConfig = runJson(
      ["capture-hook", "--no-extract", "--provider", "codex"],
      context,
      JSON.stringify({
        hook_event_name: "SessionEnd",
        session_id: "session_config_tz",
        message: "config default zone",
      }),
    );
    expect(fromConfig.status).toBe(0);
    expect(fromConfig.stdout.trust_zone_id).toBe("tz_local_default");

    const fromEnv = spawnSync(
      process.execPath,
      [cliPath, "capture-hook", "--no-extract", "--provider", "codex"],
      {
        cwd: context.cwd,
        env: {
          ...process.env,
          CARPEOS_HOME: context.home,
          CARPEOS_MCP_TRUST_ZONE: "tz_from_env_zone",
        },
        input: JSON.stringify({
          hook_event_name: "SessionEnd",
          session_id: "session_env_tz",
          message: "env zone",
        }),
        encoding: "utf8",
      },
    );
    expect(fromEnv.status).toBe(0);
    const envStdout = JSON.parse(fromEnv.stdout.trim()) as { trust_zone_id?: string };
    expect(envStdout.trust_zone_id).toBe("tz_from_env_zone");

    const fromFlag = runJson(
      ["capture-hook", "--no-extract", "--provider", "codex", "--trust-zone", "tz_from_flag_zone"],
      context,
      JSON.stringify({
        hook_event_name: "SessionEnd",
        session_id: "session_flag_tz",
        message: "flag zone",
      }),
    );
    expect(fromFlag.status).toBe(0);
    expect(fromFlag.stdout.trust_zone_id).toBe("tz_from_flag_zone");

    // Without flags/env, identify/status use config.json trust zone.
    const identified = runJson(["project", "identify"], context);
    expect(identified.status).toBe(0);
    expect(identified.stdout).toMatchObject({
      trust_zone_id: "tz_local_default",
      trust_zone_source: "config",
    });

    const identifiedFlag = runJson(
      ["project", "identify", "--trust-zone", "tz_from_flag_zone"],
      context,
    );
    expect(identifiedFlag.status).toBe(0);
    expect(identifiedFlag.stdout).toMatchObject({
      trust_zone_id: "tz_from_flag_zone",
      trust_zone_source: "flag",
    });
  });

  it("leases and acknowledges outbox items with the matching lease id", () => {
    const context = makeContext();
    const raw = JSON.stringify({
      hookEventName: "Stop",
      sessionId: "session_synthetic",
      workspaceRoot: "synthetic-workspace",
    });
    runJson(["capture-hook", "--no-extract", "--provider", "grok"], context, raw);
    const leased = runJson(["outbox", "lease", "--limit", "1", "--lease-ms", "30000"], context);
    const lease = leased.stdout.lease as {
      lease_id: string;
      items: Array<{ outbox_id: number }>;
    };
    expect(lease.items).toHaveLength(1);

    const wrong = runJson(
      [
        "outbox",
        "ack",
        "--outbox-id",
        String(lease.items[0]?.outbox_id),
        "--lease-id",
        "lease_wrong",
      ],
      context,
    );
    expect(wrong.status).toBe(2);
    expect(wrong.stdout).toMatchObject({ ok: false, acknowledged: false });

    const acknowledged = runJson(
      [
        "outbox",
        "ack",
        "--outbox-id",
        String(lease.items[0]?.outbox_id),
        "--lease-id",
        lease.lease_id,
      ],
      context,
    );
    expect(acknowledged.status).toBe(0);
    expect(acknowledged.stdout.acknowledged).toBe(true);
  });

  it("returns structured input errors and fails open for provider hooks", () => {
    const context = makeContext();
    const invalid = runJson(["capture-hook", "--no-extract", "--provider", "claude"], context, "{");
    expect(invalid.status).toBe(2);
    expect(invalid.stderr).toMatchObject({
      ok: false,
      error: { code: "invalid_provider_input" },
    });

    const failOpen = runJson(
      ["capture-hook", "--no-extract", "--provider", "claude", "--fail-open"],
      context,
      "{}",
    );
    expect(failOpen.status).toBe(0);
    expect(failOpen.stderr).toMatchObject({
      ok: false,
      warning: { code: "capture_failed_open" },
    });

    const nonHook = runJson(["outbox", "status", "--fail-open"], context);
    expect(nonHook.status).toBe(2);
    expect(nonHook.stderr).toMatchObject({
      ok: false,
      error: { code: "invalid_usage" },
    });

    const invalidTrustZone = runJson(["init", "--trust-zone", "local-zone"], context);
    expect(invalidTrustZone.status).toBe(2);
    expect(invalidTrustZone.stderr).toMatchObject({
      ok: false,
      error: { code: "invalid_usage" },
    });

    const invalidIdempotency = runJson(
      ["capture-hook", "--no-extract", "--provider", "codex", "--idempotency-key", "bad"],
      context,
      JSON.stringify({ hook_event_name: "Stop" }),
    );
    expect(invalidIdempotency.status).toBe(2);
    expect(invalidIdempotency.stderr).toMatchObject({
      ok: false,
      error: { code: "invalid_usage" },
    });
  });

  it("returns exit 3 for explicit idempotency conflicts and keeps quiet hook success silent", () => {
    const context = makeContext();
    const idempotencyKey = "idem_cli_conflict_00000001";
    const first = JSON.stringify({
      hook_event_name: "Stop",
      session_id: "session_synthetic",
      message: "synthetic first value",
    });
    const second = JSON.stringify({
      hook_event_name: "Stop",
      session_id: "session_synthetic",
      message: "synthetic second value",
    });
    const captured = runJson(
      [
        "capture-hook",
        "--no-extract",
        "--provider",
        "codex",
        "--idempotency-key",
        idempotencyKey,
        "--quiet",
      ],
      context,
      first,
    );
    expect(captured.status).toBe(0);
    expect(captured.rawStdout).toBe("");

    const conflict = runJson(
      ["capture-hook", "--no-extract", "--provider", "codex", "--idempotency-key", idempotencyKey],
      context,
      second,
    );
    expect(conflict.status).toBe(3);
    expect(conflict.stderr).toMatchObject({
      ok: false,
      error: { code: "idempotency_conflict" },
    });
  });

  it("returns leased items to pending state through outbox retry", () => {
    const context = makeContext();
    runJson(
      ["capture-hook", "--no-extract", "--provider", "claude"],
      context,
      JSON.stringify({
        hook_event_name: "Stop",
        session_id: "session_retry",
      }),
    );
    const leased = runJson(["outbox", "lease", "--limit", "1"], context);
    const lease = leased.stdout.lease as {
      lease_id: string;
      items: Array<{ outbox_id: number }>;
    };
    const retried = runJson(
      [
        "outbox",
        "retry",
        "--outbox-id",
        String(lease.items[0]?.outbox_id),
        "--lease-id",
        lease.lease_id,
        "--delay-ms",
        "0",
        "--error",
        "synthetic retry",
      ],
      context,
    );
    expect(retried.status).toBe(0);
    expect(retried.stdout).toMatchObject({ ok: true, scheduled: true });
    expect(runJson(["outbox", "status"], context).stdout).toMatchObject({
      status: { pending: 1, leased: 0, delivered: 0 },
    });
  });

  it("accepts Codex notify JSON as the single argv payload", () => {
    const context = makeContext();
    const notify = JSON.stringify({
      type: "agent-turn-complete",
      "thread-id": "thread_synthetic",
      cwd: "synthetic-workspace",
    });
    const result = runJson(
      ["capture-hook", "--no-extract", "--provider", "codex", "--input", "argv", notify],
      context,
    );
    expect(result.status).toBe(0);
    expect(result.stdout.status).toBe("captured");
  });

  it("reports sync status without reading or printing credentials", () => {
    const context = makeContext();
    const secrets = writeSyncSecrets(context.home);
    const result = runJson(
      [
        "sync",
        "status",
        "--url",
        "https://sync.example.test",
        "--credential-file",
        secrets.credentialFile,
        "--sync-key-file",
        secrets.syncKeyFile,
      ],
      context,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toMatchObject({
      ok: true,
      command: "sync status",
      sync: {
        url_configured: true,
        credential_file_configured: true,
        sync_key_file_configured: true,
      },
      local: {
        outbox: { pending: 0, leased: 0, delivered: 0 },
        outbox_trust_zone_ids: [],
        outbox_trust_zone_mismatch: false,
        trust_zone_source: "device_default",
      },
    });
    expect(result.stdout.warnings).toBeUndefined();
    expect(result.rawStdout).not.toContain(syncCredential);
    expect(result.rawStdout).not.toContain(Buffer.from(syncKey).toString("hex"));
  });

  it("warns on sync status when pending outbox trust zones differ from the active store zone", () => {
    const context = makeContext();
    const secrets = writeSyncSecrets(context.home);

    const captured = runJson(
      ["capture-hook", "--no-extract", "--provider", "codex", "--trust-zone", "tz_outbox_zone"],
      context,
      JSON.stringify({
        hook_event_name: "SessionEnd",
        session_id: "session_tz_status",
        message: "outbox under tz_outbox_zone",
      }),
    );
    expect(captured.status).toBe(0);

    const result = runJson(
      [
        "sync",
        "status",
        "--trust-zone",
        "tz_store_zone",
        "--url",
        "https://sync.example.test",
        "--credential-file",
        secrets.credentialFile,
        "--sync-key-file",
        secrets.syncKeyFile,
      ],
      context,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toMatchObject({
      ok: true,
      command: "sync status",
      local: {
        trust_zone_id: "tz_store_zone",
        outbox: { pending: 1, leased: 0, delivered: 0 },
        outbox_trust_zone_ids: ["tz_outbox_zone"],
        outbox_trust_zone_mismatch: true,
      },
      warnings: [
        {
          code: "outbox_trust_zone_mismatch",
          active_trust_zone_id: "tz_store_zone",
          outbox_trust_zone_ids: ["tz_outbox_zone"],
        },
      ],
    });
  });

  it("rejects missing and unsafe sync secret files", () => {
    const context = makeContext();
    const secrets = writeSyncSecrets(context.home);
    chmodSync(secrets.credentialFile, 0o644);

    const unsafe = runJson(
      [
        "sync",
        "push",
        "--url",
        "https://sync.example.test",
        "--credential-file",
        secrets.credentialFile,
        "--sync-key-file",
        secrets.syncKeyFile,
      ],
      context,
    );
    expect(unsafe.status).toBe(2);
    expect(unsafe.stderr).toMatchObject({
      ok: false,
      error: { code: "invalid_usage" },
    });
    expect(JSON.stringify(unsafe.stderr)).not.toContain(syncCredential);

    const missing = runJson(
      [
        "sync",
        "pull",
        "--url",
        "https://sync.example.test",
        "--credential-file",
        join(context.home, "missing-token"),
        "--sync-key-file",
        secrets.syncKeyFile,
      ],
      context,
    );
    expect(missing.status).toBe(2);
    expect(missing.stderr).toMatchObject({
      ok: false,
      error: { code: "invalid_usage" },
    });
  });

  it("hashes a 0600 credential file for D1 authorization seeding without printing the token", () => {
    const context = makeContext();
    const secrets = writeSyncSecrets(context.home);

    const hashed = runJson(
      ["sync", "credential-hash", "--credential-file", secrets.credentialFile],
      context,
    );

    expect(hashed.status).toBe(0);
    expect(hashed.stdout).toMatchObject({
      ok: true,
      command: "sync credential-hash",
      hash_algorithm: "sha-256",
    });
    expect(String(hashed.stdout.token_hash_sha256)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashed.rawStdout).not.toContain(syncCredential);
  });

  it("rejects non-loopback HTTP sync URLs", () => {
    const context = makeContext();
    const secrets = writeSyncSecrets(context.home);

    const result = runJson(
      [
        "sync",
        "push",
        "--url",
        "http://example.com",
        "--credential-file",
        secrets.credentialFile,
        "--sync-key-file",
        secrets.syncKeyFile,
      ],
      context,
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toMatchObject({
      ok: false,
      error: { code: "invalid_usage" },
    });
  });

  it("pushes one outbox item through the sync coordinator and ACKs after acceptance", async () => {
    const context = makeContext();
    const secrets = writeSyncSecrets(context.home);
    const captured = runJson(
      ["capture-hook", "--no-extract", "--provider", "codex"],
      context,
      JSON.stringify({
        hook_event_name: "SessionEnd",
        session_id: "session_sync_push",
        message: "synthetic sync push",
      }),
    );
    const calls: string[] = [];
    const server = await startSyntheticSyncServer(async (request, response) => {
      calls.push(`${request.method ?? "GET"} ${request.url ?? "/"}`);
      expect(request.headers.authorization).toBe(`Bearer ${syncCredential}`);
      if (request.method === "HEAD") {
        response.writeHead(404).end();
        return;
      }
      if (request.method === "PUT") {
        await readRequestBody(request);
        const intent = decodeHeaderJson<ProtectedValueUploadIntent>(
          String(request.headers["x-carpeos-upload-intent"] ?? ""),
        );
        writeJsonResponse(response, receiptFromIntent(intent, "uploaded"));
        return;
      }
      const body = JSON.parse(await readRequestBody(request)) as SyncPushRequest;
      expect(body.protected_value_receipts).toHaveLength(1);
      writeJsonResponse(response, {
        schema_version: "v1",
        request_id: body.request_id,
        status: "accepted",
        accepted_event_ids: [String(captured.stdout.event_id)],
        accepted_erasure_ids: [],
        errors: [],
      } satisfies SyncPushResult);
    });

    try {
      const pushed = await runCliJson(
        [
          "sync",
          "push",
          "--url",
          server.url,
          "--credential-file",
          secrets.credentialFile,
          "--sync-key-file",
          secrets.syncKeyFile,
        ],
        context,
      );

      expect(pushed.status).toBe(0);
      expect(pushed.stdout).toMatchObject({
        ok: true,
        command: "sync push",
        processed: 1,
        status: { pending: 0, leased: 0, delivered: 1 },
      });
      expect(calls.map((call) => call.split(" ")[0])).toEqual(["HEAD", "PUT", "POST"]);
      expect(pushed.rawStdout).not.toContain(syncCredential);
    } finally {
      await server.close();
    }
  });

  it("does not ACK auth failures or idempotency conflicts", async () => {
    await expectSyncPushNoAck(401);
    await expectSyncPushNoAck(409);
  });

  it("pulls one page, imports protected values, and persists the cursor", async () => {
    const target = makeContext();
    const secrets = writeSyncSecrets(target.home);
    const source = makeSourceSyncCapture();
    const transfer = source.store.exportProtectedValueForSync({
      protectedValueId: source.protectedValueId,
      trustZoneSyncKey: syncKey,
    });
    const remoteEvent = { ...source.event, zone_sequence: 5 };
    const metadata = metadataFromIntent(transfer.intent, source.event.event_id);
    const server = await startSyntheticSyncServer(async (request, response) => {
      expect(request.headers.authorization).toBe(`Bearer ${syncCredential}`);
      if (request.method === "POST") {
        const body = JSON.parse(await readRequestBody(request)) as SyncPullRequest;
        expect(body.after_sequence).toBeUndefined();
        writeJsonResponse(response, {
          schema_version: "v1",
          events: [remoteEvent],
          erasures: [],
          cursor: "cursor_5",
          after_sequence: 5,
          has_more: false,
        });
        return;
      }
      response.writeHead(200, {
        "X-CarpeOS-Protected-Metadata": encodeHeaderJson(metadata),
      });
      response.end(Buffer.from(transfer.ciphertext));
    });

    try {
      const pulled = await runCliJson(
        [
          "sync",
          "pull",
          "--url",
          server.url,
          "--credential-file",
          secrets.credentialFile,
          "--sync-key-file",
          secrets.syncKeyFile,
          "--trust-zone",
          "tz_cli_sync_zone",
          "--pull-limit",
          "1",
        ],
        target,
      );

      expect(pulled.status).toBe(0);
      expect(pulled.stdout).toMatchObject({
        ok: true,
        command: "sync pull",
        pages: 1,
        cursor: {
          trust_zone_id: "tz_cli_sync_zone",
          after_sequence: 5,
          cursor: "cursor_5",
        },
      });
      const store = new LocalCaptureStore({
        runtimeDir: target.home,
        workspaceRoot: target.cwd,
        trustZoneId: "tz_cli_sync_zone",
      });
      expect(
        Buffer.from(store.decryptProtectedValue(source.protectedValueId)).toString("utf8"),
      ).toContain("synthetic pull capture");
      store.close();
    } finally {
      source.store.close();
      await server.close();
    }
  });

  it("runs bounded sync once and rejects unknown sync subcommands", async () => {
    const context = makeContext();
    const secrets = writeSyncSecrets(context.home);
    const server = await startSyntheticSyncServer(async (request, response) => {
      if (request.method === "POST" && request.url === "/v1/sync/pull") {
        writeJsonResponse(response, {
          schema_version: "v1",
          events: [],
          erasures: [],
          cursor: "cursor_0",
          has_more: false,
        });
        return;
      }
      response.writeHead(404).end();
    });

    try {
      const once = await runCliJson(
        [
          "sync",
          "once",
          "--url",
          server.url,
          "--credential-file",
          secrets.credentialFile,
          "--sync-key-file",
          secrets.syncKeyFile,
          "--limit",
          "1",
          "--max-pages",
          "1",
        ],
        context,
      );
      expect(once.status).toBe(0);
      expect(once.stdout).toMatchObject({ ok: true, command: "sync once", pushed: [] });
    } finally {
      await server.close();
    }

    const unknown = runJson(["sync", "stream"], context);
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toMatchObject({
      ok: false,
      error: { code: "invalid_usage" },
    });
  });

  it("initializes shared key and device identity atomically across concurrent hooks", async () => {
    const context = makeContext();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        runProcess(
          ["capture-hook", "--no-extract", "--provider", "codex"],
          context,
          JSON.stringify({
            hook_event_name: "PostToolUse",
            session_id: "session_concurrent_synthetic",
            turn_id: `turn_concurrent_${index}`,
            message: `synthetic concurrent payload ${index}`,
          }),
        ),
      ),
    );

    expect(results.map((result) => result.status)).toEqual(Array.from({ length: 8 }, () => 0));
    const trustZoneIds = new Set(results.map((result) => result.stdout.trust_zone_id));
    expect(trustZoneIds.size).toBe(1);

    const store = new LocalCaptureStore({
      runtimeDir: context.home,
      workspaceRoot: context.cwd,
    });
    const db = new DatabaseSync(store.dbPath);
    const protectedValues = db
      .prepare("SELECT protected_value_id FROM protected_values ORDER BY protected_value_id")
      .all() as Array<{ protected_value_id: string }>;
    expect(protectedValues).toHaveLength(8);

    const messages = new Set(
      protectedValues.map((row) => {
        const decrypted = Buffer.from(store.decryptProtectedValue(row.protected_value_id)).toString(
          "utf8",
        );
        const envelope = JSON.parse(decrypted) as { payload: { message: string } };
        return envelope.payload.message;
      }),
    );
    expect(messages.size).toBe(8);
    db.close();
    store.close();
  });
  it("discovers OKF export help and validates its required visibility contract", async () => {
    const rootHelp = await captureHelp([]);
    const topicHelp = await captureHelp(["help", "okf"]);
    expect(rootHelp.stdout).toContain("OKF v0.2");
    expect(rootHelp.stdout).toContain("okf");
    expect(topicHelp.stdout).toContain("okf export");
    expect(topicHelp.stdout).toContain("okf rebuild");
    expect(topicHelp.stdout).toContain("projection-only");
    expect(topicHelp.stdout).toContain("--visible-trust-zone");
    expect(topicHelp.stdout).toContain("default: off");

    const context = makeContext();
    const initialized = runJson(["init"], context);
    const zone = String(initialized.stdout.trust_zone_id);
    expect(runJson(["okf", "export", "--visible-trust-zone", zone], context).status).toBe(2);
    expect(runJson(["okf", "export", "--out", tempDir("carpeos-okf-")], context).status).toBe(2);
    expect(
      runJson(
        ["okf", "export", "--out", tempDir("carpeos-okf-"), "--visible-trust-zone", "invalid"],
        context,
      ).status,
    ).toBe(2);
    expect(
      runJson(
        [
          "okf",
          "export",
          "--out",
          tempDir("carpeos-okf-"),
          "--visible-trust-zone",
          "tz_another_zone",
        ],
        context,
      ).status,
    ).toBe(2);
  });

  it("exports a promoted Observation as a safe OKF projection and preserves unmanaged files", () => {
    const context = makeContext();
    const initialized = runJson(["init"], context);
    const zone = String(initialized.stdout.trust_zone_id);
    const captured = runJson(
      ["capture-hook", "--no-extract", "--provider", "codex"],
      context,
      JSON.stringify({
        hook_event_name: "SessionEnd",
        session_id: "session_okf_export",
        timestamp: "2026-01-01T00:00:00Z",
        message: "We decided to use synthetic fixtures for the release checklist.",
        private_sentinel: "SYNTHETIC_OKF_PRIVATE_SENTINEL",
      }),
    );
    const adjudicated = runJson(
      ["adjudicate", "--event-id", String(captured.stdout.event_id)],
      context,
    );
    expect(adjudicated.status).toBe(0);

    const outputRoot = tempDir("carpeos-okf-output-");
    const exported = runJson(
      ["okf", "export", "--out", outputRoot, "--visible-trust-zone", zone],
      context,
    );
    expect(exported.status).toBe(0);
    expect(exported.stdout).toMatchObject({
      ok: true,
      command: "okf export",
      projection: "okf-export/v1",
      okf_version: "0.2",
      output_root: outputRoot,
      visible_trust_zone_ids: [zone],
      include_held: false,
      manifest_status: "missing",
    });
    expect(exported.rawStdout).not.toContain("SYNTHETIC_OKF_PRIVATE_SENTINEL");
    expect(existsSync(join(outputRoot, "index.md"))).toBe(true);
    expect(existsSync(join(outputRoot, "log.md"))).toBe(true);
    expect(existsSync(join(outputRoot, ".carpeos-okf-projection-manifest.json"))).toBe(true);
    const manifest = JSON.parse(
      readFileSync(join(outputRoot, ".carpeos-okf-projection-manifest.json"), "utf8"),
    ) as { files: Array<{ path: string }> };
    const concept = manifest.files.find(
      (file) => file.path !== "index.md" && file.path !== "log.md",
    );
    expect(concept).toBeDefined();
    expect(existsSync(join(outputRoot, concept?.path ?? ""))).toBe(true);

    writeFileSync(join(outputRoot, "unmanaged.txt"), "preserve me\n", "utf8");
    const rebuilt = runJson(
      ["okf", "rebuild", "--out", outputRoot, "--visible-trust-zone", zone],
      context,
    );
    expect(rebuilt.status).toBe(0);
    expect(rebuilt.stdout).toMatchObject({
      ok: true,
      command: "okf rebuild",
      manifest_status: "valid",
    });
    expect(readFileSync(join(outputRoot, "unmanaged.txt"), "utf8")).toBe("preserve me\n");
  });

  it("fails closed for unsafe OKF output roots and unmanaged managed-path collisions", () => {
    const context = makeContext();
    const initialized = runJson(["init"], context);
    const zone = String(initialized.stdout.trust_zone_id);
    const target = tempDir("carpeos-okf-target-");
    const symlinkRoot = join(tempDir("carpeos-okf-link-parent-"), "output");
    symlinkSync(target, symlinkRoot, "dir");
    const symlinked = runJson(
      ["okf", "export", "--out", symlinkRoot, "--visible-trust-zone", zone],
      context,
    );
    expect(symlinked.status).not.toBe(0);
    expect(existsSync(join(target, "index.md"))).toBe(false);

    const collisionRoot = tempDir("carpeos-okf-collision-");
    writeFileSync(join(collisionRoot, "index.md"), "unmanaged\n", "utf8");
    const collision = runJson(
      ["okf", "export", "--out", collisionRoot, "--visible-trust-zone", zone],
      context,
    );
    expect(collision.status).not.toBe(0);
    expect(readFileSync(join(collisionRoot, "index.md"), "utf8")).toBe("unmanaged\n");
  });
});

function runtimeFileDigests(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const visit = (directory: string, relative: string) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      const next = relative.length === 0 ? name : join(relative, name);
      const stat = statSync(path);
      if (stat.isDirectory()) visit(path, next);
      else if (stat.isFile()) {
        files[next] = createHash("sha256").update(readFileSync(path)).digest("hex");
      }
    }
  };
  visit(root, "");
  return files;
}
function makeContext(): { home: string; cwd: string } {
  const home = mkdtempSync(join(tmpdir(), "carpeos-cli-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "carpeos-cli-workspace-"));
  createdDirs.push(home, cwd);
  return { home, cwd };
}

function runJson(
  args: string[],
  context: { home: string; cwd: string },
  input?: string,
): {
  status: number;
  stdout: Record<string, unknown>;
  stderr: Record<string, unknown>;
  rawStdout: string;
} {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: context.cwd,
    env: {
      ...process.env,
      CARPEOS_HOME: context.home,
    },
    input,
    encoding: "utf8",
  });
  const rawStdout = result.stdout.trim();
  const stderrLines = result.stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"));
  return {
    status: result.status ?? -1,
    stdout: rawStdout.length === 0 ? {} : (JSON.parse(rawStdout) as Record<string, unknown>),
    stderr:
      stderrLines.length === 0
        ? {}
        : (JSON.parse(stderrLines.at(-1) ?? "{}") as Record<string, unknown>),
    rawStdout,
  };
}

describe("reconcile-policy CLI", () => {
  it("rejects every unsupported reconciliation apply and acknowledgement flag before store open", async () => {
    for (const flag of [
      "--plan-digest",
      "--expected-total-count",
      "--expected-eligible-write-count",
      "--expected-eligible-noop-count",
      "--expected-unsafe-count",
      "--apply",
      "--apply-safe-subset",
      "--acknowledge-unsafe-count",
      "--pin",
      "--event-id",
      "--policy-version",
      "--home",
      "--project-id",
    ]) {
      const args = [
        "adjudicate",
        "reconcile-policy",
        "--from-policy",
        "adj_v1",
        "--to-policy",
        "adj_v3",
        "--trust-zone",
        "tz_synthetic",
        "--limit",
        "1",
        flag,
      ];
      if (!["--apply", "--apply-safe-subset"].includes(flag)) args.push("synthetic");
      expect((await captureHelp(args)).status).toBe(2);
    }
  });

  it("rejects every forbidden reconciliation flag even with help before home creation", async () => {
    const context = makeContext();
    rmSync(context.home, { recursive: true, force: true });
    for (const flag of [
      "--plan-digest",
      "--expected-total-count",
      "--expected-eligible-write-count",
      "--expected-eligible-noop-count",
      "--expected-unsafe-count",
      "--apply",
      "--apply-safe-subset",
      "--acknowledge-unsafe-count",
      "--pin",
    ]) {
      const args = ["adjudicate", "reconcile-policy", flag, "--help"];
      if (!["--apply", "--apply-safe-subset"].includes(flag)) args.splice(3, 0, "synthetic");
      expect((await runCliJson(args, context)).status).toBe(2);
      expect(existsSync(context.home)).toBe(false);
    }
  });
  it("requires every exact reconciliation flag before opening a store", async () => {
    expect((await captureHelp(["adjudicate", "reconcile-policy"])).status).toBe(2);
    expect(
      (
        await captureHelp([
          "adjudicate",
          "reconcile-policy",
          "--from-policy",
          "adj_v1",
          "--to-policy",
          "adj_v3",
          "--trust-zone",
          "tz_synthetic",
          "--limit",
          "201",
        ])
      ).status,
    ).toBe(2);
  });
});
describe("reconcile-policy success", () => {
  it("emits a bare byte-identical read-only plan without body leakage", async () => {
    const context = makeContext();
    const store = new LocalCaptureStore({
      runtimeDir: context.home,
      workspaceRoot: context.cwd,
      trustZoneId: "tz_synthetic",
      keyProvider: new StaticKeyProvider(new Uint8Array(32).fill(4)),
    });
    const captured = store.captureHook({
      provider: "codex",
      hook_event_name: "SessionEnd",
      captured_at: "2026-01-01T00:00:00Z",
      session_id: "session_reconcile_cli",
      media_type: "application/json",
      subject_ref: "subject_synthetic",
      payload: { decision: "CLI BODY SENTINEL MUST NOT LEAK" },
    });
    store.adjudicateFromEventId(captured.event.event_id, { policyVersion: "adj_old" });
    store.adjudicateFromEventId(captured.event.event_id, { policyVersion: "adj_new" });
    store.close();

    const direct = LocalCaptureStore.openExistingPreview({
      runtimeDir: context.home,
      workspaceRoot: context.cwd,
      trustZoneId: "tz_synthetic",
    });
    const plan = direct.previewPolicyReconciliation({
      from_policy: "adj_old",
      to_policy: "adj_new",
      trust_zone_id: "tz_synthetic",
      limit: 10,
    });
    direct.close();
    const before = runtimeFileDigests(context.home);
    const result = await runCliJson(
      [
        "adjudicate",
        "reconcile-policy",
        "--from-policy",
        "adj_old",
        "--to-policy",
        "adj_new",
        "--trust-zone",
        "tz_synthetic",
        "--limit",
        "10",
      ],
      context,
    );
    expect(result.status).toBe(0);
    expect(result.rawStdout).toBe(JSON.stringify(plan));
    expect(result.stdout).toEqual(plan);
    expect(result.rawStdout).not.toContain("CLI BODY SENTINEL");
    expect(runtimeFileDigests(context.home)).toEqual(before);
  });

  it("reports bounded and same-policy empty previews", async () => {
    const context = makeContext();
    const store = new LocalCaptureStore({
      runtimeDir: context.home,
      workspaceRoot: context.cwd,
      trustZoneId: "tz_synthetic",
      keyProvider: new StaticKeyProvider(new Uint8Array(32).fill(5)),
    });
    for (const suffix of ["z", "a"]) {
      const captured = store.captureHook({
        provider: "codex",
        hook_event_name: "SessionEnd",
        captured_at: "2026-01-01T00:00:00Z",
        session_id: `session_reconcile_${suffix}`,
        media_type: "application/json",
        subject_ref: "subject_synthetic",
        payload: { decision: `Synthetic ${suffix}` },
      });
      store.adjudicateFromEventId(captured.event.event_id, { policyVersion: "adj_old" });
    }
    store.close();
    const bounded = await runCliJson(
      [
        "adjudicate",
        "reconcile-policy",
        "--from-policy",
        "adj_old",
        "--to-policy",
        "adj_new",
        "--trust-zone",
        "tz_synthetic",
        "--limit",
        "1",
      ],
      context,
    );
    expect(bounded.status).toBe(0);
    expect(bounded.stdout).toMatchObject({
      total_candidate_count: 2,
      classified_count: 1,
      truncated: true,
      plan_admissible: false,
    });
    expect(bounded.stdout.global_taint_reason_codes as string[]).toContain(
      "incomplete_enumeration_global_taint",
    );
    const same = await runCliJson(
      [
        "adjudicate",
        "reconcile-policy",
        "--from-policy",
        "adj_new",
        "--to-policy",
        "adj_new",
        "--trust-zone",
        "tz_synthetic",
        "--limit",
        "1",
      ],
      context,
    );
    expect(same.status).toBe(0);
    expect(same.stdout.entries).toEqual([]);
  });

  it("rejects invalid use before creating a home and fails closed after valid parsing", async () => {
    const context = makeContext();
    rmSync(context.home, { recursive: true, force: true });
    const base = [
      "adjudicate",
      "reconcile-policy",
      "--from-policy",
      "adj_v1",
      "--to-policy",
      "adj_v3",
      "--trust-zone",
      "tz_synthetic",
      "--limit",
      "1",
    ];
    for (const suffix of [
      ["--limit", "2"],
      ["unexpected"],
      ["--home", "elsewhere"],
      ["--from-policy", "BAD"],
      ["--limit", "0"],
      ["--limit", "abc"],
    ]) {
      expect((await runCliJson([...base, ...suffix], context)).status).toBe(2);
      expect(existsSync(context.home)).toBe(false);
    }
    expect((await runCliJson(base, context)).status).toBe(1);
    expect(existsSync(context.home)).toBe(false);
  });
});
async function captureHelp(args: string[]): Promise<{ status: number; stdout: string }> {
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  let stdout = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    void chunk;
    return true;
  }) as typeof process.stderr.write;
  try {
    const status = await runCli(args, process.env);
    return { status, stdout };
  } finally {
    process.stdout.write = originalStdoutWrite as typeof process.stdout.write;
    process.stderr.write = originalStderrWrite as typeof process.stderr.write;
  }
}

async function runCliJson(
  args: string[],
  context: { home: string; cwd: string },
): Promise<{
  status: number;
  stdout: Record<string, unknown>;
  stderr: Record<string, unknown>;
  rawStdout: string;
}> {
  const originalCwd = process.cwd();
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  let stdout = "";
  let stderr = "";
  process.chdir(context.cwd);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    const status = await runCli(args, { ...process.env, CARPEOS_HOME: context.home });
    const rawStdout = stdout.trim();
    const rawStderr = stderr.trim();
    return {
      status,
      stdout: rawStdout.length === 0 ? {} : (JSON.parse(rawStdout) as Record<string, unknown>),
      stderr: rawStderr.length === 0 ? {} : (JSON.parse(rawStderr) as Record<string, unknown>),
      rawStdout,
    };
  } finally {
    process.chdir(originalCwd);
    process.stdout.write = originalStdoutWrite as typeof process.stdout.write;
    process.stderr.write = originalStderrWrite as typeof process.stderr.write;
  }
}

function runProcess(
  args: string[],
  context: { home: string; cwd: string },
  input: string,
): Promise<{
  status: number;
  stdout: Record<string, unknown>;
}> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: context.cwd,
      env: {
        ...process.env,
        CARPEOS_HOME: context.home,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", rejectPromise);
    child.on("close", (status) => {
      const trimmed = stdout.trim();
      if (status !== 0 && stderr.length > 0) {
        rejectPromise(new Error(stderr));
        return;
      }
      resolvePromise({
        status: status ?? -1,
        stdout: trimmed.length === 0 ? {} : (JSON.parse(trimmed) as Record<string, unknown>),
      });
    });
    child.stdin.end(input);
  });
}

async function expectSyncPushNoAck(status: 401 | 409): Promise<void> {
  const context = makeContext();
  const secrets = writeSyncSecrets(context.home);
  runJson(
    ["capture-hook", "--no-extract", "--provider", "codex"],
    context,
    JSON.stringify({
      hook_event_name: "SessionEnd",
      session_id: `session_sync_blocked_${status}`,
      message: "synthetic blocked push",
    }),
  );
  const server = await startSyntheticSyncServer(async (request, response) => {
    if (request.method === "HEAD") {
      response.writeHead(404).end();
      return;
    }
    if (request.method === "PUT") {
      await readRequestBody(request);
      const intent = decodeHeaderJson<ProtectedValueUploadIntent>(
        String(request.headers["x-carpeos-upload-intent"] ?? ""),
      );
      writeJsonResponse(response, receiptFromIntent(intent, "uploaded"));
      return;
    }
    writeJsonResponse(
      response,
      { schema_version: "v1", error: { code: "unauthorized", message: "synthetic" } },
      status,
    );
  });

  try {
    const pushed = await runCliJson(
      [
        "sync",
        "push",
        "--url",
        server.url,
        "--credential-file",
        secrets.credentialFile,
        "--sync-key-file",
        secrets.syncKeyFile,
      ],
      context,
    );
    expect(pushed.status).toBe(4);
    expect(pushed.stdout).toMatchObject({
      ok: false,
      processed: 1,
      status: { delivered: 0 },
    });
    expect(pushed.rawStdout).not.toContain("synthetic");
  } finally {
    await server.close();
  }
}

function writeSyncSecrets(home: string): { credentialFile: string; syncKeyFile: string } {
  const credentialFile = join(home, "sync-credential");
  const syncKeyFile = join(home, "trust-zone-sync.key");
  writeFileSync(credentialFile, `${syncCredential}\n`, { mode: 0o600 });
  writeFileSync(syncKeyFile, `${Buffer.from(syncKey).toString("hex")}\n`, { mode: 0o600 });
  chmodSync(credentialFile, 0o600);
  chmodSync(syncKeyFile, 0o600);
  return { credentialFile, syncKeyFile };
}

function makeSourceSyncCapture(): {
  store: LocalCaptureStore;
  event: ReturnType<LocalCaptureStore["captureHook"]>["event"];
  protectedValueId: string;
} {
  const runtimeDir = tempDir("carpeos-cli-source-");
  const store = new LocalCaptureStore({
    runtimeDir,
    workspaceRoot: runtimeDir,
    trustZoneId: "tz_cli_sync_zone",
    keyProvider: new StaticKeyProvider(new Uint8Array(32).fill(8)),
  });
  const captured = store.captureHook({
    provider: "codex",
    hook_event_name: "SessionEnd",
    captured_at: "2026-01-01T00:00:00Z",
    session_id: "session_pull_synthetic",
    media_type: "application/json",
    subject_ref: "subject_synthetic",
    payload: { transcript: "synthetic pull capture" },
  });
  return { store, event: captured.event, protectedValueId: captured.protected_value_id };
}

async function startSyntheticSyncServer(
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void> | void,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    void Promise.resolve(handler(request, response)).catch((error: unknown) => {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: String(error) }));
    });
  });
  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected TCP test server");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => (error === undefined ? resolvePromise() : rejectPromise(error)));
      }),
  };
}

function receiptFromIntent(
  intent: ProtectedValueUploadIntent,
  status: "uploaded" | "already_exists",
): ProtectedValueUploadReceipt {
  return {
    schema_version: "v1",
    receipt_type: "protected_value_upload",
    protected_value_id: intent.protected_value_id,
    trust_zone_id: intent.trust_zone_id,
    object_key: intent.object_key,
    original_ciphertext_digest: intent.original_ciphertext_digest,
    original_ciphertext_size_bytes: intent.original_ciphertext_size_bytes,
    uploaded_at: "2026-01-01T00:00:00Z",
    status,
    upload_receipt_id: `receipt_${intent.protected_value_id.slice(3)}`,
  };
}

function metadataFromIntent(
  intent: ProtectedValueUploadIntent,
  eventId: string,
): ProtectedValueMetadata {
  return {
    schema_version: "v1",
    metadata_type: "protected_value",
    protected_value_id: intent.protected_value_id,
    trust_zone_id: intent.trust_zone_id,
    object_key: intent.object_key,
    vault_ref: intent.vault_ref,
    encryption_algorithm: intent.encryption_algorithm,
    encoding: intent.encoding,
    ciphertext_nonce: intent.ciphertext_nonce,
    ciphertext_auth_tag: intent.ciphertext_auth_tag,
    original_ciphertext_digest: intent.original_ciphertext_digest,
    original_ciphertext_size_bytes: intent.original_ciphertext_size_bytes,
    key_ref: intent.key_ref,
    wrapped_device_key: intent.wrapped_device_key,
    linked_event_ids: [eventId],
    orphan_status: "linked",
    uploaded_at: "2026-01-01T00:00:00Z",
    ...(intent.nonce_ref === undefined ? {} : { nonce_ref: intent.nonce_ref }),
    ...(intent.tag_ref === undefined ? {} : { tag_ref: intent.tag_ref }),
  };
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  let body = "";
  request.setEncoding("utf8");
  for await (const chunk of request) {
    body += chunk;
  }
  return body;
}

function writeJsonResponse(response: ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

function encodeHeaderJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeHeaderJson<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}
