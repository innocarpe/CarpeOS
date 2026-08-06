/**
 * E8 Materialize bridge — draft Observation + agentic_v1 disposition (P2a).
 * Never creates AcceptanceDecision. Hold-first unless gate already decided promote
 * and caller allows promotion materialization.
 */

import type { LocalCaptureStore } from "@carpeos/local-store";
import type { ProvenanceRef } from "@carpeos/schema";
import { type AgenticProposalRecord, markProposalMaterialized } from "./proposals.js";
import type { SqlDatabase } from "./sql.js";
import { edgesToProvenanceRefs, structureAgenticLinks } from "./structure.js";
import { AGENTIC_POLICY_VERSION } from "./types.js";

export type MaterializeAgenticInput = {
  store: LocalCaptureStore;
  agenticDb: SqlDatabase;
  proposal: AgenticProposalRecord;
  /** Evidence artifact id in the same trust zone as the source event. */
  artifact_id: string;
  /**
   * When true and gate.decision === "promote", write promote disposition + active Observation.
   * Default false → hold draft only (P2).
   */
  allow_promote_materialize?: boolean;
  /** Override subject for about edges; defaults to store.projectId. */
  subject_ref?: string | null;
};

export type MaterializeAgenticResult = {
  schema: "carpeos.agentic.materialize-result/v1";
  ok: boolean;
  policy_version: typeof AGENTIC_POLICY_VERSION;
  disposition: "hold" | "promote" | "reject" | "skipped";
  observation_event_id: string | null;
  observation_status: "created" | "replay" | "none" | "failed";
  disposition_status: "written" | "replay" | "skipped" | "failed";
  reason_codes: string[];
  /** P4: number of provenance refs written for graph density. */
  provenance_ref_count: number;
  /** P4: subject used for about edges in graph rebuild. */
  subject_ref: string | null;
  canonical_effect: "observation" | "none";
};

/**
 * Materialize a gated proposal into local-store typed writers.
 * Reject gates write disposition only (no Observation).
 */
