import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { CanonicalEvent, Digest } from "@carpeos/schema";
import {
  rebuildGraphProjection,
  walkGraphNeighborhood,
  type CaptureOrigin,
} from "../src/graph-projection.js";
import {
  migrateLocalRetrievalIndex,
  rebuildLocalRetrievalIndex,
  searchLocalRetrievalIndex,
} from "../src/local-index.js";
import type { RetrievalQuery } from "@carpeos/schema";

/**
 * Product 3.0 R9 retrieval evaluation harness.
 *
 * Offline, synthetic, public-safe fixtures only. Measures multi-hop / cross-repo
 * / cross-worktree behavior and precision guardrails against the local projection.
 */

const trustZone = { trust_zone_id: "tz_eval", isolation: "local_device" as const };
const digest = (n: string): Digest => ({ algorithm: "sha-256", value: n.repeat(64) });

function eventBase<T extends CanonicalEvent["event_type"]>(
  partial: CanonicalEvent<T>,
): CanonicalEvent<T> {
  return partial;
}

function makeQuery(text: string, filters: Partial<RetrievalQuery["filters"]> = {}): RetrievalQuery {
  return {
    schema_version: "v1",
    record_type: "retrieval_query",
    query_id: `query_${"e".repeat(24)}`,
    query_text: text,
    filters: {
      visible_trust_zone_ids: [trustZone.trust_zone_id],
      lifecycle_status: ["active"],
      protected_value_policy: "metadata_only",
      conflict_policy: "surface_conflicts",
      ...filters,
    },
    ranking: {
      mode: "hybrid",
      weights: { structured: 1, fts: 1, semantic: 1, recency: 0.1 },
    },
    limit: 10,
  };
}

function openEvalDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE schema_migrations (
      migration_id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE canonical_events (
      event_id TEXT PRIMARY KEY,
      event_json TEXT NOT NULL,
      local_sequence INTEGER NOT NULL
    );
    CREATE TABLE sync_inbox_events (
      event_id TEXT PRIMARY KEY,
      event_json TEXT NOT NULL,
      zone_sequence INTEGER NOT NULL
    );
    CREATE TABLE sync_inbox_erasures (
      erasure_id TEXT PRIMARY KEY,
      erasure_json TEXT NOT NULL
    );
    CREATE TABLE sync_cursors (
      trust_zone_id TEXT PRIMARY KEY,
      after_sequence INTEGER NOT NULL
    );
    CREATE TABLE erasure_ledger (
      erasure_id TEXT PRIMARY KEY,
      erasure_json TEXT NOT NULL
    );
    CREATE TABLE capture_requests (
      event_id TEXT PRIMARY KEY,
      project_id TEXT,
      worktree_id TEXT,
      worktree_name TEXT,
      git_branch TEXT
    );
  `);
  migrateLocalRetrievalIndex(db, new Date("2026-01-01T00:00:00Z"));
  return db;
}

function seedEvent(db: DatabaseSync, event: CanonicalEvent, sequence: number): void {
  db.prepare(
    `INSERT INTO canonical_events (event_id, event_json, local_sequence) VALUES (?, ?, ?)`,
  ).run(event.event_id, JSON.stringify(event), sequence);
}

function seedOrigin(
  db: DatabaseSync,
  eventId: string,
  origin: Required<Pick<CaptureOrigin, "project_id" | "worktree_id" | "worktree_name">> &
    CaptureOrigin,
): void {
  db.prepare(
    `INSERT INTO capture_requests (event_id, project_id, worktree_id, worktree_name, git_branch)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    eventId,
    origin.project_id,
    origin.worktree_id,
    origin.worktree_name,
    origin.git_branch ?? null,
  );
}

const evidenceA = eventBase({
  schema_version: "v1",
  event_id: "evt_eval_evi_a",
  event_type: "EvidenceArtifact",
  subject_ref: "subject_auth",
  valid_time: { start: "2026-01-01T00:00:00Z", end: null },
  recorded_time: { start: "2026-01-01T00:00:00Z", end: null },
  lifecycle_status: "active",
  epistemic_authority: "observed",
  trust_zone: trustZone,
  provenance: [],
  idempotency_key: "idem_eval_evi_a_00001",
  request_fingerprint: `sha-256:${"a".repeat(64)}`,
  zone_sequence: 1,
  payload: {
    artifact_id: "art_eval_a",
    kind: "message",
    media_type: "application/json",
    content_ref: {
      ref_type: "external_uri",
      uri: "https://example.invalid/eval-a",
      digest: digest("a"),
      visibility: "private",
      reachability: "offline_snapshot",
    },
  },
});

