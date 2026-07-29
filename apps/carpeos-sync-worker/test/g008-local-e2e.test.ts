import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LocalCaptureStore,
  type LocalRetrievalInputSnapshot,
  StaticKeyProvider,
} from "@carpeos/local-store";
import { createCarpeosMcpApplication } from "@carpeos/mcp-server";
import { rebuildObsidianProjection } from "@carpeos/obsidian-projection";
import { rebuildLocalRetrievalIndex, searchLocalRetrievalIndex } from "@carpeos/retrieval";
import type {
  CanonicalEvent,
  ErasureLedgerRecord,
  ProvenanceRef,
  SyncPushRequest,
  TrustZone,
} from "@carpeos/schema";
import { validateConformance } from "@carpeos/schema";
import { OutboxSyncCoordinator, SyncHttpTransport } from "@carpeos/sync-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { unstable_startWorker } from "wrangler";

type LocalWorkerHandle = Awaited<ReturnType<typeof unstable_startWorker>>;

const BASE_TRUST_ZONE_ID = "tz_g008_release";
const OTHER_TRUST_ZONE_ID = "tz_g008_other";
const SOURCE_CREDENTIAL = "synthetic_g008_source_credential_0123456789abcdef";
const MIRROR_CREDENTIAL = "synthetic_g008_mirror_credential_0123456789abcdef";
const SOURCE_KEY = new Uint8Array(32).fill(7);
const MIRROR_KEY = new Uint8Array(32).fill(9);
const SYNC_KEY = new Uint8Array(32).fill(42);
const PRIVATE_SENTINEL = "SYNTHETIC_G008_PRIVATE_CAPTURE_SENTINEL";
const BASE_TIME = "2026-07-29T00:00:00Z";
const WORKER_ROOT = new URL("..", import.meta.url).pathname;
const WORKER_STARTUP_TIMEOUT_MS = 120_000;

const tempDirs: string[] = [];
let worker: LocalWorkerHandle | undefined;
let workerPersistDir: string | undefined;
let testIndex = 0;
let currentTrustZoneId = BASE_TRUST_ZONE_ID;
let visibleTrustZoneIds = [currentTrustZoneId];

beforeAll(async () => {
  if (process.env.G008_NODE_E2E !== "1") {
    return;
  }
  workerPersistDir = mkdtempSync(join(tmpdir(), "carpeos-g008-worker-persist-"));
  wrangler(
    "d1",
    "migrations",
    "apply",
    "carpeos_sync_test",
    "--local",
    "--config",
    "wrangler.test.toml",
  );
  worker = await unstable_startWorker({
    config: "./wrangler.test.toml",
    dev: { persist: workerPersistDir },
  });
  await worker.ready;
}, WORKER_STARTUP_TIMEOUT_MS);

beforeEach(() => {
  if (process.env.G008_NODE_E2E !== "1") {
    return;
  }
  testIndex += 1;
  currentTrustZoneId = `${BASE_TRUST_ZONE_ID}_${testIndex}`;
  visibleTrustZoneIds = [currentTrustZoneId];
  wrangler(
    "d1",
    "execute",
    "carpeos_sync_test",
    "--local",
    "--config",
    "wrangler.test.toml",
    "--command",
    [
      "DELETE FROM protected_value_links",
      "DELETE FROM protected_value_uploads",
      "DELETE FROM erasure_ledger",
      "DELETE FROM canonical_events",
      "DELETE FROM zone_counters",
      "DELETE FROM sync_requests",
      "DELETE FROM client_authorizations",
    ].join("; "),
  );
}, 30_000);

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

afterAll(async () => {
  await worker?.dispose();
  worker = undefined;
  if (workerPersistDir !== undefined) {
    rmSync(workerPersistDir, { recursive: true, force: true });
    workerPersistDir = undefined;
  }
  rmSync(join(WORKER_ROOT, ".wrangler"), { recursive: true, force: true });
}, 30_000);