export function materializeAgenticProposal(
  input: MaterializeAgenticInput,
): MaterializeAgenticResult {
  const { proposal, store, agenticDb } = input;
  const base = {
    schema: "carpeos.agentic.materialize-result/v1" as const,
    policy_version: AGENTIC_POLICY_VERSION,
  };

  const subjectRef =
    input.subject_ref?.trim() ||
    proposal.edges?.find((e) => e.kind === "about")?.to_ref?.trim() ||
    store.projectId ||
    null;

  if (proposal.policy_version !== AGENTIC_POLICY_VERSION) {
    return {
      ...base,
      ok: false,
      disposition: "skipped",
      observation_event_id: null,
      observation_status: "none",
      disposition_status: "skipped",
      reason_codes: ["policy_version_mismatch"],
      provenance_ref_count: 0,
      subject_ref: subjectRef,
      canonical_effect: "none",
    };
  }

  if (proposal.materialized_event_id !== null) {
    return {
      ...base,
      ok: true,
      disposition: proposal.gate.decision,
      observation_event_id: proposal.materialized_event_id,
      observation_status: "replay",
      disposition_status: "replay",
      reason_codes: ["already_materialized"],
      provenance_ref_count: 0,
      subject_ref: subjectRef,
      canonical_effect: "observation",
    };
  }

  const gateDecision = proposal.gate.decision;
  if (gateDecision === "reject") {
    try {
      const disp = store.recordKnowledgeDisposition({
        sourceEventId: proposal.source_event_id,
        artifactId: input.artifact_id,
        disposition: "reject",
        reasonCodes: [
          ...proposal.gate.reason_codes,
          `kind:${proposal.candidate.kind}`,
          "agentic_v1",
        ],
        statement: proposal.candidate.statement,
        policyVersion: AGENTIC_POLICY_VERSION,
      });
      return {
        ...base,
        ok: true,
        disposition: "reject",
        observation_event_id: null,
        observation_status: "none",
        disposition_status: disp.status,
        reason_codes: ["reject_disposition_only"],
        provenance_ref_count: 0,
        subject_ref: subjectRef,
        canonical_effect: "none",
      };
    } catch (e) {
      return {
        ...base,
        ok: false,
        disposition: "reject",
        observation_event_id: null,
        observation_status: "none",
        disposition_status: "failed",
        reason_codes: [e instanceof Error ? e.message : "disposition_failed"],
        provenance_ref_count: 0,
        subject_ref: subjectRef,
        canonical_effect: "none",
      };
    }
  }

  const wantPromote = gateDecision === "promote" && input.allow_promote_materialize === true;
  const disposition: "hold" | "promote" = wantPromote ? "promote" : "hold";
  const lifecycleStatus = wantPromote ? "active" : "draft";

  // P4: ensure structure edges exist even for pre-P4 proposal rows.
  const edges =
    proposal.edges !== undefined && proposal.edges.length > 0
      ? proposal.edges
      : structureAgenticLinks({
          unit_ref: proposal.proposal_id,
          source_event_id: proposal.source_event_id,
          artifact_id: input.artifact_id,
          subject_ref: subjectRef,
          candidate: proposal.candidate,
        }).edges;

  const provenance: ProvenanceRef[] = edgesToProvenanceRefs(edges).map((ref) => ({
    ref_type: ref.ref_type,
    ref_id: ref.ref_id,
    relationship: ref.relationship,
  }));
  // Always include source event + artifact as derived_from if structure missed them.
  if (!provenance.some((p) => p.ref_id === proposal.source_event_id)) {
    provenance.unshift({
      ref_type: "event",
      ref_id: proposal.source_event_id,
      relationship: "derived_from",
    });
  }
  if (!provenance.some((p) => p.ref_id === input.artifact_id)) {
    provenance.push({
      ref_type: "artifact",
      ref_id: input.artifact_id,
      relationship: "derived_from",
    });
  }

  try {
    const disp = store.recordKnowledgeDisposition({
      sourceEventId: proposal.source_event_id,
      artifactId: input.artifact_id,
      disposition,
      reasonCodes: [
        ...proposal.gate.reason_codes,
        `kind:${proposal.candidate.kind}`,
        "agentic_v1",
        wantPromote ? "materialize_promote" : "materialize_hold_first",
        `structure_edges:${edges.length}`,
      ],
      statement: proposal.candidate.statement,
      policyVersion: AGENTIC_POLICY_VERSION,
      scores: {
        value: disposition === "promote" ? 0.7 : 0.4,
        durability: 0.5,
        risk: proposal.secret_ok ? 0.1 : 0.9,
        noise: proposal.cite_ok ? 0.2 : 0.8,
      },
    });

    const extraction = store.proposeObservationDraft({
      statement: proposal.candidate.statement,
      evidenceArtifactRefs: [input.artifact_id],
      sourceEventId: proposal.source_event_id,
      confidence: proposal.candidate.confidence,
      provenance,
      ...(subjectRef !== null ? { subjectRef } : {}),
      idempotencyKey: agenticObservationIdempotencyKey(
        proposal.source_event_id,
        AGENTIC_POLICY_VERSION,
        proposal.proposal_id,
      ),
      lifecycleStatus,
    });

    if (extraction.status === "failed" || extraction.status === "skipped") {
      return {
        ...base,
        ok: false,
        disposition,
        observation_event_id: null,
        observation_status: "failed",
        disposition_status: disp.status,
        reason_codes: [
          extraction.status === "failed"
            ? (extraction.error ?? "observation_failed")
            : (extraction.reason ?? "observation_skipped"),
        ],
        provenance_ref_count: provenance.length,
        subject_ref: subjectRef,
        canonical_effect: "none",
      };
    }

    const eventId = extraction.event.event_id;
    markProposalMaterialized(agenticDb, {
      proposalId: proposal.proposal_id,
      eventId,
    });

    return {
      ...base,
      ok: true,
      disposition,
      observation_event_id: eventId,
      observation_status: extraction.status === "replay" ? "replay" : "created",
      disposition_status: disp.status,
      reason_codes: wantPromote
        ? ["materialized_promote_observation", "graph_lineage_written"]
        : ["materialized_hold_draft_observation", "graph_lineage_written"],
      provenance_ref_count: provenance.length,
      subject_ref: subjectRef,
      canonical_effect: "observation",
    };
  } catch (e) {
    return {
      ...base,
      ok: false,
      disposition,
      observation_event_id: null,
      observation_status: "failed",
      disposition_status: "failed",
      reason_codes: [e instanceof Error ? e.message : "materialize_failed"],
      provenance_ref_count: provenance.length,
      subject_ref: subjectRef,
      canonical_effect: "none",
    };
  }
}

export function agenticObservationIdempotencyKey(
  sourceEventId: string,
  policyVersion: string,
  proposalId: string,
): string {
  // Local-store keys: idem_[A-Za-z0-9_-]{16,128}
  const raw = `ag_${policyVersion}_${sourceEventId}_${proposalId}`.replace(/[^A-Za-z0-9_-]/g, "_");
  const body = raw.slice(0, 120);
  return `idem_${body.length >= 16 ? body : body.padEnd(16, "0")}`;
}
