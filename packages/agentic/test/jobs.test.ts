import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { computeStageInputDigest, makeAgenticJobId } from "../src/digest.js";
import {
  completeAgenticJob,
  countAgenticJobs,
  enqueueAgenticJob,
  failAgenticJob,
  getAgenticJob,
  leaseAgenticJobs,
  listAgenticJobs,
} from "../src/jobs.js";
import { AGENTIC_FLASH_MODEL_ID, AGENTIC_POLICY_VERSION } from "../src/types.js";

const dirs: string[] = [];
const now = new Date("2026-08-06T12:00:00Z");

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDb(): DatabaseSync {
  const dir = mkdtempSync(join(tmpdir(), "agentic-jobs-"));
  dirs.push(dir);
  return new DatabaseSync(join(dir, "jobs.sqlite"));
}

function spec(overrides: Partial<Parameters<typeof enqueueAgenticJob>[1]> = {}) {
  return {
    trust_zone_id: "tz_synthetic",
    source_event_id: "evt_synthetic_session_end_1",
    stage: "admit" as const,
    model_id: "fake" as const,
    now,
    ...overrides,
  };
}

describe("stage digests", () => {
  it("is stable for identical stage identity material", () => {
    const a = computeStageInputDigest({
      stage: "triage",
      source_event_id: "evt_1",
      trust_zone_id: "tz_a",
      pack_digest: "sha256:abc",
      model_id: AGENTIC_FLASH_MODEL_ID,
      policy_version: AGENTIC_POLICY_VERSION,
    });
    const b = computeStageInputDigest({
      stage: "triage",
      source_event_id: "evt_1",
      trust_zone_id: "tz_a",
      pack_digest: "sha256:abc",
      model_id: AGENTIC_FLASH_MODEL_ID,
      policy_version: AGENTIC_POLICY_VERSION,
    });
    expect(a).toBe(b);
    expect(a.startsWith("sha256:")).toBe(true);
    expect(
      makeAgenticJobId({
        stage: "triage",
        source_event_id: "evt_1",
        trust_zone_id: "tz_a",
        pack_digest: "sha256:abc",
        model_id: AGENTIC_FLASH_MODEL_ID,
      }),
    ).toMatch(/^agj_[a-f0-9]{40}$/);
  });

  it("changes when pack, prompt, model, or policy changes", () => {
    const base = {
      stage: "extract" as const,
      source_event_id: "evt_1",
      trust_zone_id: "tz_a",
      pack_digest: "sha256:pack1",
      model_id: "fake" as const,
    };
    const d0 = computeStageInputDigest(base);
    expect(computeStageInputDigest({ ...base, pack_digest: "sha256:pack2" })).not.toBe(d0);
    expect(computeStageInputDigest({ ...base, prompt_version: "agentic.extract/v2" })).not.toBe(d0);
    expect(computeStageInputDigest({ ...base, model_id: AGENTIC_FLASH_MODEL_ID })).not.toBe(d0);
    expect(computeStageInputDigest({ ...base, policy_version: "agentic_v2" })).not.toBe(d0);
  });
});