describe.skipIf(process.env.G008_NODE_E2E !== "1")("G008 local synthetic E2E release proof", () => {
  it.sequential("runs capture through local Worker sync into retrieval, MCP, and Obsidian projections", async () => {
    const source = makeStore("source", SOURCE_KEY);
    const mirror = makeStore("mirror", MIRROR_KEY);
    seedAuthorization(source.clientId, currentTrustZoneId, SOURCE_CREDENTIAL);
    seedAuthorization(mirror.clientId, currentTrustZoneId, MIRROR_CREDENTIAL);

    const sourceTransport = makeWorkerTransport(source.clientId, SOURCE_CREDENTIAL);
    const mirrorTransport = makeWorkerTransport(mirror.clientId, MIRROR_CREDENTIAL);
    const sourceSync = new OutboxSyncCoordinator({
      store: source,
      transport: sourceTransport,
      trustZoneSyncKey: SYNC_KEY,
      pullLimit: 20,
    });
    const mirrorSync = new OutboxSyncCoordinator({
      store: mirror,
      transport: mirrorTransport,
      trustZoneSyncKey: SYNC_KEY,
      pullLimit: 20,
    });

    const captured = source.captureHook({
      provider: "synthetic",
      hook_event_name: "G008Capture",
      captured_at: "2026-07-28T23:00:00Z",
      media_type: "application/json",
      subject_ref: "subject_g008",
      payload: {
        transcript: PRIVATE_SENTINEL,
        public_summary: "Alpha release evidence",
      },
      idempotency_key: "idem_g008_capture_00000001",
    });
    expect(captured.status).toBe("captured");
    expect(captured.event.event_type).toBe("EvidenceArtifact");
    expect(captured.event.zone_sequence).toBeUndefined();
    expect(source.outboxStatus()).toEqual({ pending: 1, leased: 0, delivered: 0 });
    expect(runtimeContains(source.runtimeDir, PRIVATE_SENTINEL)).toBe(false);

    const pushedCapture = await sourceSync.pushOne(new Date("2026-07-29T00:01:00Z"));
    expect(pushedCapture).toMatchObject({
      status: "acked",
      remote_status: "accepted",
      result: { zone_sequences: [{ trust_zone_id: currentTrustZoneId, last_sequence: 1 }] },
    });
    expect(source.outboxStatus()).toEqual({ pending: 0, leased: 0, delivered: 1 });
    expect(source.getEvent(captured.event.event_id)?.zone_sequence).toBeUndefined();

    const observation = observationEvent({
      eventId: "evt_g008_observe_alpha_00000001",
      observationId: "obs_g008_alpha",
      statement: "Alpha release readiness remains accepted when visible.",
      minute: 2,
      evidenceArtifactRefs: [captured.event.payload.artifact_id],
    });
    const claim = claimEvent({
      eventId: "evt_g008_claim_alpha_000000001",
      claimId: "claim_g008_alpha",
      statement: "Alpha release readiness is accepted from synthetic lineage.",
      minute: 3,
      support: [{ ref_type: "observation", ref_id: "obs_g008_alpha", relationship: "supports" }],
    });
    const decision = decisionEvent({
      eventId: "evt_g008_accept_alpha_00000001",
      decisionId: "decision_g008_accept_alpha",
      claimRefs: ["claim_g008_alpha"],
      minute: 4,
    });

    expect((await sourceTransport.push(pushForEvent(source.clientId, observation))).status).toBe(
      "accepted",
    );
    expect((await sourceTransport.push(pushForEvent(source.clientId, claim))).status).toBe(
      "accepted",
    );
    const decisionPush = await sourceTransport.push(pushForEvent(source.clientId, decision));
    expect(decisionPush).toMatchObject({
      status: "accepted",
      zone_sequences: [{ trust_zone_id: currentTrustZoneId, last_sequence: 4 }],
    });
    expect(d1DumpContains(PRIVATE_SENTINEL)).toBe(false);

    const pull = await mirrorSync.pullPage(new Date("2026-07-29T00:05:00Z"));
    expect(pull).toMatchObject({
      imported_events: 4,
      imported_erasures: 0,
      after_sequence: 4,
      cursor: "after_sequence:4",
      has_more: false,
    });
    expect(mirror.getSyncCursor()).toEqual({
      trust_zone_id: currentTrustZoneId,
      after_sequence: 4,
      cursor: "after_sequence:4",
    });

    const mirroredEvidence = mirror.getEvent(captured.event.event_id);
    expect(mirroredEvidence?.zone_sequence).toBe(1);
    expect(mirror.getEvent(observation.event_id)?.zone_sequence).toBe(2);
    expect(mirror.getEvent(claim.event_id)?.zone_sequence).toBe(3);
    expect(mirror.getEvent(decision.event_id)?.zone_sequence).toBe(4);
    expect(
      Buffer.from(mirror.decryptProtectedValue(captured.protected_value_id)).toString("utf8"),
    ).toContain(PRIVATE_SENTINEL);
    expect(runtimeContains(mirror.runtimeDir, PRIVATE_SENTINEL)).toBe(false);

    const snapshotBeforeProjections = stableJson(mirror.getRetrievalInputSnapshot());
    const retrieval = mirror.withRetrievalDatabase((db) => {
      const rebuilt = rebuildLocalRetrievalIndex(db, new Date("2026-07-29T00:06:00Z"));
      const search = searchLocalRetrievalIndex(db, {
        query: {
          schema_version: "v1",
          record_type: "retrieval_query",
          query_id: "query_000000000000000000000008",
          query_text: "accepted Alpha release readiness",
          filters: {
            visible_trust_zone_ids: visibleTrustZoneIds,
            lifecycle_status: ["active"],
            epistemic_authority: ["derived", "verified", "observed", "imported"],
            protected_value_policy: "metadata_only",
            conflict_policy: "exclude_conflicts",
          },
          ranking: {
            mode: "hybrid",
            weights: { structured: 1, fts: 1, semantic: 1, recency: 0.1 },
          },
          limit: 10,
        },
      });
      return { rebuilt, search };
    });
    expect(retrieval.rebuilt.chunks.length).toBeGreaterThanOrEqual(2);
    expect(retrieval.search.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "visible",
          lineage: expect.objectContaining({
            canonical_rechecked: true,
            accepted_decision_event_ids: [decision.event_id],
          }),
        }),
      ]),
    );

    const app = createCarpeosMcpApplication({
      store: mirror,
      config: { visibleTrustZoneIds },
    });
    const context = await app.dispatch("memory_context_pack", {
      schema_version: "v1",
      visibility: {
        visible_trust_zone_ids: visibleTrustZoneIds,
        protected_value_policy: "deny",
      },
      task: "Summarize G008 Alpha",
      context_budget: { max_items: 20, max_characters: 20_000 },
    });
    expect(context.isError).toBe(false);
    expect(context.text).not.toContain(PRIVATE_SENTINEL);
    expect(context.structuredContent.accepted_facts).toEqual([
      expect.objectContaining({
        claim_event_id: claim.event_id,
        acceptance_decision_event_id: decision.event_id,
        source_event_ids: expect.arrayContaining([claim.event_id, decision.event_id]),
      }),
    ]);

    const trace = await app.dispatch("memory_trace", {
      schema_version: "v1",
      visibility: {
        visible_trust_zone_ids: visibleTrustZoneIds,
        protected_value_policy: "metadata_only",
      },
      record_id: claim.event_id,
      max_depth: 3,
      context_budget: { max_items: 20, max_characters: 20_000 },
    });
    expect(trace.isError).toBe(false);
    expect(trace.structuredContent.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ record_id: claim.event_id }),
        expect.objectContaining({ record_id: observation.event_id }),
      ]),
    );

    const outputRoot = tempDir();
    const projectionSnapshot = uniqueProjectionSnapshot(
      mirror.getObsidianProjectionInputSnapshot({ visibleTrustZoneIds }),
    );
    const firstProjection = rebuildObsidianProjection({
      snapshot: projectionSnapshot,
      config: projectionConfig(outputRoot),
    });
    const firstManifest = readFileSync(firstProjection.manifestPath, "utf8");
    const firstBytes = readGenerated(outputRoot, firstProjection.written);
    const secondProjection = rebuildObsidianProjection({
      snapshot: projectionSnapshot,
      config: projectionConfig(outputRoot),
    });
    expect(secondProjection.manifestStatus).toBe("valid");
    expect(readFileSync(secondProjection.manifestPath, "utf8")).toBe(firstManifest);
    expect(readGenerated(outputRoot, secondProjection.written)).toBe(firstBytes);
    expect(secondProjection.written.some((path) => path.startsWith("accepted_fact/"))).toBe(true);
    expect(firstBytes).not.toContain(PRIVATE_SENTINEL);

    const acceptedPath = secondProjection.written.find((path) => path.startsWith("accepted_fact/"));
    if (acceptedPath === undefined) {
      throw new Error("missing accepted fact projection");
    }
    writeFileSync(join(outputRoot, acceptedPath), "local edit with no canonical effect\n");

    expect(stableJson(mirror.getRetrievalInputSnapshot())).toBe(snapshotBeforeProjections);
    expect(mirror.outboxStatus()).toEqual({ pending: 0, leased: 0, delivered: 0 });
  }, 60_000);

  it.sequential("keeps replay, fingerprint conflict, and other-zone denial from allocating extra sequence", async () => {
    const source = makeStore("replay-source", SOURCE_KEY);
    seedAuthorization(source.clientId, currentTrustZoneId, SOURCE_CREDENTIAL);
    const transport = makeWorkerTransport(source.clientId, SOURCE_CREDENTIAL);

    const first = observationEvent({
      eventId: "evt_g008_replay_alpha_00000001",
      observationId: "obs_g008_replay_alpha",
      statement: "Replay keeps the original sequence.",
      minute: 1,
      evidenceArtifactRefs: [],
    });
    const firstPush = pushForEvent(source.clientId, first);
    expect(await transport.push(firstPush)).toMatchObject({
      status: "accepted",
      zone_sequences: [{ trust_zone_id: currentTrustZoneId, last_sequence: 1 }],
    });
    expect(await transport.push(firstPush)).toMatchObject({
      status: "replay",
      zone_sequences: [{ trust_zone_id: currentTrustZoneId, last_sequence: 1 }],
    });
    await expect(
      transport.push({
        ...firstPush,
        request_id: "req_g008_replay_conflict",
        request_fingerprint: digestRef("changed replay fingerprint"),
      }),
    ).rejects.toMatchObject({ status: 409 });

    const second = observationEvent({
      eventId: "evt_g008_replay_beta_000000001",
      observationId: "obs_g008_replay_beta",
      statement: "Second accepted event proves conflict did not allocate sequence.",
      minute: 2,
      evidenceArtifactRefs: [],
    });
    expect(await transport.push(pushForEvent(source.clientId, second))).toMatchObject({
      status: "accepted",
      zone_sequences: [{ trust_zone_id: currentTrustZoneId, last_sequence: 2 }],
    });

    await expect(
      transport.push(
        pushForEvent(source.clientId, {
          ...observationEvent({
            eventId: "evt_g008_other_zone_00000001",
            observationId: "obs_g008_other_zone",
            statement: "Other-zone push must fail closed.",
            minute: 3,
            evidenceArtifactRefs: [],
          }),
          trust_zone: { ...trustZone(), trust_zone_id: OTHER_TRUST_ZONE_ID },
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      transport.pull({
        schema_version: "v1",
        client_id: source.clientId,
        trust_zone_id: OTHER_TRUST_ZONE_ID,
        limit: 10,
      }),
    ).rejects.toMatchObject({ status: 403 });
  }, 60_000);

  it.sequential("surfaces accepted-fact negatives and erasure repair without projection mutation", async () => {
    const source = makeStore("negative-source", SOURCE_KEY);
    const mirror = makeStore("negative-mirror", MIRROR_KEY);
    seedAuthorization(source.clientId, currentTrustZoneId, SOURCE_CREDENTIAL);
    seedAuthorization(mirror.clientId, currentTrustZoneId, MIRROR_CREDENTIAL);
    const sourceTransport = makeWorkerTransport(source.clientId, SOURCE_CREDENTIAL);
    const mirrorSync = new OutboxSyncCoordinator({
      store: mirror,
      transport: makeWorkerTransport(mirror.clientId, MIRROR_CREDENTIAL),
      trustZoneSyncKey: SYNC_KEY,
      pullLimit: 50,
    });

    const observation = observationEvent({
      eventId: "evt_g008_negative_obs_00000001",
      observationId: "obs_g008_negative",
      statement: "Negative matrix observation.",
      minute: 1,
      evidenceArtifactRefs: [],
    });
    const accepted = claimEvent({
      eventId: "evt_g008_negative_claim_ok_001",
      claimId: "claim_g008_negative_ok",
      statement: "Only this negative-matrix claim is accepted.",
      minute: 2,
      support: [{ ref_type: "observation", ref_id: "obs_g008_negative", relationship: "supports" }],
    });
    const acceptedDecision = decisionEvent({
      eventId: "evt_g008_negative_accept_0001",
      decisionId: "decision_g008_negative_accept",
      claimRefs: ["claim_g008_negative_ok"],
      minute: 3,
    });
    const draftAccepted = claimEvent({
      eventId: "evt_g008_negative_draft_00001",
      claimId: "claim_g008_negative_draft",
      statement: "Draft accepted claim must not become accepted fact.",
      minute: 4,
      lifecycleStatus: "draft",
      support: [{ ref_type: "observation", ref_id: "obs_g008_negative", relationship: "supports" }],
    });
    const draftDecision = decisionEvent({
      eventId: "evt_g008_negative_draft_acc01",
      decisionId: "decision_g008_negative_draft",
      claimRefs: ["claim_g008_negative_draft"],
      minute: 5,
    });
    const unverified = claimEvent({
      eventId: "evt_g008_negative_unverified1",
      claimId: "claim_g008_negative_unverified",
      statement: "Unverified accepted claim must not become accepted fact.",
      minute: 6,
      authority: "unverified",
      support: [{ ref_type: "observation", ref_id: "obs_g008_negative", relationship: "supports" }],
    });
    const unverifiedDecision = decisionEvent({
      eventId: "evt_g008_negative_unver_acc1",
      decisionId: "decision_g008_negative_unverified",
      claimRefs: ["claim_g008_negative_unverified"],
      minute: 7,
    });
    const rejected = claimEvent({
      eventId: "evt_g008_negative_rejected001",
      claimId: "claim_g008_negative_rejected",
      statement: "Rejected claim must stay rejected lineage.",
      minute: 8,
      support: [{ ref_type: "observation", ref_id: "obs_g008_negative", relationship: "supports" }],
    });
    const rejectedDecision = decisionEvent({
      eventId: "evt_g008_negative_reject_0001",
      decisionId: "decision_g008_negative_reject",
      claimRefs: ["claim_g008_negative_rejected"],
      decision: "rejected",
      minute: 9,
    });
    const supersededAccepted = claimEvent({
      eventId: "evt_g008_superseded_claim_001",
      claimId: "claim_g008_superseded_ok",
      statement: "Superseded accepted claim must be excluded from release surfaces.",
      minute: 10,
      support: [{ ref_type: "observation", ref_id: "obs_g008_negative", relationship: "supports" }],
    });
    const supersededDecision = decisionEvent({
      eventId: "evt_g008_superseded_accept01",
      decisionId: "decision_g008_superseded_accept",
      claimRefs: ["claim_g008_superseded_ok"],
      minute: 11,
    });
    const supersession = supersessionEvent({
      eventId: "evt_g008_supersession_000001",
      supersessionId: "sup_g008_superseded_claim",
      supersedesEventId: supersededAccepted.event_id,
      replacementEventId: accepted.event_id,
      minute: 12,
    });

    for (const event of [
      observation,
      accepted,
      acceptedDecision,
      draftAccepted,
      draftDecision,
      unverified,
      unverifiedDecision,
      rejected,
      rejectedDecision,
      supersededAccepted,
      supersededDecision,
      supersession,
    ]) {
      expect((await sourceTransport.push(pushForEvent(source.clientId, event))).status).toBe(
        "accepted",
      );
    }
    expect(await mirrorSync.pullPage(new Date("2026-07-29T00:10:00Z"))).toMatchObject({
      imported_events: 12,
      after_sequence: 12,
    });

    const retrieval = mirror.withRetrievalDatabase((db) => {
      const rebuilt = rebuildLocalRetrievalIndex(db, new Date("2026-07-29T00:10:30Z"));
      const supersededSearch = searchLocalRetrievalIndex(db, {
        query: {
          schema_version: "v1",
          record_type: "retrieval_query",
          query_id: "query_000000000000000000000009",
          query_text: "Superseded accepted claim release surfaces",
          filters: {
            visible_trust_zone_ids: visibleTrustZoneIds,
            lifecycle_status: ["active"],
            epistemic_authority: ["derived", "verified", "observed", "imported"],
            protected_value_policy: "metadata_only",
            conflict_policy: "surface_conflicts",
          },
          ranking: {
            mode: "hybrid",
            weights: { structured: 1, fts: 1, semantic: 1, recency: 0.1 },
          },
          limit: 10,
        },
      });
      const otherZoneOnlySearch = searchLocalRetrievalIndex(db, {
        query: {
          schema_version: "v1",
          record_type: "retrieval_query",
          query_id: "query_000000000000000000000010",
          query_text: "Superseded accepted claim release surfaces",
          filters: {
            visible_trust_zone_ids: [OTHER_TRUST_ZONE_ID],
            lifecycle_status: ["active"],
            epistemic_authority: ["derived", "verified", "observed", "imported"],
            protected_value_policy: "metadata_only",
            conflict_policy: "surface_conflicts",
          },
          ranking: {
            mode: "hybrid",
            weights: { structured: 1, fts: 1, semantic: 1, recency: 0.1 },
          },
          limit: 10,
        },
      });
      return { rebuilt, supersededSearch, otherZoneOnlySearch };
    });
    expect(retrieval.rebuilt.chunks.length).toBeGreaterThanOrEqual(4);
    expect(retrieval.supersededSearch.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "excluded",
          reason: "source superseded",
          lineage: expect.objectContaining({
            supersession_event_ids: [supersession.event_id],
            accepted_decision_event_ids: [supersededDecision.event_id],
          }),
        }),
      ]),
    );
    const supersededResult = retrieval.supersededSearch.results.find(
      (item) =>
        item.status === "excluded" &&
        item.reason === "source superseded" &&
        item.lineage.supersession_event_ids?.includes(supersession.event_id),
    );
    expect(
      supersededResult?.lineage.source_records.map((record) => record.source_record_id),
    ).toEqual(
      expect.arrayContaining([
        supersededAccepted.event_id,
        supersession.event_id,
        accepted.event_id,
      ]),
    );
    expect(
      retrieval.supersededSearch.results.some(
        (item) =>
          item.status === "visible" &&
          item.text.includes("Superseded accepted claim must be excluded"),
      ),
    ).toBe(false);
    expect(retrieval.otherZoneOnlySearch.results.some((item) => item.status === "visible")).toBe(
      false,
    );

    const app = createCarpeosMcpApplication({
      store: mirror,
      config: { visibleTrustZoneIds },
    });
    const context = await app.dispatch("memory_context_pack", {
      schema_version: "v1",
      visibility: {
        visible_trust_zone_ids: visibleTrustZoneIds,
        protected_value_policy: "metadata_only",
      },
      task: "Negative matrix",
      context_budget: { max_items: 50, max_characters: 20_000 },
    });
    expect(context.structuredContent.accepted_facts).toEqual([
      expect.objectContaining({ claim_event_id: accepted.event_id }),
    ]);
    expect(context.structuredContent.accepted_facts).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ claim_event_id: supersededAccepted.event_id }),
      ]),
    );
    expect(context.structuredContent.supersessions).toEqual(
      expect.arrayContaining([expect.objectContaining({ record_id: supersession.event_id })]),
    );
    expect(context.structuredContent.draft_claims).toEqual(
      expect.arrayContaining([expect.objectContaining({ claim_event_id: draftAccepted.event_id })]),
    );
    expect(context.structuredContent.rejected_claims).toEqual(
      expect.arrayContaining([expect.objectContaining({ claim_event_id: rejected.event_id })]),
    );

    const outsideValid = await app.dispatch("memory_context_pack", {
      schema_version: "v1",
      visibility: {
        visible_trust_zone_ids: visibleTrustZoneIds,
        protected_value_policy: "metadata_only",
      },
      task: "Outside valid time",
      valid_time: { start: "2025-01-01T00:00:00Z", end: "2025-12-31T23:59:59Z" },
      context_budget: { max_items: 50, max_characters: 20_000 },
    });
    expect(outsideValid.structuredContent.accepted_facts).toEqual([]);

    const otherZoneContext = await app.dispatch("memory_context_pack", {
      schema_version: "v1",
      visibility: {
        visible_trust_zone_ids: [OTHER_TRUST_ZONE_ID],
        protected_value_policy: "metadata_only",
      },
      task: "Unauthorized other zone",
      context_budget: { max_items: 50, max_characters: 20_000 },
    });
    expect(otherZoneContext.isError).toBe(true);
    expect(otherZoneContext.structuredContent.error).toMatchObject({ code: "unauthorized" });

    const supersessionTrace = await app.dispatch("memory_trace", {
      schema_version: "v1",
      visibility: {
        visible_trust_zone_ids: visibleTrustZoneIds,
        protected_value_policy: "metadata_only",
      },
      record_id: supersession.event_id,
      max_depth: 2,
      context_budget: { max_items: 20, max_characters: 20_000 },
    });
    expect(supersessionTrace.isError).toBe(false);
    expect(supersessionTrace.structuredContent.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ record_id: supersession.event_id }),
        expect.objectContaining({ record_id: supersededAccepted.event_id }),
        expect.objectContaining({ record_id: accepted.event_id }),
      ]),
    );

    const outputRoot = tempDir();
    const beforeErasureProjection = rebuildObsidianProjection({
      snapshot: uniqueProjectionSnapshot(
        mirror.getObsidianProjectionInputSnapshot({ visibleTrustZoneIds }),
      ),
      config: projectionConfig(outputRoot),
    });
    const acceptedPath = beforeErasureProjection.written.find((path) =>
      path.startsWith("accepted_fact/"),
    );
    expect(acceptedPath).toBeDefined();
    if (acceptedPath === undefined) {
      throw new Error("missing accepted fact projection before erasure");
    }
    expect(beforeErasureProjection.written).toEqual(
      expect.arrayContaining([
        expect.stringMatching(new RegExp(`^supersession/.*/${supersession.event_id}-`)),
      ]),
    );
    expect(
      beforeErasureProjection.written.filter(
        (path) =>
          (path.startsWith("accepted_fact/") || path.startsWith("proposed_claim/")) &&
          path.includes(supersededAccepted.event_id),
      ),
    ).toEqual([]);
    const beforeErasureBytes = readGenerated(outputRoot, beforeErasureProjection.written);
    expect(beforeErasureBytes).toContain(`Supersedes: \`${supersededAccepted.event_id}\``);
    expect(beforeErasureBytes).not.toContain("accepted fact claim_g008_superseded_ok");
    expect(beforeErasureBytes).not.toContain("proposed claim claim_g008_superseded_ok");
    const otherZoneSnapshot = mirror.getObsidianProjectionInputSnapshot({
      visibleTrustZoneIds: [OTHER_TRUST_ZONE_ID],
    });
    expect(otherZoneSnapshot.events).toEqual([]);
    expect(otherZoneSnapshot.erasures).toEqual([]);
    const snapshotBeforeOtherZoneProjection = stableJson(mirror.getRetrievalInputSnapshot());
    const otherZoneProjection = rebuildObsidianProjection({
      snapshot: otherZoneSnapshot,
      config: { outputRoot: tempDir(), visibleTrustZoneIds: [OTHER_TRUST_ZONE_ID] },
    });
    expect(otherZoneProjection.written).toEqual([]);
    expect(stableJson(mirror.getRetrievalInputSnapshot())).toBe(snapshotBeforeOtherZoneProjection);
    const snapshotBeforeProjectionEdit = stableJson(mirror.getRetrievalInputSnapshot());
    writeFileSync(join(outputRoot, acceptedPath), "operator edit ignored by canonical store\n");
    expect(stableJson(mirror.getRetrievalInputSnapshot())).toBe(snapshotBeforeProjectionEdit);

    const erasure = erasureRecord({
      erasureId: "era_g008_negative_accept_001",
      targetEventId: acceptedDecision.event_id,
      minute: 13,
    });
    expect(await sourceTransport.push(pushForErasure(source.clientId, erasure))).toMatchObject({
      status: "accepted",
      zone_sequences: [{ trust_zone_id: currentTrustZoneId, last_sequence: 13 }],
    });
    expect(await mirrorSync.pullPage(new Date("2026-07-29T00:11:00Z"))).toMatchObject({
      imported_events: 0,
      imported_erasures: 1,
      after_sequence: 13,
    });

    const repairedProjection = rebuildObsidianProjection({
      snapshot: uniqueProjectionSnapshot(
        mirror.getObsidianProjectionInputSnapshot({ visibleTrustZoneIds }),
      ),
      config: projectionConfig(outputRoot),
    });
    expect(repairedProjection.deleted).toContain(acceptedPath);
    expect(existsSync(join(outputRoot, acceptedPath))).toBe(false);

    const repairedContext = await app.dispatch("memory_context_pack", {
      schema_version: "v1",
      visibility: {
        visible_trust_zone_ids: visibleTrustZoneIds,
        protected_value_policy: "metadata_only",
      },
      task: "After erasure",
      context_budget: { max_items: 50, max_characters: 20_000 },
    });
    expect(repairedContext.structuredContent.accepted_facts).toEqual([]);
    expect(repairedContext.structuredContent.erasures).toEqual(
      expect.arrayContaining([expect.objectContaining({ record_id: erasure.erasure_id })]),
    );
  }, 60_000);
});

