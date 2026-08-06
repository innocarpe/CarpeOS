/**
 * P4 graph density metrics over a rebuildable graph snapshot (projection only).
 * Never treats graph tables as source of truth — callers rebuild from canonical events.
 */

export type GraphMetricsNode = {
  node_id: string;
  node_kind: string;
};

export type GraphMetricsEdge = {
  edge_id: string;
  edge_kind: string;
  from_node_id: string;
  to_node_id: string;
};

export type GraphMetricsSnapshot = {
  nodes: readonly GraphMetricsNode[];
  edges: readonly GraphMetricsEdge[];
};

export type GraphDensityMetrics = {
  schema: "carpeos.agentic.graph-density/v1";
  projection: "graph_v2";
  node_count: number;
  edge_count: number;
  meaning_unit_count: number;
  evidence_count: number;
  subject_count: number;
  edge_kind_counts: Record<string, number>;
  /** Edges of kinds used for knowledge lineage density. */
  knowledge_edge_count: number;
  derived_from_count: number;
  about_count: number;
  supports_count: number;
  contradicts_count: number;
  /** Mean incident knowledge-edge degree over meaning_unit nodes (0 if none). */
  mean_meaning_unit_degree: number;
  /** meaning_unit_count / max(evidence_count, 1) — knowledge per evidence signal. */
  meaning_per_evidence: number;
  /** knowledge_edge_count / max(meaning_unit_count, 1). */
  knowledge_edges_per_meaning_unit: number;
  /** True when every meaning_unit has ≥1 derived_from edge. */
  all_meaning_units_derived: boolean;
  /** True when every meaning_unit has ≥1 about edge (subject linkage). */
  all_meaning_units_about: boolean;
};

const KNOWLEDGE_EDGE_KINDS = new Set([
  "derived_from",
  "supports",
  "contradicts",
  "about",
  "supersedes",
]);

/**
 * Compute density metrics for a graph_v2-shaped snapshot.
 */
export function computeGraphDensityMetrics(snapshot: GraphMetricsSnapshot): GraphDensityMetrics {
  const edge_kind_counts: Record<string, number> = {};
  for (const edge of snapshot.edges) {
    edge_kind_counts[edge.edge_kind] = (edge_kind_counts[edge.edge_kind] ?? 0) + 1;
  }

  const meaningUnits = snapshot.nodes.filter((n) => n.node_kind === "meaning_unit");
  const evidence = snapshot.nodes.filter((n) => n.node_kind === "evidence");
  const subjects = snapshot.nodes.filter((n) => n.node_kind === "subject");

  const knowledgeEdges = snapshot.edges.filter((e) => KNOWLEDGE_EDGE_KINDS.has(e.edge_kind));
  const derived_from_count = edge_kind_counts.derived_from ?? 0;
  const about_count = edge_kind_counts.about ?? 0;
  const supports_count = edge_kind_counts.supports ?? 0;
  const contradicts_count = edge_kind_counts.contradicts ?? 0;

  const degree = new Map<string, number>();
  for (const mu of meaningUnits) degree.set(mu.node_id, 0);
  for (const edge of knowledgeEdges) {
    if (degree.has(edge.from_node_id)) {
      degree.set(edge.from_node_id, (degree.get(edge.from_node_id) ?? 0) + 1);
    }
    if (degree.has(edge.to_node_id)) {
      degree.set(edge.to_node_id, (degree.get(edge.to_node_id) ?? 0) + 1);
    }
  }

  let degreeSum = 0;
  for (const d of degree.values()) degreeSum += d;
  const mean_meaning_unit_degree = meaningUnits.length === 0 ? 0 : degreeSum / meaningUnits.length;

  const derivedFromIncident = incidentKinds(snapshot, "derived_from");
  const aboutIncident = incidentKinds(snapshot, "about");
  const all_meaning_units_derived =
    meaningUnits.length > 0 &&
    meaningUnits.every((n) => (derivedFromIncident.get(n.node_id) ?? 0) > 0);
  const all_meaning_units_about =
    meaningUnits.length > 0 && meaningUnits.every((n) => (aboutIncident.get(n.node_id) ?? 0) > 0);

  return {
    schema: "carpeos.agentic.graph-density/v1",
    projection: "graph_v2",
    node_count: snapshot.nodes.length,
    edge_count: snapshot.edges.length,
    meaning_unit_count: meaningUnits.length,
    evidence_count: evidence.length,
    subject_count: subjects.length,
    edge_kind_counts,
    knowledge_edge_count: knowledgeEdges.length,
    derived_from_count,
    about_count,
    supports_count,
    contradicts_count,
    mean_meaning_unit_degree,
    meaning_per_evidence: meaningUnits.length / Math.max(evidence.length, 1),
    knowledge_edges_per_meaning_unit: knowledgeEdges.length / Math.max(meaningUnits.length, 1),
    all_meaning_units_derived,
    all_meaning_units_about,
  };
}

