import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { CanonicalEvent, Digest, ErasureLedgerRecord } from "@carpeos/schema";
import {
  buildGraphProjection,
  migrateGraphProjection,
  rebuildGraphProjection,
  type CaptureOrigin,
} from "../src/graph-projection.js";

const trustZone = { trust_zone_id: "tz_graph", isolation: "local_device" as const };

function baseEvent<T extends CanonicalEvent["event_type"]>(
  partial: CanonicalEvent<T>,
): CanonicalEvent<T> {
  return partial;
}

const evidence = baseEvent({
  schema_version: "v1",
  event_id: "evt_evidence01",
  event_type: "EvidenceArtifact",
  subject_ref: "subject_alpha",
  valid_time: { start: "2026-01-01T00:00:00Z", end: null },
  recorded_time: { start: "2026-01-01T00:00:00Z", end: null },
  lifecycle_status: "active",
  epistemic_authority: "observed",
  trust_zone: trustZone,
  provenance: [],
  idempotency_key: "idem_evidence_000001",
  request_fingerprint: `sha-256:${"1".repeat(64)}`,
  zone_sequence: 1,
  payload: {
    artifact_id: "art_evidence01",
    kind: "message",
    media_type: "application/json",
    content_ref: {
      ref_type: "external_uri",
      uri: "https://example.invalid/synthetic-evidence",
      digest: { algorithm: "sha-256", value: "9".repeat(64) },
      visibility: "private",
      reachability: "offline_snapshot",
    },
  },
});

const observation = baseEvent({
  schema_version: "v1",
  event_id: "evt_obs000001",
  event_type: "Observation",
  subject_ref: "subject_alpha",
  valid_time: { start: "2026-01-01T00:01:00Z", end: null },
  recorded_time: { start: "2026-01-01T00:01:00Z", end: null },
  lifecycle_status: "active",
  epistemic_authority: "derived",
  trust_zone: trustZone,
  provenance: [{ ref_type: "event", ref_id: "evt_evidence01", relationship: "derived_from" }],
  idempotency_key: "idem_obs_0000000001",
  request_fingerprint: `sha-256:${"2".repeat(64)}`,
  zone_sequence: 2,
  payload: {
    observation_id: "obs_alpha",
    observed_at: "2026-01-01T00:01:00Z",
    statement: "Synthetic Alpha prefers local-first retrieval.",
    evidence_artifact_refs: ["art_evidence01"],
  },
});

const claim = baseEvent({
  schema_version: "v1",
  event_id: "evt_claim0001",
  event_type: "Claim",
  subject_ref: "subject_alpha",
  valid_time: { start: "2026-01-01T00:02:00Z", end: null },
  recorded_time: { start: "2026-01-01T00:02:00Z", end: null },
  lifecycle_status: "active",
  epistemic_authority: "derived",
  trust_zone: trustZone,
  provenance: [{ ref_type: "event", ref_id: "evt_obs000001", relationship: "derived_from" }],
  idempotency_key: "idem_claim_00000001",
  request_fingerprint: `sha-256:${"3".repeat(64)}`,
  zone_sequence: 3,
  payload: {
    claim_id: "claim_alpha",
    statement: "Synthetic Alpha decision: keep graph rebuildable.",
    claim_type: "decision",
    support: [{ ref_type: "event", ref_id: "evt_obs000001", relationship: "supports" }],
  },
});

const acceptance = baseEvent({
  schema_version: "v1",
  event_id: "evt_accept001",
  event_type: "AcceptanceDecision",
  subject_ref: "subject_alpha",
  valid_time: { start: "2026-01-01T00:03:00Z", end: null },
  recorded_time: { start: "2026-01-01T00:03:00Z", end: null },
  lifecycle_status: "active",
  epistemic_authority: "verified",
  trust_zone: trustZone,
  provenance: [],
  idempotency_key: "idem_accept_0000001",
  request_fingerprint: `sha-256:${"4".repeat(64)}`,
  zone_sequence: 4,
  payload: {
    decision_id: "dec_alpha",
    claim_refs: ["claim_alpha"],
    decision: "accepted",
    decided_by: "operator",
    decided_at: "2026-01-01T00:03:00Z",
  },
});

