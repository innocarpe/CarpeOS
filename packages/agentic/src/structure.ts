/**
 * E6 Structure / link stage (P4) — deterministic edge proposals.
 * No LLM. Edges materialize only via canonical provenance + graph rebuild (ADR 0017 D8).
 */

import type { AgenticCitation, AgenticEdgeKind, AgenticEdgeProposal } from "./types.js";
import type { AgenticExtractCandidate } from "./types.js";

export type StructureLinkInput = {
  /** Proposed unit id placeholder (proposal_id or "unit"). */
  unit_ref: string;
  source_event_id: string;
  /** Evidence artifact id when known (artifact ref_type). */
  artifact_id?: string | null;
  /** Project / subject for `about` edges. */
  subject_ref?: string | null;
  candidate: AgenticExtractCandidate;
  /**
   * Other unit event ids already materialized in the same zone (optional).
   * Emits `supports` edges only when cite_ok candidates share source lineage.
   */
  sibling_unit_event_ids?: readonly string[];
};

export type StructureLinkResult = {
  schema: "carpeos.agentic.structure-result/v1";
  edges: AgenticEdgeProposal[];
  reason_codes: string[];
};

/**
 * Build v1 edge proposals for a verified extract candidate.
 *
 * Always:
 * - `derived_from` unit → source evidence event (required)
 * - `derived_from` unit → each citation evidence_event_id
 * - `derived_from` unit → artifact_id when present (artifact ref)
 * - `about` unit → subject_ref when present
 *
 * Optional:
 * - `supports` unit → sibling unit when sibling list non-empty (deterministic,
 *   same-source reinforcement only — never invents free `related` spam)
 */
export function structureAgenticLinks(input: StructureLinkInput): StructureLinkResult {
  const edges: AgenticEdgeProposal[] = [];
  const reason_codes: string[] = [];
  const from = input.unit_ref;
  const seen = new Set<string>();

  const push = (kind: AgenticEdgeKind, to_ref: string, note: string | null): void => {
    const key = `${kind}|${from}|${to_ref}`;
    if (seen.has(key) || !to_ref.trim()) return;
    seen.add(key);
    edges.push({ kind, from_ref: from, to_ref: to_ref.trim(), note });
  };

  // Required lineage: unit derived_from source evidence event.
  push("derived_from", input.source_event_id, "source_evidence_event");
  reason_codes.push("edge_derived_from_source");

  if (input.artifact_id !== undefined && input.artifact_id !== null && input.artifact_id.trim()) {
    push("derived_from", input.artifact_id.trim(), "evidence_artifact");
    reason_codes.push("edge_derived_from_artifact");
  }

  for (const cite of input.candidate.citations) {
    addCitationEdges(push, cite, reason_codes);
  }

  const subject = input.subject_ref?.trim();
  if (subject) {
    push("about", subject, "subject_ref");
    reason_codes.push("edge_about_subject");
  }

  for (const sibling of input.sibling_unit_event_ids ?? []) {
    if (!sibling.trim() || sibling === from) continue;
    // Same-pack reinforcement: later units support earlier meaning units.
    edges.push({
      kind: "supports",
      from_ref: from,
      to_ref: sibling.trim(),
      note: "same_zone_sibling",
    });
    reason_codes.push("edge_supports_sibling");
  }

  if (edges.length === 0) {
    reason_codes.push("structure_no_edges");
  } else {
    reason_codes.push(`structure_edge_count:${edges.length}`);
  }

  return {
    schema: "carpeos.agentic.structure-result/v1",
    edges,
    reason_codes,
  };
}

function addCitationEdges(
  push: (kind: AgenticEdgeKind, to_ref: string, note: string | null) => void,
  cite: AgenticCitation,
  reason_codes: string[],
): void {
  if (cite.evidence_event_id.trim()) {
    push("derived_from", cite.evidence_event_id, "citation_evidence");
    reason_codes.push("edge_derived_from_citation");
  }
}

/**
 * Map structure edges to local-store ProvenanceRef-shaped objects for materialize.
 * `about` is applied via subject_ref (graph resolveEntities), not provenance.
 * `supports` / `contradicts` require event refs to existing units.
 */
export function edgesToProvenanceRefs(edges: readonly AgenticEdgeProposal[]): Array<{
  ref_type: "event" | "artifact";
  ref_id: string;
  relationship: "derived_from" | "supports" | "contradicts";
}> {
  const out: Array<{
    ref_type: "event" | "artifact";
    ref_id: string;
    relationship: "derived_from" | "supports" | "contradicts";
  }> = [];
  const seen = new Set<string>();

  for (const edge of edges) {
    if (edge.kind === "about") continue;
    if (edge.kind !== "derived_from" && edge.kind !== "supports" && edge.kind !== "contradicts") {
      continue;
    }
    const ref_type =
      edge.note === "evidence_artifact" || edge.to_ref.startsWith("art_")
        ? ("artifact" as const)
        : ("event" as const);
    const key = `${edge.kind}|${ref_type}|${edge.to_ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ref_type,
      ref_id: edge.to_ref,
      relationship: edge.kind,
    });
  }
  return out;
}
