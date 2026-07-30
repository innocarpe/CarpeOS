import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
  ProtectedValueUploadIntent,
  ProtectedValueUploadReceipt,
  SyncPushRequest,
  SyncPushResult,
} from "@carpeos/schema";
import { afterEach, describe, expect, it } from "vitest";
import { CycleFailure, runSyncCycle } from "../src/cycle.js";

const packageRoot = resolve(import.meta.dirname, "..");
const cliPath = join(packageRoot, "dist", "index.js");
const createdDirs: string[] = [];
const syncCredential = "synthetic_cycle_credential_0000000000000000001";
const syncKeyHex = Buffer.from(new Uint8Array(32).fill(9)).toString("hex");

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("sync cycle runner", () => {
  it("writes an immutable manifest before transport and records private modes, bounds, and health", async () => {
    const home = tempDir("carpeos-cycle-unit-");
    const events: string[] = [];
    const result = await runSyncCycle({
      home,
      projectId: "project_synthetic",
      trustZoneId: "tz_cycle_unit",
      bounds: { limit: 2, maxPages: 3, pullLimit: 4 },
      commandArgv: ["sync", "cycle", "--url", "https://redacted.example"],
      hooks: {
        onEvent: (event) => {
          events.push(event.type);
        },
      },
      preflight: () => ({
        syncUrlHashSha256: "a".repeat(64),
        credentialFileHashSha256: "b".repeat(64),
        credentialSecretHashSha256: "c".repeat(64),
        syncKeyFileHashSha256: "d".repeat(64),
      }),
      syncOnce: () => {
        events.push("transport");
        return {
          pushed: [{ status: "acked" }],
          pulled: [{ has_more: false }],
          pushedCount: 1,
          pulledPages: 1,
          cursor: { after_sequence: 0 },
          outboxStatus: { pending: 0, leased: 0, delivered: 1 },
          transportCounts: { POST: 1 },
        };
      },
      rebuildRetrieval: () => ({ chunks: 1, freshness: [{ projection_name: "retrieval" }] }),
    });

    expect(result.ok).toBe(true);
    const paths = cycleArtifacts(home);
    const manifest = JSON.parse(readFileSync(paths.manifest, "utf8")) as {
      source?: Record<string, unknown>;
    };
    expect(manifest).toMatchObject({
      bounds: { max_pages: 3 },
      source: { distribution: "unknown" },
    });
    expect(manifest.source).not.toHaveProperty("git_commit");
    expect(events).toEqual([
      "transport",
      "health_written",
      "lock_release_attempted",
      "lock_released",
    ]);
    expect(statSync(join(home, "cycles")).mode & 0o777).toBe(0o700);
    expect(statSync(join(home, "cycles", "manifests")).mode & 0o777).toBe(0o700);
    expect(statSync(paths.manifest).mode & 0o777).toBe(0o600);
    expect(statSync(paths.health).mode & 0o777).toBe(0o600);
    expect(readFileSync(paths.manifest, "utf8")).toBe(readFileSync(paths.manifest, "utf8"));
    const health = JSON.parse(readFileSync(paths.health, "utf8")) as Record<string, unknown>;
    expect(health).toMatchObject({
      status: "success",
      category: "success",
      bounds: { limit: 2, max_pages: 3 },
      sync: { attempted: true, pushed_count: 1, pulled_pages: 1, cursor_present: true },
      retrieval: { attempted: true, rebuilt: true, chunks: 1 },
      lock: { acquired: true, released: false },
    });
    expect(JSON.stringify(health)).not.toContain("after_sequence");
  });

  it("keeps manifest unchanged on sync failure and suppresses retrieval", async () => {
    const home = tempDir("carpeos-cycle-fail-");
    let retrievalCalls = 0;
    const result = await runSyncCycle({
      home,
      projectId: "project_synthetic",
      trustZoneId: "tz_cycle_fail",
      bounds: { limit: 1, maxPages: 1, pullLimit: 1 },
      commandArgv: ["sync", "cycle"],
      preflight: () => ({
        syncUrlHashSha256: "a".repeat(64),
        credentialFileHashSha256: "b".repeat(64),
        credentialSecretHashSha256: "c".repeat(64),
        syncKeyFileHashSha256: "d".repeat(64),
      }),
      syncOnce: () => {
        throw new CycleFailure("sync_failed", "sync", 7, "synthetic sync failure");
      },
      rebuildRetrieval: () => {
        retrievalCalls += 1;
        return { chunks: 0, freshness: [] };
      },
    });

    const paths = cycleArtifacts(home);
    const manifestBefore = readFileSync(paths.manifest, "utf8");
    const health = JSON.parse(readFileSync(paths.health, "utf8")) as { category?: string };
    expect(result.ok).toBe(false);
    expect(health.category).toBe("sync_failed");
    expect(result.health.sync.attempted).toBe(true);
    expect(readFileSync(paths.manifest, "utf8")).toBe(manifestBefore);
    expect(retrievalCalls).toBe(0);
    expect(statSync(join(home, "cycles", "cycle.lock"), { throwIfNoEntry: false })).toBeUndefined();
  });

  it("fails closed on active locks before manifest or transport", async () => {
    for (const startedAt of [new Date().toISOString(), "2020-01-01T00:00:00.000Z"] as const) {
      const home = tempDir("carpeos-cycle-lock-busy-");
      const cycles = join(home, "cycles");
      mkdirAndLock(cycles, startedAt);
      let transportCalls = 0;
      const result = await runSyncCycle({
        home,
        projectId: "project_synthetic",
        trustZoneId: "tz_cycle_lock",
        bounds: { limit: 1, maxPages: 1, pullLimit: 1 },
        commandArgv: ["sync", "cycle"],
        preflight: () => ({
          syncUrlHashSha256: "a".repeat(64),
          credentialFileHashSha256: "b".repeat(64),
          credentialSecretHashSha256: "c".repeat(64),
          syncKeyFileHashSha256: "d".repeat(64),
        }),
        syncOnce: () => {
          transportCalls += 1;
          return {
            pushed: [],
            pulled: [],
            pushedCount: 0,
            pulledPages: 0,
            cursor: null,
            outboxStatus: null,
          };
        },
        rebuildRetrieval: () => ({ chunks: 0, freshness: [] }),
      });

      expect(result.ok).toBe(false);
      expect(result.health.category).toBe("lock_busy");
      expect(result.manifest).toBeNull();
      expect(transportCalls).toBe(0);
    }
  });

  it("fails closed and rewrites health when lock release fails", async () => {
    const home = tempDir("carpeos-cycle-release-fail-");
    const events: string[] = [];
    const result = await runSyncCycle({
      home,
      projectId: "project_synthetic",
      trustZoneId: "tz_cycle_release",
      bounds: { limit: 1, maxPages: 1, pullLimit: 1 },
      commandArgv: ["sync", "cycle"],
      hooks: {
        releaseLock: () => {
          throw new Error("synthetic release failure");
        },
        onEvent: (event) => {
          events.push(event.type);
        },
      },
      preflight: () => ({
        syncUrlHashSha256: "a".repeat(64),
        credentialFileHashSha256: "b".repeat(64),
        credentialSecretHashSha256: "c".repeat(64),
        syncKeyFileHashSha256: "d".repeat(64),
      }),
      syncOnce: () => ({
        pushed: [],
        pulled: [],
        pushedCount: 0,
        pulledPages: 0,
        cursor: "cursor_release_failure",
        outboxStatus: null,
      }),
      rebuildRetrieval: () => ({ chunks: 0, freshness: [] }),
    });

    const health = JSON.parse(readFileSync(cycleArtifacts(home).health, "utf8")) as Record<
      string,
      unknown
    >;
    expect(result.ok).toBe(false);
    expect(result.health).toMatchObject({
      status: "failed",
      category: "lock_release_failed",
      exit_code: 5,
      lock: { acquired: true, released: false },
    });
    expect(health).toMatchObject({
      status: "failed",
      category: "lock_release_failed",
      lock: { acquired: true, released: false },
      sync: { cursor_present: true },
    });
    expect(JSON.stringify(health)).not.toContain("cursor_release_failure");
    expect(statSync(join(home, "cycles", "cycle.lock")).mode & 0o777).toBe(0o600);
    expect(events).toEqual([
      "health_written",
      "lock_release_attempted",
      "lock_release_failed",
      "health_written",
    ]);
  });

  it("runs a temp-home CLI cycle against a fake endpoint without leaking sentinels", async () => {
    const context = makeContext();
    const secrets = writeSyncSecrets(context.home);
    const privatePayload = "SYNTHETIC_CYCLE_PRIVATE_PAYLOAD";
    const urlMarker = "SYNTHETIC_URL_MARKER";
    await runProcessJson(
      ["capture-hook", "--provider", "codex", "--trust-zone", "tz_cycle_cli"],
      context,
      JSON.stringify({
        hook_event_name: "SessionEnd",
        session_id: "session_cycle_cli",
        timestamp: "2026-01-01T00:00:00Z",
        message: privatePayload,
      }),
    );

    let postCalls = 0;
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
      if (request.method === "POST" && request.url?.endsWith("/v1/sync/push")) {
        postCalls += 1;
        const body = JSON.parse(await readRequestBody(request)) as SyncPushRequest;
        writeJsonResponse(response, {
          schema_version: "v1",
          request_id: body.request_id,
          status: "accepted",
          accepted_event_ids: body.events.map((event) => event.event_id),
          accepted_erasure_ids: [],
          errors: [],
        } satisfies SyncPushResult);
        return;
      }
      if (request.method === "POST" && request.url?.endsWith("/v1/sync/pull")) {
        postCalls += 1;
        writeJsonResponse(response, {
          schema_version: "v1",
          events: [],
          erasures: [],
          cursor: "cursor_cycle",
          has_more: false,
        });
        return;
      }
      response.writeHead(404).end();
    });

    try {
      const cycle = await runProcessJson(
        [
          "sync",
          "cycle",
          "--url",
          `${server.url}/${urlMarker}`,
          "--credential-file",
          secrets.credentialFile,
          "--sync-key-file",
          secrets.syncKeyFile,
          "--trust-zone",
          "tz_cycle_cli",
          "--limit",
          "1",
          "--max-pages",
          "1",
          "--json",
        ],
        context,
      );
      expect(cycle.status).toBe(0);
      expect(cycle.stdout).toMatchObject({
        ok: true,
        command: "sync cycle",
        health: {
          status: "success",
          bounds: { limit: 1, max_pages: 1 },
          sync: { attempted: true, pushed_count: 1, pulled_pages: 1 },
          retrieval: { attempted: true, rebuilt: true },
        },
      });
      expect(postCalls).toBe(2);
      const paths = cycleArtifacts(context.home);
      const manifest = readFileSync(paths.manifest, "utf8");
      const health = readFileSync(paths.health, "utf8");
      const combined = `${cycle.rawStdout}\n${cycle.rawStderr}\n${manifest}\n${health}`;
      expect(combined).not.toContain(syncCredential);
      expect(combined).not.toContain(syncKeyHex);
      expect(combined).not.toContain(privatePayload);
      expect(combined).not.toContain(urlMarker);
    } finally {
      await server.close();
    }
  });

  it("prints sync help with cycle and keeps sync once compatible", async () => {
    const help = spawnSync(process.execPath, [cliPath, "help", "sync"], {
      encoding: "utf8",
      timeout: 20_000,
      killSignal: "SIGKILL",
    });
    if (help.error !== undefined) {
      throw help.error;
    }
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("cycle");

    const context = makeContext();
    const secrets = writeSyncSecrets(context.home);
    const server = await startSyntheticSyncServer(async (request, response) => {
      if (request.method === "POST" && request.url?.endsWith("/v1/sync/pull")) {
        writeJsonResponse(response, {
          schema_version: "v1",
          events: [],
          erasures: [],
          cursor: "cursor_once",
          has_more: false,
        });
        return;
      }
      response.writeHead(404).end();
    });
    try {
      const once = await runProcessJson(
        [
          "sync",
          "once",
          "--url",
          server.url,
          "--credential-file",
          secrets.credentialFile,
          "--sync-key-file",
          secrets.syncKeyFile,
        ],
        context,
      );
      expect(once.status).toBe(0);
      expect(once.stdout).toMatchObject({ ok: true, command: "sync once" });
    } finally {
      await server.close();
    }
  });
});

