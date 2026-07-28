import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LocalCaptureStore } from "@carpeos/local-store";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const packageRoot = resolve(import.meta.dirname, "..");
const cliPath = join(packageRoot, "dist", "index.js");
const createdDirs: string[] = [];

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
    const first = runJson(["capture-hook", "--provider", "codex"], context, raw);
    expect(first.status).toBe(0);
    expect(first.stdout).toMatchObject({
      ok: true,
      command: "capture-hook",
      status: "captured",
      event_type: "EvidenceArtifact",
    });
    expect(first.rawStdout).not.toContain("SYNTHETIC_CLI_PRIVATE_SENTINEL");

    const replay = runJson(["capture-hook", "--provider", "codex"], context, raw);
    expect(replay.status).toBe(0);
    expect(replay.stdout.status).toBe("replay");
    expect(replay.stdout.event_id).toBe(first.stdout.event_id);

    const status = runJson(["outbox", "status"], context);
    expect(status.stdout).toMatchObject({
      ok: true,
      status: { pending: 1, leased: 0, delivered: 0 },
    });
  });

  it("leases and acknowledges outbox items with the matching lease id", () => {
    const context = makeContext();
    const raw = JSON.stringify({
      hookEventName: "Stop",
      sessionId: "session_synthetic",
      workspaceRoot: "synthetic-workspace",
    });
    runJson(["capture-hook", "--provider", "grok"], context, raw);
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
    const invalid = runJson(["capture-hook", "--provider", "claude"], context, "{");
    expect(invalid.status).toBe(2);
    expect(invalid.stderr).toMatchObject({
      ok: false,
      error: { code: "invalid_provider_input" },
    });

    const failOpen = runJson(
      ["capture-hook", "--provider", "claude", "--fail-open"],
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
      ["capture-hook", "--provider", "codex", "--idempotency-key", "bad"],
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
      ["capture-hook", "--provider", "codex", "--idempotency-key", idempotencyKey, "--quiet"],
      context,
      first,
    );
    expect(captured.status).toBe(0);
    expect(captured.rawStdout).toBe("");

    const conflict = runJson(
      ["capture-hook", "--provider", "codex", "--idempotency-key", idempotencyKey],
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
      ["capture-hook", "--provider", "claude"],
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
      ["capture-hook", "--provider", "codex", "--input", "argv", notify],
      context,
    );
    expect(result.status).toBe(0);
    expect(result.stdout.status).toBe("captured");
  });

  it("initializes shared key and device identity atomically across concurrent hooks", async () => {
    const context = makeContext();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        runProcess(
          ["capture-hook", "--provider", "codex"],
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
});

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
