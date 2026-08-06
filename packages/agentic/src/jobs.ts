/**
 * Durable agentic job store + lease state machine (ADR 0017 D9).
 * No LLM. Delivery at-least-once; effects once via job_id / digests.
 *
 * States: pending → leased → succeeded | blocked | dead
 * Expired leases reclaim to pending (crash-safe).
 */

import { computeStageInputDigest, makeAgenticJobId, sha256Hex, stableJson } from "./digest.js";
import type { SqlDatabase } from "./sql.js";
import {
  AGENTIC_FLASH_MODEL_ID,
  AGENTIC_POLICY_VERSION,
  AGENTIC_PROMPT_VERSIONS,
  type AgenticJob,
  type AgenticJobEnqueueSpec,
  type AgenticJobState,
  type AgenticStageId,
} from "./types.js";

export type LeasedAgenticJob = {
  lease_id: string;
  lease_expires_at: string;
  job: AgenticJob;
};

export type AgenticJobStatusCounts = Record<AgenticJobState, number>;

type JobRow = { job_json: string };
type JobIdRow = { job_id: string };

const DEFAULT_MAX_ATTEMPTS = 8;
const TERMINAL: ReadonlySet<AgenticJobState> = new Set(["succeeded", "blocked", "dead"]);

export function migrateAgenticJobs(db: SqlDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agentic_jobs (
      job_id TEXT PRIMARY KEY,
      trust_zone_id TEXT NOT NULL,
      source_event_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      state TEXT NOT NULL,
      input_digest TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      available_at TEXT NOT NULL,
      lease_id TEXT,
      lease_expires_at TEXT,
      job_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(trust_zone_id, source_event_id, stage, input_digest)
    );
    CREATE INDEX IF NOT EXISTS idx_agentic_jobs_lease
      ON agentic_jobs (state, available_at, job_id);
    CREATE INDEX IF NOT EXISTS idx_agentic_jobs_zone
      ON agentic_jobs (trust_zone_id, state);
  `);
}

/**
 * Idempotent enqueue: same stage identity returns the existing job without
 * resetting terminal state.
 */
export function enqueueAgenticJob(db: SqlDatabase, spec: AgenticJobEnqueueSpec): AgenticJob {
  migrateAgenticJobs(db);
  const now = spec.now ?? new Date();
  const model_id = spec.model_id ?? "fake";
  const prompt_version = spec.prompt_version ?? AGENTIC_PROMPT_VERSIONS[spec.stage];
  const digestInput = {
    stage: spec.stage,
    source_event_id: spec.source_event_id,
    trust_zone_id: spec.trust_zone_id,
    pack_digest: spec.pack_digest ?? null,
    prompt_version,
    model_id,
    policy_version: AGENTIC_POLICY_VERSION,
    prev_output_digest: spec.prev_output_digest ?? null,
    ...(spec.schema_version !== undefined ? { schema_version: spec.schema_version } : {}),
  };
  const input_digest = computeStageInputDigest(digestInput);
  const job_id = makeAgenticJobId(digestInput);

  const existing = getAgenticJob(db, job_id);
  if (existing !== undefined) {
    return existing;
  }

  const iso = now.toISOString();
  const job: AgenticJob = {
    schema: "carpeos.agentic.job/v1",
    job_id,
    trust_zone_id: spec.trust_zone_id,
    source_event_id: spec.source_event_id,
    stage: spec.stage,
    state: "pending",
    policy_version: AGENTIC_POLICY_VERSION,
    model_id,
    input_digest,
    output_digest: null,
    attempt: 0,
    max_attempts: spec.max_attempts ?? DEFAULT_MAX_ATTEMPTS,
    available_at: spec.available_at ?? iso,
    leased_at: null,
    lease_id: null,
    lease_expires_at: null,
    finished_at: null,
    error_code: null,
    last_error: null,
    canonical_effect: spec.canonical_effect ?? "none",
    created_at: iso,
    updated_at: iso,
  };
  writeJob(db, job);
  return job;
}

export function getAgenticJob(db: SqlDatabase, jobId: string): AgenticJob | undefined {
  migrateAgenticJobs(db);
  return readJob(db, jobId);
}

/** Read without migrate — safe inside open transactions (DDL would break IMMEDIATE). */
function readJob(db: SqlDatabase, jobId: string): AgenticJob | undefined {
  const row = db.prepare("SELECT job_json FROM agentic_jobs WHERE job_id = ?").get(jobId) as
    | JobRow
    | undefined;
  return row === undefined ? undefined : (JSON.parse(row.job_json) as AgenticJob);
}

/**
 * Lease up to `limit` due jobs. Expired leases are reclaimable.
 * Crash-safe: BEGIN IMMEDIATE + per-row re-check under lock.
 */
export function leaseAgenticJobs(
  db: SqlDatabase,
  input: { limit: number; leaseMs: number; now?: Date; trust_zone_id?: string },
): LeasedAgenticJob[] {
  migrateAgenticJobs(db);
  if (!Number.isInteger(input.limit) || input.limit < 1) {
    throw new Error("lease limit must be a positive integer");
  }
  if (!Number.isInteger(input.leaseMs) || input.leaseMs < 1) {
    throw new Error("leaseMs must be a positive integer");
  }

  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const lease_id = `lease_${sha256Hex(`${nowIso}:${Math.random()}`).slice(0, 24)}`;
  const lease_expires_at = new Date(now.getTime() + input.leaseMs).toISOString();

  const zoneFilter = input.trust_zone_id !== undefined;
  const sql = zoneFilter
    ? `
      SELECT job_id FROM agentic_jobs
      WHERE trust_zone_id = ?
        AND state IN ('pending', 'leased')
        AND available_at <= ?
        AND (state != 'leased' OR lease_expires_at <= ?)
      ORDER BY available_at ASC, job_id ASC
      LIMIT ?
    `
    : `
      SELECT job_id FROM agentic_jobs
      WHERE state IN ('pending', 'leased')
        AND available_at <= ?
        AND (state != 'leased' OR lease_expires_at <= ?)
      ORDER BY available_at ASC, job_id ASC
      LIMIT ?
    `;

  const rows = (
    zoneFilter
      ? db.prepare(sql).all(input.trust_zone_id, nowIso, nowIso, input.limit)
      : db.prepare(sql).all(nowIso, nowIso, input.limit)
  ) as JobIdRow[];

  const leased: LeasedAgenticJob[] = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) {
      const current = readJob(db, row.job_id);
      if (current === undefined || !isLeaseable(current, nowIso)) {
        continue;
      }
      const job: AgenticJob = {
        ...current,
        state: "leased",
        attempt: current.attempt + 1,
        lease_id,
        lease_expires_at,
        leased_at: nowIso,
        updated_at: nowIso,
        error_code: null,
        last_error: null,
      };
      writeJob(db, job);
      leased.push({ lease_id, lease_expires_at, job });
    }
    db.exec("COMMIT");
    return leased;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Mark leased job succeeded with optional output digest (effects once via job_id). */
export function completeAgenticJob(
  db: SqlDatabase,
  input: {
    jobId: string;
    leaseId: string;
    output_digest?: string | null;
    canonical_effect?: AgenticJob["canonical_effect"];
    now?: Date;
  },
): boolean {
  migrateAgenticJobs(db);
  const job = getAgenticJob(db, input.jobId);
  if (job === undefined || job.state !== "leased" || job.lease_id !== input.leaseId) {
    return false;
  }
  const now = input.now ?? new Date();
  const iso = now.toISOString();
  writeJob(db, {
    ...withoutLease(job),
    state: "succeeded",
    output_digest: input.output_digest ?? job.output_digest,
    canonical_effect: input.canonical_effect ?? job.canonical_effect,
    finished_at: iso,
    updated_at: iso,
    error_code: null,
    last_error: null,
  });
  return true;
}

/** Retry later: pending with backoff. Exceeding max_attempts → dead. */
export function failAgenticJob(
  db: SqlDatabase,
  input: {
    jobId: string;
    leaseId: string;
    error_code: string;
    error?: string;
    now?: Date;
    /** When true, go straight to blocked (needs operator). */
    block?: boolean;
  },
): boolean {
  migrateAgenticJobs(db);
  const job = getAgenticJob(db, input.jobId);
  if (job === undefined || job.state !== "leased" || job.lease_id !== input.leaseId) {
    return false;
  }
  const now = input.now ?? new Date();
  const iso = now.toISOString();
  const sanitized = sanitizeAgenticError(input.error ?? input.error_code);

  if (input.block === true) {
    writeJob(db, {
      ...withoutLease(job),
      state: "blocked",
      finished_at: iso,
      updated_at: iso,
      error_code: input.error_code,
      last_error: sanitized,
    });
    return true;
  }

  if (job.attempt >= job.max_attempts) {
    writeJob(db, {
      ...withoutLease(job),
      state: "dead",
      finished_at: iso,
      updated_at: iso,
      error_code: input.error_code,
      last_error: sanitized,
    });
    return true;
  }

  const retryAt = boundedBackoff(now, job.attempt, job.job_id);
  writeJob(db, {
    ...withoutLease(job),
    state: "pending",
    available_at: retryAt.toISOString(),
    finished_at: null,
    updated_at: iso,
    error_code: input.error_code,
    last_error: sanitized,
  });
  return true;
}

export function countAgenticJobs(db: SqlDatabase, trust_zone_id?: string): AgenticJobStatusCounts {
  migrateAgenticJobs(db);
  const counts: AgenticJobStatusCounts = {
    pending: 0,
    leased: 0,
    succeeded: 0,
    blocked: 0,
    dead: 0,
  };
  const rows = (
    trust_zone_id !== undefined
      ? db
          .prepare(
            `SELECT state, COUNT(*) AS n FROM agentic_jobs WHERE trust_zone_id = ? GROUP BY state`,
          )
          .all(trust_zone_id)
      : db.prepare(`SELECT state, COUNT(*) AS n FROM agentic_jobs GROUP BY state`).all()
  ) as Array<{ state: string; n: number | bigint }>;

  for (const row of rows) {
    if (row.state in counts) {
      counts[row.state as AgenticJobState] = Number(row.n);
    }
  }
  return counts;
}

export function listAgenticJobs(
  db: SqlDatabase,
  input: { trust_zone_id?: string; state?: AgenticJobState; limit?: number } = {},
): AgenticJob[] {
  migrateAgenticJobs(db);
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("list limit must be a positive integer");
  }

  let sql = `SELECT job_json FROM agentic_jobs WHERE 1=1`;
  const params: unknown[] = [];
  if (input.trust_zone_id !== undefined) {
    sql += ` AND trust_zone_id = ?`;
    params.push(input.trust_zone_id);
  }
  if (input.state !== undefined) {
    sql += ` AND state = ?`;
    params.push(input.state);
  }
  sql += ` ORDER BY available_at ASC, job_id ASC LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as JobRow[];
  return rows.map((r) => JSON.parse(r.job_json) as AgenticJob);
}

