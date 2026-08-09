import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CaptureEnvelope } from "@carpeos/capture";
import { ADJUDICATION_POLICY_VERSION, hashHex, stableJson } from "@carpeos/capture";
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
import {
  buildPolicyReconciliationPlanV2,
  classifyPolicyReconciliationEntry,
  digestPolicyReconciliationPlanV2,
  type PolicyReconciliationPlanV2,
  partitionReconciliationComponents,
  policyReconciliationDigestPreimageV2,
} from "../src/policy-reconciliation.js";
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

    const lease = store.leaseOutbox(10, 30_000, now, { admission_policy: "full_log" });
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
    const lease = store.leaseOutbox(1, 1_000, now, { admission_policy: "full_log" });
    const outboxId = lease.items[0]?.outbox_id ?? -1;

    expect(outboxId).toBe(captured.outbox_id);
    expect(lease.items[0]?.attempts).toBe(1);
    expect(store.ackOutbox(outboxId, "lease_wrong", now)).toBe(false);
    expect(store.retryOutbox(outboxId, "lease_wrong", 1_000, "temporary", now)).toBe(false);
    expect(store.retryOutbox(outboxId, lease.lease_id, 2_000, "temporary", now)).toBe(true);
    expect(
      store.leaseOutbox(1, 1_000, new Date("2026-01-01T00:00:01Z"), {
        admission_policy: "full_log",
      }).items,
    ).toHaveLength(0);
    store.close();

    const reopened = new LocalCaptureStore({
      runtimeDir,
      dbPath,
      workspaceRoot: runtimeDir,
      keyProvider: new StaticKeyProvider(staticMaterial),
    });
    const requeued = reopened.leaseOutbox(1, 1_000, new Date("2026-01-01T00:00:02Z"), {
      admission_policy: "full_log",
    });
    expect(requeued.items).toHaveLength(1);
    expect(requeued.items[0]?.attempts).toBe(2);
    expect(reopened.ackOutbox(outboxId, requeued.lease_id, new Date("2026-01-01T00:00:03Z"))).toBe(
      true,
    );
    expect(reopened.outboxStatus()).toEqual({ pending: 0, leased: 0, delivered: 1 });
    reopened.close();
  });

  it("thin lease auto-skips EvidenceArtifact pending without leasing", () => {
    const now = new Date("2026-01-01T00:00:00Z");
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
    const lease = store.leaseOutbox(1, 1_000, now, {
      admission_policy: "remote_thin_promoted_v1",
    });
    expect(lease.items).toHaveLength(0);
    expect(lease.admission_skipped).toBeGreaterThanOrEqual(1);
    expect(store.outboxStatus().pending).toBe(0);
    store.close();
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
    store.leaseOutbox(1, 1_000, now, { admission_policy: "full_log" });
    store.close();

    const reopened = new LocalCaptureStore({
      runtimeDir,
      dbPath,
      workspaceRoot: runtimeDir,
      keyProvider: new StaticKeyProvider(staticMaterial),
    });
    const reclaimed = reopened.leaseOutbox(1, 1_000, new Date("2026-01-01T00:00:02Z"), {
      admission_policy: "full_log",
    });
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

  it("returns body-free held receipts and promotes one through an append-only review", () => {
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

    const held = store.listHeldDispositions(ADJUDICATION_POLICY_VERSION);
    expect(held).toMatchObject({ policy_version: ADJUDICATION_POLICY_VERSION, count: 1 });
    expect(held.held[0]).toMatchObject({
      source_event_id: captured.event.event_id,
      artifact_id: captured.event.payload.artifact_id,
      policy_version: ADJUDICATION_POLICY_VERSION,
    });
    expect(held.held[0]).not.toHaveProperty("statement");
    expect(JSON.stringify(held)).not.toContain(captured.extraction.event.payload.statement);

    const reviewed = store.reviewHeldDisposition(
      captured.event.event_id,
      "promote",
      ADJUDICATION_POLICY_VERSION,
    );
    expect(reviewed.status).toBe("reviewed");
    if (reviewed.status === "failed" || reviewed.observation === undefined) {
      throw new Error("expected held promotion");
    }
    expect(reviewed).toMatchObject({
      decision: "promote",
      policy_version: ADJUDICATION_POLICY_VERSION,
      count: 1,
      observation: { lifecycle_status: "active" },
    });
    expect(store.listHeldDispositions(ADJUDICATION_POLICY_VERSION)).toMatchObject({ count: 0 });
    expect(store.countRows("knowledge_disposition_reviews")).toBe(1);
    expect(store.countRows("canonical_events")).toBe(3);

    const replay = store.reviewHeldDisposition(
      captured.event.event_id,
      "promote",
      ADJUDICATION_POLICY_VERSION,
    );
    expect(replay.status).toBe("replay");
    if (replay.status === "failed" || replay.observation === undefined) {
      throw new Error("expected held promotion replay");
    }
    expect(replay.observation.event_id).toBe(reviewed.observation.event_id);
    expect(store.countRows("canonical_events")).toBe(3);

    const conflict = store.reviewHeldDisposition(
      captured.event.event_id,
      "reject",
      ADJUDICATION_POLICY_VERSION,
    );
    expect(conflict).toMatchObject({ status: "failed", count: 0 });
    if (conflict.status === "failed") {
      expect(conflict.error).toContain("already reviewed as promote");
    }
    expect(store.countRows("knowledge_disposition_reviews")).toBe(1);

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
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM canonical_events WHERE event_type = 'AcceptanceDecision'",
        )
        .get(),
    ).toMatchObject({ n: 0 });
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
    expect(store.listHeldDispositions(ADJUDICATION_POLICY_VERSION)).toMatchObject({ count: 1 });

    const reviewed = store.reviewHeldDisposition(
      captured.event.event_id,
      "reject",
      ADJUDICATION_POLICY_VERSION,
    );
    expect(reviewed).toMatchObject({
      status: "reviewed",
      source_event_id: captured.event.event_id,
      decision: "reject",
      policy_version: ADJUDICATION_POLICY_VERSION,
      count: 1,
    });
    expect(store.listHeldDispositions(ADJUDICATION_POLICY_VERSION)).toMatchObject({ count: 0 });
    expect(store.countRows("canonical_events")).toBe(2);
    expect(store.countRows("knowledge_disposition_reviews")).toBe(1);

    expect(
      store.reviewHeldDisposition(captured.event.event_id, "reject", ADJUDICATION_POLICY_VERSION),
    ).toMatchObject({ status: "replay", decision: "reject" });
    const conflict = store.reviewHeldDisposition(
      captured.event.event_id,
      "promote",
      ADJUDICATION_POLICY_VERSION,
    );
    expect(conflict).toMatchObject({ status: "failed", count: 0 });
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

    const interrupted = store.reviewHeldDisposition(
      captured.event.event_id,
      "promote",
      ADJUDICATION_POLICY_VERSION,
    );
    expect(interrupted).toMatchObject({ status: "failed" });
    if (interrupted.status === "failed") {
      expect(interrupted.error).toContain("audit");
      expect(interrupted.error).toContain("retry promote-held");
    }
    expect(store.countRows("knowledge_disposition_reviews")).toBe(1);
    expect(store.countRows("canonical_events")).toBe(2);
    expect(store.listHeldDispositions(ADJUDICATION_POLICY_VERSION)).toMatchObject({ count: 0 });

    proposal.mockRestore();
    const repaired = store.reviewHeldDisposition(
      captured.event.event_id,
      "promote",
      ADJUDICATION_POLICY_VERSION,
    );
    expect(repaired.status).toBe("replay");
    if (repaired.status === "failed" || repaired.observation === undefined) {
      throw new Error("expected repaired promotion");
    }
    expect(repaired.observation.lifecycle_status).toBe("active");
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
  it("isolates held review by exact policy version", () => {
    const { store } = makeStore();
    const captured = store.captureHook(
      makeEnvelope({
        session_id: "session_mixed_policy_held",
        payload: { message: "Synthetic held candidate for policy isolation." },
      }),
      { extract: true },
    );
    const second = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_test_v2",
    });
    expect(second).toMatchObject({ status: "held", policy_version: "adj_test_v2" });

    expect(store.listHeldDispositions(ADJUDICATION_POLICY_VERSION)).toMatchObject({
      policy_version: ADJUDICATION_POLICY_VERSION,
      count: 1,
    });
    expect(store.listHeldDispositions("adj_test_v2")).toMatchObject({
      policy_version: "adj_test_v2",
      count: 1,
    });

    const unknown = store.reviewHeldDisposition(
      captured.event.event_id,
      "promote",
      "adj_unknown_v9",
    );
    expect(unknown).toMatchObject({
      status: "failed",
      policy_version: "adj_unknown_v9",
      count: 0,
    });
    expect(store.countRows("knowledge_disposition_reviews")).toBe(0);

    const reviewed = store.reviewHeldDisposition(captured.event.event_id, "reject", "adj_test_v2");
    expect(reviewed).toMatchObject({
      status: "reviewed",
      decision: "reject",
      policy_version: "adj_test_v2",
      count: 1,
    });
    expect(store.listHeldDispositions("adj_test_v2")).toMatchObject({ count: 0 });
    expect(store.listHeldDispositions(ADJUDICATION_POLICY_VERSION)).toMatchObject({ count: 1 });
    expect(store.countRows("knowledge_disposition_reviews")).toBe(1);

    expect(() => store.listHeldDispositions("invalid policy")).toThrow(/policy version must match/);
    expect(
      store.reviewHeldDisposition(captured.event.event_id, "promote", "invalid policy"),
    ).toMatchObject({ status: "failed", count: 0 });
    expect(store.countRows("knowledge_disposition_reviews")).toBe(1);
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
    const reviewed = store.reviewHeldDisposition(
      captured.event.event_id,
      "promote",
      ADJUDICATION_POLICY_VERSION,
    );
    expect(reviewed).toMatchObject({ status: "failed" });
    if (reviewed.status === "failed") {
      expect(reviewed.error).toContain("expected hold");
    }
    expect(store.countRows("knowledge_disposition_reviews")).toBe(0);
  });
});
describe("policy reconciliation preview", () => {
  it("uses the exact all-zero plan-v2 digest", () => {
    const plan = buildPolicyReconciliationPlanV2({
      trust_zone_id: "tz_synthetic",
      from_policy: "adj_v1",
      to_policy: "adj_v3",
      limit: 100,
      total_candidate_count: 0,
      high_water: {
        canonical_local_sequence_max: 0,
        disposition_row_count: 0,
        review_row_count: 0,
        outbox_id_max: 0,
        supersession_event_count: 0,
      },
      candidates: [],
    });
    expect(plan.plan_digest).toBe(
      "sha256:131f346f95646f32abb1ee39b30df40970b75c15d2466ff96c353cbb204204e6",
    );
    expect(digestPolicyReconciliationPlanV2(plan)).toBe(plan.plan_digest);
  });
  it("pins every plan-v2 digest preimage field and normalization boundary", () => {
    const component = (hex: string) => `cmp:${hex.repeat(64)}`;
    const populated = {
      schema: "carpeos.policy-reconciliation-plan/v2" as const,
      trust_zone_id: "tz_synthetic",
      from_policy: "adj_v1",
      to_policy: "adj_v3",
      limit: 3,
      total_candidate_count: 3,
      classified_count: 3,
      truncated: false,
      high_water: {
        canonical_local_sequence_max: 11,
        disposition_row_count: 12,
        review_row_count: 13,
        outbox_id_max: 14,
        supersession_event_count: 15,
      },
      counts: {
        eligible_write_count: 1,
        eligible_noop_count: 1,
        unsafe_unchanged_count: 1,
        replace_count: 1,
        invalidate_count: 0,
        already_applied_count: 1,
        reason_code_counts: [
          { reason_code: "already_applied" as const, count: 1 },
          { reason_code: "missing_unsafe" as const, count: 1 },
          { reason_code: "replace" as const, count: 1 },
        ],
      },
      plan_admissible: false,
      global_taint_reason_codes: [
        "unproved_conformance_global_taint" as const,
        "unproved_zero_write_global_taint" as const,
      ],
      global_taint_component_ids: [component("a"), component("b")],
      global_taint_entry_ids: ["evt_source0001", "evt_source0002"],
      entries: [
        {
          source_event_id: "evt_source0001",
          target_event_id: "evt_target0001",
          replacement_event_id: "evt_replace001",
          bucket: "eligible_write" as const,
          action: "replace" as const,
          reason_code: "replace" as const,
          component_id: component("a"),
        },
        {
          source_event_id: "evt_source0002",
          target_event_id: "evt_target0002",
          replacement_event_id: null,
          bucket: "eligible_noop" as const,
          action: "already_applied" as const,
          reason_code: "already_applied" as const,
          component_id: component("b"),
        },
        {
          source_event_id: "evt_source0003",
          target_event_id: null,
          replacement_event_id: null,
          bucket: "unsafe_unchanged" as const,
          action: "none" as const,
          reason_code: "missing_unsafe" as const,
          component_id: component("c"),
        },
      ],
    };
    const plan = {
      ...populated,
      plan_digest: "sha256:3f25159769480ee4cce2740146b7c2e5faacf4edbdace5e6190ef0f2d50039f8",
    } satisfies PolicyReconciliationPlanV2;
    const golden = plan.plan_digest;
    expect(digestPolicyReconciliationPlanV2(plan)).toBe(golden);

    const required = <T>(value: T | undefined, label: string): T => {
      if (value === undefined) throw new Error(`missing required ${label}`);
      return value;
    };
    type Mutation = { field: string; mutate: (value: PolicyReconciliationPlanV2) => void };
    const validMutations: Mutation[] = [
      { field: "trust_zone_id", mutate: (v) => (v.trust_zone_id = "tz_other") },
      { field: "from_policy", mutate: (v) => (v.from_policy = "adj_v2") },
      { field: "to_policy", mutate: (v) => (v.to_policy = "adj_v4") },
      { field: "limit", mutate: (v) => (v.limit = 4) },
      {
        field: "high_water.canonical_local_sequence_max",
        mutate: (v) => (v.high_water.canonical_local_sequence_max = 16),
      },
      {
        field: "high_water.disposition_row_count",
        mutate: (v) => (v.high_water.disposition_row_count = 16),
      },
      {
        field: "high_water.review_row_count",
        mutate: (v) => (v.high_water.review_row_count = 16),
      },
      {
        field: "high_water.outbox_id_max",
        mutate: (v) => (v.high_water.outbox_id_max = 16),
      },
      {
        field: "high_water.supersession_event_count",
        mutate: (v) => (v.high_water.supersession_event_count = 16),
      },
      {
        field: "global_taint_reason_codes[0]",
        mutate: (v) => (v.global_taint_reason_codes[0] = "eligible_cross_zone_global_taint"),
      },
      {
        field: "global_taint_component_ids[0]",
        mutate: (v) => (v.global_taint_component_ids[0] = component("0")),
      },
      {
        field: "global_taint_entry_ids[0]",
        mutate: (v) => (v.global_taint_entry_ids[0] = "evt_00000000"),
      },
      {
        field: "entries[0].source_event_id",
        mutate: (v) => (required(v.entries[0], "entry").source_event_id = "evt_source0000"),
      },
      {
        field: "entries[0].target_event_id",
        mutate: (v) => (required(v.entries[0], "entry").target_event_id = "evt_target0009"),
      },
      {
        field: "entries[0].replacement_event_id",
        mutate: (v) => (required(v.entries[0], "entry").replacement_event_id = "evt_replace009"),
      },
      {
        field: "entries[0].component_id",
        mutate: (v) => (required(v.entries[0], "entry").component_id = component("0")),
      },
    ];
    for (const { field, mutate } of validMutations) {
      const changed = structuredClone(plan);
      mutate(changed);
      expect(digestPolicyReconciliationPlanV2(changed), field).not.toBe(golden);
    }

    const invalidMutations: Mutation[] = [
      {
        field: "schema",
        mutate: (v) => ((v as { schema: string }).schema = "carpeos.policy-reconciliation-plan/v3"),
      },
      { field: "total_candidate_count", mutate: (v) => (v.total_candidate_count = 4) },
      { field: "classified_count", mutate: (v) => (v.classified_count = 4) },
      { field: "truncated", mutate: (v) => (v.truncated = true) },
      {
        field: "counts.eligible_write_count",
        mutate: (v) => (v.counts.eligible_write_count = 2),
      },
      {
        field: "counts.eligible_noop_count",
        mutate: (v) => (v.counts.eligible_noop_count = 2),
      },
      {
        field: "counts.unsafe_unchanged_count",
        mutate: (v) => (v.counts.unsafe_unchanged_count = 2),
      },
      { field: "counts.replace_count", mutate: (v) => (v.counts.replace_count = 2) },
      { field: "counts.invalidate_count", mutate: (v) => (v.counts.invalidate_count = 1) },
      {
        field: "counts.already_applied_count",
        mutate: (v) => (v.counts.already_applied_count = 2),
      },
      {
        field: "counts.reason_code_counts[0].reason_code",
        mutate: (v) =>
          (required(v.counts.reason_code_counts[0], "reason count").reason_code = "invalidate"),
      },
      {
        field: "counts.reason_code_counts[0].count",
        mutate: (v) => (required(v.counts.reason_code_counts[0], "reason count").count = 2),
      },
      { field: "plan_admissible", mutate: (v) => (v.plan_admissible = true) },
      {
        field: "entries[0].bucket",
        mutate: (v) => (required(v.entries[0], "entry").bucket = "eligible_noop"),
      },
      {
        field: "entries[0].action",
        mutate: (v) => (required(v.entries[0], "entry").action = "invalidate"),
      },
      {
        field: "entries[0].reason_code",
        mutate: (v) => (required(v.entries[0], "entry").reason_code = "invalidate"),
      },
    ];
    for (const { field, mutate } of invalidMutations) {
      const changed = structuredClone(plan);
      mutate(changed);
      expect(() => digestPolicyReconciliationPlanV2(changed), field).toThrow();
    }

    expect(
      digestPolicyReconciliationPlanV2({ ...plan, plan_digest: `sha256:${"0".repeat(64)}` }),
    ).toBe(golden);
    const reorderedInput = {
      trust_zone_id: "tz_synthetic",
      from_policy: "adj_v1",
      to_policy: "adj_v3",
      limit: 3,
      total_candidate_count: 3,
      high_water: zeroHighWater(),
      candidates: [
        { source_event_id: "evt_source0003", unsafe_reason_code: "missing_unsafe" as const },
        {
          source_event_id: "evt_source0001",
          target_event_id: "evt_target0001",
          replacement_event_id: "evt_replace001",
          classification: "replace" as const,
        },
        {
          source_event_id: "evt_source0002",
          target_event_id: "evt_target0002",
          classification: "already_applied" as const,
        },
      ],
      global_taint_reason_codes: [
        "unproved_zero_write_global_taint",
        "unproved_conformance_global_taint",
      ] as const,
    };
    const normalized = buildPolicyReconciliationPlanV2(reorderedInput);
    const reverseNormalized = buildPolicyReconciliationPlanV2({
      ...reorderedInput,
      candidates: [...reorderedInput.candidates].reverse(),
      global_taint_reason_codes: [...reorderedInput.global_taint_reason_codes].reverse(),
    });
    expect(reverseNormalized).toEqual(normalized);
    expect(() =>
      digestPolicyReconciliationPlanV2({ ...plan, entries: [...plan.entries].reverse() }),
    ).toThrow("unsorted");
    expect(() =>
      digestPolicyReconciliationPlanV2({
        ...plan,
        counts: {
          ...plan.counts,
          reason_code_counts: [...plan.counts.reason_code_counts].reverse(),
        },
      }),
    ).toThrow("reason counts");
    expect(() =>
      digestPolicyReconciliationPlanV2({
        ...plan,
        global_taint_reason_codes: [...plan.global_taint_reason_codes].reverse(),
        global_taint_component_ids: [...plan.global_taint_component_ids].reverse(),
        global_taint_entry_ids: [...plan.global_taint_entry_ids].reverse(),
      }),
    ).toThrow("global taints");
  });

  it("does not write for an empty metadata-only preview", () => {
    const { store } = makeStore("tz_synthetic");
    const before = {
      protected: store.countRows("protected_values"),
      canonical: store.countRows("canonical_events"),
      outbox: store.countRows("outbox"),
      dispositions: store.countRows("knowledge_dispositions"),
      reviews: store.countRows("knowledge_disposition_reviews"),
    };
    const plan = store.previewPolicyReconciliation({
      from_policy: "adj_v1",
      to_policy: "adj_v3",
      trust_zone_id: "tz_synthetic",
      limit: 1,
    });
    expect(plan.entries).toEqual([]);
    expect({
      protected: store.countRows("protected_values"),
      canonical: store.countRows("canonical_events"),
      outbox: store.countRows("outbox"),
      dispositions: store.countRows("knowledge_dispositions"),
      reviews: store.countRows("knowledge_disposition_reviews"),
    }).toEqual(before);
  });
  it("covers all permitted pure-builder entry actions and bounded taint", () => {
    const plan = buildPolicyReconciliationPlanV2({
      trust_zone_id: "tz_synthetic",
      from_policy: "adj_v1",
      to_policy: "adj_v3",
      limit: 3,
      total_candidate_count: 4,
      high_water: {
        canonical_local_sequence_max: 0,
        disposition_row_count: 0,
        review_row_count: 0,
        outbox_id_max: 0,
        supersession_event_count: 0,
      },
      candidates: [
        {
          source_event_id: "evt_source0001",
          target_event_id: "evt_target0001",
          replacement_event_id: "evt_replace001",
          classification: "replace",
        },
        {
          source_event_id: "evt_source0002",
          target_event_id: "evt_target0002",
          classification: "invalidate",
        },
        {
          source_event_id: "evt_source0003",
          target_event_id: "evt_target0003",
          replacement_event_id: "evt_replace003",
          classification: "already_applied",
        },
        { source_event_id: "evt_source0004", unsafe_reason_code: "missing_unsafe" },
      ],
    });
    expect(plan.entries.map((entry) => entry.reason_code)).toEqual([
      "replace",
      "invalidate",
      "already_applied",
    ]);
    expect(plan.counts.eligible_write_count).toBe(2);
    expect(plan.counts.eligible_noop_count).toBe(1);
    expect(plan.counts.unsafe_unchanged_count).toBe(0);
    expect(plan.truncated).toBe(true);
    expect(plan.global_taint_reason_codes).toEqual(["incomplete_enumeration_global_taint"]);
    expect(plan.plan_admissible).toBe(false);
  });
  it("classifies all unsafe reasons without granting an action", () => {
    const reasons = [
      "shared_materialization_unsafe",
      "missing_unsafe",
      "ambiguous_unsafe",
      "imported_unsafe",
      "self_unsafe",
      "cycle_unsafe",
      "zone_unsafe",
      "lineage_unsafe",
      "conflicting_intent_unsafe",
    ] as const;
    for (const [index, reason] of reasons.entries()) {
      const source = `evt_unsafe${String(index).padStart(4, "0")}`;
      expect(
        classifyPolicyReconciliationEntry({
          source_event_id: source,
          ...(reason === "self_unsafe" ? { target_event_id: source } : {}),
          unsafe_reason_code: reason,
        }),
      ).toMatchObject({ bucket: "unsafe_unchanged", action: "none", reason_code: reason });
    }
    expect(() =>
      classifyPolicyReconciliationEntry({
        source_event_id: "evt_unsafe9999",
        target_event_id: "evt_unsafe9999",
        unsafe_reason_code: "missing_unsafe",
      }),
    ).toThrow("self relation");
  });

  it("sorts every global taint and reverse candidate prefix deterministically", () => {
    const taints = [
      "unproved_conformance_global_taint",
      "unproved_zero_write_global_taint",
      "nonunique_component_partition_global_taint",
      "unsafe_influences_eligible_global_taint",
      "eligible_subject_uncertainty_global_taint",
      "eligible_cross_zone_global_taint",
      "eligible_imported_shared_lineage_global_taint",
      "eligible_reachable_cycle_global_taint",
      "conflicting_eligible_intent_global_taint",
      "eligible_unsafe_overlap_global_taint",
      "unstable_snapshot_global_taint",
      "incomplete_enumeration_global_taint",
    ] as const;
    const plan = buildPolicyReconciliationPlanV2({
      trust_zone_id: "tz_synthetic",
      from_policy: "adj_v1",
      to_policy: "adj_v3",
      limit: 12,
      total_candidate_count: 12,
      high_water: zeroHighWater(),
      global_taint_reason_codes: taints,
      candidates: taints.map((_, index) => ({
        source_event_id: `evt_taint${String(11 - index).padStart(4, "0")}`,
        unsafe_reason_code: "missing_unsafe" as const,
      })),
    });
    expect(plan.global_taint_reason_codes).toEqual([...taints].sort());
    expect(plan.entries.map((entry) => entry.source_event_id)).toEqual(
      [...plan.entries.map((entry) => entry.source_event_id)].sort(),
    );
    expect(plan.plan_admissible).toBe(false);
  });
  it("rejects an already-applied replacement that aliases its source", () => {
    expect(() =>
      classifyPolicyReconciliationEntry({
        source_event_id: "evt_noop00001",
        target_event_id: "evt_target001",
        replacement_event_id: "evt_noop00001",
        classification: "already_applied",
      }),
    ).toThrow("self relation");
  });

  it("uses transitive, permutation-stable component partitions", () => {
    const entries = [
      classifyPolicyReconciliationEntry({
        source_event_id: "evt_graph0001",
        target_event_id: "evt_graph0002",
        classification: "invalidate",
      }),
      classifyPolicyReconciliationEntry({
        source_event_id: "evt_graph0003",
        target_event_id: "evt_graph0004",
        classification: "invalidate",
      }),
    ];
    const candidates = [
      {
        source_event_id: "evt_graph0001",
        lineage_event_ids: ["evt_graph0005"],
        supersession_relations: [["evt_graph0005", "evt_graph0003"]] as const,
      },
      { source_event_id: "evt_graph0003" },
    ];
    const forward = partitionReconciliationComponents(entries, candidates);
    const reverse = partitionReconciliationComponents(
      [...entries].reverse(),
      [...candidates].reverse(),
    );
    expect(forward[0]).toBe(forward[1]);
    expect(reverse[0]).toBe(forward[1]);
    expect(reverse[1]).toBe(forward[0]);
  });

  it("has an explicit zero preimage, excludes digest, and rejects invalid equations", () => {
    const zero = buildPolicyReconciliationPlanV2({
      trust_zone_id: "tz_synthetic",
      from_policy: "adj_v1",
      to_policy: "adj_v3",
      limit: 100,
      total_candidate_count: 0,
      high_water: zeroHighWater(),
      candidates: [],
    });
    const preimage = policyReconciliationDigestPreimageV2(zero);
    expect(Object.hasOwn(preimage, "plan_digest")).toBe(false);
    expect(JSON.stringify(preimage)).toBe(
      '{"schema":"carpeos.policy-reconciliation-plan/v2","trust_zone_id":"tz_synthetic","from_policy":"adj_v1","to_policy":"adj_v3","limit":100,"total_candidate_count":0,"classified_count":0,"truncated":false,"high_water":{"canonical_local_sequence_max":0,"disposition_row_count":0,"review_row_count":0,"outbox_id_max":0,"supersession_event_count":0},"counts":{"eligible_write_count":0,"eligible_noop_count":0,"unsafe_unchanged_count":0,"replace_count":0,"invalidate_count":0,"already_applied_count":0,"reason_code_counts":[]},"plan_admissible":true,"global_taint_reason_codes":[],"global_taint_component_ids":[],"global_taint_entry_ids":[],"entries":[]}',
    );
    expect(digestPolicyReconciliationPlanV2({ ...preimage, to_policy: "adj_v2" })).not.toBe(
      zero.plan_digest,
    );
    expect(() => policyReconciliationDigestPreimageV2({ ...zero, classified_count: 1 })).toThrow(
      "classified",
    );
    const uncheckedPreimage = policyReconciliationDigestPreimageV2 as unknown as (
      value: unknown,
    ) => unknown;
    expect(() => uncheckedPreimage({ ...zero, extra: true })).toThrow("keys");
  });
  it("opens an initialized preview read-only and fails closed without a database", () => {
    const { store, runtimeDir } = makeStore("tz_synthetic");
    const before = store.countRows("canonical_events");
    const preview = LocalCaptureStore.openExistingPreview({
      runtimeDir,
      workspaceRoot: runtimeDir,
      trustZoneId: "tz_synthetic",
    });
    expect(
      preview.previewPolicyReconciliation({
        from_policy: "adj_v1",
        to_policy: "adj_v3",
        trust_zone_id: "tz_synthetic",
        limit: 1,
      }).entries,
    ).toEqual([]);
    expect(store.countRows("canonical_events")).toBe(before);
    preview.close();
    expect(() =>
      LocalCaptureStore.openExistingPreview({
        runtimeDir: join(runtimeDir, "absent"),
        workspaceRoot: runtimeDir,
        trustZoneId: "tz_synthetic",
      }),
    ).toThrow("initialized preview store");
  });
  it("does not let a caller-provided token turn the normal constructor into a preview", () => {
    const { store, runtimeDir } = makeStore("tz_synthetic");
    const direct = new LocalCaptureStore(
      {
        runtimeDir,
        workspaceRoot: runtimeDir,
        trustZoneId: "tz_synthetic",
        keyProvider: new StaticKeyProvider(staticMaterial),
        clock: { now: () => now },
      },
      Symbol("caller preview token"),
    );
    expect(direct.countRows("canonical_events")).toBe(0);
    direct.close();
    store.close();
  });
  function reconciliationWriteCounts(store: LocalCaptureStore) {
    return {
      protected_values: store.countRows("protected_values"),
      canonical_events: store.countRows("canonical_events"),
      outbox: store.countRows("outbox"),
      knowledge_dispositions: store.countRows("knowledge_dispositions"),
      knowledge_disposition_reviews: store.countRows("knowledge_disposition_reviews"),
    };
  }
  it("derives a replacement only from two explicit policy materializations", () => {
    const { store } = makeStore("tz_synthetic");
    const captured = store.captureHook(
      makeEnvelope({
        payload: { decision: "Use the synthetic deterministic installer." },
      }),
    );
    const oldResult = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_old",
    });
    const newResult = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_new",
    });
    expect(oldResult.status).toBe("promoted");
    expect(newResult.status).toBe("promoted");
    const beforePreview = reconciliationWriteCounts(store);
    const plan = store.previewPolicyReconciliation({
      from_policy: "adj_old",
      to_policy: "adj_new",
      trust_zone_id: "tz_synthetic",
      limit: 10,
    });
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]).toMatchObject({
      bucket: "eligible_write",
      action: "replace",
      reason_code: "replace",
    });
    expect(JSON.stringify(plan)).not.toContain("synthetic deterministic installer");
    expect(reconciliationWriteCounts(store)).toEqual(beforePreview);
  });
  it("recognizes uniquely reviewed held materializations for both policy endpoints", () => {
    const { store } = makeStore("tz_synthetic");
    const captured = store.captureHook(
      makeEnvelope({
        payload: { message: "Synthetic context without durable markers for operator review." },
      }),
    );
    for (const policyVersion of ["adj_old", "adj_new"]) {
      expect(store.adjudicateFromEventId(captured.event.event_id, { policyVersion })).toMatchObject(
        {
          status: "held",
          policy_version: policyVersion,
        },
      );
      const reviewed = store.reviewHeldDisposition(
        captured.event.event_id,
        "promote",
        policyVersion,
      );
      expect(reviewed).toMatchObject({
        status: "reviewed",
        decision: "promote",
        observation: { lifecycle_status: "active" },
      });
    }
    const beforePreview = reconciliationWriteCounts(store);
    const plan = store.previewPolicyReconciliation({
      from_policy: "adj_old",
      to_policy: "adj_new",
      trust_zone_id: "tz_synthetic",
      limit: 10,
    });
    expect(plan.entries).toEqual([
      expect.objectContaining({
        bucket: "eligible_write",
        action: "replace",
        reason_code: "replace",
      }),
    ]);
    expect(reconciliationWriteCounts(store)).toEqual(beforePreview);
  });
  it("fails closed when held materialization authority is interrupted, absent, rejected, or conflicting", () => {
    const interrupted = makeStore("tz_synthetic").store;
    const interruptedSource = interrupted.captureHook(
      makeEnvelope({
        payload: { message: "Synthetic context without durable markers for operator review." },
      }),
    );
    expect(
      interrupted.adjudicateFromEventId(interruptedSource.event.event_id, {
        policyVersion: "adj_old",
      }),
    ).toMatchObject({ status: "held" });
    expect(
      interrupted.adjudicateFromEventId(interruptedSource.event.event_id, {
        policyVersion: "adj_new",
      }),
    ).toMatchObject({ status: "held" });
    const interruption = vi
      .spyOn(interrupted, "proposeObservationDraft")
      .mockImplementationOnce(() => {
        throw new Error("synthetic interrupted materialization");
      });
    expect(
      interrupted.reviewHeldDisposition(interruptedSource.event.event_id, "promote", "adj_old"),
    ).toMatchObject({ status: "failed" });
    interruption.mockRestore();
    expect(
      interrupted.reviewHeldDisposition(interruptedSource.event.event_id, "promote", "adj_new"),
    ).toMatchObject({ status: "reviewed" });
    expectHeldPreviewUnsafe(interrupted, interruptedSource.event.event_id, "missing_unsafe");

    const absent = makeStore("tz_synthetic").store;
    const absentSource = absent.captureHook(
      makeEnvelope({ payload: { message: "Synthetic unreviewed held authority." } }),
      { extract: false },
    );
    const seed = absent.captureHook(
      makeEnvelope({
        session_id: "session_held_seed",
        payload: { decision: "Use synthetic seed." },
      }),
    );
    const seedObservation = extractedObservation(
      absent.adjudicateFromEventId(seed.event.event_id, { policyVersion: "adj_seed" }),
    );
    appendHeldDisposition(absent, absentSource, "adj_old");
    appendHeldDisposition(absent, absentSource, "adj_new");
    appendSyntheticPolicyObservation(absent, seedObservation, absentSource, "adj_old", "held");
    appendHeldReview(absent, absentSource.event.event_id, "adj_new", "promote");
    appendSyntheticPolicyObservation(absent, seedObservation, absentSource, "adj_new", "held");
    expectHeldPreviewUnsafe(absent, absentSource.event.event_id, "ambiguous_unsafe");

    const rejected = makeStore("tz_synthetic").store;
    const rejectedSource = rejected.captureHook(
      makeEnvelope({
        payload: { message: "Synthetic context without durable markers for operator review." },
      }),
    );
    for (const policyVersion of ["adj_old", "adj_new"]) {
      expect(
        rejected.adjudicateFromEventId(rejectedSource.event.event_id, { policyVersion }),
      ).toMatchObject({ status: "held" });
    }
    expect(
      rejected.reviewHeldDisposition(rejectedSource.event.event_id, "reject", "adj_old"),
    ).toMatchObject({ status: "reviewed", decision: "reject" });
    expect(
      rejected.reviewHeldDisposition(rejectedSource.event.event_id, "promote", "adj_new"),
    ).toMatchObject({ status: "reviewed", decision: "promote" });
    expectHeldPreviewUnsafe(rejected, rejectedSource.event.event_id, "missing_unsafe");

    const conflicting = makeStore("tz_synthetic").store;
    const conflictingSource = conflicting.captureHook(
      makeEnvelope({ payload: { message: "Synthetic conflicting held authority." } }),
      { extract: false },
    );
    const conflictingSeed = conflicting.captureHook(
      makeEnvelope({
        session_id: "session_conflict_seed",
        payload: { decision: "Use synthetic seed." },
      }),
    );
    const conflictingBase = extractedObservation(
      conflicting.adjudicateFromEventId(conflictingSeed.event.event_id, {
        policyVersion: "adj_seed",
      }),
    );
    for (const policyVersion of ["adj_old", "adj_new"]) {
      appendHeldDisposition(conflicting, conflictingSource, policyVersion);
      appendHeldReview(conflicting, conflictingSource.event.event_id, policyVersion, "promote");
      appendSyntheticPolicyObservation(
        conflicting,
        conflictingBase,
        conflictingSource,
        policyVersion,
        "held",
      );
    }
    appendSyntheticPolicyObservation(
      conflicting,
      conflictingBase,
      conflictingSource,
      "adj_old",
      "policy",
    );
    expectHeldPreviewUnsafe(conflicting, conflictingSource.event.event_id, "ambiguous_unsafe");
  });
  it("keeps reject dispositions with matching ordinary policy keys unsafe", () => {
    const { store } = makeStore("tz_synthetic");
    const source = store.captureHook(
      makeEnvelope({ payload: { message: "Synthetic ordinary-key reject authority." } }),
      { extract: false },
    );
    const seed = store.captureHook(
      makeEnvelope({
        session_id: "session_reject_seed",
        payload: { decision: "Use synthetic seed." },
      }),
    );
    const base = extractedObservation(
      store.adjudicateFromEventId(seed.event.event_id, { policyVersion: "adj_seed" }),
    );
    for (const policyVersion of ["adj_old", "adj_new"]) {
      appendDisposition(store, source, policyVersion, "reject");
      appendSyntheticPolicyObservation(store, base, source, policyVersion, "policy");
    }
    expectHeldPreviewUnsafe(store, source.event.event_id, "ambiguous_unsafe");
  });
  it("keeps unreviewed holds with ordinary policy keys unsafe", () => {
    const { store } = makeStore("tz_synthetic");
    const source = store.captureHook(
      makeEnvelope({ payload: { message: "Synthetic unreviewed ordinary-key authority." } }),
      { extract: false },
    );
    const seed = store.captureHook(
      makeEnvelope({
        session_id: "session_unreviewed_seed",
        payload: { decision: "Use synthetic seed." },
      }),
    );
    const base = extractedObservation(
      store.adjudicateFromEventId(seed.event.event_id, { policyVersion: "adj_seed" }),
    );
    for (const policyVersion of ["adj_old", "adj_new"]) {
      appendHeldDisposition(store, source, policyVersion);
      appendSyntheticPolicyObservation(store, base, source, policyVersion, "policy");
    }
    expectHeldPreviewUnsafe(store, source.event.event_id, "ambiguous_unsafe");
  });
  it("keeps reviewed holds with ordinary-only or extra ordinary materializations unsafe", () => {
    for (const extra of [false, true]) {
      const { store } = makeStore("tz_synthetic");
      const source = store.captureHook(
        makeEnvelope({
          session_id: `session_reviewed_ordinary_${extra}`,
          payload: { message: "Synthetic reviewed ordinary-key authority." },
        }),
        { extract: false },
      );
      const seed = store.captureHook(
        makeEnvelope({
          session_id: `session_reviewed_seed_${extra}`,
          payload: { decision: "Use synthetic seed." },
        }),
      );
      const base = extractedObservation(
        store.adjudicateFromEventId(seed.event.event_id, { policyVersion: "adj_seed" }),
      );
      for (const policyVersion of ["adj_old", "adj_new"]) {
        appendHeldDisposition(store, source, policyVersion);
        appendHeldReview(store, source.event.event_id, policyVersion, "promote");
        appendSyntheticPolicyObservation(store, base, source, policyVersion, "policy");
        if (extra) {
          appendSyntheticPolicyObservation(store, base, source, policyVersion, "held");
        }
      }
      expectHeldPreviewUnsafe(store, source.event.event_id, "ambiguous_unsafe");
    }
  });
  it("keeps adj_v3 materialization distinct from discoverable shipped adj_v2 targets", () => {
    const { store } = makeStore("tz_synthetic");
    const captured = store.captureHook(
      makeEnvelope({ payload: { decision: "Use the synthetic deterministic installer." } }),
    );
    const v2 = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_v2",
    });
    const v3 = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_v3",
    });
    expect(v2.status).toBe("promoted");
    expect(v3.status).toBe("promoted");
    const plan = store.previewPolicyReconciliation({
      from_policy: "adj_v2",
      to_policy: "adj_v3",
      trust_zone_id: "tz_synthetic",
      limit: 1,
    });
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]).toMatchObject({ action: "replace", reason_code: "replace" });
    expect(plan.entries[0]?.target_event_id).not.toBe(plan.entries[0]?.replacement_event_id);
  });

  it("emits invalidation from an explicit later rejected disposition without writes", () => {
    const { store } = makeStore("tz_synthetic");
    const captured = store.captureHook(
      makeEnvelope({
        payload: { decision: "Use the synthetic invalidation procedure." },
      }),
    );
    const older = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_old",
    });
    const later = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_new",
      signalText: "thanks",
    });
    expect(older.status).toBe("promoted");
    expect(later.status).toBe("rejected");
    const beforePreview = reconciliationWriteCounts(store);
    const plan = store.previewPolicyReconciliation({
      from_policy: "adj_old",
      to_policy: "adj_new",
      trust_zone_id: "tz_synthetic",
      limit: 10,
    });
    expect(plan.entries).toEqual([
      expect.objectContaining({
        bucket: "eligible_write",
        action: "invalidate",
        reason_code: "invalidate",
        target_event_id: expect.stringMatching(/^evt_/),
        replacement_event_id: null,
      }),
    ]);
    expect(plan.counts).toMatchObject({
      eligible_write_count: 1,
      eligible_noop_count: 0,
      unsafe_unchanged_count: 0,
      replace_count: 0,
      invalidate_count: 1,
      already_applied_count: 0,
      reason_code_counts: [{ reason_code: "invalidate", count: 1 }],
    });
    expect(plan.global_taint_reason_codes).toEqual([]);
    expect(plan.plan_admissible).toBe(true);
    expect(JSON.stringify(plan)).not.toContain("synthetic invalidation procedure");
    expect(reconciliationWriteCounts(store)).toEqual(beforePreview);
  });
  it("taints malformed canonical Supersession rows without reading or writing them", () => {
    const { store } = makeStore("tz_synthetic");
    const captured = store.captureHook(
      makeEnvelope({ payload: { decision: "CORRUPT SUPERSESSION BODY SENTINEL" } }),
    );
    const db = new DatabaseSync(store.dbPath);
    try {
      db.prepare(
        `INSERT INTO canonical_events (
          event_id, event_type, trust_zone_id, idempotency_key,
          request_fingerprint, protected_value_id, event_json, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "evt_corrupt0001",
        "Supersession",
        "tz_synthetic",
        "idem_corrupt0001",
        "sha256:corrupt",
        captured.protected_value_id,
        "{not canonical json",
        "2026-01-01T00:00:00Z",
      );
    } finally {
      db.close();
    }
    const beforePreview = reconciliationWriteCounts(store);
    const plan = store.previewPolicyReconciliation({
      from_policy: "adj_old",
      to_policy: "adj_new",
      trust_zone_id: "tz_synthetic",
      limit: 1,
    });
    expect(plan.global_taint_reason_codes).toEqual(["unproved_conformance_global_taint"]);
    expect(plan.plan_admissible).toBe(false);
    expect(plan.global_taint_component_ids).toEqual([]);
    expect(plan.global_taint_entry_ids).toEqual([]);
    expect(JSON.stringify(plan)).not.toContain("CORRUPT SUPERSESSION BODY SENTINEL");
    expect(reconciliationWriteCounts(store)).toEqual(beforePreview);
  });
  it("uses a conformant local Supersession as an existing noop relation", () => {
    const { store } = makeStore("tz_synthetic");
    const captured = store.captureHook(
      makeEnvelope({ payload: { decision: "Use the synthetic deterministic installer." } }),
    );
    const oldResult = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_old",
    });
    const newResult = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_new",
    });
    expect(oldResult.status).toBe("promoted");
    expect(newResult.status).toBe("promoted");
    const oldObservation = extractedObservation(oldResult);
    const newObservation = extractedObservation(newResult);
    insertSyntheticSupersession(store, oldObservation, {
      event_id: "evt_nooprelation01",
      target_event_id: oldObservation.event_id,
      replacement_event_id: newObservation.event_id,
      trust_zone_id: "tz_synthetic",
    });
    const beforePreview = reconciliationWriteCounts(store);
    const plan = store.previewPolicyReconciliation({
      from_policy: "adj_old",
      to_policy: "adj_new",
      trust_zone_id: "tz_synthetic",
      limit: 10,
    });
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]).toMatchObject({
      bucket: "eligible_noop",
      action: "already_applied",
      reason_code: "already_applied",
      target_event_id: oldObservation.event_id,
      replacement_event_id: newObservation.event_id,
    });
    expect(plan.global_taint_reason_codes).toEqual([]);
    expect(reconciliationWriteCounts(store)).toEqual(beforePreview);
  });

  it("taints a replace relation whose persisted zone disagrees with its canonical body", () => {
    const { store } = makeStore("tz_synthetic");
    const captured = store.captureHook(
      makeEnvelope({ payload: { decision: "Use the synthetic deterministic installer." } }),
    );
    const oldResult = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_old",
    });
    const newResult = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_new",
    });
    expect(oldResult.status).toBe("promoted");
    expect(newResult.status).toBe("promoted");
    const oldObservation = extractedObservation(oldResult);
    const newObservation = extractedObservation(newResult);
    insertSyntheticSupersession(store, oldObservation, {
      event_id: "evt_rowzoneplace",
      target_event_id: oldObservation.event_id,
      replacement_event_id: newObservation.event_id,
      trust_zone_id: "tz_synthetic",
      row_trust_zone_id: "tz_other_zone",
    });
    const beforePreview = reconciliationWriteCounts(store);
    const plan = store.previewPolicyReconciliation({
      from_policy: "adj_old",
      to_policy: "adj_new",
      trust_zone_id: "tz_synthetic",
      limit: 10,
    });
    expect(plan.entries[0]).toMatchObject({ action: "replace", reason_code: "replace" });
    expect(plan.global_taint_reason_codes).toEqual(["unproved_conformance_global_taint"]);
    expect(plan.plan_admissible).toBe(false);
    expect(plan.global_taint_component_ids).toEqual([plan.entries[0]?.component_id]);
    expect(plan.global_taint_entry_ids).toEqual([captured.event.event_id]);
    expect(reconciliationWriteCounts(store)).toEqual(beforePreview);
  });
  it("taints an invalidate relation whose persisted zone disagrees with its canonical body", () => {
    const { store } = makeStore("tz_synthetic");
    const captured = store.captureHook(
      makeEnvelope({ payload: { decision: "Use the synthetic deterministic installer." } }),
    );
    const oldResult = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_old",
    });
    expect(oldResult.status).toBe("promoted");
    const rejected = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_new",
      signalText: "thanks",
    });
    const oldObservation = extractedObservation(oldResult);
    expect(rejected.status).toBe("rejected");
    insertSyntheticSupersession(store, oldObservation, {
      event_id: "evt_rowzoneinval",
      target_event_id: oldObservation.event_id,
      replacement_event_id: null,
      trust_zone_id: "tz_synthetic",
      row_trust_zone_id: "tz_other_zone",
    });
    const beforePreview = reconciliationWriteCounts(store);
    const plan = store.previewPolicyReconciliation({
      from_policy: "adj_old",
      to_policy: "adj_new",
      trust_zone_id: "tz_synthetic",
      limit: 10,
    });
    expect(plan.entries[0]).toMatchObject({ action: "invalidate", reason_code: "invalidate" });
    expect(plan.global_taint_reason_codes).toEqual(["unproved_conformance_global_taint"]);
    expect(plan.plan_admissible).toBe(false);
    expect(plan.global_taint_component_ids).toEqual([plan.entries[0]?.component_id]);
    expect(plan.global_taint_entry_ids).toEqual([captured.event.event_id]);
    expect(reconciliationWriteCounts(store)).toEqual(beforePreview);
  });
  it("keeps an imported matching Supersession unsafe with causal arrays", () => {
    const { store } = makeStore("tz_synthetic");
    const captured = store.captureHook(
      makeEnvelope({ payload: { decision: "Use the synthetic deterministic installer." } }),
    );
    const oldResult = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_old",
    });
    const newResult = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_new",
    });
    expect(oldResult.status).toBe("promoted");
    expect(newResult.status).toBe("promoted");
    const oldObservation = extractedObservation(oldResult);
    const newObservation = extractedObservation(newResult);
    store.importPulledEvent(
      syntheticSupersession(oldObservation, {
        event_id: "evt_importrelation",
        target_event_id: oldObservation.event_id,
        replacement_event_id: newObservation.event_id,
        trust_zone_id: "tz_synthetic",
      }),
    );
    const plan = store.previewPolicyReconciliation({
      from_policy: "adj_old",
      to_policy: "adj_new",
      trust_zone_id: "tz_synthetic",
      limit: 10,
    });
    expect(plan.entries[0]).toMatchObject({
      bucket: "unsafe_unchanged",
      reason_code: "imported_unsafe",
    });
    expect(plan.global_taint_reason_codes).toEqual([]);
    expect(plan.global_taint_component_ids).toEqual([]);
    expect(plan.global_taint_entry_ids).toEqual([]);
  });
  it("uses the shipped adj_v1 extract identity only as historical materialization evidence", () => {
    const { store } = makeStore("tz_synthetic");
    const captured = store.captureHook(
      makeEnvelope({ payload: { decision: "Use the synthetic historical policy procedure." } }),
    );
    expect(
      store.adjudicateFromEventId(captured.event.event_id, { policyVersion: "adj_v1" }).status,
    ).toBe("promoted");
    expect(
      store.adjudicateFromEventId(captured.event.event_id, { policyVersion: "adj_v3" }).status,
    ).toBe("promoted");
    const plan = store.previewPolicyReconciliation({
      from_policy: "adj_v1",
      to_policy: "adj_v3",
      trust_zone_id: "tz_synthetic",
      limit: 10,
    });
    expect(plan.entries).toEqual([
      expect.objectContaining({ action: "replace", reason_code: "replace" }),
    ]);
  });
  it("fails closed when malformed inbox evidence collides with a materialization", () => {
    const { store } = makeStore("tz_synthetic");
    const captured = store.captureHook(
      makeEnvelope({ payload: { decision: "Use the synthetic deterministic installer." } }),
    );
    const oldResult = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_old",
    });
    expect(
      store.adjudicateFromEventId(captured.event.event_id, { policyVersion: "adj_new" }).status,
    ).toBe("promoted");
    appendMalformedInboxRow(
      store,
      extractedObservation(oldResult).event_id,
      captured.protected_value_id,
    );
    const plan = store.previewPolicyReconciliation({
      from_policy: "adj_old",
      to_policy: "adj_new",
      trust_zone_id: "tz_synthetic",
      limit: 10,
    });
    expect(plan.entries).toEqual([
      expect.objectContaining({ action: "none", reason_code: "imported_unsafe" }),
    ]);
  });
  it("keeps a conformant source duplicated into the inbox imported and unsafe", () => {
    const { store } = makeStore("tz_synthetic");
    const captured = store.captureHook(
      makeEnvelope({ payload: { decision: "Use the synthetic imported-source procedure." } }),
    );
    expect(
      store.adjudicateFromEventId(captured.event.event_id, {
        policyVersion: "adj_old",
      }).status,
    ).toBe("promoted");
    expect(
      store.adjudicateFromEventId(captured.event.event_id, {
        policyVersion: "adj_new",
      }).status,
    ).toBe("promoted");
    appendInboxCopy(store, captured.event, captured.protected_value_id);
    const beforePreview = reconciliationWriteCounts(store);
    const plan = store.previewPolicyReconciliation({
      from_policy: "adj_old",
      to_policy: "adj_new",
      trust_zone_id: "tz_synthetic",
      limit: 10,
    });
    expect(plan.entries).toEqual([
      expect.objectContaining({
        source_event_id: captured.event.event_id,
        bucket: "unsafe_unchanged",
        action: "none",
        reason_code: "imported_unsafe",
      }),
    ]);
    expect(reconciliationWriteCounts(store)).toEqual(beforePreview);
  });
  it("keeps an inbox-duplicated exact from-policy materialization imported and unsafe", () => {
    const { store } = makeStore("tz_synthetic");
    const captured = store.captureHook(
      makeEnvelope({ payload: { decision: "Use the synthetic imported-old procedure." } }),
    );
    const oldResult = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_old",
    });
    const newResult = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_new",
    });
    const oldObservation = extractedObservation(oldResult);
    const newObservation = extractedObservation(newResult);
    appendInboxCopy(store, oldObservation, captured.protected_value_id);
    const beforePreview = reconciliationWriteCounts(store);
    const plan = store.previewPolicyReconciliation({
      from_policy: "adj_old",
      to_policy: "adj_new",
      trust_zone_id: "tz_synthetic",
      limit: 10,
    });
    expect(plan.entries).toEqual([
      expect.objectContaining({
        source_event_id: captured.event.event_id,
        bucket: "unsafe_unchanged",
        action: "none",
        reason_code: "imported_unsafe",
        target_event_id: oldObservation.event_id,
        replacement_event_id: null,
      }),
    ]);
    expect(plan.entries[0]?.target_event_id).not.toBe(newObservation.event_id);
    expect(plan.global_taint_reason_codes).toEqual([]);
    expect(plan.global_taint_component_ids).toEqual([]);
    expect(plan.global_taint_entry_ids).toEqual([]);
    expect(plan.plan_admissible).toBe(true);
    expect(reconciliationWriteCounts(store)).toEqual(beforePreview);
  });
  it("keeps an inbox-duplicated exact to-policy materialization imported and unsafe", () => {
    const { store } = makeStore("tz_synthetic");
    const captured = store.captureHook(
      makeEnvelope({ payload: { decision: "Use the synthetic imported-new procedure." } }),
    );
    const oldResult = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_old",
    });
    const newResult = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_new",
    });
    const oldObservation = extractedObservation(oldResult);
    const newObservation = extractedObservation(newResult);
    appendInboxCopy(store, newObservation, captured.protected_value_id);
    const beforePreview = reconciliationWriteCounts(store);
    const plan = store.previewPolicyReconciliation({
      from_policy: "adj_old",
      to_policy: "adj_new",
      trust_zone_id: "tz_synthetic",
      limit: 10,
    });
    expect(plan.entries).toEqual([
      expect.objectContaining({
        source_event_id: captured.event.event_id,
        bucket: "unsafe_unchanged",
        action: "none",
        reason_code: "imported_unsafe",
        target_event_id: null,
        replacement_event_id: newObservation.event_id,
      }),
    ]);
    expect(plan.entries[0]?.replacement_event_id).not.toBe(oldObservation.event_id);
    expect(plan.global_taint_reason_codes).toEqual([]);
    expect(plan.global_taint_component_ids).toEqual([]);
    expect(plan.global_taint_entry_ids).toEqual([]);
    expect(plan.plan_admissible).toBe(true);
    expect(reconciliationWriteCounts(store)).toEqual(beforePreview);
  });
  it("marks a cross-zone existing relation unsafe without applying it", () => {
    const { store } = makeStore("tz_synthetic");
    const captured = store.captureHook(
      makeEnvelope({ payload: { decision: "Use the synthetic deterministic installer." } }),
    );
    const oldResult = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_old",
    });
    const newResult = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_new",
    });
    expect(oldResult.status).toBe("promoted");
    expect(newResult.status).toBe("promoted");
    const oldObservation = extractedObservation(oldResult);
    const newObservation = extractedObservation(newResult);
    insertSyntheticSupersession(store, oldObservation, {
      event_id: "evt_crosszonerel",
      target_event_id: oldObservation.event_id,
      replacement_event_id: newObservation.event_id,
      trust_zone_id: "tz_other_zone",
    });
    const plan = store.previewPolicyReconciliation({
      from_policy: "adj_old",
      to_policy: "adj_new",
      trust_zone_id: "tz_synthetic",
      limit: 10,
    });
    expect(plan.entries[0]).toMatchObject({
      bucket: "unsafe_unchanged",
      reason_code: "zone_unsafe",
    });
    expect(plan.global_taint_reason_codes).toEqual([]);
  });
  it("marks a conflicting existing target intent unsafe", () => {
    const { store } = makeStore("tz_synthetic");
    const captured = store.captureHook(
      makeEnvelope({ payload: { decision: "Use the synthetic deterministic installer." } }),
    );
    const oldResult = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_old",
    });
    const newResult = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_new",
    });
    expect(oldResult.status).toBe("promoted");
    expect(newResult.status).toBe("promoted");
    const oldObservation = extractedObservation(oldResult);
    const newObservation = extractedObservation(newResult);
    insertSyntheticSupersession(store, oldObservation, {
      event_id: "evt_conflictrel01",
      target_event_id: oldObservation.event_id,
      replacement_event_id: "evt_conflictrepl",
      trust_zone_id: "tz_synthetic",
    });
    const plan = store.previewPolicyReconciliation({
      from_policy: "adj_old",
      to_policy: "adj_new",
      trust_zone_id: "tz_synthetic",
      limit: 10,
    });
    expect(plan.entries[0]).toMatchObject({
      bucket: "unsafe_unchanged",
      reason_code: "conflicting_intent_unsafe",
    });
    expect(plan.global_taint_reason_codes).toEqual([]);
    expect(newObservation.event_id).toMatch(/^evt_/);
  });
  it("connects an unsafe missing to-policy candidate through validated graph facts", () => {
    const { store } = makeStore("tz_synthetic");
    const eligible = store.captureHook(
      makeEnvelope({
        session_id: "session_eligible",
        source_event_id: "source_eligible",
        payload: { decision: "Use the synthetic deterministic installer." },
      }),
    );
    const unsafe = store.captureHook(
      makeEnvelope({
        session_id: "session_unsafe",
        source_event_id: "source_unsafe",
        payload: { decision: "Use the synthetic deterministic installer." },
      }),
    );
    const eligibleOld = store.adjudicateFromEventId(eligible.event.event_id, {
      policyVersion: "adj_old",
    });
    const eligibleNew = store.adjudicateFromEventId(eligible.event.event_id, {
      policyVersion: "adj_new",
    });
    const unsafeOld = store.adjudicateFromEventId(unsafe.event.event_id, {
      policyVersion: "adj_old",
    });
    expect(eligibleOld.status).toBe("promoted");
    expect(eligibleNew.status).toBe("promoted");
    expect(unsafeOld.status).toBe("promoted");
    const eligibleReplacement = extractedObservation(eligibleNew);
    const unsafeTarget = extractedObservation(unsafeOld);
    insertSyntheticSupersession(store, eligibleReplacement, {
      event_id: "evt_connectfacts",
      target_event_id: eligibleReplacement.event_id,
      replacement_event_id: unsafeTarget.event_id,
      trust_zone_id: "tz_synthetic",
    });
    const beforePreview = reconciliationWriteCounts(store);
    const plan = store.previewPolicyReconciliation({
      from_policy: "adj_old",
      to_policy: "adj_new",
      trust_zone_id: "tz_synthetic",
      limit: 10,
    });
    const eligibleEntry = plan.entries.find(
      (entry) => entry.source_event_id === eligible.event.event_id,
    );
    const unsafeEntry = plan.entries.find(
      (entry) => entry.source_event_id === unsafe.event.event_id,
    );
    expect(eligibleEntry).toMatchObject({ action: "replace", reason_code: "replace" });
    expect(unsafeEntry).toMatchObject({ reason_code: "missing_unsafe" });
    expect(unsafeEntry?.component_id).toBe(eligibleEntry?.component_id);
    expect(plan.global_taint_reason_codes).toEqual([
      "eligible_unsafe_overlap_global_taint",
      "unsafe_influences_eligible_global_taint",
    ]);
    expect(plan.global_taint_component_ids).toEqual([eligibleEntry?.component_id]);
    expect(plan.global_taint_entry_ids).toEqual(
      [eligible.event.event_id, unsafe.event.event_id].sort(),
    );
    expect(reconciliationWriteCounts(store)).toEqual(beforePreview);
  });
  it("emits exact causal arrays for lineage-connected eligible and unsafe entries", () => {
    const plan = buildPolicyReconciliationPlanV2({
      trust_zone_id: "tz_synthetic",
      from_policy: "adj_v1",
      to_policy: "adj_v3",
      limit: 2,
      total_candidate_count: 2,
      high_water: zeroHighWater(),
      candidates: [
        {
          source_event_id: "evt_overlap0001",
          target_event_id: "evt_sharedtarget",
          replacement_event_id: "evt_replacement",
          classification: "replace",
        },
        {
          source_event_id: "evt_overlap0002",
          target_event_id: "evt_sharedtarget",
          unsafe_reason_code: "lineage_unsafe",
        },
      ],
    });
    expect(plan.entries[0]?.component_id).toBe(plan.entries[1]?.component_id);
    expect(plan.global_taint_reason_codes).toEqual([
      "eligible_unsafe_overlap_global_taint",
      "unsafe_influences_eligible_global_taint",
    ]);
    expect(plan.global_taint_component_ids).toEqual([plan.entries[0]?.component_id]);
    expect(plan.global_taint_entry_ids).toEqual(["evt_overlap0001", "evt_overlap0002"]);
  });
  it("derives imported and zone taints only for unsafe facts connected to eligibility", () => {
    const plan = buildPolicyReconciliationPlanV2({
      trust_zone_id: "tz_synthetic",
      from_policy: "adj_v1",
      to_policy: "adj_v3",
      limit: 3,
      total_candidate_count: 3,
      high_water: zeroHighWater(),
      candidates: [
        {
          source_event_id: "evt_taintlink01",
          target_event_id: "evt_tainttarget",
          replacement_event_id: "evt_taintreplace",
          classification: "replace",
        },
        {
          source_event_id: "evt_taintlink02",
          target_event_id: "evt_tainttarget",
          unsafe_reason_code: "imported_unsafe",
        },
        {
          source_event_id: "evt_taintlink03",
          target_event_id: "evt_tainttarget",
          unsafe_reason_code: "zone_unsafe",
        },
      ],
    });
    expect(plan.global_taint_reason_codes).toEqual([
      "eligible_cross_zone_global_taint",
      "eligible_imported_shared_lineage_global_taint",
      "eligible_unsafe_overlap_global_taint",
      "unsafe_influences_eligible_global_taint",
    ]);
    expect(plan.global_taint_component_ids).toEqual([plan.entries[0]?.component_id]);
    expect(plan.global_taint_entry_ids).toEqual([
      "evt_taintlink01",
      "evt_taintlink02",
      "evt_taintlink03",
    ]);
  });
  it("detects a transitive existing Supersession cycle without globally tainting an unsafe-only entry", () => {
    const { store } = makeStore("tz_synthetic");
    const captured = store.captureHook(
      makeEnvelope({ payload: { decision: "Use the synthetic deterministic installer." } }),
    );
    const oldResult = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_old",
    });
    const newResult = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_new",
    });
    expect(oldResult.status).toBe("promoted");
    expect(newResult.status).toBe("promoted");
    const target = extractedObservation(oldResult);
    const replacement = extractedObservation(newResult);
    insertSyntheticSupersession(store, target, {
      event_id: "evt_cycleedge001",
      target_event_id: target.event_id,
      replacement_event_id: "evt_cyclemiddle",
      trust_zone_id: "tz_synthetic",
    });
    insertSyntheticSupersession(store, target, {
      event_id: "evt_cycleedge002",
      target_event_id: "evt_cyclemiddle",
      replacement_event_id: replacement.event_id,
      trust_zone_id: "tz_synthetic",
    });
    insertSyntheticSupersession(store, target, {
      event_id: "evt_cycleedge003",
      target_event_id: replacement.event_id,
      replacement_event_id: target.event_id,
      trust_zone_id: "tz_synthetic",
    });
    const beforePreview = reconciliationWriteCounts(store);
    const plan = store.previewPolicyReconciliation({
      from_policy: "adj_old",
      to_policy: "adj_new",
      trust_zone_id: "tz_synthetic",
      limit: 10,
    });
    expect(plan.entries[0]).toMatchObject({
      bucket: "unsafe_unchanged",
      reason_code: "cycle_unsafe",
    });
    expect(plan.global_taint_reason_codes).toEqual([]);
    expect(reconciliationWriteCounts(store)).toEqual(beforePreview);
  });

  it("adds a cycle taint only when a cycle-unsafe fact shares an eligible component", () => {
    const plan = buildPolicyReconciliationPlanV2({
      trust_zone_id: "tz_synthetic",
      from_policy: "adj_v1",
      to_policy: "adj_v3",
      limit: 2,
      total_candidate_count: 2,
      high_water: zeroHighWater(),
      candidates: [
        {
          source_event_id: "evt_cycleproof1",
          target_event_id: "evt_cycleproof2",
          replacement_event_id: "evt_cycleproof3",
          classification: "replace",
        },
        {
          source_event_id: "evt_cycleproof4",
          target_event_id: "evt_cycleproof2",
          unsafe_reason_code: "cycle_unsafe",
        },
      ],
    });
    expect(plan.global_taint_reason_codes).toEqual([
      "eligible_reachable_cycle_global_taint",
      "eligible_unsafe_overlap_global_taint",
      "unsafe_influences_eligible_global_taint",
    ]);
    expect(plan.global_taint_component_ids).toEqual([plan.entries[0]?.component_id]);
    expect(plan.global_taint_entry_ids).toEqual(["evt_cycleproof1", "evt_cycleproof4"]);
  });
  it("fails closed for a row-id-mismatched candidate Observation", () => {
    const { store } = makeStore("tz_synthetic");
    const captured = store.captureHook(
      makeEnvelope({ payload: { decision: "Use synthetic malformed observation." } }),
    );
    const oldResult = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_old",
    });
    const rejected = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_new",
      signalText: "thanks",
    });
    const oldObservation = extractedObservation(oldResult);
    expect(rejected.status).toBe("rejected");
    insertRowIdMismatchedObservation(store, oldObservation, captured.event.event_id, "adj_new");
    const beforePreview = reconciliationWriteCounts(store);
    const plan = store.previewPolicyReconciliation({
      from_policy: "adj_old",
      to_policy: "adj_new",
      trust_zone_id: "tz_synthetic",
      limit: 10,
    });
    expect(plan.entries[0]).toMatchObject({
      bucket: "unsafe_unchanged",
      reason_code: "lineage_unsafe",
    });
    expect(plan.global_taint_reason_codes).toEqual(["unproved_conformance_global_taint"]);
    expect(plan.plan_admissible).toBe(false);
    expect(plan.global_taint_component_ids).toEqual([plan.entries[0]?.component_id]);
    expect(plan.global_taint_entry_ids).toEqual([captured.event.event_id]);
    expect(reconciliationWriteCounts(store)).toEqual(beforePreview);
  });
  it("retains a subject-mismatched real policy-key Observation as causal unsafe evidence", () => {
    const { store } = makeStore("tz_synthetic");
    const captured = store.captureHook(
      makeEnvelope({ payload: { decision: "Use synthetic subject-mismatch procedure." } }),
    );
    const oldResult = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_old",
    });
    expect(
      store.adjudicateFromEventId(captured.event.event_id, {
        policyVersion: "adj_new",
        signalText: "thanks",
      }).status,
    ).toBe("rejected");
    const oldObservation = extractedObservation(oldResult);
    const beforeObservationCount = store.countRows("canonical_events");
    appendSyntheticPolicyObservation(
      store,
      oldObservation,
      captured,
      "adj_new",
      "policy",
      "subject_other_synthetic",
    );
    expect(store.countRows("canonical_events")).toBe(beforeObservationCount + 1);
    const beforePreview = reconciliationWriteCounts(store);
    const plan = store.previewPolicyReconciliation({
      from_policy: "adj_old",
      to_policy: "adj_new",
      trust_zone_id: "tz_synthetic",
      limit: 10,
    });
    expect(plan.entries[0]).toMatchObject({
      source_event_id: captured.event.event_id,
      bucket: "unsafe_unchanged",
      reason_code: "lineage_unsafe",
      component_id: expect.any(String),
    });
    expect(plan.global_taint_reason_codes).toEqual([]);
    expect(plan.global_taint_component_ids).toEqual([]);
    expect(plan.global_taint_entry_ids).toEqual([]);
    expect(plan.plan_admissible).toBe(true);
    expect(reconciliationWriteCounts(store)).toEqual(beforePreview);
  });
  it("keeps a subject-mismatched malformed policy Observation as causal unsafe evidence", () => {
    const { store } = makeStore("tz_synthetic");
    const captured = store.captureHook(
      makeEnvelope({ payload: { decision: "Use synthetic malformed-subject procedure." } }),
    );
    const oldResult = store.adjudicateFromEventId(captured.event.event_id, {
      policyVersion: "adj_old",
    });
    expect(
      store.adjudicateFromEventId(captured.event.event_id, {
        policyVersion: "adj_new",
        signalText: "thanks",
      }).status,
    ).toBe("rejected");
    appendMalformedSubjectPolicyObservation(
      store,
      extractedObservation(oldResult),
      captured,
      "adj_new",
    );
    const beforePreview = reconciliationWriteCounts(store);
    const plan = store.previewPolicyReconciliation({
      from_policy: "adj_old",
      to_policy: "adj_new",
      trust_zone_id: "tz_synthetic",
      limit: 10,
    });
    expect(plan.entries[0]).toMatchObject({
      source_event_id: captured.event.event_id,
      bucket: "unsafe_unchanged",
      action: "none",
      reason_code: "lineage_unsafe",
    });
    expect(plan.global_taint_reason_codes).toEqual(["unproved_conformance_global_taint"]);
    expect(plan.global_taint_component_ids).toEqual([plan.entries[0]?.component_id]);
    expect(plan.global_taint_entry_ids).toEqual([captured.event.event_id]);
    expect(plan.plan_admissible).toBe(false);
    expect(reconciliationWriteCounts(store)).toEqual(beforePreview);
  });
  it("fails closed for malformed candidate source JSON without throwing or writing", () => {
    const { store } = makeStore("tz_synthetic");
    const captured = store.captureHook(makeEnvelope());
    const db = new DatabaseSync(store.dbPath);
    try {
      db.prepare(
        `INSERT INTO canonical_events (
          event_id, event_type, trust_zone_id, idempotency_key, request_fingerprint,
          protected_value_id, event_json, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "evt_badsource001",
        "EvidenceArtifact",
        "tz_synthetic",
        "idem_badsource001",
        `sha256:${"c".repeat(64)}`,
        captured.protected_value_id,
        "{malformed source",
        "2026-01-01T00:00:00Z",
      );
      db.prepare(
        `INSERT INTO knowledge_dispositions (
          source_event_id, artifact_id, trust_zone_id, disposition, reason_codes_json,
          scores_json, policy_version, statement, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "evt_badsource001",
        "art_badsource001",
        "tz_synthetic",
        "promote",
        "[]",
        "{}",
        "adj_old",
        "synthetic",
        "2026-01-01T00:00:00Z",
      );
    } finally {
      db.close();
    }
    const beforePreview = reconciliationWriteCounts(store);
    const plan = store.previewPolicyReconciliation({
      from_policy: "adj_old",
      to_policy: "adj_new",
      trust_zone_id: "tz_synthetic",
      limit: 10,
    });
    expect(plan.entries[0]).toMatchObject({
      bucket: "unsafe_unchanged",
      reason_code: "lineage_unsafe",
    });
    expect(plan.global_taint_reason_codes).toEqual(["unproved_conformance_global_taint"]);
    expect(plan.plan_admissible).toBe(false);
    expect(plan.global_taint_component_ids).toEqual([plan.entries[0]?.component_id]);
    expect(plan.global_taint_entry_ids).toEqual(["evt_badsource001"]);
    expect(reconciliationWriteCounts(store)).toEqual(beforePreview);
  });
  it("uses the exact lexical prefix and incomplete taint for a bounded preview", () => {
    const { store } = makeStore("tz_synthetic");
    const captured = ["z", "a"].map((suffix) =>
      store.captureHook(
        makeEnvelope({
          session_id: `session_prefix_${suffix}`,
          source_event_id: `source_prefix_${suffix}`,
          payload: { decision: `Use the synthetic deterministic installer ${suffix}.` },
        }),
      ),
    );
    for (const item of captured) {
      const oldResult = store.adjudicateFromEventId(item.event.event_id, {
        policyVersion: "adj_old",
      });
      expect(oldResult.status).toBe("promoted");
    }
    const beforePreview = reconciliationWriteCounts(store);
    const plan = store.previewPolicyReconciliation({
      from_policy: "adj_old",
      to_policy: "adj_new",
      trust_zone_id: "tz_synthetic",
      limit: 1,
    });
    expect(plan.total_candidate_count).toBe(2);
    expect(plan.classified_count).toBe(1);
    expect(plan.truncated).toBe(true);
    expect(plan.global_taint_reason_codes).toContain("incomplete_enumeration_global_taint");
    expect(plan.plan_admissible).toBe(false);
    expect(plan.entries[0]?.source_event_id).toBe(
      [...captured.map((item) => item.event.event_id)].sort()[0],
    );
    const repeat = store.previewPolicyReconciliation({
      from_policy: "adj_old",
      to_policy: "adj_new",
      trust_zone_id: "tz_synthetic",
      limit: 1,
    });
    expect(JSON.stringify(repeat)).toBe(JSON.stringify(plan));
    expect(reconciliationWriteCounts(store)).toEqual(beforePreview);
  });
  it("keeps a missing lexical first old materialization in the bounded prefix", () => {
    const { store } = makeStore("tz_synthetic");
    const captured = ["a", "z"].map((suffix) =>
      store.captureHook(
        makeEnvelope({
          session_id: `session_missing_prefix_${suffix}`,
          source_event_id: `source_missing_prefix_${suffix}`,
          payload: { decision: `Use the synthetic deterministic installer ${suffix}.` },
        }),
        { extract: false },
      ),
    );
    const first = [...captured].sort((left, right) =>
      left.event.event_id < right.event.event_id ? -1 : 1,
    )[0];
    const second = [...captured].sort((left, right) =>
      left.event.event_id < right.event.event_id ? -1 : 1,
    )[1];
    if (first === undefined || second === undefined) throw new Error("expected synthetic sources");
    const db = new DatabaseSync(store.dbPath);
    try {
      db.prepare(
        `INSERT INTO knowledge_dispositions (
          source_event_id, artifact_id, trust_zone_id, disposition, reason_codes_json,
          scores_json, policy_version, statement, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        first.event.event_id,
        first.event.payload.artifact_id,
        "tz_synthetic",
        "promote",
        "[]",
        "{}",
        "adj_old",
        "synthetic",
        "2026-01-01T00:00:00Z",
      );
    } finally {
      db.close();
    }
    const secondResult = store.adjudicateFromEventId(second.event.event_id, {
      policyVersion: "adj_old",
    });
    expect(secondResult.status).toBe("promoted");
    const before = reconciliationWriteCounts(store);
    const plan = store.previewPolicyReconciliation({
      from_policy: "adj_old",
      to_policy: "adj_new",
      trust_zone_id: "tz_synthetic",
      limit: 1,
    });
    const repeat = store.previewPolicyReconciliation({
      from_policy: "adj_old",
      to_policy: "adj_new",
      trust_zone_id: "tz_synthetic",
      limit: 1,
    });
    expect(plan.total_candidate_count).toBe(2);
    expect(plan.entries[0]).toMatchObject({
      source_event_id: first.event.event_id,
      reason_code: "missing_unsafe",
      action: "none",
    });
    expect(plan.truncated).toBe(true);
    expect(plan.plan_admissible).toBe(false);
    expect(repeat.plan_digest).toBe(plan.plan_digest);
    expect(JSON.stringify(repeat)).toBe(JSON.stringify(plan));
    expect(reconciliationWriteCounts(store)).toEqual(before);
  });
});