function makeContext(): { home: string; cwd: string } {
  return { home: tempDir("carpeos-cycle-home-"), cwd: tempDir("carpeos-cycle-cwd-") };
}

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

function cycleArtifacts(home: string): { manifest: string; health: string } {
  const manifests = join(home, "cycles", "manifests");
  const entries = execFileSync("find", [manifests, "-type", "f"], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
  return {
    manifest: entries[0] ?? join(manifests, "missing"),
    health: join(home, "cycles", "health.json"),
  };
}

function mkdirAndLock(cycles: string, startedAt: string): void {
  execFileSync("mkdir", ["-p", cycles]);
  chmodSync(cycles, 0o700);
  writeFileSync(
    join(cycles, "cycle.lock"),
    `${JSON.stringify({
      schema_version: "v1",
      record_type: "carpeos_sync_cycle_lock",
      cycle_id: "cycle_existing",
      started_at: startedAt,
    })}\n`,
    { mode: 0o600 },
  );
  chmodSync(join(cycles, "cycle.lock"), 0o600);
}

function writeSyncSecrets(home: string): { credentialFile: string; syncKeyFile: string } {
  const credentialFile = join(home, "sync-credential");
  const syncKeyFile = join(home, "trust-zone-sync.key");
  writeFileSync(credentialFile, `${syncCredential}\n`, { mode: 0o600 });
  writeFileSync(syncKeyFile, `${syncKeyHex}\n`, { mode: 0o600 });
  chmodSync(credentialFile, 0o600);
  chmodSync(syncKeyFile, 0o600);
  return { credentialFile, syncKeyFile };
}

function runProcessJson(
  args: string[],
  context: { home: string; cwd: string },
  input?: string,
): Promise<{
  status: number;
  stdout: Record<string, unknown>;
  rawStdout: string;
  rawStderr: string;
}> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: context.cwd,
      env: { ...process.env, CARPEOS_HOME: context.home },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      rejectPromise(new Error(`CLI subprocess timed out: ${args.join(" ")}`));
    }, 20_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.on("close", (status) => {
      clearTimeout(timeout);
      const rawStdout = stdout.trim();
      resolvePromise({
        status: status ?? -1,
        stdout: rawStdout.length === 0 ? {} : (JSON.parse(rawStdout) as Record<string, unknown>),
        rawStdout,
        rawStderr: stderr,
      });
    });
    child.stdin.end(input);
  });
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
        server.closeIdleConnections();
        server.closeAllConnections();
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

function decodeHeaderJson<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}
