import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  ackEmbeddingJob,
  blockEmbeddingJob,
  ensureEmbeddingJob,
  leaseEmbeddingJobs,
  makeEmbeddingRecord,
  nextUtcMidnight,
  retryEmbeddingJob,
  sanitizeEmbeddingError,
} from "../src/embedding-jobs.js";
import { migrateLocalRetrievalIndex, storeLocalVector } from "../src/local-index.js";

const dirs: string[] = [];
const chunkId = `chk_${"a".repeat(40)}`;
const now = new Date("2026-01-01T23:59:59Z");

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("embedding job queue", () => {
  it("creates jobs idempotently and leases bounded due rows once", () => {
    const db = makeDb();
    const first = ensureEmbeddingJob(db, spec());
    const replay = ensureEmbeddingJob(db, spec());

    expect(replay).toEqual(first);

    const lease = leaseEmbeddingJobs(db, { limit: 1, leaseMs: 30_000, now });
    expect(lease).toHaveLength(1);
    expect(lease[0]?.job).toMatchObject({ state: "leased", attempts: 1 });
    expect(leaseEmbeddingJobs(db, { limit: 1, leaseMs: 30_000, now })).toHaveLength(0);

    db.close();
  });

  it("reclaims expired leases and rejects stale lease acknowledgements", () => {
    const db = makeDb();
    const job = ensureEmbeddingJob(db, spec());
    const firstLease = leaseEmbeddingJobs(db, { limit: 1, leaseMs: 1_000, now })[0];
    const reclaimed = leaseEmbeddingJobs(db, {
      limit: 1,
      leaseMs: 1_000,
      now: new Date("2026-01-02T00:00:01Z"),
    })[0];
    if (firstLease === undefined || reclaimed === undefined) {
      throw new Error("expected lease");
    }

    const record = makeEmbeddingRecord({
      chunkId,
      vector: vector768(),
      embeddingModel: spec().embeddingModel,
      embeddingVersion: spec().embeddingVersion,
      pooling: spec().pooling,
      inputTextSha256: `sha-256:${"b".repeat(64)}`,
      createdAt: "2026-01-02T00:00:02Z",
    });

    expect(ackEmbeddingJob(db, { jobId: job.job_id, leaseId: firstLease.lease_id, record })).toBe(
      false,
    );
    expect(ackEmbeddingJob(db, { jobId: job.job_id, leaseId: reclaimed.lease_id, record })).toBe(
      true,
    );
    expect(leaseEmbeddingJobs(db, { limit: 1, leaseMs: 1_000, now })).toHaveLength(0);

    db.close();
  });

  it("classifies retry timing, UTC allocation reset, blocking, and sanitized errors", () => {
    const db = makeDb();
    const retryJob = ensureEmbeddingJob(db, spec({ chunkId: `chk_${"b".repeat(40)}` }));
    const retryLease = leaseEmbeddingJobs(db, { limit: 1, leaseMs: 30_000, now })[0];
    if (retryLease === undefined) {
      throw new Error("expected retry lease");
    }

    expect(
      retryEmbeddingJob(db, {
        jobId: retryJob.job_id,
        leaseId: retryLease.lease_id,
        failureKind: "workers_ai_allocation_exhausted",
        error: `allocation exhausted with source text "${"secret ".repeat(20)}"`,
        now,
      }),
    ).toBe(true);
    expect(nextUtcMidnight(now).toISOString()).toBe("2026-01-02T00:00:00.000Z");
    expect(sanitizeEmbeddingError(`bad "${"secret ".repeat(20)}"`)).not.toContain("secret secret");

    const blockJob = ensureEmbeddingJob(db, spec({ chunkId: `chk_${"c".repeat(40)}` }));
    const blockLease = leaseEmbeddingJobs(db, {
      limit: 1,
      leaseMs: 30_000,
      now: new Date("2026-01-02T00:00:00Z"),
    })[0];
    if (blockLease === undefined) {
      throw new Error("expected block lease");
    }
    expect(
      blockEmbeddingJob(db, {
        jobId: blockJob.job_id,
        leaseId: blockLease.lease_id,
        failureKind: "dimension_mismatch",
        error: "dimension mismatch",
        now,
      }),
    ).toBe(true);

    db.close();
  });

  it("rejects wrong dimension, non-finite, and tampered local vectors", () => {
    const db = makeDb();
    const vector = vector768();
    const record = makeEmbeddingRecord({
      chunkId,
      vector,
      embeddingModel: spec().embeddingModel,
      embeddingVersion: spec().embeddingVersion,
      pooling: spec().pooling,
      inputTextSha256: `sha-256:${"b".repeat(64)}`,
      createdAt: "2026-01-02T00:00:02Z",
    });

    expect(() =>
      makeEmbeddingRecord({
        chunkId,
        vector: vector.slice(0, 767),
        embeddingModel: spec().embeddingModel,
        embeddingVersion: spec().embeddingVersion,
        pooling: spec().pooling,
        inputTextSha256: `sha-256:${"b".repeat(64)}`,
        createdAt: "2026-01-02T00:00:02Z",
      }),
    ).toThrow("embedding vector dimension mismatch");
    expect(() =>
      makeEmbeddingRecord({
        chunkId,
        vector: withVectorValue(Number.NaN),
        embeddingModel: spec().embeddingModel,
        embeddingVersion: spec().embeddingVersion,
        pooling: spec().pooling,
        inputTextSha256: `sha-256:${"b".repeat(64)}`,
        createdAt: "2026-01-02T00:00:02Z",
      }),
    ).toThrow("embedding vector must contain only finite numbers");
    expect(() =>
      makeEmbeddingRecord({
        chunkId,
        vector: withVectorValue(Number.POSITIVE_INFINITY),
        embeddingModel: spec().embeddingModel,
        embeddingVersion: spec().embeddingVersion,
        pooling: spec().pooling,
        inputTextSha256: `sha-256:${"b".repeat(64)}`,
        createdAt: "2026-01-02T00:00:02Z",
      }),
    ).toThrow("embedding vector must contain only finite numbers");

    migrateLocalRetrievalIndex(db);
    expect(() =>
      storeLocalVector(db, {
        record,
        vector: vector.map((value, index) => (index === 0 ? value + 1 : value)),
      }),
    ).toThrow("embedding vector digest mismatch");
    expect(() => storeLocalVector(db, { record, vector: vector.slice(0, 767) })).toThrow(
      "embedding vector dimension mismatch",
    );
    db.prepare(`
      INSERT INTO retrieval_chunks (
        chunk_id, trust_zone_id, projection_version, chunk_kind, lifecycle_status,
        epistemic_authority, status, max_zone_sequence, text, chunk_json, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      chunkId,
      "tz_local_default",
      "retrieval/v1",
      "claim",
      "active",
      "derived",
      "active",
      1,
      "synthetic chunk",
      "{}",
      "2026-01-02T00:00:02Z",
    );
    storeLocalVector(db, { record, vector });

    db.close();
  });
});

function spec(overrides: Partial<Parameters<typeof ensureEmbeddingJob>[1]> = {}) {
  return {
    chunkId,
    embeddingModel: "@cf/baai/bge-base-en-v1.5",
    embeddingVersion: "v1",
    pooling: "mean" as const,
    now,
    ...overrides,
  };
}

function makeDb(): DatabaseSync {
  const dir = mkdtempSync(join(tmpdir(), "carpeos-retrieval-jobs-"));
  dirs.push(dir);
  return new DatabaseSync(join(dir, "jobs.sqlite"));
}

function vector768(): number[] {
  return Array.from({ length: 768 }, (_, index) => index / 768);
}

function withVectorValue(value: number): number[] {
  const vector = vector768();
  vector[0] = value;
  return vector;
}