const obsA = eventBase({
  schema_version: "v1",
  event_id: "evt_eval_obs_a",
  event_type: "Observation",
  subject_ref: "subject_auth",
  valid_time: { start: "2026-01-01T00:01:00Z", end: null },
  recorded_time: { start: "2026-01-01T00:01:00Z", end: null },
  lifecycle_status: "active",
  epistemic_authority: "derived",
  trust_zone: trustZone,
  provenance: [{ ref_type: "event", ref_id: "evt_eval_evi_a", relationship: "derived_from" }],
  idempotency_key: "idem_eval_obs_a_00001",
  request_fingerprint: `sha-256:${"b".repeat(64)}`,
  zone_sequence: 2,
  payload: {
    observation_id: "obs_eval_a",
    observed_at: "2026-01-01T00:01:00Z",
    statement: "Project Alpha auth decision: use local session tokens.",
    evidence_artifact_refs: ["art_eval_a"],
  },
});

const claimA = eventBase({
  schema_version: "v1",
  event_id: "evt_eval_claim_a",
  event_type: "Claim",
  subject_ref: "subject_auth",
  valid_time: { start: "2026-01-01T00:02:00Z", end: null },
  recorded_time: { start: "2026-01-01T00:02:00Z", end: null },
  lifecycle_status: "active",
  epistemic_authority: "derived",
  trust_zone: trustZone,
  provenance: [{ ref_type: "event", ref_id: "evt_eval_obs_a", relationship: "derived_from" }],
  idempotency_key: "idem_eval_claim_a_0001",
  request_fingerprint: `sha-256:${"c".repeat(64)}`,
  zone_sequence: 3,
  payload: {
    claim_id: "claim_eval_a",
    statement: "Accepted auth approach for Alpha is local session tokens.",
    claim_type: "decision",
    support: [{ ref_type: "event", ref_id: "evt_eval_obs_a", relationship: "supports" }],
  },
});

const obsB = eventBase({
  schema_version: "v1",
  event_id: "evt_eval_obs_b",
  event_type: "Observation",
  subject_ref: "subject_deploy",
  valid_time: { start: "2026-01-01T00:03:00Z", end: null },
  recorded_time: { start: "2026-01-01T00:03:00Z", end: null },
  lifecycle_status: "active",
  epistemic_authority: "derived",
  trust_zone: trustZone,
  provenance: [],
  idempotency_key: "idem_eval_obs_b_00001",
  request_fingerprint: `sha-256:${"d".repeat(64)}`,
  zone_sequence: 4,
  payload: {
    observation_id: "obs_eval_b",
    observed_at: "2026-01-01T00:03:00Z",
    statement: "Project Beta deploy window is Tuesday only.",
    evidence_artifact_refs: [],
  },
});