export function isTerminalAgenticState(state: AgenticJobState): boolean {
  return TERMINAL.has(state);
}

export function sanitizeAgenticError(error: string): string {
  return error
    .replace(/["'`][^"'`]{16,}["'`]/g, "[redacted]")
    .replace(/\b(sk-[a-z0-9]{10,}|api[_-]?key|bearer\s+[a-z0-9._-]+)\b/gi, "[secret]")
    .replace(/\b[a-f0-9]{64}\b/gi, "[digest]")
    .slice(0, 500)
    .trim();
}

function isLeaseable(job: AgenticJob, nowIso: string): boolean {
  if (job.available_at > nowIso) return false;
  if (job.state === "pending") return true;
  if (job.state === "leased") {
    return job.lease_expires_at !== null && job.lease_expires_at <= nowIso;
  }
  return false;
}

function withoutLease(job: AgenticJob): AgenticJob {
  return {
    ...job,
    lease_id: null,
    lease_expires_at: null,
    leased_at: null,
  };
}

function writeJob(db: SqlDatabase, job: AgenticJob): void {
  assertJob(job);
  db.prepare(`
    INSERT INTO agentic_jobs (
      job_id, trust_zone_id, source_event_id, stage, state, input_digest,
      attempt, available_at, lease_id, lease_expires_at, job_json, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET
      state=excluded.state,
      attempt=excluded.attempt,
      available_at=excluded.available_at,
      lease_id=excluded.lease_id,
      lease_expires_at=excluded.lease_expires_at,
      job_json=excluded.job_json,
      updated_at=excluded.updated_at
  `).run(
    job.job_id,
    job.trust_zone_id,
    job.source_event_id,
    job.stage,
    job.state,
    job.input_digest,
    job.attempt,
    job.available_at,
    job.lease_id,
    job.lease_expires_at,
    stableJson(job),
    job.updated_at,
  );
}

function assertJob(job: AgenticJob): void {
  if (job.schema !== "carpeos.agentic.job/v1") {
    throw new Error(`invalid agentic job schema: ${job.schema}`);
  }
  if (job.policy_version !== AGENTIC_POLICY_VERSION) {
    throw new Error(`invalid policy_version: ${job.policy_version}`);
  }
  if (job.model_id !== "fake" && job.model_id !== AGENTIC_FLASH_MODEL_ID) {
    throw new Error(`invalid model_id for Product 6: ${job.model_id}`);
  }
  const stages: AgenticStageId[] = [
    "admit",
    "pack",
    "triage",
    "extract",
    "verify",
    "structure",
    "gate",
    "materialize",
    "project",
  ];
  if (!stages.includes(job.stage)) {
    throw new Error(`invalid stage: ${job.stage}`);
  }
}

function boundedBackoff(now: Date, attempts: number, seed: string): Date {
  const baseMs = Math.min(3_600_000, 1_000 * 2 ** Math.min(10, Math.max(0, attempts - 1)));
  const jitterMs = Number.parseInt(sha256Hex(seed).slice(0, 6), 16) % 1_000;
  return new Date(now.getTime() + baseMs + jitterMs);
}
