import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CaptureEnvelope } from "@carpeos/capture";
import { hashHex } from "@carpeos/capture";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertPrivateKeyFileModes,
  FileKeyProvider,
  IdempotencyConflictError,
  LocalCaptureStore,
  StaticKeyProvider,
} from "../src/index.js";
import { resolveProjectIdentity, sanitizeRemoteIdentity } from "../src/project-identity.js";

const staticMaterial = new Uint8Array(32).fill(7);
const now = new Date("2026-01-01T00:00:00Z");
const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("LocalCaptureStore", () => {
  it("atomically captures a valid event, encrypted protected value, and non-empty outbox request", () => {
    const { store, runtimeDir } = makeStore();
    const result = store.captureHook(
      makeEnvelope({
        captured_at: "2025-12-31T23:59:00Z",
        payload: { transcript: "secret sentinel alpha" },
      }),
    );

    expect(result.status).toBe("captured");
    expect(result.local_sequence).toBe(1);
    expect(result.event.zone_sequence).toBeUndefined();
    expect(result.event.valid_time.start).toBe("2025-12-31T23:59:00Z");
    expect(result.event.recorded_time.start).toBe(now.toISOString().replace(".000Z", "Z"));
    expect(store.countRows("capture_requests")).toBe(1);
    expect(store.countRows("protected_values")).toBe(1);
    expect(store.countRows("canonical_events")).toBe(1);
    expect(store.countRows("outbox")).toBe(1);
    expect(store.outboxStatus()).toEqual({ pending: 1, leased: 0, delivered: 0 });

    const lease = store.leaseOutbox(10, 30_000, now);
    expect(lease.items).toHaveLength(1);
    expect(lease.items[0]?.push_request.events).toHaveLength(1);
    expect(lease.items[0]?.push_request.erasures).toEqual([]);
    expect(lease.items[0]?.push_request.events[0]?.zone_sequence).toBeUndefined();
    expect(lease.items[0]?.protected_value_id).toBe(result.protected_value_id);
    expect(searchRuntimeBytes(runtimeDir, "secret sentinel alpha")).toBe(false);

    const contentRef = result.event.payload.content_ref;
    if (contentRef.ref_type !== "protected_value") {
      throw new Error("expected protected value content ref");
    }
    expect(contentRef.protected_value_id).toBe(result.protected_value_id);
    expect(contentRef.protected_value_id).toBe(lease.items[0]?.protected_value_id);
    const db = new DatabaseSync(store.dbPath);
    const protectedRow = db
      .prepare(
        "SELECT ciphertext, plaintext_digest FROM protected_values WHERE protected_value_id = ?",
      )
      .get(result.protected_value_id) as {
      ciphertext: Uint8Array;
      plaintext_digest: string;
    };
    expect(contentRef.encrypted_blob.digest.value).toBe(hashHex(protectedRow.ciphertext));
    expect(contentRef.encrypted_blob.digest.value).not.toBe(protectedRow.plaintext_digest);
    const requestTimeRow = db
      .prepare("SELECT captured_at, recorded_at FROM capture_requests WHERE event_id = ?")
      .get(result.event.event_id) as {
      captured_at: string;
      recorded_at: string;
    };
    expect(requestTimeRow).toEqual({
      captured_at: "2025-12-31T23:59:00Z",
      recorded_at: now.toISOString(),
    });
    db.close();

    const decrypted = Buffer.from(
      store.decryptProtectedValue(lease.items[0]?.protected_value_id ?? ""),
    ).toString("utf8");
    expect(decrypted).toContain("secret sentinel alpha");
  });

  it("rolls back capture atomically when outbox insertion cannot happen", () => {
    const { store } = makeStore();

    expect(() =>
      store.captureHook(makeEnvelope({ payload: { transcript: "rollback sentinel" } }), {
        failAfter: "canonical_event",
      }),
    ).toThrow("simulated transaction failure");

    expect(store.countRows("capture_requests")).toBe(0);
    expect(store.countRows("protected_values")).toBe(0);
    expect(store.countRows("canonical_events")).toBe(0);
    expect(store.countRows("outbox")).toBe(0);
  });

  it("rejects updates and deletes against append-only request and event tables", () => {
    const { store } = makeStore();
    const captured = store.captureHook(makeEnvelope());
    const db = new DatabaseSync(store.dbPath);

    expect(() =>
      db
        .prepare("UPDATE canonical_events SET event_type = ? WHERE event_id = ?")
        .run("Claim", captured.event.event_id),
    ).toThrow("append-only");
    expect(() =>
      db.prepare("DELETE FROM canonical_events WHERE event_id = ?").run(captured.event.event_id),
    ).toThrow("append-only");
    expect(() =>
      db
        .prepare("UPDATE capture_requests SET provider = ? WHERE event_id = ?")
        .run("claude", captured.event.event_id),
    ).toThrow("append-only");
    expect(() =>
      db.prepare("DELETE FROM capture_requests WHERE event_id = ?").run(captured.event.event_id),
    ).toThrow("append-only");
    db.close();
  });

  it("replays identical idempotency across reopen, rejects conflicts, and scopes uniqueness by trust zone", () => {
    const runtimeDir = tempDir();
    const dbPath = join(runtimeDir, "carpeos.sqlite");
    const first = new LocalCaptureStore({
      runtimeDir,
      dbPath,
      workspaceRoot: runtimeDir,
      keyProvider: new StaticKeyProvider(staticMaterial),
    });
    const envelope = makeEnvelope({ idempotency_key: "idem_replay_key_00000001" });
    const captured = first.captureHook(envelope);
    first.close();

    const reopened = new LocalCaptureStore({
      runtimeDir,
      dbPath,
      workspaceRoot: runtimeDir,
      keyProvider: new StaticKeyProvider(staticMaterial),
    });
    const replay = reopened.captureHook(envelope);
    expect(replay.status).toBe("replay");
    expect(replay.local_sequence).toBe(captured.local_sequence);
    expect(reopened.countRows("canonical_events")).toBe(1);
    expect(() =>
      reopened.captureHook(
        makeEnvelope({
          idempotency_key: "idem_replay_key_00000001",
          payload: { transcript: "different" },
        }),
      ),
    ).toThrow(IdempotencyConflictError);
    expect(reopened.countRows("canonical_events")).toBe(1);
    reopened.close();

    const otherZone = new LocalCaptureStore({
      runtimeDir,
      dbPath,
      workspaceRoot: runtimeDir,
      trustZoneId: "tz_other_zone",
      keyProvider: new StaticKeyProvider(staticMaterial),
    });
    const crossZone = otherZone.captureHook(envelope);
    expect(crossZone.status).toBe("captured");
    expect(otherZone.countRows("canonical_events")).toBe(2);
  });

  it("stores distinct protected values for identical payloads with different logical request identity", () => {
    const { store } = makeStore();
    const first = store.captureHook(
      makeEnvelope({
        source_event_id: "source_same_payload_1",
        idempotency_key: "idem_same_payload_00000001",
        payload: { transcript: "same payload" },
      }),
    );
    const second = store.captureHook(
      makeEnvelope({
        source_event_id: "source_same_payload_2",
        idempotency_key: "idem_same_payload_00000002",
        payload: { transcript: "same payload" },
      }),
    );

    expect(first.event.event_id).not.toBe(second.event.event_id);
    expect(first.protected_value_id).not.toBe(second.protected_value_id);
    expect(store.countRows("canonical_events")).toBe(2);
    expect(store.countRows("protected_values")).toBe(2);
  });

  it("keeps migrations idempotent across reopen", () => {
    const runtimeDir = tempDir();
    const dbPath = join(runtimeDir, "carpeos.sqlite");
    const first = new LocalCaptureStore({
      runtimeDir,
      dbPath,
      workspaceRoot: runtimeDir,
      keyProvider: new StaticKeyProvider(staticMaterial),
    });
    first.close();

    const second = new LocalCaptureStore({
      runtimeDir,
      dbPath,
      workspaceRoot: runtimeDir,
      keyProvider: new StaticKeyProvider(staticMaterial),
    });
    const db = new DatabaseSync(second.dbPath);
    const row = db.prepare("SELECT count(*) AS count FROM schema_migrations").get() as {
      count: number;
    };
    expect(Number(row.count)).toBe(1);
    db.close();
  });

  it("leases due outbox rows, rejects wrong lease ids, retries with delay, and reclaims expired leases after restart", () => {
    const runtimeDir = tempDir();
    const dbPath = join(runtimeDir, "carpeos.sqlite");
    const store = new LocalCaptureStore({
      runtimeDir,
      dbPath,
      workspaceRoot: runtimeDir,
      keyProvider: new StaticKeyProvider(staticMaterial),
      clock: { now: () => now },
    });
    const captured = store.captureHook(makeEnvelope());
    const lease = store.leaseOutbox(1, 1_000, now);
    const outboxId = lease.items[0]?.outbox_id ?? -1;

    expect(outboxId).toBe(captured.outbox_id);
    expect(lease.items[0]?.attempts).toBe(1);
    expect(store.ackOutbox(outboxId, "lease_wrong", now)).toBe(false);
    expect(store.retryOutbox(outboxId, "lease_wrong", 1_000, "temporary", now)).toBe(false);
    expect(store.retryOutbox(outboxId, lease.lease_id, 2_000, "temporary", now)).toBe(true);
    expect(store.leaseOutbox(1, 1_000, new Date("2026-01-01T00:00:01Z")).items).toHaveLength(0);
    store.close();

    const reopened = new LocalCaptureStore({
      runtimeDir,
      dbPath,
      workspaceRoot: runtimeDir,
      keyProvider: new StaticKeyProvider(staticMaterial),
    });
    const requeued = reopened.leaseOutbox(1, 1_000, new Date("2026-01-01T00:00:02Z"));
    expect(requeued.items).toHaveLength(1);
    expect(requeued.items[0]?.attempts).toBe(2);
    expect(reopened.ackOutbox(outboxId, requeued.lease_id, new Date("2026-01-01T00:00:03Z"))).toBe(
      true,
    );
    expect(reopened.outboxStatus()).toEqual({ pending: 0, leased: 0, delivered: 1 });
  });

  it("reclaims expired leases after reopening without retry", () => {
    const runtimeDir = tempDir();
    const dbPath = join(runtimeDir, "carpeos.sqlite");
    const store = new LocalCaptureStore({
      runtimeDir,
      dbPath,
      workspaceRoot: runtimeDir,
      keyProvider: new StaticKeyProvider(staticMaterial),
      clock: { now: () => now },
    });
    store.captureHook(makeEnvelope());
    store.leaseOutbox(1, 1_000, now);
    store.close();

    const reopened = new LocalCaptureStore({
      runtimeDir,
      dbPath,
      workspaceRoot: runtimeDir,
      keyProvider: new StaticKeyProvider(staticMaterial),
    });
    const reclaimed = reopened.leaseOutbox(1, 1_000, new Date("2026-01-01T00:00:02Z"));
    expect(reclaimed.items).toHaveLength(1);
    expect(reclaimed.items[0]?.attempts).toBe(2);
  });

  it("creates local key material with private file modes", () => {
    const runtimeDir = tempDir();
    const provider = new FileKeyProvider(runtimeDir);
    const key = provider.readOrCreateKey();
    expect(key).toHaveLength(32);
    expect(new FileKeyProvider(runtimeDir).readOrCreateKey()).toEqual(key);
    assertPrivateKeyFileModes(runtimeDir);
    expect(statSync(join(runtimeDir, "local-aes256.key")).mode & 0o777).toBe(0o600);
  });

  it("fails closed on corrupt persisted key or device identity material", () => {
    const corruptKeyDir = tempDir();
    writeFileSync(join(corruptKeyDir, "local-aes256.key"), "not-a-valid-key\n", { mode: 0o600 });
    expect(() => new FileKeyProvider(corruptKeyDir).readOrCreateKey()).toThrow(
      /invalid local key material/,
    );

    const corruptIdentityDir = tempDir();
    writeFileSync(join(corruptIdentityDir, "device-client-id"), "client_invalid\n", {
      mode: 0o600,
    });
    expect(() =>
      resolveProjectIdentity({
        runtimeDir: corruptIdentityDir,
        workspaceRoot: corruptIdentityDir,
        execGit: () => {
          throw new Error("no remote");
        },
      }),
    ).toThrow(/invalid device client id/);
  });

  it("derives default local trust zones per device and keeps them stable across reopen", () => {
    const runtimeA = tempDir();
    const runtimeB = tempDir();
    const firstA = new LocalCaptureStore({
      runtimeDir: runtimeA,
      workspaceRoot: runtimeA,
      keyProvider: new StaticKeyProvider(staticMaterial),
    });
    const firstB = new LocalCaptureStore({
      runtimeDir: runtimeB,
      workspaceRoot: runtimeB,
      keyProvider: new StaticKeyProvider(staticMaterial),
    });

    expect(firstA.trustZone.trust_zone_id).toMatch(/^tz_local_[a-f0-9]{24}$/);
    expect(firstB.trustZone.trust_zone_id).toMatch(/^tz_local_[a-f0-9]{24}$/);
    expect(firstA.trustZone.trust_zone_id).not.toBe(firstB.trustZone.trust_zone_id);
    const stableZone = firstA.trustZone.trust_zone_id;
    firstA.close();
    firstB.close();

    const reopenedA = new LocalCaptureStore({
      runtimeDir: runtimeA,
      workspaceRoot: runtimeA,
      keyProvider: new StaticKeyProvider(staticMaterial),
    });
    expect(reopenedA.trustZone.trust_zone_id).toBe(stableZone);
  });

  it("rejects trust zone identifiers outside the canonical schema", () => {
    const runtimeDir = tempDir();

    expect(
      () =>
        new LocalCaptureStore({
          runtimeDir,
          workspaceRoot: runtimeDir,
          trustZoneId: "local-zone",
          keyProvider: new StaticKeyProvider(staticMaterial),
        }),
    ).toThrow(/invalid trust zone id/);
  });
});

