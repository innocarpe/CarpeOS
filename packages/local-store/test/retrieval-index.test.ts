import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CanonicalEvent,
  ErasureLedgerRecord,
  ProvenanceRef,
  RetrievalQuery,
  TrustZone,
} from "@carpeos/schema";
import { afterEach, describe, expect, it } from "vitest";
import {
  migrateLocalRetrievalIndex,
  rebuildLocalRetrievalIndex,
  searchLocalRetrievalIndex,
  storeLocalVector,
} from "../../retrieval/src/local-index.js";
import {
  DETERMINISTIC_LOCAL_DEV_EMBEDDING,
  deterministicLocalDevEmbedding,
} from "../../retrieval/src/deterministic-local-dev.js";
import { makeEmbeddingRecord } from "../../retrieval/src/embedding-jobs.js";
import {
  type LocalRetrievalDatabase,
  type LocalStoreSqlStatement,
  LocalCaptureStore,
  StaticKeyProvider,
  withLocalRetrievalDatabase,
} from "../src/index.js";

const staticMaterial = new Uint8Array(32).fill(17);
const trustZone: TrustZone = { trust_zone_id: "tz_retrieval_index", isolation: "local_device" };
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("local retrieval index", () => {
  it("runs migration idempotently and uses exact FTS MATCH candidates", () => {
    const store = makeStore();
    store.importPulledEvent(observation, new Date("2026-01-01T00:01:00Z"));
    store.importPulledEvent(claimAlpha, new Date("2026-01-01T00:02:00Z"));

    const result = withLocalRetrievalDatabase(store, (db) => {
      migrateLocalRetrievalIndex(db);
      migrateLocalRetrievalIndex(db);
      rebuildLocalRetrievalIndex(db, new Date("2026-01-01T00:03:00Z"));
      return searchLocalRetrievalIndex(db, { query: query("deterministic") });
    });

    expect(result.results[0]).toMatchObject({
      status: "visible",
      text: "Alpha retrieval is deterministic.",
    });
    const noMatch = withLocalRetrievalDatabase(store, (db) =>
      searchLocalRetrievalIndex(db, { query: query("nonexistenttoken") }),
    );
    expect(noMatch.results).toHaveLength(0);
  });

  it("scopes FTS candidates to visible trust zones before limiting", () => {
    const store = makeStore();
    store.importPulledEvent(observation, new Date("2026-01-01T00:01:00Z"));
    store.importPulledEvent(claimAlpha, new Date("2026-01-01T00:02:00Z"));

    const result = withLocalRetrievalDatabase(store, (db) => {
      const rebuilt = rebuildLocalRetrievalIndex(db, new Date("2026-01-01T00:04:00Z"));
      const visible = rebuilt.chunks.find(
        (chunk) => chunk.text === "Alpha retrieval is deterministic.",
      );
      if (visible === undefined) {
        throw new Error("missing visible chunk");
      }
      const hidden = {
        ...visible,
        chunk_id: `chk_${"9".repeat(40)}`,
        trust_zone_id: "tz_hidden_retrieval",
        text: "Hidden deterministic retrieval candidate should not crowd out visible results.",
        source_records: visible.source_records.map((record) => ({
          ...record,
          trust_zone_id: "tz_hidden_retrieval",
          zone_sequence: 100,
        })),
      };
      db.prepare(`
        INSERT INTO retrieval_chunks (
          chunk_id, trust_zone_id, projection_version, chunk_kind, lifecycle_status,
          epistemic_authority, status, max_zone_sequence, text, chunk_json, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        hidden.chunk_id,
        hidden.trust_zone_id,
        hidden.projection_version,
        hidden.chunk_kind,
        hidden.lifecycle_status,
        hidden.epistemic_authority,
        hidden.status,
        100,
        hidden.text,
        JSON.stringify(hidden),
        "2026-01-01T00:04:01Z",
      );
      db.prepare("INSERT INTO retrieval_chunks_fts (chunk_id, text) VALUES (?, ?)").run(
        hidden.chunk_id,
        hidden.text,
      );
      return searchLocalRetrievalIndex(db, {
        query: { ...query("deterministic"), limit: 1 },
      });
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      status: "visible",
      text: "Alpha retrieval is deterministic.",
    });
    expect(
      result.results[0]?.lineage.source_records.every(
        (record) => record.trust_zone_id === trustZone.trust_zone_id,
      ),
    ).toBe(true);
  });

  it("rebuilds deterministically, records freshness, handles erasure, and does not mutate canonical JSON", () => {
    const store = makeStore();
    store.importPulledEvent(observation, new Date("2026-01-01T00:01:00Z"));
    store.importPulledEvent(claimAlpha, new Date("2026-01-01T00:02:00Z"));
    const before = store.getEvent(claimAlpha.event_id);
    store.persistSyncCursor({ afterSequence: 5, now: new Date("2026-01-01T00:04:00Z") });
    store.importPulledErasure(erasure, new Date("2026-01-01T00:05:00Z"));

    const first = withLocalRetrievalDatabase(store, (db) =>
      rebuildLocalRetrievalIndex(db, new Date("2026-01-01T00:06:00Z")),
    );
    const second = withLocalRetrievalDatabase(store, (db) =>
      rebuildLocalRetrievalIndex(db, new Date("2026-01-01T00:06:00Z")),
    );

    expect(second.chunks.map((chunk) => chunk.chunk_id)).toEqual(
      first.chunks.map((chunk) => chunk.chunk_id),
    );
    expect(first.chunks.some((chunk) => chunk.status === "projection_deleted")).toBe(true);
    expect(first.freshness[0]).toMatchObject({
      stale: false,
      last_indexed_zone_sequence: 5,
      sync_cursor_after_sequence: 5,
    });
    expect(store.getEvent(claimAlpha.event_id)).toEqual(before);
  });

  it("uses one compatible 768-dimensional deterministic space for fallback and stored semantic scores", () => {
    const store = makeStore();
    store.importPulledEvent(observation, new Date("2026-01-01T00:01:00Z"));
    store.importPulledEvent(claimAlpha, new Date("2026-01-01T00:02:00Z"));

    const semanticQuery = {
      ...query("Alpha retrieval deterministic"),
      ranking: {
        mode: "hybrid" as const,
        weights: { structured: 0, fts: 0, semantic: 1, recency: 0 },
      },
    };
    const result = withLocalRetrievalDatabase(store, (db) => {
      const rebuilt = rebuildLocalRetrievalIndex(db, new Date("2026-01-01T00:03:00Z"));
      const before = searchLocalRetrievalIndex(db, { query: semanticQuery });
      const target = rebuilt.chunks.find(
        (chunk) => chunk.text === "Alpha retrieval is deterministic.",
      );
      if (target === undefined) {
        throw new Error("missing target chunk");
      }
      const vector = deterministicLocalDevEmbedding(target.text);
      expect(vector).toHaveLength(768);
      expect(vector.every((value) => Number.isFinite(value))).toBe(true);
      storeLocalVector(db, {
        record: makeEmbeddingRecord({
          chunkId: target.chunk_id,
          vector,
          embeddingModel: DETERMINISTIC_LOCAL_DEV_EMBEDDING.model,
          embeddingVersion: DETERMINISTIC_LOCAL_DEV_EMBEDDING.version,
          pooling: DETERMINISTIC_LOCAL_DEV_EMBEDDING.pooling,
          inputTextSha256: target.text_digest,
          createdAt: "2026-01-01T00:04:00Z",
        }),
        vector,
      });
      const after = searchLocalRetrievalIndex(db, { query: semanticQuery });
      return { before, after, chunkId: target.chunk_id };
    });

    const beforeTarget = result.before.results.find((item) => item.chunk_id === result.chunkId);
    const afterTarget = result.after.results.find((item) => item.chunk_id === result.chunkId);
    expect(beforeTarget?.score.semantic).toBeGreaterThan(0);
    expect(afterTarget?.score.semantic).toBeCloseTo(beforeTarget?.score.semantic ?? 0, 12);
    expect(result.after.results.map((item) => item.chunk_id)).toEqual(
      result.before.results.map((item) => item.chunk_id),
    );
    expect(result.after.results.map((item) => item.chunk_id)).toEqual(
      result.before.results.map((item) => item.chunk_id),
    );
  });

  it("ignores incompatible stored vectors instead of comparing them as semantic matches", () => {
    const store = makeStore();
    store.importPulledEvent(observation, new Date("2026-01-01T00:01:00Z"));
    store.importPulledEvent(claimAlpha, new Date("2026-01-01T00:02:00Z"));

    const semanticQuery = {
      ...query("Alpha retrieval deterministic"),
      ranking: {
        mode: "hybrid" as const,
        weights: { structured: 0, fts: 0, semantic: 1, recency: 0 },
      },
    };
    const result = withLocalRetrievalDatabase(store, (db) => {
      const rebuilt = rebuildLocalRetrievalIndex(db, new Date("2026-01-01T00:03:00Z"));
      const before = searchLocalRetrievalIndex(db, { query: semanticQuery });
      const target = rebuilt.chunks.find(
        (chunk) => chunk.text === "Alpha retrieval is deterministic.",
      );
      if (target === undefined) {
        throw new Error("missing target chunk");
      }
      db.prepare(`
        INSERT INTO local_vectors (
          chunk_id, vector_json, vector_digest, embedding_model, embedding_version, pooling, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        target.chunk_id,
        JSON.stringify([1, 0, 0, 0, 0, 0, 0, 0]),
        `sha-256:${"9".repeat(64)}`,
        "incompatible-model",
        "v0",
        "cls",
        "2026-01-01T00:04:00Z",
      );
      const after = searchLocalRetrievalIndex(db, { query: semanticQuery });
      return { before, after, chunkId: target.chunk_id };
    });

    const beforeTarget = result.before.results.find((item) => item.chunk_id === result.chunkId);
    const afterTarget = result.after.results.find((item) => item.chunk_id === result.chunkId);
    expect(afterTarget?.score.semantic).toBeCloseTo(beforeTarget?.score.semantic ?? 0, 12);
    expect(afterTarget?.score.semantic).toBeGreaterThan(0);
    expect(result.after.results.map((item) => item.chunk_id)).toEqual(
      result.before.results.map((item) => item.chunk_id),
    );
    expect(result.after.results.map((item) => item.chunk_id)).toEqual(
      result.before.results.map((item) => item.chunk_id),
    );
  });

  it("invalidates leaked retrieval SQL sessions and statements after the callback returns", () => {
    const store = makeStore();
    let leakedSession: LocalRetrievalDatabase | undefined;
    let leakedStatement: LocalStoreSqlStatement | undefined;

    withLocalRetrievalDatabase(store, (db) => {
      leakedSession = db;
      leakedStatement = db.prepare("SELECT 1 AS value");
      expect(leakedStatement.get()).toEqual({ value: 1 });
    });

    expect(() => leakedSession?.exec("CREATE TABLE leaked_session (id INTEGER)")).toThrow(
      "retrieval SQL session is no longer active",
    );
    expect(() => leakedStatement?.get()).toThrow("retrieval SQL session is no longer active");
    expect(() => leakedStatement?.run()).toThrow("retrieval SQL session is no longer active");
    expect(() => leakedStatement?.all()).toThrow("retrieval SQL session is no longer active");
  });

  it("rejects async retrieval SQL callbacks before the leaked session can be reused later", () => {
    const store = makeStore();

    expect(() =>
      withLocalRetrievalDatabase(store, async (db) => {
        db.prepare("SELECT 1").get();
        return 1;
      }),
    ).toThrow("retrieval SQL callback must be synchronous");
  });
});

function makeStore(): LocalCaptureStore {
  const dir = mkdtempSync(join(tmpdir(), "carpeos-local-retrieval-"));
  dirs.push(dir);
  return new LocalCaptureStore({
    runtimeDir: dir,
    workspaceRoot: dir,
    trustZoneId: trustZone.trust_zone_id,
    keyProvider: new StaticKeyProvider(staticMaterial),
  });
}

function query(text: string): RetrievalQuery {
  return {
    schema_version: "v1",
    record_type: "retrieval_query",
    query_id: `query_${"a".repeat(24)}`,
    query_text: text,
    filters: {
      visible_trust_zone_ids: [trustZone.trust_zone_id],
      lifecycle_status: ["active"],
      epistemic_authority: ["observed", "derived", "verified"],
      protected_value_policy: "metadata_only",
      conflict_policy: "surface_conflicts",
    },
    ranking: { mode: "hybrid", weights: { structured: 1, fts: 1, semantic: 0, recency: 0 } },
    limit: 10,
  };
}

const base = {
  schema_version: "v1",
  subject_ref: "subject_alpha",
  valid_time: { start: "2026-01-01T00:00:00Z", end: null },
  lifecycle_status: "active",
  trust_zone: trustZone,
  provenance: [
    { ref_type: "external", ref_id: "external_fixture", relationship: "derived_from" },
  ] satisfies ProvenanceRef[],
} as const;

const observation: CanonicalEvent<"Observation"> = {
  ...base,
  event_id: "evt_observe001",
  event_type: "Observation",
  recorded_time: { start: "2026-01-01T00:01:00Z", end: null },
  epistemic_authority: "observed",
  idempotency_key: "idem_observe0010000000",
  request_fingerprint: `sha-256:${"1".repeat(64)}`,
  zone_sequence: 1,
  payload: {
    observation_id: "obs_alpha",
    observed_at: "2026-01-01T00:01:00Z",
    statement: "Alpha source observation.",
    evidence_artifact_refs: ["art_alpha_source"],
  },
};

const claimAlpha: CanonicalEvent<"Claim"> = {
  ...base,
  event_id: "evt_claim001",
  event_type: "Claim",
  recorded_time: { start: "2026-01-01T00:02:00Z", end: null },
  epistemic_authority: "derived",
  idempotency_key: "idem_claim00100000000",
  request_fingerprint: `sha-256:${"2".repeat(64)}`,
  zone_sequence: 2,
  payload: {
    claim_id: "claim_alpha",
    statement: "Alpha retrieval is deterministic.",
    claim_type: "inference",
    support: [{ ref_type: "observation", ref_id: "obs_alpha", relationship: "supports" }],
  },
};

const erasure: ErasureLedgerRecord = {
  schema_version: "v1",
  erasure_id: "era_retrieval0001",
  target_ref: { target_kind: "event", target_id: "evt_claim001", reason: "synthetic erasure" },
  requested_at: "2026-01-01T00:05:00Z",
  completed_at: "2026-01-01T00:05:30Z",
  method: "tombstone",
  actor_ref: "actor_synthetic",
  trust_zone: trustZone,
  evidence_refs: [{ ref_type: "external", ref_id: "external_erasure", relationship: "supports" }],
  zone_sequence: 5,
};