const supersession = baseEvent({
  schema_version: "v1",
  event_id: "evt_super0001",
  event_type: "Supersession",
  subject_ref: "subject_alpha",
  valid_time: { start: "2026-01-01T00:04:00Z", end: null },
  recorded_time: { start: "2026-01-01T00:04:00Z", end: null },
  lifecycle_status: "active",
  epistemic_authority: "derived",
  trust_zone: trustZone,
  provenance: [],
  idempotency_key: "idem_super_00000001",
  request_fingerprint: `sha-256:${"5".repeat(64)}`,
  zone_sequence: 5,
  payload: {
    supersession_id: "sup_alpha",
    supersedes_event_id: "evt_claim0001",
    replacement_event_id: "evt_claim0002",
    reason: "synthetic replacement",
  },
});

describe("graph projection", () => {
  it("materializes lineage edges and origin facets without absolute paths", () => {
    const origins = new Map<string, CaptureOrigin>([
      [
        "evt_evidence01",
        {
          project_id: "project_alpha",
          worktree_id: `wt_${"a".repeat(24)}`,
          worktree_name: "alpha-main",
          git_branch: "main",
        },
      ],
    ]);
    const snapshot = buildGraphProjection({
      events: [evidence, observation, claim, acceptance, supersession],
      origins,
    });

    expect(snapshot.nodes.some((node) => node.node_kind === "project")).toBe(true);
    expect(snapshot.nodes.some((node) => node.node_kind === "worktree")).toBe(true);
    expect(snapshot.edges.some((edge) => edge.edge_kind === "derived_from")).toBe(true);
    expect(snapshot.edges.some((edge) => edge.edge_kind === "supports")).toBe(true);
    expect(snapshot.edges.some((edge) => edge.edge_kind === "accepted_by")).toBe(true);
    expect(snapshot.edges.some((edge) => edge.edge_kind === "supersedes")).toBe(true);
    expect(snapshot.edges.some((edge) => edge.edge_kind === "belongs_to")).toBe(true);
    expect(snapshot.edges.some((edge) => edge.edge_kind === "observed_in")).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain("/Users/");
    expect(JSON.stringify(snapshot)).not.toContain("/home/");
  });

  it("rebuilds idempotently and drops erased events", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE schema_migrations (
        migration_id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE capture_requests (
        event_id TEXT PRIMARY KEY,
        project_id TEXT,
        worktree_id TEXT,
        worktree_name TEXT,
        git_branch TEXT
      );
      INSERT INTO capture_requests (event_id, project_id, worktree_id, worktree_name, git_branch)
      VALUES (
        'evt_evidence01',
        'project_alpha',
        'wt_aaaaaaaaaaaaaaaaaaaaaaaa',
        'alpha-main',
        'main'
      );
    `);
    migrateGraphProjection(db, new Date("2026-01-01T00:00:00Z"));

    const events = [evidence, observation, claim, acceptance];
    const first = rebuildGraphProjection(db, {
      events,
      now: new Date("2026-01-01T00:10:00Z"),
    });
    const second = rebuildGraphProjection(db, {
      events,
      now: new Date("2026-01-01T00:11:00Z"),
    });
    expect(second.nodes.map((node) => node.node_id)).toEqual(
      first.nodes.map((node) => node.node_id),
    );
    expect(second.edges.map((edge) => edge.edge_id)).toEqual(
      first.edges.map((edge) => edge.edge_id),
    );

    const erasure: ErasureLedgerRecord = {
      schema_version: "v1",
      erasure_id: "era_graph0001",
      target_ref: { target_kind: "event", target_id: "evt_obs000001" },
      requested_at: "2026-01-01T00:12:00Z",
      completed_at: "2026-01-01T00:12:00Z",
      method: "tombstone",
      actor_ref: "actor_operator",
      trust_zone: trustZone,
      zone_sequence: 9,
      evidence_refs: [],
    };
    const afterErasure = rebuildGraphProjection(db, {
      events,
      erasures: [erasure],
      now: new Date("2026-01-01T00:12:00Z"),
    });
    expect(afterErasure.nodes.some((node) => node.source_event_id === "evt_obs000001")).toBe(false);

    const edgeCount = (db.prepare("SELECT COUNT(*) AS c FROM graph_edges").get() as { c: number })
      .c;
    const nodeCount = (db.prepare("SELECT COUNT(*) AS c FROM graph_nodes").get() as { c: number })
      .c;
    expect(nodeCount).toBe(afterErasure.nodes.length);
    expect(edgeCount).toBe(afterErasure.edges.length);
  });
});