function makeStore(label: string, key: Uint8Array): LocalCaptureStore {
  const runtimeDir = tempDir();
  return new LocalCaptureStore({
    runtimeDir,
    dbPath: join(runtimeDir, "carpeos.sqlite"),
    workspaceRoot: runtimeDir,
    trustZoneId: currentTrustZoneId,
    explicitProjectId: `project_g008_${label}`,
    keyProvider: new StaticKeyProvider(key),
    clock: { now: () => new Date(BASE_TIME) },
  });
}

function makeWorkerTransport(clientId: string, bearerCredential: string): SyncHttpTransport {
  return new SyncHttpTransport({
    baseUrl: "https://sync.g008.test",
    bearerCredential,
    clientId,
    fetch: async (input, init) => {
      if (worker === undefined) {
        throw new Error("local Worker is not running");
      }
      return (await worker.fetch(input as never, init as never)) as unknown as Response;
    },
  });
}

function projectionConfig(outputRoot: string): {
  outputRoot: string;
  visibleTrustZoneIds: string[];
} {
  return { outputRoot, visibleTrustZoneIds };
}

function trustZone(): TrustZone {
  return {
    trust_zone_id: currentTrustZoneId,
    isolation: "user_cloud",
    boundary_purpose: "synthetic G008 local e2e",
  };
}

