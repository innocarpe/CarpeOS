/**
 * E8 Materialize bridge — draft Observation and/or draft Claim (P2 + P5).
 * Never creates AcceptanceDecision. Hold-first unless gate already decided promote
 * and caller allows promotion materialization.
 */

import type { LocalCaptureStore } from "@carpeos/local-store";
import type { ProvenanceRef } from "@carpeos/schema";
import {
  agenticClaimIdempotencyKey,
  agenticKindToClaimType,
  materializeTargetsForKind,
} from "./claims.js";
import { type AgenticProposalRecord, markProposalMaterialized } from "./proposals.js";
import type { SqlDatabase } from "./sql.js";
import { edgesToProvenanceRefs, structureAgenticLinks } from "./structure.js";
import { AGENTIC_KNOWN_POLICY_VERSIONS, AGENTIC_POLICY_VERSION } from "./types.js";

export type MaterializeAgenticInput = {
  store: LocalCaptureStore;
  agenticDb: SqlDatabase;
  proposal: AgenticProposalRecord;
  /** Evidence artifact id in the same trust zone as the source event. */
  artifact_id: string;
  /**
   * When false, force draft even if gate.promote (debug hold-first).
   * ADR 0018 product default: true / omit — gate promote → active usable unit.
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
  /** P5 draft Claim event id (lifecycle draft; never AcceptanceDecision). */
  claim_event_id: string | null;
  claim_status: "created" | "replay" | "none" | "failed";
  claim_type: "factual" | "decision" | "inference" | null;
  disposition_status: "written" | "replay" | "skipped" | "failed";
  reason_codes: string[];
  /** P4: number of provenance refs written for graph density. */
  provenance_ref_count: number;
  /** P4: subject used for about edges in graph rebuild. */
  subject_ref: string | null;
  canonical_effect: "observation" | "draft_claim" | "observation_and_draft_claim" | "none";
};