function zeroHighWater() {
  return {
    canonical_local_sequence_max: 0,
    disposition_row_count: 0,
    review_row_count: 0,
    outbox_id_max: 0,
    supersession_event_count: 0,
  };
}
function extractedObservation(
  result: ReturnType<LocalCaptureStore["adjudicateFromEventId"]>,
): CanonicalEvent<"Observation"> {
  if (
    (result.status !== "promoted" && result.status !== "held" && result.status !== "replay") ||
    result.extraction === undefined ||
    (result.extraction.status !== "extracted" && result.extraction.status !== "replay")
  ) {
    throw new Error("expected extracted Observation");
  }
  return result.extraction.event;
}

function syntheticSupersession(
  base: CanonicalEvent<"Observation">,
  input: {
    event_id: string;
    target_event_id: string;
    replacement_event_id: string | null;
    trust_zone_id: string;
  },
): CanonicalEvent<"Supersession"> {
  const idempotencySuffix = hashHex(input.event_id).slice(0, 32);
  return {
    schema_version: "v1",
    event_id: input.event_id,
    event_type: "Supersession",
    subject_ref: base.subject_ref,
    valid_time: base.valid_time,
    recorded_time: base.recorded_time,
    lifecycle_status: "active",
    epistemic_authority: "verified",
    trust_zone: { ...base.trust_zone, trust_zone_id: input.trust_zone_id },
    provenance: [...base.provenance],
    idempotency_key: `idem_${idempotencySuffix}`,
    request_fingerprint: `sha-256:${"a".repeat(64)}`,
    payload: {
      supersession_id: `sup_${hashHex(input.event_id).slice(0, 24)}`,
      supersedes_event_id: input.target_event_id,
      ...(input.replacement_event_id === null
        ? {}
        : { replacement_event_id: input.replacement_event_id }),
      reason: "Synthetic reconciliation fixture.",
    },
  };
}