describe("retrieval evaluation harness (R9)", () => {
  it("recalls multi-hop related decisions within depth budget", () => {
    const db = openEvalDb();
    seedEvent(db, evidenceA, 1);
    seedEvent(db, obsA, 2);
    seedEvent(db, claimA, 3);
    seedOrigin(db, "evt_eval_evi_a", {
      project_id: "project_alpha",
      worktree_id: `wt_${"a".repeat(24)}`,
      worktree_name: "alpha-main",
    });
    rebuildLocalRetrievalIndex(db, new Date("2026-01-01T01:00:00Z"));

    const walk = walkGraphNeighborhood(db, {
      root_id: "evt_eval_obs_a",
      max_depth: 2,
      max_nodes: 64,
      visible_trust_zone_ids: [trustZone.trust_zone_id],
    });
    expect(walk.nodes.some((node) => node.source_event_id === "evt_eval_claim_a")).toBe(true);
    expect(walk.budgets.nodes_used).toBeLessThanOrEqual(64);
  });

  it("keeps cross-worktree recall under one project partition", () => {
    const db = openEvalDb();
    seedEvent(db, obsA, 1);
    seedEvent(db, claimA, 2);
    // Same project, different worktrees.
    seedOrigin(db, "evt_eval_obs_a", {
      project_id: "project_alpha",
      worktree_id: `wt_${"a".repeat(24)}`,
      worktree_name: "alpha-main",
    });
    seedOrigin(db, "evt_eval_claim_a", {
      project_id: "project_alpha",
      worktree_id: `wt_${"b".repeat(24)}`,
      worktree_name: "alpha-feature",
    });
    rebuildLocalRetrievalIndex(db, new Date("2026-01-01T01:00:00Z"));

    const result = searchLocalRetrievalIndex(db, {
      query: makeQuery("local session tokens", {
        project_ids: ["project_alpha"],
      }),
    });
    const texts = result.results
      .filter((item) => item.status === "visible")
      .map((item) => ("text" in item ? item.text : ""));
    expect(texts.some((text) => text.includes("local session tokens"))).toBe(true);
  });

  it("isolates cross-project scoped queries", () => {
    const db = openEvalDb();
    seedEvent(db, obsA, 1);
    seedEvent(db, obsB, 2);
    seedOrigin(db, "evt_eval_obs_a", {
      project_id: "project_alpha",
      worktree_id: `wt_${"a".repeat(24)}`,
      worktree_name: "alpha-main",
    });
    seedOrigin(db, "evt_eval_obs_b", {
      project_id: "project_beta",
      worktree_id: `wt_${"c".repeat(24)}`,
      worktree_name: "beta-main",
    });
    rebuildLocalRetrievalIndex(db, new Date("2026-01-01T01:00:00Z"));

    const alphaOnly = searchLocalRetrievalIndex(db, {
      query: makeQuery("deploy window Tuesday", {
        project_ids: ["project_alpha"],
      }),
    });
    const visible = alphaOnly.results.filter((item) => item.status === "visible");
    // Beta deploy knowledge must not appear under Alpha project scope.
    // Unknown-origin would remain visible; here origin is known and foreign.
    const leaked = visible.some((item) => "text" in item && item.text.includes("Tuesday"));
    expect(leaked).toBe(false);
  });

  it("never derives acceptance from graph structure alone", () => {
    const db = openEvalDb();
    seedEvent(db, obsA, 1);
    seedEvent(db, claimA, 2);
    rebuildGraphProjection(db, {
      events: [obsA, claimA],
      now: new Date("2026-01-01T01:00:00Z"),
    });
    const walk = walkGraphNeighborhood(db, {
      root_id: "evt_eval_claim_a",
      max_depth: 2,
      max_nodes: 32,
      visible_trust_zone_ids: [trustZone.trust_zone_id],
    });
    // No AcceptanceDecision was seeded; graph must not invent accepted_by.
    expect(walk.edges.every((edge) => edge.edge_kind !== "accepted_by")).toBe(true);
  });

  it("reports walk budget omissions honestly", () => {
    const db = openEvalDb();
    seedEvent(db, evidenceA, 1);
    seedEvent(db, obsA, 2);
    seedEvent(db, claimA, 3);
    rebuildGraphProjection(db, {
      events: [evidenceA, obsA, claimA],
      now: new Date("2026-01-01T01:00:00Z"),
    });
    const tight = walkGraphNeighborhood(db, {
      root_id: "evt_eval_obs_a",
      max_depth: 0,
      max_nodes: 1,
      visible_trust_zone_ids: [trustZone.trust_zone_id],
    });
    expect(tight.budgets.nodes_used).toBeLessThanOrEqual(1);
    expect(tight.omissions.some((item) => item.reason === "max_depth")).toBe(true);
  });

  it("rebuilds graph projection deterministically", () => {
    const db = openEvalDb();
    seedEvent(db, evidenceA, 1);
    seedEvent(db, obsA, 2);
    seedEvent(db, claimA, 3);
    const first = rebuildGraphProjection(db, {
      events: [evidenceA, obsA, claimA],
      now: new Date("2026-01-01T01:00:00Z"),
    });
    const second = rebuildGraphProjection(db, {
      events: [evidenceA, obsA, claimA],
      now: new Date("2026-01-01T02:00:00Z"),
    });
    expect(second.nodes.map((node) => node.node_id)).toEqual(
      first.nodes.map((node) => node.node_id),
    );
    expect(second.edges.map((edge) => edge.edge_id)).toEqual(
      first.edges.map((edge) => edge.edge_id),
    );
  });

  it("keeps absolute local paths out of projected graph artifacts", () => {
    const db = openEvalDb();
    seedEvent(db, obsA, 1);
    seedOrigin(db, "evt_eval_obs_a", {
      project_id: "project_alpha",
      worktree_id: `wt_${"a".repeat(24)}`,
      worktree_name: "alpha-main",
      git_branch: "main",
    });
    const snapshot = rebuildGraphProjection(db, {
      events: [obsA],
      now: new Date("2026-01-01T01:00:00Z"),
    });
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("/Users/");
    expect(serialized).not.toContain("/home/");
  });
});