function incidentKinds(snapshot: GraphMetricsSnapshot, edgeKind: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const edge of snapshot.edges) {
    if (edge.edge_kind !== edgeKind) continue;
    counts.set(edge.from_node_id, (counts.get(edge.from_node_id) ?? 0) + 1);
    counts.set(edge.to_node_id, (counts.get(edge.to_node_id) ?? 0) + 1);
  }
  return counts;
}

export type GraphDensityUpliftReport = {
  schema: "carpeos.agentic.graph-density-uplift/v1";
  pass: boolean;
  before: GraphDensityMetrics;
  after: GraphDensityMetrics;
  delta: {
    meaning_unit_count: number;
    knowledge_edge_count: number;
    derived_from_count: number;
    about_count: number;
    mean_meaning_unit_degree: number;
  };
  reason_codes: string[];
};

/**
 * Compare evidence-only vs post-agentic materialize graphs.
 * Pass when meaning units appear with derived_from uplift and about linkage.
 */
export function evaluateGraphDensityUplift(input: {
  before: GraphMetricsSnapshot;
  after: GraphMetricsSnapshot;
  /** Require at least this many new meaning units (default 1). */
  min_new_meaning_units?: number;
  /** Require derived_from edges on every after meaning unit (default true). */
  require_all_derived?: boolean;
  /** Require about edges on every after meaning unit (default true). */
  require_all_about?: boolean;
}): GraphDensityUpliftReport {
  const before = computeGraphDensityMetrics(input.before);
  const after = computeGraphDensityMetrics(input.after);
  const minNew = input.min_new_meaning_units ?? 1;
  const requireDerived = input.require_all_derived !== false;
  const requireAbout = input.require_all_about !== false;
  const reason_codes: string[] = [];

  const delta = {
    meaning_unit_count: after.meaning_unit_count - before.meaning_unit_count,
    knowledge_edge_count: after.knowledge_edge_count - before.knowledge_edge_count,
    derived_from_count: after.derived_from_count - before.derived_from_count,
    about_count: after.about_count - before.about_count,
    mean_meaning_unit_degree: after.mean_meaning_unit_degree - before.mean_meaning_unit_degree,
  };

  let pass = true;
  if (delta.meaning_unit_count < minNew) {
    pass = false;
    reason_codes.push("insufficient_new_meaning_units");
  }
  if (delta.derived_from_count < 1 && after.derived_from_count < 1) {
    pass = false;
    reason_codes.push("no_derived_from_uplift");
  }
  if (requireDerived && after.meaning_unit_count > 0 && !after.all_meaning_units_derived) {
    pass = false;
    reason_codes.push("meaning_units_missing_derived_from");
  }
  if (requireAbout && after.meaning_unit_count > 0 && !after.all_meaning_units_about) {
    pass = false;
    reason_codes.push("meaning_units_missing_about");
  }
  if (delta.knowledge_edge_count < 1 && after.knowledge_edge_count <= before.knowledge_edge_count) {
    pass = false;
    reason_codes.push("no_knowledge_edge_uplift");
  }
  if (pass) reason_codes.push("graph_density_uplift_ok");

  return {
    schema: "carpeos.agentic.graph-density-uplift/v1",
    pass,
    before,
    after,
    delta,
    reason_codes,
  };
}