function insertSyntheticSupersession(
  store: LocalCaptureStore,
  base: CanonicalEvent<"Observation">,
  input: {
    event_id: string;
    target_event_id: string;
    replacement_event_id: string | null;
    trust_zone_id: string;
    row_trust_zone_id?: string;
  },
): void {
  const event = syntheticSupersession(base, input);
  const db = new DatabaseSync(store.dbPath);
  try {
    const protectedValue = db
      .prepare("SELECT protected_value_id FROM canonical_events WHERE event_id = ?")
      .get(base.event_id) as { protected_value_id: string };
    db.prepare(
      `INSERT INTO canonical_events (
        event_id, event_type, trust_zone_id, idempotency_key, request_fingerprint,
        protected_value_id, event_json, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      event.event_id,
      event.event_type,
      input.row_trust_zone_id ?? input.trust_zone_id,
      event.idempotency_key,
      event.request_fingerprint,
      protectedValue.protected_value_id,
      JSON.stringify(event),
      event.recorded_time.start,
    );
  } finally {
    db.close();
  }
}
function insertRowIdMismatchedObservation(
  store: LocalCaptureStore,
  base: CanonicalEvent<"Observation">,
  sourceEventId: string,
  policyVersion: string,
): void {
  const idempotencyKey = `idem_${hashHex(
    stableJson({
      kind: "adjudicated_observation",
      source_event_id: sourceEventId,
      policy_version: policyVersion,
    }),
  ).slice(0, 32)}`;
  const db = new DatabaseSync(store.dbPath);
  try {
    const protectedValue = db
      .prepare("SELECT protected_value_id FROM canonical_events WHERE event_id = ?")
      .get(base.event_id) as { protected_value_id: string };
    db.prepare(
      `INSERT INTO canonical_events (
        event_id, event_type, trust_zone_id, idempotency_key, request_fingerprint,
        protected_value_id, event_json, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "evt_mismatchobs01",
      "Observation",
      base.trust_zone.trust_zone_id,
      idempotencyKey,
      `sha256:${"b".repeat(64)}`,
      protectedValue.protected_value_id,
      JSON.stringify(base),
      base.recorded_time.start,
    );
  } finally {
    db.close();
  }
}
function policyObservationKey(sourceEventId: string, policyVersion: string): string {
  return `idem_${hashHex(
    stableJson({
      kind: "adjudicated_observation",
      source_event_id: sourceEventId,
      policy_version: policyVersion,
    }),
  ).slice(0, 32)}`;
}

function heldObservationKey(sourceEventId: string, policyVersion: string): string {
  return `idem_${hashHex(
    stableJson({
      kind: "held_review_promote",
      source_event_id: sourceEventId,
      trust_zone_id: "tz_synthetic",
      policy_version: policyVersion,
    }),
  ).slice(0, 32)}`;
}

function appendDisposition(
  store: LocalCaptureStore,
  source: { event: CanonicalEvent<"EvidenceArtifact"> },
  policyVersion: string,
  disposition: "hold" | "reject",
): void {
  const db = new DatabaseSync(store.dbPath);
  try {
    db.prepare(
      `INSERT INTO knowledge_dispositions (
        source_event_id, artifact_id, trust_zone_id, disposition, reason_codes_json,
        scores_json, policy_version, statement, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      source.event.event_id,
      source.event.payload.artifact_id,
      "tz_synthetic",
      disposition,
      "[]",
      "{}",
      policyVersion,
      "synthetic",
      now.toISOString(),
    );
  } finally {
    db.close();
  }
}

function appendHeldDisposition(
  store: LocalCaptureStore,
  source: { event: CanonicalEvent<"EvidenceArtifact"> },
  policyVersion: string,
): void {
  appendDisposition(store, source, policyVersion, "hold");
}

function appendHeldReview(
  store: LocalCaptureStore,
  sourceEventId: string,
  policyVersion: string,
  decision: "promote" | "reject",
): void {
  const db = new DatabaseSync(store.dbPath);
  try {
    db.prepare(
      `INSERT INTO knowledge_disposition_reviews (
        review_id, source_event_id, trust_zone_id, policy_version, review_decision, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      `kdr_${hashHex(`${sourceEventId}:${policyVersion}:${decision}`).slice(0, 32)}`,
      sourceEventId,
      "tz_synthetic",
      policyVersion,
      decision,
      now.toISOString(),
    );
  } finally {
    db.close();
  }
}

function appendSyntheticPolicyObservation(
  store: LocalCaptureStore,
  base: CanonicalEvent<"Observation">,
  source: { event: CanonicalEvent<"EvidenceArtifact">; protected_value_id: string },
  policyVersion: string,
  authority: "held" | "policy",
  subjectRef = source.event.subject_ref,
): void {
  const eventId = `evt_${hashHex(
    `${source.event.event_id}:${policyVersion}:${authority}:${subjectRef}`,
  ).slice(0, 24)}`;
  const event: CanonicalEvent<"Observation"> = {
    ...base,
    event_id: eventId,
    subject_ref: subjectRef,
    lifecycle_status: "active",
    idempotency_key:
      authority === "held"
        ? heldObservationKey(source.event.event_id, policyVersion)
        : policyObservationKey(source.event.event_id, policyVersion),
    provenance: [
      { ref_type: "event", ref_id: source.event.event_id, relationship: "derived_from" },
    ],
    payload: {
      ...base.payload,
      evidence_artifact_refs: [source.event.payload.artifact_id],
    },
  };
  const db = new DatabaseSync(store.dbPath);
  try {
    db.prepare(
      `INSERT INTO canonical_events (
        event_id, event_type, trust_zone_id, idempotency_key, request_fingerprint,
        protected_value_id, event_json, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      event.event_id,
      event.event_type,
      event.trust_zone.trust_zone_id,
      event.idempotency_key,
      event.request_fingerprint,
      source.protected_value_id,
      JSON.stringify(event),
      event.recorded_time.start,
    );
  } finally {
    db.close();
  }
}
function appendMalformedSubjectPolicyObservation(
  store: LocalCaptureStore,
  base: CanonicalEvent<"Observation">,
  source: { event: CanonicalEvent<"EvidenceArtifact">; protected_value_id: string },
  policyVersion: string,
): void {
  const event: CanonicalEvent<"Observation"> = {
    ...base,
    event_id: "evt_malformed_subject_body",
    subject_ref: "subject_other_synthetic",
    lifecycle_status: "active",
    idempotency_key: policyObservationKey(source.event.event_id, policyVersion),
    provenance: [
      { ref_type: "event", ref_id: source.event.event_id, relationship: "derived_from" },
    ],
    payload: {
      ...base.payload,
      evidence_artifact_refs: [source.event.payload.artifact_id],
    },
  };
  const db = new DatabaseSync(store.dbPath);
  try {
    db.prepare(
      `INSERT INTO canonical_events (
        event_id, event_type, trust_zone_id, idempotency_key, request_fingerprint,
        protected_value_id, event_json, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "evt_malformed_subject_row",
      event.event_type,
      event.trust_zone.trust_zone_id,
      event.idempotency_key,
      event.request_fingerprint,
      source.protected_value_id,
      JSON.stringify(event),
      event.recorded_time.start,
    );
  } finally {
    db.close();
  }
}

function appendInboxCopy(
  store: LocalCaptureStore,
  event: CanonicalEvent,
  protectedValueId: string,
): void {
  const db = new DatabaseSync(store.dbPath);
  try {
    db.prepare(
      `INSERT INTO sync_inbox_events (
        event_id, trust_zone_id, zone_sequence, protected_value_id, event_json, imported_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      event.event_id,
      event.trust_zone.trust_zone_id,
      0,
      protectedValueId,
      JSON.stringify(event),
      now.toISOString(),
    );
  } finally {
    db.close();
  }
}
function appendMalformedInboxRow(
  store: LocalCaptureStore,
  eventId: string,
  protectedValueId: string,
): void {
  const db = new DatabaseSync(store.dbPath);
  try {
    db.prepare(
      `INSERT INTO sync_inbox_events (
        event_id, trust_zone_id, zone_sequence, protected_value_id, event_json, imported_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(eventId, "tz_synthetic", 0, protectedValueId, "{not canonical json", now.toISOString());
  } finally {
    db.close();
  }
}

function expectHeldPreviewUnsafe(
  store: LocalCaptureStore,
  sourceEventId: string,
  reasonCode: "missing_unsafe" | "ambiguous_unsafe",
): void {
  const beforePreview = {
    protected_values: store.countRows("protected_values"),
    canonical_events: store.countRows("canonical_events"),
    outbox: store.countRows("outbox"),
    knowledge_dispositions: store.countRows("knowledge_dispositions"),
    knowledge_disposition_reviews: store.countRows("knowledge_disposition_reviews"),
  };
  const plan = store.previewPolicyReconciliation({
    from_policy: "adj_old",
    to_policy: "adj_new",
    trust_zone_id: "tz_synthetic",
    limit: 10,
  });
  expect(plan.entries).toEqual([
    expect.objectContaining({
      source_event_id: sourceEventId,
      bucket: "unsafe_unchanged",
      action: "none",
      reason_code: reasonCode,
    }),
  ]);
  expect(plan.global_taint_reason_codes).toEqual([]);
  expect(plan.global_taint_component_ids).toEqual([]);
  expect(plan.global_taint_entry_ids).toEqual([]);
  expect(plan.plan_admissible).toBe(true);
  expect({
    protected_values: store.countRows("protected_values"),
    canonical_events: store.countRows("canonical_events"),
    outbox: store.countRows("outbox"),
    knowledge_dispositions: store.countRows("knowledge_dispositions"),
    knowledge_disposition_reviews: store.countRows("knowledge_disposition_reviews"),
  }).toEqual(beforePreview);
}
function makeStore(trustZoneId?: string): { store: LocalCaptureStore; runtimeDir: string } {
  const runtimeDir = tempDir();
  return {
    runtimeDir,
    store: new LocalCaptureStore({
      runtimeDir,
      workspaceRoot: runtimeDir,
      keyProvider: new StaticKeyProvider(staticMaterial),
      clock: { now: () => now },
      ...(trustZoneId === undefined ? {} : { trustZoneId }),
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