describe("agentic job store", () => {
  it("enqueues idempotently for the same stage identity", () => {
    const db = makeDb();
    const first = enqueueAgenticJob(db, spec());
    const replay = enqueueAgenticJob(db, spec());
    expect(replay).toEqual(first);
    expect(first.state).toBe("pending");
    expect(first.canonical_effect).toBe("none");
    expect(first.policy_version).toBe("agentic_v1.1");
    expect(countAgenticJobs(db).pending).toBe(1);
    db.close();
  });

  it("leases and rewrites durable jobs stamped agentic_v1 (pre-6.7 compat)", () => {
    const db = makeDb();
    const job = enqueueAgenticJob(db, spec({ source_event_id: "evt_legacy_policy" }));
    // Simulate a pre-quality job row still on disk.
    const legacy = { ...job, policy_version: "agentic_v1" as const };
    db.prepare(`UPDATE agentic_jobs SET job_json = ? WHERE job_id = ?`).run(
      JSON.stringify(legacy),
      job.job_id,
    );
    const lease = leaseAgenticJobs(db, { limit: 1, leaseMs: 30_000, now });
    expect(lease).toHaveLength(1);
    expect(lease[0]?.job.policy_version).toBe("agentic_v1");
    expect(lease[0]?.job.state).toBe("leased");
    db.close();
  });

  it("leases due jobs once and rejects concurrent double-lease", () => {
    const db = makeDb();
    enqueueAgenticJob(db, spec());
    enqueueAgenticJob(db, spec({ source_event_id: "evt_synthetic_2", stage: "pack" }));

    const lease = leaseAgenticJobs(db, { limit: 1, leaseMs: 30_000, now });
    expect(lease).toHaveLength(1);
    const first = lease[0];
    if (first === undefined) throw new Error("expected first lease");
    expect(first.job.state).toBe("leased");
    expect(first.job.attempt).toBe(1);
    expect(first.lease_id).toMatch(/^lease_/);

    const secondBatch = leaseAgenticJobs(db, { limit: 10, leaseMs: 30_000, now });
    expect(secondBatch).toHaveLength(1);
    const second = secondBatch[0];
    if (second === undefined) throw new Error("expected second lease");
    expect(second.job.job_id).not.toBe(first.job.job_id);
    const leasedSources = new Set([first.job.source_event_id, second.job.source_event_id]);
    expect(leasedSources).toEqual(new Set(["evt_synthetic_session_end_1", "evt_synthetic_2"]));

    expect(leaseAgenticJobs(db, { limit: 10, leaseMs: 30_000, now })).toHaveLength(0);
    db.close();
  });

  it("reclaims expired leases and rejects stale lease completion", () => {
    const db = makeDb();
    const job = enqueueAgenticJob(db, spec());
    const firstLease = leaseAgenticJobs(db, { limit: 1, leaseMs: 1_000, now })[0];
    expect(firstLease).toBeDefined();
    if (firstLease === undefined) throw new Error("expected first lease");

    const reclaimed = leaseAgenticJobs(db, {
      limit: 1,
      leaseMs: 5_000,
      now: new Date("2026-08-06T12:00:02Z"),
    })[0];
    expect(reclaimed).toBeDefined();
    if (reclaimed === undefined) throw new Error("expected reclaim");
    expect(reclaimed.job.attempt).toBe(2);
    expect(reclaimed.lease_id).not.toBe(firstLease.lease_id);

    expect(
      completeAgenticJob(db, {
        jobId: job.job_id,
        leaseId: firstLease.lease_id,
        output_digest: "sha256:stale",
        now: new Date("2026-08-06T12:00:03Z"),
      }),
    ).toBe(false);

    expect(
      completeAgenticJob(db, {
        jobId: job.job_id,
        leaseId: reclaimed.lease_id,
        output_digest: "sha256:ok",
        now: new Date("2026-08-06T12:00:03Z"),
      }),
    ).toBe(true);

    const done = getAgenticJob(db, job.job_id);
    expect(done?.state).toBe("succeeded");
    expect(done?.output_digest).toBe("sha256:ok");
    expect(done?.lease_id).toBeNull();
    expect(leaseAgenticJobs(db, { limit: 1, leaseMs: 1_000, now })).toHaveLength(0);
    db.close();
  });

  it("retries with backoff then marks dead after max_attempts", () => {
    const db = makeDb();
    const job = enqueueAgenticJob(db, spec({ max_attempts: 2 }));
    const l1 = leaseAgenticJobs(db, { limit: 1, leaseMs: 30_000, now })[0];
    if (l1 === undefined) throw new Error("expected lease");
    expect(
      failAgenticJob(db, {
        jobId: job.job_id,
        leaseId: l1.lease_id,
        error_code: "transient",
        error: "temporary glitch",
        now,
      }),
    ).toBe(true);
    const afterFail = getAgenticJob(db, job.job_id);
    if (afterFail === undefined) throw new Error("expected job after fail");
    expect(afterFail.state).toBe("pending");
    expect(afterFail.available_at > now.toISOString()).toBe(true);

    const later = new Date(afterFail.available_at);
    const l2 = leaseAgenticJobs(db, { limit: 1, leaseMs: 30_000, now: later })[0];
    if (l2 === undefined) throw new Error("expected second lease");
    expect(l2.job.attempt).toBe(2);
    expect(
      failAgenticJob(db, {
        jobId: job.job_id,
        leaseId: l2.lease_id,
        error_code: "still_bad",
        now: later,
      }),
    ).toBe(true);
    expect(getAgenticJob(db, job.job_id)?.state).toBe("dead");
    expect(countAgenticJobs(db).dead).toBe(1);
    db.close();
  });

  it("blocks on operator path without retry", () => {
    const db = makeDb();
    const job = enqueueAgenticJob(db, spec());
    const lease = leaseAgenticJobs(db, { limit: 1, leaseMs: 30_000, now })[0];
    if (lease === undefined) throw new Error("expected lease");
    expect(
      failAgenticJob(db, {
        jobId: job.job_id,
        leaseId: lease.lease_id,
        error_code: "need_context",
        block: true,
        now,
      }),
    ).toBe(true);
    expect(getAgenticJob(db, job.job_id)?.state).toBe("blocked");
    db.close();
  });

  it("filters by trust zone and lists jobs", () => {
    const db = makeDb();
    enqueueAgenticJob(db, spec({ trust_zone_id: "tz_a" }));
    enqueueAgenticJob(db, spec({ trust_zone_id: "tz_b", source_event_id: "evt_b" }));
    expect(countAgenticJobs(db, "tz_a").pending).toBe(1);
    expect(countAgenticJobs(db, "tz_b").pending).toBe(1);
    const listed = listAgenticJobs(db, { trust_zone_id: "tz_a", state: "pending" });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.trust_zone_id).toBe("tz_a");
    db.close();
  });

  it("refuses non-Flash real model ids at write", () => {
    const db = makeDb();
    expect(() =>
      enqueueAgenticJob(
        db,
        // @ts-expect-error intentional invalid model for Product 6 freeze
        spec({ model_id: "gpt-5.6-luna" }),
      ),
    ).toThrow(/invalid model_id/);
    db.close();
  });
});