describe("project identity", () => {
  it("normalizes HTTPS and SSH remotes to the same credential-free hash basis", () => {
    expect(sanitizeRemoteIdentity("https://token@example.com/Owner/Repo.git")).toBe(
      "example.com/Owner/Repo",
    );
    expect(sanitizeRemoteIdentity("git@example.com:Owner/Repo.git")).toBe("example.com/Owner/Repo");
    expect(sanitizeRemoteIdentity("git@example.com:owner/repo.git")).not.toBe(
      sanitizeRemoteIdentity("git@example.com:Owner/Repo.git"),
    );

    const runtimeA = tempDir();
    const runtimeB = tempDir();
    const httpsIdentity = resolveProjectIdentity({
      runtimeDir: runtimeA,
      workspaceRoot: runtimeA,
      execGit: () => "https://token@example.com/Owner/Repo.git\n",
    });
    const sshIdentity = resolveProjectIdentity({
      runtimeDir: runtimeB,
      workspaceRoot: runtimeB,
      execGit: () => "git@example.com:Owner/Repo.git\n",
    });

    expect(httpsIdentity.project_id).toBe(sshIdentity.project_id);
    expect(httpsIdentity.project_id).toMatch(/^project_git_/);
  });

  it("lets explicit project identity win and marks path fallback as device local", () => {
    const runtimeDir = tempDir();
    const explicit = resolveProjectIdentity({
      runtimeDir,
      workspaceRoot: runtimeDir,
      explicitProjectId: "My Product!",
      execGit: () => "git@example.com:owner/repo.git",
    });
    expect(explicit.project_id).toMatch(/^my_product_[a-f0-9]{16}$/);
    expect(explicit.basis_kind).toBe("explicit");

    const fallback = resolveProjectIdentity({
      runtimeDir,
      workspaceRoot: "/private/synthetic/workspace",
      execGit: () => {
        throw new Error("no remote");
      },
    });
    expect(fallback.project_id).toMatch(/^project_local_/);
    expect(fallback.basis_kind).toBe("device_local_root_hash");

    const otherDevice = resolveProjectIdentity({
      runtimeDir: tempDir(),
      workspaceRoot: "/private/synthetic/workspace",
      execGit: () => {
        throw new Error("no remote");
      },
    });
    expect(otherDevice.project_id).not.toBe(fallback.project_id);
  });

  it("keeps lossy explicit project identifiers collision resistant", () => {
    const runtimeDir = tempDir();
    const identify = (explicitProjectId: string) =>
      resolveProjectIdentity({
        runtimeDir,
        workspaceRoot: runtimeDir,
        explicitProjectId,
        execGit: () => "git@example.com:owner/repo.git",
      }).project_id;

    expect(identify("1")).not.toBe(identify("2"));
    expect(identify("!!!")).not.toBe(identify("???"));
    expect(identify("My Product!")).not.toBe(identify("My-Product!"));
    expect(identify("canonical_project")).toBe("canonical_project");
  });
});

function makeStore(): { store: LocalCaptureStore; runtimeDir: string } {
  const runtimeDir = tempDir();
  return {
    runtimeDir,
    store: new LocalCaptureStore({
      runtimeDir,
      workspaceRoot: runtimeDir,
      keyProvider: new StaticKeyProvider(staticMaterial),
      clock: { now: () => now },
    }),
  };
}

function makeEnvelope(overrides: Partial<CaptureEnvelope> = {}): CaptureEnvelope {
  return {
    provider: "codex",
    hook_event_name: "SessionEnd",
    captured_at: "2026-01-01T00:00:00Z",
    workspace_root: "/synthetic/workspace",
    session_id: "session_synthetic",
    source_event_id: "source_synthetic",
    media_type: "application/json",
    subject_ref: "subject_synthetic",
    payload: { transcript: "synthetic capture" },
    ...overrides,
  };
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "carpeos-local-store-"));
  createdDirs.push(dir);
  return dir;
}

function searchRuntimeBytes(runtimeDir: string, needle: string): boolean {
  const stack = [runtimeDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
        continue;
      }
      if (readFileSync(path).includes(needle)) {
        return true;
      }
    }
  }
  return false;
}