/**
 * Materialize a gated proposal into local-store typed writers.
 * Reject gates write disposition only (no Observation/Claim).
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

  const empty = (partial: Partial<MaterializeAgenticResult>): MaterializeAgenticResult => ({
    ...base,
    ok: false,
    disposition: "skipped",
    observation_event_id: null,
    observation_status: "none",
    claim_event_id: null,
    claim_status: "none",
    claim_type: null,
    disposition_status: "skipped",
    reason_codes: [],
    provenance_ref_count: 0,
    subject_ref: subjectRef,
    canonical_effect: "none",
    ...partial,
  });

  // Accept current + known legacy stamps (agentic_v1) so HITL-free backlog
  // materialize can close pre-quality promotes without human re-gate.
  if (!AGENTIC_KNOWN_POLICY_VERSIONS.has(proposal.policy_version)) {
    return empty({ reason_codes: ["policy_version_mismatch"] });
  }

  if (proposal.materialized_event_id !== null) {
    const claimType = agenticKindToClaimType(proposal.candidate.kind);
    const hasClaim =
      proposal.materialized_claim_event_id !== null ||
      (claimType !== null &&
        materializeTargetsForKind(proposal.candidate.kind).observation === false);
    return {
      ...base,
      ok: true,
      disposition: proposal.gate.decision,
      observation_event_id: materializeTargetsForKind(proposal.candidate.kind).observation
        ? proposal.materialized_event_id
        : null,
      observation_status: materializeTargetsForKind(proposal.candidate.kind).observation
        ? "replay"
        : "none",
      claim_event_id:
        proposal.materialized_claim_event_id ??
        (hasClaim && !materializeTargetsForKind(proposal.candidate.kind).observation
          ? proposal.materialized_event_id
          : proposal.materialized_claim_event_id),
      claim_status:
        proposal.materialized_claim_event_id !== null ||
        (claimType !== null && !materializeTargetsForKind(proposal.candidate.kind).observation)
          ? "replay"
          : "none",
      claim_type: claimType,
      disposition_status: "replay",
      reason_codes: ["already_materialized"],
      provenance_ref_count: 0,
      subject_ref: subjectRef,
      canonical_effect: resolveCanonicalEffect(
        materializeTargetsForKind(proposal.candidate.kind).observation &&
          proposal.materialized_event_id !== null,
        claimType !== null &&
          (proposal.materialized_claim_event_id !== null ||
            !materializeTargetsForKind(proposal.candidate.kind).observation),
      ),
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
          AGENTIC_POLICY_VERSION,
        ],
        statement: proposal.candidate.statement,
        policyVersion: AGENTIC_POLICY_VERSION,
      });
      return empty({
        ok: true,
        disposition: "reject",
        disposition_status: disp.status,
        reason_codes: ["reject_disposition_only"],
      });
    } catch (e) {
      return empty({
        disposition: "reject",
        disposition_status: "failed",
        reason_codes: [e instanceof Error ? e.message : "disposition_failed"],
      });
    }
  }

  const wantPromote = gateDecision === "promote" && input.allow_promote_materialize !== false;
  const disposition: "hold" | "promote" = wantPromote ? "promote" : "hold";
  const lifecycleStatus = wantPromote ? "active" : "draft";
  const targets = materializeTargetsForKind(proposal.candidate.kind);
  const claimType = agenticKindToClaimType(proposal.candidate.kind);

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
        AGENTIC_POLICY_VERSION,
        `formation:${AGENTIC_POLICY_VERSION}`,
        wantPromote ? "materialize_promote" : "materialize_hold_first",
        `structure_edges:${edges.length}`,
        targets.draft_claim ? "p5_draft_claim_target" : "p5_observation_only",
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

    let observation_event_id: string | null = null;
    let observation_status: MaterializeAgenticResult["observation_status"] = "none";
    let claim_event_id: string | null = null;
    let claim_status: MaterializeAgenticResult["claim_status"] = "none";
    const reason_codes: string[] = [];

    if (targets.observation) {
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
        return empty({
          disposition,
          disposition_status: disp.status,
          observation_status: "failed",
          provenance_ref_count: provenance.length,
          reason_codes: [
            extraction.status === "failed"
              ? (extraction.error ?? "observation_failed")
              : (extraction.reason ?? "observation_skipped"),
          ],
        });
      }

      observation_event_id = extraction.event.event_id;
      observation_status = extraction.status === "replay" ? "replay" : "created";
      reason_codes.push(
        wantPromote ? "materialized_promote_observation" : "materialized_hold_draft_observation",
        "graph_lineage_written",
      );
    }

    if (targets.draft_claim && claimType !== null) {
      // Claim support must reference visible canonical events (not bare artifacts).
      // derived_from → evidence (required lineage); supports → Observation when dual-written.
      const support: ProvenanceRef[] = [
        {
          ref_type: "event",
          ref_id: proposal.source_event_id,
          relationship: "derived_from",
        },
      ];
      if (observation_event_id !== null) {
        support.push({
          ref_type: "event",
          ref_id: observation_event_id,
          relationship: "supports",
        });
      }

      const claimResult = store.proposeClaimDraft({
        statement: proposal.candidate.statement,
        claimType,
        support,
        confidence: proposal.candidate.confidence,
        ...(subjectRef !== null ? { subjectRef } : {}),
        idempotencyKey: agenticClaimIdempotencyKey(
          proposal.source_event_id,
          AGENTIC_POLICY_VERSION,
          proposal.proposal_id,
        ),
      });

      claim_event_id = claimResult.event.event_id;
      claim_status = claimResult.status === "replay" ? "replay" : "created";
      // Hard fence: Claims are always draft; never AcceptanceDecision.
      if (claimResult.event.lifecycle_status !== "draft") {
        return empty({
          disposition,
          disposition_status: disp.status,
          observation_event_id,
          observation_status,
          claim_event_id,
          claim_status: "failed",
          claim_type: claimType,
          provenance_ref_count: provenance.length,
          reason_codes: ["claim_not_draft_lifecycle"],
        });
      }
      if (claimResult.event.event_type !== "Claim") {
        return empty({
          disposition,
          disposition_status: disp.status,
          observation_event_id,
          observation_status,
          claim_status: "failed",
          claim_type: claimType,
          provenance_ref_count: provenance.length,
          reason_codes: ["claim_type_mismatch"],
        });
      }
      reason_codes.push(
        `materialized_draft_claim:${claimType}`,
        "no_acceptance_decision",
        "graph_lineage_written",
      );
    }

    if (observation_event_id === null && claim_event_id === null) {
      return empty({
        disposition,
        disposition_status: disp.status,
        provenance_ref_count: provenance.length,
        reason_codes: ["no_materialize_target"],
      });
    }

    const primaryEventId = observation_event_id ?? claim_event_id!;
    markProposalMaterialized(agenticDb, {
      proposalId: proposal.proposal_id,
      eventId: primaryEventId,
      claimEventId: claim_event_id,
    });

    return {
      ...base,
      ok: true,
      disposition,
      observation_event_id,
      observation_status,
      claim_event_id,
      claim_status,
      claim_type: claimType,
      disposition_status: disp.status,
      reason_codes,
      provenance_ref_count: provenance.length,
      subject_ref: subjectRef,
      canonical_effect: resolveCanonicalEffect(
        observation_event_id !== null,
        claim_event_id !== null,
      ),
    };
  } catch (e) {
    return empty({
      disposition,
      observation_status: "failed",
      claim_status: "failed",
      claim_type: claimType,
      disposition_status: "failed",
      provenance_ref_count: provenance.length,
      reason_codes: [e instanceof Error ? e.message : "materialize_failed"],
    });
  }
}

function resolveCanonicalEffect(
  hasObservation: boolean,
  hasClaim: boolean,
): MaterializeAgenticResult["canonical_effect"] {
  if (hasObservation && hasClaim) return "observation_and_draft_claim";
  if (hasClaim) return "draft_claim";
  if (hasObservation) return "observation";
  return "none";
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
