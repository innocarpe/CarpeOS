import type { EmbeddingFailureKind, EmbeddingJob, EmbeddingRecord } from "@carpeos/schema";
import { validateConformance } from "@carpeos/schema";
import { assertVectorIntegrity, vectorDigest, type SqlDatabase } from "./local-index.js";
import { sha256Hex, sha256Ref, stableJson } from "./provenance.js";

export type EmbeddingJobSpec = {
  chunkId: string;
  embeddingModel: string;
  embeddingVersion: string;
  pooling: EmbeddingJob["pooling"];
  now?: Date;
};

export type LeasedEmbeddingJob = {
  lease_id: string;
  lease_expires_at: string;
  job: EmbeddingJob;
};

type JobRow = {
  job_json: string;
};

type JobIdRow = {
  job_id: string;
};

export function migrateEmbeddingJobs(db: SqlDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS embedding_jobs (
      job_id TEXT PRIMARY KEY,
      chunk_id TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      embedding_version TEXT NOT NULL,
      pooling TEXT NOT NULL,
      state TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      available_at TEXT NOT NULL,
      lease_id TEXT,
      lease_expires_at TEXT,
      job_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(chunk_id, embedding_model, embedding_version, pooling)
    );
    CREATE TABLE IF NOT EXISTS embedding_records (
      embedding_id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      record_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(chunk_id)
    );
  `);
}

export function ensureEmbeddingJob(db: SqlDatabase, spec: EmbeddingJobSpec): EmbeddingJob {
  migrateEmbeddingJobs(db);
  const now = spec.now ?? new Date();
  const jobId = makeEmbeddingJobId(spec);
  const existing = db.prepare("SELECT job_json FROM embedding_jobs WHERE job_id = ?").get(jobId) as
    | JobRow
    | undefined;
  if (existing !== undefined) {
    return JSON.parse(existing.job_json) as EmbeddingJob;
  }
  const job: EmbeddingJob = {
    schema_version: "v1",
    record_type: "embedding_job",
    job_id: jobId,
    chunk_id: spec.chunkId,
    embedding_model: spec.embeddingModel,
    embedding_version: spec.embeddingVersion,
    pooling: spec.pooling,
    state: "pending",
    attempts: 0,
    available_at: now.toISOString(),
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
  writeJob(db, job);
  return job;
}

export function leaseEmbeddingJobs(
  db: SqlDatabase,
  input: { limit: number; leaseMs: number; now?: Date },
): LeasedEmbeddingJob[] {
  migrateEmbeddingJobs(db);
  if (!Number.isInteger(input.limit) || input.limit < 1) {
    throw new Error("lease limit must be a positive integer");
  }
  if (!Number.isInteger(input.leaseMs) || input.leaseMs < 1) {
    throw new Error("leaseMs must be a positive integer");
  }
  const now = input.now ?? new Date();
  const leaseId = `lease_${sha256Hex(`${now.toISOString()}:${Math.random()}`).slice(0, 24)}`;
  const leaseExpiresAt = new Date(now.getTime() + input.leaseMs).toISOString();
  const rows = db
    .prepare(`
      SELECT job_id
      FROM embedding_jobs
      WHERE state IN ('pending', 'retryable_failed', 'leased')
        AND available_at <= ?
        AND (state != 'leased' OR lease_expires_at <= ?)
      ORDER BY available_at ASC, job_id ASC
      LIMIT ?
    `)
    .all(now.toISOString(), now.toISOString(), input.limit) as JobIdRow[];

  const leased: LeasedEmbeddingJob[] = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) {
      const current = getJob(db, row.job_id);
      if (
        current === undefined ||
        !["pending", "retryable_failed", "leased"].includes(current.state) ||
        current.available_at > now.toISOString() ||
        (current.state === "leased" &&
          current.lease_expires_at !== undefined &&
          current.lease_expires_at > now.toISOString())
      ) {
        continue;
      }
      const job = {
        ...current,
        state: "leased" as const,
        attempts: current.attempts + 1,
        lease_id: leaseId,
        lease_expires_at: leaseExpiresAt,
        updated_at: now.toISOString(),
      };
      writeJob(db, job);
      leased.push({ lease_id: leaseId, lease_expires_at: leaseExpiresAt, job });
    }
    db.exec("COMMIT");
    return leased;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function ackEmbeddingJob(
  db: SqlDatabase,
  input: { jobId: string; leaseId: string; record: EmbeddingRecord; now?: Date },
): boolean {
  migrateEmbeddingJobs(db);
  const job = getJob(db, input.jobId);
  if (job === undefined || job.state !== "leased" || job.lease_id !== input.leaseId) {
    return false;
  }
  const conformance = validateConformance("retrievalProjection", input.record);
  if (!conformance.valid || input.record.chunk_id !== job.chunk_id) {
    return false;
  }
  const now = input.now ?? new Date();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO embedding_records (embedding_id, job_id, chunk_id, record_json, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(chunk_id) DO UPDATE SET
        embedding_id=excluded.embedding_id,
        job_id=excluded.job_id,
        record_json=excluded.record_json,
        created_at=excluded.created_at
    `).run(
      input.record.embedding_id,
      input.jobId,
      input.record.chunk_id,
      stableJson(input.record),
      input.record.created_at,
    );
    writeJob(
      db,
      withoutLease({
        ...job,
        state: "embedded",
        updated_at: now.toISOString(),
      }),
    );
    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function retryEmbeddingJob(
  db: SqlDatabase,
  input: {
    jobId: string;
    leaseId: string;
    failureKind: EmbeddingFailureKind;
    error: string;
    now?: Date;
  },
): boolean {
  const job = getJob(db, input.jobId);
  if (job === undefined || job.state !== "leased" || job.lease_id !== input.leaseId) {
    return false;
  }
  const now = input.now ?? new Date();
  const retryAfter =
    input.failureKind === "workers_ai_allocation_exhausted"
      ? nextUtcMidnight(now)
      : boundedBackoff(now, job.attempts, input.jobId);
  writeJob(
    db,
    withoutLease(
      withQuotaReset(input.failureKind, {
        ...job,
        state: "retryable_failed",
        failure_kind: input.failureKind,
        retry_after: retryAfter.toISOString(),
        last_error: sanitizeEmbeddingError(input.error),
        available_at: retryAfter.toISOString(),
        updated_at: now.toISOString(),
      }),
    ),
  );
  return true;
}

