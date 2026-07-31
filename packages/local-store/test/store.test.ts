import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CaptureEnvelope } from "@carpeos/capture";
import { ADJUDICATION_POLICY_VERSION, hashHex } from "@carpeos/capture";
import type {
  CanonicalEvent,
  ErasureLedgerRecord,
  ProtectedValueMetadata,
  ProtectedValueUploadIntent,
} from "@carpeos/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertPrivateKeyFileModes,
  FileKeyProvider,
  IdempotencyConflictError,
  LOCAL_STORE_MIGRATION_IDS,
  LocalCaptureStore,
  StaticKeyProvider,
} from "../src/index.js";
import { resolveProjectIdentity, sanitizeRemoteIdentity } from "../src/project-identity.js";

const staticMaterial = new Uint8Array(32).fill(7);
const otherStaticMaterial = new Uint8Array(32).fill(9);
const trustZoneSyncKey = new Uint8Array(32).fill(11);
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

  it("proposes draft claims with explicit and default valid time without accepting them", () => {
    const { store } = makeStore();
    const supportEvent = store.captureHook(makeEnvelope({ source_event_id: "source_support_001" }));
    const support = [
      {
        ref_type: "event" as const,
        ref_id: supportEvent.event.event_id,
        relationship: "supports" as const,
      },
    ];

    const defaulted = store.proposeClaimDraft({
      statement: "Synthetic default-time claim.",
      support,
      idempotencyKey: "idem_claim_default_000001",
    });
    expect(defaulted.status).toBe("proposed");
    expect(defaulted.valid_time_defaulted).toBe(true);
    expect(defaulted.event.event_type).toBe("Claim");
    expect(defaulted.event.lifecycle_status).toBe("draft");
    expect(defaulted.event.valid_time).toEqual(defaulted.event.recorded_time);
    expect(defaulted.event.payload.support).toEqual(support);
    expect(store.countRows("canonical_events")).toBe(2);

    const historical = store.proposeClaimDraft({
      statement: "Synthetic historical claim.",
      support,
      validTime: { start: "2025-01-01T00:00:00Z", end: null },
      idempotencyKey: "idem_claim_history_000001",
    });
    expect(historical.valid_time_defaulted).toBe(false);
    expect(historical.event.valid_time.start).toBe("2025-01-01T00:00:00Z");
    expect(historical.event.recorded_time.start).toBe(now.toISOString());
    expect(historical.event.valid_time.start).not.toBe(historical.event.recorded_time.start);

    const future = store.proposeClaimDraft({
      statement: "Synthetic future claim.",
      support,
      validTime: { start: "2027-01-01T00:00:00Z", end: null },
      idempotencyKey: "idem_claim_future_000001",
    });
    expect(future.event.valid_time.start).toBe("2027-01-01T00:00:00Z");
    const eventTypes = store
      .listCanonicalEventSnapshots()
      .map((snapshot) => snapshot.event.event_type);
    expect(eventTypes).toEqual(["EvidenceArtifact", "Claim", "Claim", "Claim"]);
    expect(eventTypes).not.toContain("AcceptanceDecision");
  });

  it("replays and conflicts propose-claim idempotency without duplicate canonical writes", () => {
    const { store } = makeStore();
    const supportEvent = store.captureHook(makeEnvelope({ source_event_id: "source_support_002" }));
    const support = [
      {
        ref_type: "event" as const,
        ref_id: supportEvent.event.event_id,
        relationship: "supports" as const,
      },
    ];
    const input = {
      statement: "Synthetic replay claim.",
      support,
      idempotencyKey: "idem_claim_replay_000001",
    };

    const proposed = store.proposeClaimDraft(input);
    const replay = store.proposeClaimDraft(input);
    expect(replay.status).toBe("replay");
    expect(replay.event.event_id).toBe(proposed.event.event_id);
    expect(store.countRows("canonical_events")).toBe(2);
    expect(() =>
      store.proposeClaimDraft({
        ...input,
        statement: "Synthetic conflicting claim.",
      }),
    ).toThrow(IdempotencyConflictError);
    expect(store.countRows("canonical_events")).toBe(2);
  });

  it("rejects unknown, unauthorized, and cross-zone support before writing draft claims", () => {
    const { store } = makeStore();
    const supportEvent = store.captureHook(makeEnvelope({ source_event_id: "source_support_003" }));

    expect(() =>
      store.proposeClaimDraft({
        statement: "Unknown support fails.",
        support: [{ ref_type: "event", ref_id: "evt_missing_support", relationship: "supports" }],
      }),
    ).toThrow(/support reference not found or unauthorized/);
    expect(() =>
      store.proposeClaimDraft({
        statement: "Hidden support fails.",
        support: [
          { ref_type: "event", ref_id: supportEvent.event.event_id, relationship: "supports" },
        ],
        visibleTrustZoneIds: ["tz_hidden_only"],
      }),
    ).toThrow(/local trust zone must be visible/);

    const otherZone = new LocalCaptureStore({
      runtimeDir: tempDir(),
      workspaceRoot: tempDir(),
      trustZoneId: "tz_other_support",
      keyProvider: new StaticKeyProvider(staticMaterial),
      clock: { now: () => now },
    });
    const otherSupport = otherZone.captureHook(
      makeEnvelope({ source_event_id: "source_support_004" }),
    );
    expect(() =>
      store.proposeClaimDraft({
        statement: "Cross-zone support fails.",
        support: [
          { ref_type: "event", ref_id: otherSupport.event.event_id, relationship: "supports" },
        ],
        visibleTrustZoneIds: [store.trustZone.trust_zone_id, otherZone.trustZone.trust_zone_id],
      }),
    ).toThrow(/support reference not found or unauthorized|different trust zone/);
    expect(store.countRows("canonical_events")).toBe(1);
  });

  it("returns deterministic authorized canonical, inbox, erasure, and retrieval snapshots", () => {
    const { store } = makeStore();
    const captured = store.captureHook(makeEnvelope({ source_event_id: "source_snapshot_001" }));
    const imported = makeExternalEvent("evt_snapshot_import_0001", store.trustZone.trust_zone_id);
    const erasure = makeErasure("era_snapshot_0001", store.trustZone.trust_zone_id);
    store.importPulledEvent(imported);
    store.importPulledErasure(erasure);
    store.persistSyncCursor({ afterSequence: 4, now });

    const snapshot = store.getRetrievalInputSnapshot();
    expect(snapshot.visible_trust_zone_ids).toEqual([store.trustZone.trust_zone_id]);
    expect(snapshot.events.map((event) => event.event_id)).toEqual([
      captured.event.event_id,
      imported.event_id,
    ]);
    expect(snapshot.erasures.map((item) => item.erasure_id)).toEqual([erasure.erasure_id]);
    expect(snapshot.sync_cursor.after_sequence).toBe(4);
    expect(store.getAuthorizedCanonicalEvent({ eventId: captured.event.event_id })?.event_id).toBe(
      captured.event.event_id,
    );
    expect(
      store.getAuthorizedCanonicalEvent({
        eventId: captured.event.event_id,
        visibleTrustZoneIds: ["tz_hidden_only"],
      }),
    ).toBeUndefined();
    expect(store.getObsidianProjectionInputSnapshot()).toEqual(snapshot);
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

  it("records worktree facet on capture without storing absolute paths", () => {
    const runtimeDir = tempDir();
    const store = new LocalCaptureStore({
      runtimeDir,
      workspaceRoot: runtimeDir,
      keyProvider: new StaticKeyProvider(staticMaterial),
      clock: { now: () => now },
    });
    const captured = store.captureHook(makeEnvelope());

    expect(store.worktree.worktree_id).toMatch(/^wt_[a-f0-9]{24}$/);
    expect(store.worktree.worktree_name.length).toBeGreaterThan(0);
    expect(store.worktree.worktree_name).not.toContain("/");

    const db = new DatabaseSync(store.dbPath);
    const row = db
      .prepare(
        "SELECT project_id, worktree_id, worktree_name, git_branch, is_linked_worktree FROM capture_requests WHERE event_id = ?",
      )
      .get(captured.event.event_id) as {
      project_id: string;
      worktree_id: string;
      worktree_name: string;
      git_branch: string | null;
      is_linked_worktree: number;
    };
    expect(row.project_id).toBe(store.projectId);
    expect(row.worktree_id).toBe(store.worktree.worktree_id);
    expect(row.worktree_name).toBe(store.worktree.worktree_name);
    expect([0, 1]).toContain(Number(row.is_linked_worktree));

    // Privacy shape: the absolute workspace root must never be persisted here.
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(runtimeDir);
    db.close();
    store.close();
  });

  it("keeps the same project partition across sibling worktrees of one repository", () => {
    const runtimeDir = tempDir();
    const remote = "git@github.com:example/synthetic-repo.git";
    const makeAt = (root: string) =>
      new LocalCaptureStore({
        runtimeDir,
        dbPath: join(runtimeDir, "carpeos.sqlite"),
        workspaceRoot: root,
        keyProvider: new StaticKeyProvider(staticMaterial),
        clock: { now: () => now },
        // Both checkouts report the same remote; only the checkout root differs.
        execGit: (args: string[], cwd: string) => {
          if (args[0] === "config") return remote;
          if (args[1] === "--show-toplevel") return cwd;
          if (args[1] === "--abbrev-ref") return "main";
          if (args[1] === "--git-dir") return cwd + "/.git";
          if (args[1] === "--git-common-dir") return cwd + "/.git";
          throw new Error("unexpected git call");
        },
      });

    const primary = makeAt(join(runtimeDir, "repo-main"));
    const linked = makeAt(join(runtimeDir, "repo-feature"));

    expect(linked.projectId).toBe(primary.projectId);
    expect(linked.worktree.worktree_id).not.toBe(primary.worktree.worktree_id);
    expect(primary.worktree.worktree_name).toBe("repo-main");
    expect(linked.worktree.worktree_name).toBe("repo-feature");
    primary.close();
    linked.close();
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
    expect(Number(row.count)).toBe(LOCAL_STORE_MIGRATION_IDS.length);
    const applied = db
      .prepare("SELECT migration_id FROM schema_migrations ORDER BY migration_id")
      .all() as Array<{ migration_id: string }>;
    expect(applied.map((item) => item.migration_id)).toEqual([...LOCAL_STORE_MIGRATION_IDS]);
    db.close();
    second.close();
  });

  it("preserves events across reopen after migrations (no silent wipe)", () => {
    const runtimeDir = tempDir();
    const dbPath = join(runtimeDir, "carpeos.sqlite");
    const first = new LocalCaptureStore({
      runtimeDir,
      dbPath,
      workspaceRoot: runtimeDir,
      keyProvider: new StaticKeyProvider(staticMaterial),
    });
    const captured = first.captureHook(makeEnvelope());
    expect(first.countRows("canonical_events")).toBe(1);
    first.close();

    const second = new LocalCaptureStore({
      runtimeDir,
      dbPath,
      workspaceRoot: runtimeDir,
      keyProvider: new StaticKeyProvider(staticMaterial),
    });
    expect(second.countRows("canonical_events")).toBe(1);
    const db = new DatabaseSync(second.dbPath);
    const event = db
      .prepare("SELECT event_id FROM canonical_events WHERE event_id = ?")
      .get(captured.event.event_id) as { event_id: string } | undefined;
    expect(event?.event_id).toBe(captured.event.event_id);
    const migrationCount = db.prepare("SELECT count(*) AS count FROM schema_migrations").get() as {
      count: number;
    };
    expect(Number(migrationCount.count)).toBe(LOCAL_STORE_MIGRATION_IDS.length);
    db.close();
    second.close();
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

  it("exports protected ciphertext with a schema-valid upload intent without leaking the raw device key", () => {
    const { store } = makeStore();
    const captured = store.captureHook(makeEnvelope({ payload: { transcript: "sync export" } }));
    const transfer = store.exportProtectedValueForSync({
      protectedValueId: captured.protected_value_id,
      trustZoneSyncKey,
    });

    expect(transfer.intent.protected_value_id).toBe(captured.protected_value_id);
    expect(transfer.intent.trust_zone_id).toBe(store.trustZone.trust_zone_id);
    expect(transfer.intent.object_key).toContain(`/${captured.protected_value_id}/`);
    expect(transfer.intent.original_ciphertext_digest.value).toBe(hashHex(transfer.ciphertext));
    expect(transfer.intent.original_ciphertext_size_bytes).toBe(transfer.ciphertext.byteLength);
    expect(JSON.stringify(transfer.intent)).not.toContain(
      Buffer.from(staticMaterial).toString("hex"),
    );
    expect(transfer.intent.wrapped_device_key.aad).toEqual({
      trust_zone_id: store.trustZone.trust_zone_id,
      protected_value_id: captured.protected_value_id,
      key_ref: "key_local_active",
    });
  });

  it("imports pulled protected values into a second runtime with a different device key", () => {
    const trustZoneId = "tz_shared_sync_zone";
    const runtimeA = tempDir();
    const runtimeB = tempDir();
    const storeA = new LocalCaptureStore({
      runtimeDir: runtimeA,
      workspaceRoot: runtimeA,
      trustZoneId,
      keyProvider: new StaticKeyProvider(staticMaterial),
      clock: { now: () => now },
    });
    const captured = storeA.captureHook(
      makeEnvelope({ payload: { transcript: "cross mac synthetic secret" } }),
    );
    const transfer = storeA.exportProtectedValueForSync({
      protectedValueId: captured.protected_value_id,
      trustZoneSyncKey,
    });
    const remoteEvent = { ...captured.event, zone_sequence: 12 };
    const metadata = metadataFromIntent(transfer.intent, captured.event.event_id);

    const storeB = new LocalCaptureStore({
      runtimeDir: runtimeB,
      workspaceRoot: runtimeB,
      trustZoneId,
      keyProvider: new StaticKeyProvider(otherStaticMaterial),
      clock: { now: () => new Date("2026-01-01T00:01:00Z") },
    });
    const imported = storeB.importPulledProtectedValue({
      event: remoteEvent,
      metadata,
      ciphertext: transfer.ciphertext,
      trustZoneSyncKey,
    });

    expect(imported.status).toBe("imported");
    expect(storeB.getEvent(captured.event.event_id)).toEqual(remoteEvent);
    expect(
      Buffer.from(storeB.decryptProtectedValue(captured.protected_value_id)).toString("utf8"),
    ).toContain("cross mac synthetic secret");
    expect(storeB.countRows("protected_value_imports")).toBe(1);
    expect(storeB.countRows("sync_inbox_events")).toBe(1);
    expect(searchRuntimeBytes(runtimeB, "cross mac synthetic secret")).toBe(false);
  });

  it("fails closed on wrong sync key, digest mismatch, and wrapped AAD mismatch", () => {
    const { store } = makeStore();
    const captured = store.captureHook(makeEnvelope({ payload: { transcript: "aad guard" } }));
    const transfer = store.exportProtectedValueForSync({
      protectedValueId: captured.protected_value_id,
      trustZoneSyncKey,
    });
    const metadata = metadataFromIntent(transfer.intent, captured.event.event_id);
    const target = new LocalCaptureStore({
      runtimeDir: tempDir(),
      workspaceRoot: tempDir(),
      trustZoneId: store.trustZone.trust_zone_id,
      keyProvider: new StaticKeyProvider(otherStaticMaterial),
    });

    expect(() =>
      target.importPulledProtectedValue({
        event: captured.event,
        metadata,
        ciphertext: transfer.ciphertext,
        trustZoneSyncKey: new Uint8Array(32).fill(12),
      }),
    ).toThrow();
    expect(() =>
      target.importPulledProtectedValue({
        event: captured.event,
        metadata: {
          ...metadata,
          original_ciphertext_digest: { algorithm: "sha-256", value: "0".repeat(64) },
        },
        ciphertext: transfer.ciphertext,
        trustZoneSyncKey,
      }),
    ).toThrow(/metadata digest does not match event|ciphertext digest mismatch/);
    expect(() =>
      target.importPulledProtectedValue({
        event: captured.event,
        metadata: {
          ...metadata,
          wrapped_device_key: {
            ...metadata.wrapped_device_key,
            aad: { ...metadata.wrapped_device_key.aad, key_ref: "key_wrong" },
          },
        },
        ciphertext: transfer.ciphertext,
        trustZoneSyncKey,
      }),
    ).toThrow(/invalid protected value metadata|AAD key ref mismatch/);
  });

  it("keeps imports and sync cursors restart-safe and idempotent", () => {
    const trustZoneId = "tz_restart_safe_zone";
    const source = new LocalCaptureStore({
      runtimeDir: tempDir(),
      workspaceRoot: tempDir(),
      trustZoneId,
      keyProvider: new StaticKeyProvider(staticMaterial),
    });
    const captured = source.captureHook(makeEnvelope());
    const transfer = source.exportProtectedValueForSync({
      protectedValueId: captured.protected_value_id,
      trustZoneSyncKey,
    });
    const remoteEvent = { ...captured.event, zone_sequence: 7 };
    const metadata = metadataFromIntent(transfer.intent, captured.event.event_id);
    const runtimeDir = tempDir();
    const dbPath = join(runtimeDir, "carpeos.sqlite");
    const first = new LocalCaptureStore({
      runtimeDir,
      dbPath,
      workspaceRoot: runtimeDir,
      trustZoneId,
      keyProvider: new StaticKeyProvider(otherStaticMaterial),
    });
    expect(
      first.importPulledProtectedValue({
        event: remoteEvent,
        metadata,
        ciphertext: transfer.ciphertext,
        trustZoneSyncKey,
      }).status,
    ).toBe("imported");
    first.persistSyncCursor({ afterSequence: 7, cursor: "cursor_7", now });
    first.close();

    const reopened = new LocalCaptureStore({
      runtimeDir,
      dbPath,
      workspaceRoot: runtimeDir,
      trustZoneId,
      keyProvider: new StaticKeyProvider(otherStaticMaterial),
    });
    expect(
      reopened.importPulledProtectedValue({
        event: remoteEvent,
        metadata,
        ciphertext: transfer.ciphertext,
        trustZoneSyncKey,
      }).status,
    ).toBe("replay");
    expect(reopened.countRows("canonical_events")).toBe(1);
    expect(reopened.countRows("protected_value_imports")).toBe(1);
    expect(reopened.getSyncCursor()).toEqual({
      trust_zone_id: trustZoneId,
      after_sequence: 7,
      cursor: "cursor_7",
    });
  });

  it("imports non-protected pulled events idempotently and rejects divergent replay", () => {
    const trustZoneId = "tz_general_import_zone";
    const target = new LocalCaptureStore({
      runtimeDir: tempDir(),
      workspaceRoot: tempDir(),
      trustZoneId,
      keyProvider: new StaticKeyProvider(otherStaticMaterial),
    });
    const event = makeExternalEvent("evt_general_import_0001", trustZoneId);

    expect(target.importPulledEvent(event, now)).toEqual({
      status: "imported",
      event_id: event.event_id,
    });
    expect(target.importPulledEvent(event, now).status).toBe("replay");
    expect(target.getEvent(event.event_id)).toEqual(event);
    expect(() =>
      target.importPulledEvent({ ...event, subject_ref: "subject_changed" }, now),
    ).toThrow(/replay diverges/);
  });

  it("treats same-origin pull as replay when only remote zone_sequence was assigned", () => {
    const trustZoneId = "tz_same_origin_pull";
    const runtimeDir = tempDir();
    const store = new LocalCaptureStore({
      runtimeDir,
      workspaceRoot: runtimeDir,
      trustZoneId,
      keyProvider: new StaticKeyProvider(staticMaterial),
      clock: { now: () => now },
    });
    const captured = store.captureHook(
      makeEnvelope({ payload: { transcript: "same origin pull secret" } }),
    );
    expect(captured.event.zone_sequence).toBeUndefined();

    const transfer = store.exportProtectedValueForSync({
      protectedValueId: captured.protected_value_id,
      trustZoneSyncKey,
    });
    const remoteEvent = { ...captured.event, zone_sequence: 4 };
    const metadata = metadataFromIntent(transfer.intent, captured.event.event_id);

    const result = store.importPulledProtectedValue({
      event: remoteEvent,
      metadata,
      ciphertext: transfer.ciphertext,
      trustZoneSyncKey,
    });
    expect(result).toEqual({
      status: "replay",
      event_id: captured.event.event_id,
      protected_value_id: captured.protected_value_id,
    });
    // Local origin event stays without zone_sequence; content is unchanged.
    expect(store.getEvent(captured.event.event_id)).toEqual(captured.event);
    expect(store.countRows("protected_value_imports")).toBe(1);

    // Real content divergence still fails closed.
    expect(() =>
      store.importPulledProtectedValue({
        event: { ...remoteEvent, subject_ref: "subject_tampered" },
        metadata,
        ciphertext: transfer.ciphertext,
        trustZoneSyncKey,
      }),
    ).toThrow(/replay diverges/);

    // Non-protected same-origin path.
    const general = makeExternalEvent("evt_same_origin_general01", trustZoneId);
    // Simulate local origin by storing without zone_sequence first via capture-shaped insert:
    // import without sequence, then re-pull with sequence only.
    const withoutSequence = { ...general };
    delete (withoutSequence as { zone_sequence?: number }).zone_sequence;
    expect(store.importPulledEvent(withoutSequence as typeof general, now).status).toBe("imported");
    expect(
      store.importPulledEvent({ ...withoutSequence, zone_sequence: 9 } as typeof general, now)
        .status,
    ).toBe("replay");
  });

  it("rejects pulled events and erasures outside the local trust zone", () => {
    const target = new LocalCaptureStore({
      runtimeDir: tempDir(),
      workspaceRoot: tempDir(),
      trustZoneId: "tz_local_import_zone",
      keyProvider: new StaticKeyProvider(otherStaticMaterial),
    });

    expect(() =>
      target.importPulledEvent(makeExternalEvent("evt_wrong_zone0001", "tz_other_import_zone")),
    ).toThrow(/different trust zone/);
    expect(() =>
      target.importPulledErasure(makeErasure("era_wrong_zone0001", "tz_other_import_zone")),
    ).toThrow(/different trust zone/);
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

describe("LocalCaptureStore extraction", () => {
  it("extracts Observation after eligible capture when extract:true", () => {
    const { store } = makeStore();
    const result = store.captureHook(
      makeEnvelope({
        hook_event_name: "SessionEnd",
        payload: { transcript: "secret should not appear in observation" },
      }),
      { extract: true },
    );
    expect(result.status).toBe("captured");
    expect(result.extraction?.status).toBe("extracted");
    if (result.extraction?.status !== "extracted" && result.extraction?.status !== "replay") {
      throw new Error("expected extraction");
    }
    expect(result.extraction.event.event_type).toBe("Observation");
    expect(result.extraction.event.lifecycle_status).toBe("draft");
    expect(result.extraction.event.payload.statement).toContain("SessionEnd");
    expect(result.extraction.event.payload.statement).not.toContain("secret should not appear");
    expect(result.extraction.event.payload.statement).not.toContain("Knowledge fragment");
    expect(result.extraction.event.payload.evidence_artifact_refs).toEqual([
      result.event.payload.artifact_id,
    ]);
    expect(store.countRows("canonical_events")).toBe(2);

    const again = store.extractFromEventId(result.event.event_id);
    expect(again.status).toBe("replay");
  });

  it("skips extraction for PostToolUse under default policy", () => {
    const { store } = makeStore();
    const result = store.captureHook(makeEnvelope({ hook_event_name: "PostToolUse" }), {
      extract: true,
    });
    expect(result.extraction?.status).toBe("skipped");
    expect(store.countRows("canonical_events")).toBe(1);
  });

  it("does not extract when extract option is omitted (low-level default)", () => {
    const { store } = makeStore();
    const result = store.captureHook(makeEnvelope({ hook_event_name: "Stop" }));
    expect(result.extraction).toBeUndefined();
    expect(store.countRows("canonical_events")).toBe(1);
  });
});

describe("LocalCaptureStore adjudication", () => {
  it("promotes decision-like SessionEnd signals to active Observation", () => {
    const { store } = makeStore();
    const result = store.captureHook(
      makeEnvelope({
        hook_event_name: "SessionEnd",
        payload: {
          message: "We decided to always use pnpm and never commit credentials in this monorepo.",
        },
      }),
      { extract: true },
    );
    expect(result.extraction?.status).toBe("extracted");
    if (result.extraction?.status !== "extracted" && result.extraction?.status !== "replay") {
      throw new Error("expected extraction");
    }
    expect(result.extraction.event.lifecycle_status).toBe("active");
    expect(result.extraction.event.payload.statement).toContain(
      "We decided to always use pnpm and never commit credentials in this monorepo.",
    );
    const counts = store.listDispositionCounts();
    expect(counts.promote).toBe(1);
  });

  it("labels explicit semantic fields before building a statement", () => {
    const { store } = makeStore();
    const result = store.captureHook(
      makeEnvelope({
        hook_event_name: "SessionEnd",
        payload: { decision: "Use pnpm as the default synthetic workspace installer." },
      }),
      { extract: true },
    );

    expect(result.extraction?.status).toBe("extracted");
    if (result.extraction?.status !== "extracted" && result.extraction?.status !== "replay") {
      throw new Error("expected decision extraction");
    }
    expect(result.extraction.event.lifecycle_status).toBe("active");
    expect(result.extraction.event.payload.statement).toContain(
      "Knowledge fragment (decision): Decision: Use pnpm as the default synthetic workspace installer.",
    );
  });

  it("rejects PostToolUse noise without creating Observation", () => {
    const { store } = makeStore();
    const adjudicated = store.adjudicateFromEventId(
      store.captureHook(makeEnvelope({ hook_event_name: "PostToolUse" })).event.event_id,
    );
    expect(adjudicated.status).toBe("rejected");
    if (adjudicated.status !== "rejected") {
      throw new Error("expected rejected");
    }
    expect(adjudicated.disposition).toBe("reject");
    expect(store.countRows("canonical_events")).toBe(1);
    expect(store.listDispositionCounts().reject).toBe(1);
  });

  it("holds metadata-only lifecycle as draft Observation", () => {
    const { store } = makeStore();
    const result = store.captureHook(
      makeEnvelope({
        hook_event_name: "SessionEnd",
        payload: { kind: "empty" },
      }),
      { extract: true },
    );
    expect(result.extraction?.status).toBe("extracted");
    if (result.extraction?.status !== "extracted" && result.extraction?.status !== "replay") {
      throw new Error("expected held extraction");
    }
    expect(result.extraction.event.lifecycle_status).toBe("draft");
  });

  it("extracts a safe procedure span from explicit procedure steps", () => {
    const { store } = makeStore();
    const result = store.captureHook(
      makeEnvelope({
        hook_event_name: "SessionEnd",
        procedure_trace: {
          provider: "synthetic-agent",
          session_id: "session_candidate_procedure",
          completeness: "partial",
          has_tool_calls: true,
        },
        payload: {
          steps: [
            { instruction: "Procedure: first run offline checks before release." },
            "Then verify the synthetic package artifact.",
          ],
        },
      }),
      { extract: true },
    );

    expect(result.extraction?.status).toBe("extracted");
    if (result.extraction?.status !== "extracted" && result.extraction?.status !== "replay") {
      throw new Error("expected procedure extraction");
    }
    expect(result.extraction.event.lifecycle_status).toBe("active");
    expect(result.extraction.event.payload.statement).toContain("Knowledge fragment (procedure)");
    expect(result.extraction.event.payload.statement).toContain(
      "Procedure: first run offline checks before release.",
    );
    expect(result.extraction.event.payload.statement).not.toContain("has_tool_calls");
  });

  it("rejects secret-like decision text before creating a knowledge statement", () => {
    const { store } = makeStore();
    const result = store.captureHook(
      makeEnvelope({
        hook_event_name: "SessionEnd",
        payload: {
          decision: `Store ${["pass", "word=syntheticsecretvalue123"].join("")} for later.`,
        },
      }),
      { extract: true },
    );

    expect(result.extraction?.status).toBe("skipped");
    expect(store.listDispositionCounts().reject).toBe(1);
    expect(store.countRows("canonical_events")).toBe(1);
  });

  it("lists held dispositions and promotes one through an append-only review", () => {
    const { store } = makeStore();
    const captured = store.captureHook(
      makeEnvelope({
        session_id: "session_held_promote",
        payload: { message: "Synthetic context without durable markers for operator review." },
      }),
      { extract: true },
    );
    expect(captured.extraction?.status).toBe("extracted");
    if (captured.extraction?.status !== "extracted" && captured.extraction?.status !== "replay") {
      throw new Error("expected held extraction");
    }
    expect(captured.extraction.event.lifecycle_status).toBe("draft");

    const held = store.listHeldDispositions();
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({
      source_event_id: captured.event.event_id,
      artifact_id: captured.event.payload.artifact_id,
      policy_version: ADJUDICATION_POLICY_VERSION,
    });

    const reviewed = store.reviewHeldDisposition(captured.event.event_id, "promote");
    expect(reviewed.status).toBe("reviewed");
    if (reviewed.status === "failed" || reviewed.extraction === undefined) {
      throw new Error("expected held promotion");
    }
    expect(reviewed.decision).toBe("promote");
    expect(reviewed.extraction.status).toBe("extracted");
    if (reviewed.extraction.status !== "extracted" && reviewed.extraction.status !== "replay") {
      throw new Error("expected active review Observation");
    }
    expect(reviewed.extraction.event.lifecycle_status).toBe("active");
    expect(reviewed.extraction.event.payload.statement).toBe(
      captured.extraction.event.payload.statement,
    );
    expect(store.listHeldDispositions()).toEqual([]);
    expect(store.countRows("knowledge_disposition_reviews")).toBe(1);
    expect(store.countRows("canonical_events")).toBe(3);

    const replay = store.reviewHeldDisposition(captured.event.event_id, "promote");
    expect(replay.status).toBe("replay");
    if (replay.status === "failed" || replay.extraction === undefined) {
      throw new Error("expected held promotion replay");
    }
    expect(replay.extraction.status).toBe("replay");
    if (replay.extraction.status !== "extracted" && replay.extraction.status !== "replay") {
      throw new Error("expected active review replay");
    }
    expect(replay.extraction.event.event_id).toBe(reviewed.extraction.event.event_id);
    expect(store.countRows("canonical_events")).toBe(3);

    const conflict = store.reviewHeldDisposition(captured.event.event_id, "reject");
    expect(conflict).toMatchObject({ status: "failed" });
    if (conflict.status === "failed") {
      expect(conflict.error).toContain("already reviewed as promote");
    }

    const db = new DatabaseSync(store.dbPath);
    expect(() =>
      db.prepare("UPDATE knowledge_dispositions SET disposition = 'reject'").run(),
    ).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM knowledge_dispositions").run()).toThrow(/append-only/);
    expect(() =>
      db.prepare("UPDATE knowledge_disposition_reviews SET review_decision = 'reject'").run(),
    ).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM knowledge_disposition_reviews").run()).toThrow(
      /append-only/,
    );
    db.close();
  });

  it("rejects a held disposition without creating active meaning", () => {
    const { store } = makeStore();
    const captured = store.captureHook(
      makeEnvelope({
        session_id: "session_held_reject",
        payload: { message: "Synthetic context without durable markers for rejection review." },
      }),
      { extract: true },
    );
    expect(captured.extraction?.status).toBe("extracted");
    expect(store.listHeldDispositions()).toHaveLength(1);

    const reviewed = store.reviewHeldDisposition(captured.event.event_id, "reject");
    expect(reviewed).toMatchObject({
      status: "reviewed",
      source_event_id: captured.event.event_id,
      decision: "reject",
    });
    expect(store.listHeldDispositions()).toEqual([]);
    expect(store.countRows("canonical_events")).toBe(2);
    expect(store.countRows("knowledge_disposition_reviews")).toBe(1);

    expect(store.reviewHeldDisposition(captured.event.event_id, "reject")).toMatchObject({
      status: "replay",
      decision: "reject",
    });
    const conflict = store.reviewHeldDisposition(captured.event.event_id, "promote");
    expect(conflict).toMatchObject({ status: "failed" });
    expect(store.countRows("canonical_events")).toBe(2);
  });

  it("repairs a reviewed promotion after materialization is interrupted", () => {
    const { store } = makeStore();
    const captured = store.captureHook(
      makeEnvelope({
        session_id: "session_held_retry",
        payload: { message: "Synthetic held candidate for retry without durable markers." },
      }),
      { extract: true },
    );
    const proposal = vi.spyOn(store, "proposeObservationDraft").mockImplementationOnce(() => {
      throw new Error("synthetic interruption");
    });

    const interrupted = store.reviewHeldDisposition(captured.event.event_id, "promote");
    expect(interrupted).toMatchObject({ status: "failed" });
    if (interrupted.status === "failed") {
      expect(interrupted.error).toContain("audit");
      expect(interrupted.error).toContain("retry promote-held");
    }
    expect(store.countRows("knowledge_disposition_reviews")).toBe(1);
    expect(store.countRows("canonical_events")).toBe(2);
    expect(store.listHeldDispositions()).toEqual([]);

    proposal.mockRestore();
    const repaired = store.reviewHeldDisposition(captured.event.event_id, "promote");
    expect(repaired.status).toBe("replay");
    if (repaired.status === "failed" || repaired.extraction === undefined) {
      throw new Error("expected repaired promotion");
    }
    expect(repaired.extraction.status).toBe("extracted");
    expect(store.countRows("canonical_events")).toBe(3);
  });

  it("appends a new disposition when policy_version changes and replays the same policy", () => {
    const { store } = makeStore();
    const captured = store.captureHook(
      makeEnvelope({
        session_id: "session_policy_history",
        payload: {
          message: "We decided to always use pnpm and never commit credentials in this monorepo.",
        },
      }),
    );
    const first = store.adjudicateFromEventId(captured.event.event_id);
    expect(first.status).toBe("promoted");
    if (first.status !== "promoted" && first.status !== "held" && first.status !== "replay") {
      throw new Error("expected first promote");
    }
    expect(first.policy_version).toBe(ADJUDICATION_POLICY_VERSION);
    expect(first.extraction?.status).toBe("extracted");
    const firstObservationId =
      first.extraction &&
      (first.extraction.status === "extracted" || first.extraction.status === "replay")
        ? first.extraction.event.event_id
        : undefined;
    expect(firstObservationId).toMatch(/^evt_/);

    const replay = store.adjudicateFromEventId(captured.event.event_id);
    expect(replay.status).toBe("replay");
    if (replay.status !== "replay") {
      throw new Error("expected current-policy replay");
    }
    expect(replay.policy_version).toBe(ADJUDICATION_POLICY_VERSION);
    if (replay.extraction !== undefined) {
      expect(replay.extraction.status).toBe("replay");
      if (replay.extraction.status === "extracted" || replay.extraction.status === "replay") {
        expect(replay.extraction.event.event_id).toBe(firstObservationId);
      }
    }
    expect(store.countRows("knowledge_dispositions")).toBe(1);

    // Force a second disposition under a synthetic later policy without changing current policy code.
    const second = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_test_v2",
      signalText: "thanks",
    });
    // thanks is noise-only → reject under rules, but still appends a new disposition row.
    expect(second.status).toBe("rejected");
    if (second.status !== "rejected") {
      throw new Error("expected adj_test_v2 reject");
    }
    expect(second.policy_version).toBe("adj_test_v2");
    expect(store.countRows("knowledge_dispositions")).toBe(2);

    const history = store.listDispositionHistory(captured.event.event_id);
    expect(history).toHaveLength(2);
    expect(history.map((row) => row.policy_version).sort()).toEqual(
      ["adj_test_v2", ADJUDICATION_POLICY_VERSION].sort(),
    );
    expect(history.every((row) => row.source_event_id === captured.event.event_id)).toBe(true);

    const secondReplay = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_test_v2",
      signalText: "thanks",
    });
    expect(secondReplay.status).toBe("replay");
    if (secondReplay.status !== "replay") {
      throw new Error("expected adj_test_v2 replay");
    }
    expect(secondReplay.policy_version).toBe("adj_test_v2");
    expect(store.countRows("knowledge_dispositions")).toBe(2);

    // Current-policy stats remain scoped to the active product policy.
    const counts = store.listDispositionCounts();
    expect(counts.policy_version).toBe(ADJUDICATION_POLICY_VERSION);
    expect(counts.promote + counts.hold + counts.reject).toBe(1);
  });

  it("refuses held review for a non-held disposition", () => {
    const { store } = makeStore();
    const captured = store.captureHook(
      makeEnvelope({
        session_id: "session_not_held",
        payload: { decision: "Use pnpm as the default synthetic installer." },
      }),
      { extract: true },
    );
    const reviewed = store.reviewHeldDisposition(captured.event.event_id, "promote");
    expect(reviewed).toMatchObject({ status: "failed" });
    if (reviewed.status === "failed") {
      expect(reviewed.error).toContain("expected hold");
    }
    expect(store.countRows("knowledge_disposition_reviews")).toBe(0);
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

function makeExternalEvent(eventId: string, trustZoneId: string): CanonicalEvent {
  return {
    schema_version: "v1",
    event_id: eventId,
    event_type: "EvidenceArtifact",
    subject_ref: "subject_synthetic",
    valid_time: { start: "2026-01-01T00:00:00Z", end: null },
    recorded_time: { start: "2026-01-01T00:00:00Z", end: null },
    lifecycle_status: "active",
    epistemic_authority: "observed",
    trust_zone: { trust_zone_id: trustZoneId, isolation: "user_cloud" },
    provenance: [
      { ref_type: "external", ref_id: "external_synthetic", relationship: "derived_from" },
    ],
    idempotency_key: `idem_${eventId.slice(4)}000000000000`,
    request_fingerprint: "sha-256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    zone_sequence: 3,
    payload: {
      artifact_id: `art_${eventId.slice(4)}0000`,
      kind: "message",
      media_type: "text/plain",
      content_ref: {
        ref_type: "external_uri",
        uri: `https://example.invalid/${eventId}`,
        digest: {
          algorithm: "sha-256",
          value: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
        visibility: "public",
        reachability: "online",
      },
    },
  };
}

function makeErasure(erasureId: string, trustZoneId: string): ErasureLedgerRecord {
  return {
    schema_version: "v1",
    erasure_id: erasureId,
    target_ref: {
      target_kind: "event",
      target_id: "evt_general_import_0001",
      reason: "synthetic erasure",
    },
    requested_at: "2026-01-01T00:00:00Z",
    completed_at: null,
    method: "tombstone",
    actor_ref: "actor_synthetic",
    trust_zone: { trust_zone_id: trustZoneId, isolation: "user_cloud" },
    evidence_refs: [{ ref_type: "external", ref_id: "external_erasure", relationship: "supports" }],
    zone_sequence: 4,
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
    uploaded_at: now.toISOString().replace(".000Z", "Z"),
    ...(intent.nonce_ref === undefined ? {} : { nonce_ref: intent.nonce_ref }),
    ...(intent.tag_ref === undefined ? {} : { tag_ref: intent.tag_ref }),
  };
}