function seedAuthorization(clientId: string, trustZoneId: string, bearerCredential: string): void {
  wrangler(
    "d1",
    "execute",
    "carpeos_sync_test",
    "--local",
    "--config",
    "wrangler.test.toml",
    "--command",
    `INSERT INTO client_authorizations (client_id, trust_zone_id, token_hash_sha256) VALUES ('${clientId}', '${trustZoneId}', '${sha256Hex(bearerCredential)}')`,
  );
}

function d1DumpContains(text: string): boolean {
  return wrangler(
    "d1",
    "execute",
    "carpeos_sync_test",
    "--local",
    "--config",
    "wrangler.test.toml",
    "--command",
    "SELECT event_json AS value FROM canonical_events UNION ALL SELECT result_json AS value FROM sync_requests UNION ALL SELECT object_key AS value FROM protected_value_uploads",
  ).includes(text);
}

function wrangler(...args: string[]): string {
  if (workerPersistDir === undefined) {
    throw new Error("local Worker persistence root is not initialized");
  }
  return execFileSync("pnpm", ["exec", "wrangler", ...args, "--persist-to", workerPersistDir], {
    cwd: WORKER_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function uniqueProjectionSnapshot(
  snapshot: LocalRetrievalInputSnapshot,
): LocalRetrievalInputSnapshot {
  const byEventId = new Map<string, LocalRetrievalInputSnapshot["events"][number]>();
  for (const event of snapshot.events) {
    const existing = byEventId.get(event.event_id);
    if (existing === undefined || existing.source !== "inbox") {
      byEventId.set(event.event_id, event);
    }
  }
  return {
    ...snapshot,
    events: [...byEventId.values()].sort(
      (left, right) =>
        left.trust_zone_id.localeCompare(right.trust_zone_id) ||
        left.zone_sequence - right.zone_sequence ||
        left.event_id.localeCompare(right.event_id),
    ),
  };
}

function pushForEvent(clientId: string, event: CanonicalEvent): SyncPushRequest {
  const request = {
    schema_version: "v1",
    request_id: `req_${event.event_id.slice(4)}`,
    client_id: clientId,
    trust_zone_id: event.trust_zone.trust_zone_id,
    idempotency_key: event.idempotency_key,
    request_fingerprint: event.request_fingerprint,
    events: [event],
    erasures: [],
  } satisfies SyncPushRequest;
  assertSchema("syncApi", request);
  return request;
}

function pushForErasure(clientId: string, erasure: ErasureLedgerRecord): SyncPushRequest {
  const request = {
    schema_version: "v1",
    request_id: `req_${erasure.erasure_id.slice(4)}`,
    client_id: clientId,
    trust_zone_id: erasure.trust_zone.trust_zone_id,
    idempotency_key: `idem_${erasure.erasure_id.slice(4)}`,
    request_fingerprint: digestRef(erasure.erasure_id),
    events: [],
    erasures: [erasure],
  } satisfies SyncPushRequest;
  assertSchema("syncApi", request);
  return request;
}

function observationEvent(input: {
  eventId: string;
  observationId: string;
  statement: string;
  minute: number;
  evidenceArtifactRefs: string[];
}): CanonicalEvent<"Observation"> {
  const event = {
    ...baseEvent(input.eventId, input.minute),
    event_type: "Observation",
    lifecycle_status: "active",
    epistemic_authority: "observed",
    payload: {
      observation_id: input.observationId,
      observed_at: `2026-07-20T00:${String(input.minute).padStart(2, "0")}:00Z`,
      statement: input.statement,
      evidence_artifact_refs:
        input.evidenceArtifactRefs.length === 0
          ? ["art_g008_synthetic_support"]
          : input.evidenceArtifactRefs,
    },
  } satisfies CanonicalEvent<"Observation">;
  assertSchema("canonicalEvent", event);
  return event;
}

function claimEvent(input: {
  eventId: string;
  claimId: string;
  statement: string;
  minute: number;
  support: ProvenanceRef[];
  lifecycleStatus?: "active" | "draft";
  authority?: CanonicalEvent["epistemic_authority"];
}): CanonicalEvent<"Claim"> {
  const event = {
    ...baseEvent(input.eventId, input.minute),
    event_type: "Claim",
    lifecycle_status: input.lifecycleStatus ?? "active",
    epistemic_authority: input.authority ?? "derived",
    payload: {
      claim_id: input.claimId,
      statement: input.statement,
      claim_type: "inference",
      support: input.support,
    },
  } satisfies CanonicalEvent<"Claim">;
  assertSchema("canonicalEvent", event);
  return event;
}

function decisionEvent(input: {
  eventId: string;
  decisionId: string;
  claimRefs: string[];
  decision?: "accepted" | "rejected";
  minute: number;
}): CanonicalEvent<"AcceptanceDecision"> {
  const event = {
    ...baseEvent(input.eventId, input.minute),
    event_type: "AcceptanceDecision",
    lifecycle_status: "active",
    epistemic_authority: "verified",
    payload: {
      decision_id: input.decisionId,
      claim_refs: input.claimRefs,
      decision: input.decision ?? "accepted",
      decided_by: "actor_g008_synthetic",
      decided_at: `2026-07-29T00:${String(input.minute).padStart(2, "0")}:00Z`,
    },
  } satisfies CanonicalEvent<"AcceptanceDecision">;
  assertSchema("canonicalEvent", event);
  return event;
}

function supersessionEvent(input: {
  eventId: string;
  supersessionId: string;
  supersedesEventId: string;
  replacementEventId: string;
  minute: number;
}): CanonicalEvent<"Supersession"> {
  const event = {
    ...baseEvent(input.eventId, input.minute),
    event_type: "Supersession",
    lifecycle_status: "active",
    epistemic_authority: "verified",
    payload: {
      supersession_id: input.supersessionId,
      supersedes_event_id: input.supersedesEventId,
      replacement_event_id: input.replacementEventId,
      reason: "Synthetic G008 supersession.",
    },
  } satisfies CanonicalEvent<"Supersession">;
  assertSchema("canonicalEvent", event);
  return event;
}

function erasureRecord(input: {
  erasureId: string;
  targetEventId: string;
  minute: number;
}): ErasureLedgerRecord {
  const erasure = {
    schema_version: "v1",
    erasure_id: input.erasureId,
    target_ref: {
      target_kind: "event",
      target_id: input.targetEventId,
      reason: "Synthetic G008 erasure.",
    },
    requested_at: `2026-07-29T00:${String(input.minute).padStart(2, "0")}:00Z`,
    completed_at: `2026-07-29T00:${String(input.minute).padStart(2, "0")}:01Z`,
    method: "tombstone",
    actor_ref: "actor_g008_synthetic",
    trust_zone: trustZone(),
    evidence_refs: [{ ref_type: "event", ref_id: input.targetEventId, relationship: "redacts" }],
  } satisfies ErasureLedgerRecord;
  assertSchema("erasureLedger", erasure);
  return erasure;
}

function baseEvent(eventId: string, minute: number) {
  return {
    schema_version: "v1" as const,
    event_id: eventId,
    subject_ref: "subject_g008",
    valid_time: { start: "2026-07-20T00:00:00Z", end: "2026-08-01T00:00:00Z" },
    recorded_time: {
      start: `2026-07-29T00:${String(minute).padStart(2, "0")}:00Z`,
      end: null,
    },
    trust_zone: trustZone(),
    provenance: [
      { ref_type: "external", ref_id: "external_g008_synthetic", relationship: "derived_from" },
    ] satisfies ProvenanceRef[],
    idempotency_key: `idem_${eventId.slice(4)}`,
    request_fingerprint: digestRef(eventId),
  };
}

function assertSchema(
  schemaName: "canonicalEvent" | "erasureLedger" | "syncApi",
  value: unknown,
): void {
  const conformance = validateConformance(schemaName, value);
  if (!conformance.valid) {
    throw new Error(`invalid ${schemaName}: ${conformance.errors.join("; ")}`);
  }
}

function runtimeContains(root: string, text: string): boolean {
  if (!existsSync(root)) {
    return false;
  }
  const stats = readFileSyncSafe(root);
  if (stats === undefined) {
    return false;
  }
  if (stats.kind === "file") {
    return stats.content.includes(text);
  }
  return stats.children.some((child) => runtimeContains(child, text));
}

function readFileSyncSafe(
  path: string,
): { kind: "file"; content: string } | { kind: "dir"; children: string[] } | undefined {
  try {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      return { kind: "dir", children: readdirSync(path).map((name) => join(path, name)) };
    }
    if (stat.isFile()) {
      return { kind: "file", content: readFileSync(path, "utf8") };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function readGenerated(root: string, paths: readonly string[]): string {
  return paths.map((path) => readFileSync(join(root, path), "utf8")).join("\n");
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "carpeos-g008-e2e-"));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  tempDirs.push(dir);
  return dir;
}

function stableJson(value: unknown): string {
  return JSON.stringify(toCanonicalJsonValue(value));
}

function digestRef(value: unknown): `sha-256:${string}` {
  return `sha-256:${sha256Hex(stableJson(value))}`;
}

function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function toCanonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toCanonicalJsonValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, toCanonicalJsonValue(item)]),
    );
  }
  return value;
}