export function blockEmbeddingJob(
  db: SqlDatabase,
  input: {
    jobId: string;
    leaseId: string;
    failureKind: EmbeddingFailureKind;
    error: string;
    now?: Date;
  },
): boolean {
  const job = getJob(db, input.jobId);
  if (job === undefined || job.state !== "leased" || job.lease_id !== input.leaseId) {
    return false;
  }
  const now = input.now ?? new Date();
  writeJob(
    db,
    withoutLease({
      ...job,
      state: "blocked",
      failure_kind: input.failureKind,
      last_error: sanitizeEmbeddingError(input.error),
      updated_at: now.toISOString(),
    }),
  );
  return true;
}

export function makeEmbeddingRecord(input: {
  chunkId: string;
  vector: readonly number[];
  embeddingModel: string;
  embeddingVersion: string;
  pooling: EmbeddingJob["pooling"];
  inputTextSha256: string;
  createdAt: string;
}): EmbeddingRecord {
  const vectorJson = stableJson(input.vector);
  const digest = vectorDigest(input.vector);
  assertVectorIntegrity(input.vector, digest, 768);
  return {
    schema_version: "v1",
    record_type: "embedding_record",
    embedding_id: `emb_${sha256Hex(`${input.chunkId}:${vectorJson}`).slice(0, 40)}`,
    chunk_id: input.chunkId,
    vector_ref: `local_vector:${input.chunkId}`,
    vector_digest: sha256Ref(vectorJson),
    provenance: {
      embedding_model: input.embeddingModel,
      embedding_dimensions: 768,
      embedding_version: input.embeddingVersion,
      pooling: input.pooling,
      input_token_limit: 512,
      input_text_sha256: input.inputTextSha256,
      created_at: input.createdAt,
    },
    created_at: input.createdAt,
  };
}

export function sanitizeEmbeddingError(error: string): string {
  return error
    .replace(/["'`][^"'`]{16,}["'`]/g, "[redacted]")
    .replace(/\b[a-f0-9]{64}\b/gi, "[digest]")
    .slice(0, 500)
    .trim();
}

export function nextUtcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

function getJob(db: SqlDatabase, jobId: string): EmbeddingJob | undefined {
  const row = db.prepare("SELECT job_json FROM embedding_jobs WHERE job_id = ?").get(jobId) as
    | JobRow
    | undefined;
  return row === undefined ? undefined : (JSON.parse(row.job_json) as EmbeddingJob);
}

function writeJob(db: SqlDatabase, job: EmbeddingJob): void {
  const normalized = Object.fromEntries(
    Object.entries(job).filter(([, value]) => value !== undefined),
  ) as unknown as EmbeddingJob;
  const conformance = validateConformance("retrievalProjection", normalized);
  if (!conformance.valid) {
    throw new Error(`invalid embedding job: ${conformance.errors.join("; ")}`);
  }
  db.prepare(`
    INSERT INTO embedding_jobs (
      job_id, chunk_id, embedding_model, embedding_version, pooling, state,
      attempts, available_at, lease_id, lease_expires_at, job_json, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET
      state=excluded.state,
      attempts=excluded.attempts,
      available_at=excluded.available_at,
      lease_id=excluded.lease_id,
      lease_expires_at=excluded.lease_expires_at,
      job_json=excluded.job_json,
      updated_at=excluded.updated_at
  `).run(
    normalized.job_id,
    normalized.chunk_id,
    normalized.embedding_model,
    normalized.embedding_version,
    normalized.pooling,
    normalized.state,
    normalized.attempts,
    normalized.available_at,
    normalized.lease_id ?? null,
    normalized.lease_expires_at ?? null,
    stableJson(normalized),
    normalized.updated_at,
  );
}

function withoutLease(job: EmbeddingJob): EmbeddingJob {
  const { lease_id: _leaseId, lease_expires_at: _leaseExpiresAt, ...rest } = job;
  return rest;
}

function withQuotaReset(failureKind: EmbeddingFailureKind, job: EmbeddingJob): EmbeddingJob {
  return failureKind === "workers_ai_allocation_exhausted"
    ? { ...job, quota_reset_at: job.retry_after ?? job.available_at }
    : job;
}

function makeEmbeddingJobId(spec: EmbeddingJobSpec): string {
  return `embjob_${sha256Hex(
    `${spec.chunkId}:${spec.embeddingModel}:${spec.embeddingVersion}:${spec.pooling}`,
  ).slice(0, 32)}`;
}

function boundedBackoff(now: Date, attempts: number, seed: string): Date {
  const baseMs = Math.min(3_600_000, 1_000 * 2 ** Math.min(10, Math.max(0, attempts - 1)));
  const jitterMs = Number.parseInt(sha256Hex(seed).slice(0, 6), 16) % 1_000;
  return new Date(now.getTime() + baseMs + jitterMs);
}
