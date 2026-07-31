import { createHash } from "node:crypto";
import type { CanonicalEvent, ErasureLedgerRecord, ProvenanceRef } from "@carpeos/schema";
import { stableJson } from "./provenance.js";

export const GRAPH_PROJECTION_VERSION = "graph_v2";
export const GRAPH_PROJECTION_MIGRATION_ID = "graph_projection_v2";

export type GraphNodeKind =
  | "project"
  | "worktree"
  | "meaning_unit"
  | "evidence"
  | "acceptance"
  | "supersession"
  | "subject"
  | "decision_thread";

export type GraphEdgeKind =
  | "belongs_to"
  | "observed_in"
  | "derived_from"
  | "supports"
  | "contradicts"
  | "supersedes"
  | "accepted_by"
  | "about"
  | "in_thread";

export type GraphNode = {
  node_id: string;
  node_kind: GraphNodeKind;
  trust_zone_id: string;
  label?: string;
  source_event_id?: string;
  properties: Record<string, string>;
};

export type GraphEdge = {
  edge_id: string;
  edge_kind: GraphEdgeKind;
  from_node_id: string;
  to_node_id: string;
  trust_zone_id: string;
  source_event_id?: string;
  properties: Record<string, string>;
};

export type GraphProjectionSnapshot = {
  projection_version: typeof GRAPH_PROJECTION_VERSION;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

type SqlDatabase = {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
};

type CaptureOriginRow = {
  event_id: string;
  project_id: string | null;
  worktree_id: string | null;
  worktree_name: string | null;
  git_branch: string | null;
};

/**
 * Create rebuildable graph projection tables.
 *
 * Graph storage is non-authoritative (ADR 0001 / ADR 0013). Dropping these
 * tables and rebuilding from canonical events must always be safe.
 */
export function migrateGraphProjection(db: SqlDatabase, appliedAt = new Date()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_nodes (
      node_id TEXT PRIMARY KEY,
      node_kind TEXT NOT NULL,
      trust_zone_id TEXT NOT NULL,
      label TEXT,
      source_event_id TEXT,
      properties_json TEXT NOT NULL,
      projection_version TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS graph_edges (
      edge_id TEXT PRIMARY KEY,
      edge_kind TEXT NOT NULL,
      from_node_id TEXT NOT NULL,
      to_node_id TEXT NOT NULL,
      trust_zone_id TEXT NOT NULL,
      source_event_id TEXT,
      properties_json TEXT NOT NULL,
      projection_version TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_kind
      ON graph_nodes (node_kind, trust_zone_id);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_from
      ON graph_edges (from_node_id, edge_kind);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_to
      ON graph_edges (to_node_id, edge_kind);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_kind
      ON graph_edges (edge_kind, trust_zone_id);
  `);
  db.prepare(
    "INSERT OR IGNORE INTO schema_migrations (migration_id, applied_at) VALUES (?, ?)",
  ).run(GRAPH_PROJECTION_MIGRATION_ID, appliedAt.toISOString());
}

export function rebuildGraphProjection(
  db: SqlDatabase,
  input: {
    events: readonly CanonicalEvent[];
    erasures?: readonly ErasureLedgerRecord[];
    now?: Date;
    /** When false, caller already holds a write transaction (retrieval rebuild). */
    transactional?: boolean;
  },
): GraphProjectionSnapshot {
  migrateGraphProjection(db, input.now);
  const erasedEventIds = new Set(
    (input.erasures ?? [])
      .filter((erasure) => erasure.target_ref.target_kind === "event")
      .map((erasure) => erasure.target_ref.target_id),
  );
  const origins = readCaptureOrigins(db);
  const visibleEvents = input.events.filter((event) => !erasedEventIds.has(event.event_id));
  const snapshot = buildGraphProjection({ events: visibleEvents, origins });
  const nowIso = (input.now ?? new Date()).toISOString();
  const openOwnTransaction = input.transactional !== false;

  if (openOwnTransaction) {
    db.exec("BEGIN IMMEDIATE");
  }
  try {
    writeGraphSnapshot(db, snapshot, nowIso);
    if (openOwnTransaction) {
      db.exec("COMMIT");
    }
  } catch (error) {
    if (openOwnTransaction) {
      db.exec("ROLLBACK");
    }
    throw error;
  }
  return snapshot;
}

/** Write nodes/edges. Caller owns the transaction when embedding into rebuild. */
export function writeGraphSnapshot(
  db: SqlDatabase,
  snapshot: GraphProjectionSnapshot,
  nowIso: string,
): void {
  db.exec("DELETE FROM graph_edges");
  db.exec("DELETE FROM graph_nodes");
  const insertNode = db.prepare(`
    INSERT INTO graph_nodes (
      node_id, node_kind, trust_zone_id, label, source_event_id,
      properties_json, projection_version, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertEdge = db.prepare(`
    INSERT INTO graph_edges (
      edge_id, edge_kind, from_node_id, to_node_id, trust_zone_id,
      source_event_id, properties_json, projection_version, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const node of snapshot.nodes) {
    insertNode.run(
      node.node_id,
      node.node_kind,
      node.trust_zone_id,
      node.label ?? null,
      node.source_event_id ?? null,
      stableJson(node.properties),
      GRAPH_PROJECTION_VERSION,
      nowIso,
    );
  }
  for (const edge of snapshot.edges) {
    insertEdge.run(
      edge.edge_id,
      edge.edge_kind,
      edge.from_node_id,
      edge.to_node_id,
      edge.trust_zone_id,
      edge.source_event_id ?? null,
      stableJson(edge.properties),
      GRAPH_PROJECTION_VERSION,
      nowIso,
    );
  }
}

export function buildGraphProjection(input: {
  events: readonly CanonicalEvent[];
  origins: ReadonlyMap<string, CaptureOrigin>;
}): GraphProjectionSnapshot {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const byId = new Map(input.events.map((event) => [event.event_id, event]));

  const putNode = (node: GraphNode): void => {
    nodes.set(node.node_id, node);
  };
  const putEdge = (edge: GraphEdge): void => {
    edges.set(edge.edge_id, edge);
  };

  for (const event of input.events) {
    const trustZoneId = event.trust_zone.trust_zone_id;
    const unitNodeId = `evt:${event.event_id}`;

    if (event.event_type === "EvidenceArtifact") {
      putNode({
        node_id: unitNodeId,
        node_kind: "evidence",
        trust_zone_id: trustZoneId,
        label: event.payload.kind,
        source_event_id: event.event_id,
        properties: { event_type: event.event_type },
      });
    } else if (event.event_type === "Observation" || event.event_type === "Claim") {
      putNode({
        node_id: unitNodeId,
        node_kind: "meaning_unit",
        trust_zone_id: trustZoneId,
        label:
          event.event_type === "Observation" ? event.payload.statement : event.payload.statement,
        source_event_id: event.event_id,
        properties: {
          event_type: event.event_type,
          lifecycle_status: event.lifecycle_status,
        },
      });
    } else if (event.event_type === "AcceptanceDecision") {
      putNode({
        node_id: unitNodeId,
        node_kind: "acceptance",
        trust_zone_id: trustZoneId,
        label: event.payload.decision,
        source_event_id: event.event_id,
        properties: { event_type: event.event_type, decision: event.payload.decision },
      });
    } else if (event.event_type === "Supersession") {
      putNode({
        node_id: unitNodeId,
        node_kind: "supersession",
        trust_zone_id: trustZoneId,
        source_event_id: event.event_id,
        properties: { event_type: event.event_type },
      });
    } else {
      continue;
    }

    // Origin facets: project partition + worktree facet (never absolute paths).
    const origin = resolveEventOrigin(event, input.origins, byId);
    if (origin?.project_id) {
      const projectNodeId = `project:${origin.project_id}`;
      putNode({
        node_id: projectNodeId,
        node_kind: "project",
        trust_zone_id: trustZoneId,
        label: origin.project_id,
        properties: { project_id: origin.project_id },
      });
      putEdge(
        makeEdge({
          edgeKind: "belongs_to",
          from: unitNodeId,
          to: projectNodeId,
          trustZoneId,
          sourceEventId: event.event_id,
        }),
      );
    }
    if (origin?.worktree_id) {
      const worktreeNodeId = `worktree:${origin.worktree_id}`;
      putNode({
        node_id: worktreeNodeId,
        node_kind: "worktree",
        trust_zone_id: trustZoneId,
        label: origin.worktree_name ?? origin.worktree_id,
        properties: {
          worktree_id: origin.worktree_id,
          ...(origin.worktree_name ? { worktree_name: origin.worktree_name } : {}),
          ...(origin.git_branch ? { git_branch: origin.git_branch } : {}),
        },
      });
      putEdge(
        makeEdge({
          edgeKind: "observed_in",
          from: unitNodeId,
          to: worktreeNodeId,
          trustZoneId,
          sourceEventId: event.event_id,
        }),
      );
    }

    for (const ref of event.provenance ?? []) {
      const edgeKind = relationshipToEdgeKind(ref.relationship) ?? "derived_from";
      const target = refTargetNodeId(ref, byId);
      if (target === undefined) continue;
      // Ensure target stub exists when the referenced event is in the snapshot.
      if (byId.has(ref.ref_id) && !nodes.has(target)) {
        const targetEvent = byId.get(ref.ref_id)!;
        putNode({
          node_id: target,
          node_kind: targetEvent.event_type === "EvidenceArtifact" ? "evidence" : "meaning_unit",
          trust_zone_id: targetEvent.trust_zone.trust_zone_id,
          source_event_id: targetEvent.event_id,
          properties: { event_type: targetEvent.event_type },
        });
      }
      putEdge(
        makeEdge({
          edgeKind,
          from: unitNodeId,
          to: target,
          trustZoneId,
          sourceEventId: event.event_id,
        }),
      );
    }

    if (event.event_type === "Claim") {
      for (const ref of event.payload.support ?? []) {
        const edgeKind = relationshipToEdgeKind(ref.relationship) ?? "supports";
        const target = refTargetNodeId(ref, byId);
        if (target === undefined) continue;
        putEdge(
          makeEdge({
            edgeKind,
            from: unitNodeId,
            to: target,
            trustZoneId,
            sourceEventId: event.event_id,
          }),
        );
      }
    }

    if (event.event_type === "AcceptanceDecision") {
      for (const claimRef of event.payload.claim_refs ?? []) {
        const claimEvent = [...byId.values()].find(
          (candidate) =>
            candidate.event_type === "Claim" && candidate.payload.claim_id === claimRef,
        );
        if (claimEvent === undefined) continue;
        putEdge(
          makeEdge({
            edgeKind: "accepted_by",
            from: `evt:${claimEvent.event_id}`,
            to: unitNodeId,
            trustZoneId,
            sourceEventId: event.event_id,
          }),
        );
      }
    }

    if (event.event_type === "Supersession") {
      const prior = event.payload.supersedes_event_id;
      const replacement = event.payload.replacement_event_id;
      if (typeof prior === "string") {
        // Prefer replacement -> prior when present; otherwise supersession node -> prior.
        const fromId = typeof replacement === "string" ? `evt:${replacement}` : unitNodeId;
        putEdge(
          makeEdge({
            edgeKind: "supersedes",
            from: fromId,
            to: `evt:${prior}`,
            trustZoneId,
            sourceEventId: event.event_id,
          }),
        );
      }
    }
  }

  // Entity resolution (deterministic): subjects from subject_ref, decision threads
  // from connected components of meaning units under the same subject.
  resolveEntities({ events: input.events, nodes, edges, putNode, putEdge });

  return {
    projection_version: GRAPH_PROJECTION_VERSION,
    nodes: [...nodes.values()].sort((a, b) => a.node_id.localeCompare(b.node_id)),
    edges: [...edges.values()].sort((a, b) => a.edge_id.localeCompare(b.edge_id)),
  };
}

export type CaptureOrigin = {
  project_id?: string;
  worktree_id?: string;
  worktree_name?: string;
  git_branch?: string;
};

function readCaptureOrigins(db: SqlDatabase): Map<string, CaptureOrigin> {
  const origins = new Map<string, CaptureOrigin>();
  let rows: CaptureOriginRow[];
  try {
    rows = db
      .prepare(
        `SELECT event_id, project_id, worktree_id, worktree_name, git_branch
         FROM capture_requests`,
      )
      .all() as CaptureOriginRow[];
  } catch {
    return origins;
  }
  for (const row of rows) {
    const origin: CaptureOrigin = {
      ...(row.project_id ? { project_id: row.project_id } : {}),
      ...(row.worktree_id ? { worktree_id: row.worktree_id } : {}),
      ...(row.worktree_name ? { worktree_name: row.worktree_name } : {}),
      ...(row.git_branch ? { git_branch: row.git_branch } : {}),
    };
    if (Object.keys(origin).length > 0) {
      origins.set(row.event_id, origin);
    }
  }
  return origins;
}

function resolveEventOrigin(
  event: CanonicalEvent,
  origins: ReadonlyMap<string, CaptureOrigin>,
  byId: ReadonlyMap<string, CanonicalEvent>,
): CaptureOrigin | undefined {
  const direct = origins.get(event.event_id);
  if (direct !== undefined) return direct;
  for (const ref of event.provenance ?? []) {
    const fromRef = origins.get(ref.ref_id);
    if (fromRef !== undefined) return fromRef;
    const parent = byId.get(ref.ref_id);
    if (parent !== undefined) {
      const inherited = origins.get(parent.event_id);
      if (inherited !== undefined) return inherited;
    }
  }
  return undefined;
}

function relationshipToEdgeKind(relationship: string | undefined): GraphEdgeKind | undefined {
  switch (relationship) {
    case "derived_from":
      return "derived_from";
    case "supports":
      return "supports";
    case "contradicts":
      return "contradicts";
    case "supersedes":
      return "supersedes";
    default:
      return undefined;
  }
}

function refTargetNodeId(
  ref: ProvenanceRef,
  byId: ReadonlyMap<string, CanonicalEvent>,
): string | undefined {
  if (ref.ref_type === "event" || byId.has(ref.ref_id)) {
    return `evt:${ref.ref_id}`;
  }
  // External refs are not graph-canonical nodes in v1 materialization.
  return undefined;
}

function makeEdge(input: {
  edgeKind: GraphEdgeKind;
  from: string;
  to: string;
  trustZoneId: string;
  sourceEventId: string;
}): GraphEdge {
  return {
    edge_id: `edge:${input.edgeKind}:${input.from}->${input.to}`,
    edge_kind: input.edgeKind,
    from_node_id: input.from,
    to_node_id: input.to,
    trust_zone_id: input.trustZoneId,
    source_event_id: input.sourceEventId,
    properties: {},
  };
}

/**
 * Deterministic entity resolution for product 3.0 R5.
 *
 * Rules (stable, testable, no acceptance semantics):
 * 1. Every event with a non-empty `subject_ref` links to a `subject` node
 *    (`subj:<normalized>`). Meaning units get an `about` edge.
 * 2. Decision threads are connected components of Observation/Claim nodes under
 *    the same subject, joined by derived_from / supports / contradicts /
 *    supersedes edges. Thread id is `thr:<sha256(sorted member ids)[:24]>`.
 * 3. Clustering never creates AcceptanceDecision edges or implies acceptance.
 */
function resolveEntities(input: {
  events: readonly CanonicalEvent[];
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  putNode: (node: GraphNode) => void;
  putEdge: (edge: GraphEdge) => void;
}): void {
  const meaningUnitIds = new Set(
    [...input.nodes.values()]
      .filter((node) => node.node_kind === "meaning_unit")
      .map((node) => node.node_id),
  );

  // 1) subject nodes + about edges
  for (const event of input.events) {
    const subjectRef = event.subject_ref?.trim();
    if (!subjectRef) continue;
    const subjectNodeId = subjectNodeIdFor(subjectRef);
    const trustZoneId = event.trust_zone.trust_zone_id;
    input.putNode({
      node_id: subjectNodeId,
      node_kind: "subject",
      trust_zone_id: trustZoneId,
      label: subjectRef,
      properties: { subject_ref: subjectRef },
    });
    const unitNodeId = `evt:${event.event_id}`;
    if (input.nodes.has(unitNodeId) && meaningUnitIds.has(unitNodeId)) {
      input.putEdge(
        makeEdge({
          edgeKind: "about",
          from: unitNodeId,
          to: subjectNodeId,
          trustZoneId,
          sourceEventId: event.event_id,
        }),
      );
    }
  }

  // 2) decision threads by subject-scoped connected components
  const adjacency = new Map<string, Set<string>>();
  const addAdj = (a: string, b: string): void => {
    if (!meaningUnitIds.has(a) || !meaningUnitIds.has(b)) return;
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };
  for (const edge of input.edges.values()) {
    if (
      edge.edge_kind === "derived_from" ||
      edge.edge_kind === "supports" ||
      edge.edge_kind === "contradicts" ||
      edge.edge_kind === "supersedes"
    ) {
      addAdj(edge.from_node_id, edge.to_node_id);
    }
  }

  const subjectOf = new Map<string, string>();
  for (const event of input.events) {
    if (event.event_type !== "Observation" && event.event_type !== "Claim") continue;
    const ref = event.subject_ref?.trim();
    if (!ref) continue;
    subjectOf.set(`evt:${event.event_id}`, ref);
  }

  const visited = new Set<string>();
  for (const start of [...meaningUnitIds].sort()) {
    if (visited.has(start)) continue;
    const subjectRef = subjectOf.get(start);
    if (subjectRef === undefined) continue;

    const component: string[] = [];
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const current = queue.shift()!;
      // Only walk members that share this subject.
      if (subjectOf.get(current) !== subjectRef) continue;
      component.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (visited.has(next)) continue;
        if (subjectOf.get(next) !== subjectRef) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    if (component.length === 0) continue;
    component.sort();
    const threadId = threadNodeIdFor(subjectRef, component);
    const trustZoneId =
      input.nodes.get(component[0]!)?.trust_zone_id ??
      input.events[0]?.trust_zone.trust_zone_id ??
      "tz_unknown";
    input.putNode({
      node_id: threadId,
      node_kind: "decision_thread",
      trust_zone_id: trustZoneId,
      label: subjectRef,
      properties: {
        subject_ref: subjectRef,
        member_count: String(component.length),
        root_event_id: component[0]!.replace(/^evt:/, ""),
      },
    });
    // Link thread to subject.
    input.putEdge(
      makeEdge({
        edgeKind: "about",
        from: threadId,
        to: subjectNodeIdFor(subjectRef),
        trustZoneId,
        sourceEventId: component[0]!.replace(/^evt:/, ""),
      }),
    );
    for (const member of component) {
      input.putEdge(
        makeEdge({
          edgeKind: "in_thread",
          from: member,
          to: threadId,
          trustZoneId,
          sourceEventId: member.replace(/^evt:/, ""),
        }),
      );
    }
  }
}

function subjectNodeIdFor(subjectRef: string): string {
  const normalized = subjectRef
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "_");
  return `subj:${normalized.slice(0, 96) || "unknown"}`;
}

function threadNodeIdFor(subjectRef: string, memberNodeIds: readonly string[]): string {
  const material = `${subjectRef.trim().toLowerCase()}|${memberNodeIds.join(",")}`;
  // Inline sha256 via stableJson path is overkill; use node crypto.
  return `thr:${sha256Hex(material).slice(0, 24)}`;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
