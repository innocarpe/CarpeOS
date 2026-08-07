/**
 * Offline-first agentic proposal pipeline (E1–E5 + gate → proposals).
 * No canonical writes. Capture path is never invoked.
 */

import { ruleAdmitEvidence } from "./admit.js";
import { evaluateAgenticGate } from "./gate.js";
import { makeAgenticPackId, packAgenticEvidence } from "./pack.js";
import {
  type AgenticProposalRecord,
  listAgenticProposals,
  makeProposalId,
  putAgenticProposal,
} from "./proposals.js";
import type { SqlDatabase } from "./sql.js";
import { type AgenticStageMode, runExtractStage, runTriageStage } from "./stages.js";
import { structureAgenticLinks } from "./structure.js";
import type { AgenticKnowledgeKind } from "./types.js";
import { verifyExtractCandidate } from "./verify.js";

export type AgenticPipelineInput = {
  trust_zone_id: string;
  source_event_id: string;
  hook_event_name: string;
  signal_text: string;
  /** Optional kind hint (fixtures). */
  hint_kind?: AgenticKnowledgeKind | null;
  /** Evidence artifact id for derived_from artifact edges (P4). */
  artifact_id?: string | null;
  /** Subject / project for about edges (P4). */
  subject_ref?: string | null;
  /** Already-materialized meaning unit event ids for optional supports edges. */
  sibling_unit_event_ids?: readonly string[];
  mode?: AgenticStageMode;
  allow_network?: boolean;
  /** Product default true (ADR 0018). Set false or hold_first for debug staging. */
  allow_auto_promote?: boolean;
  hold_first?: boolean;
  now?: Date;
  /** Optional agentic-off kill switch. */
  agentic_enabled?: boolean;
  /** Pre-fetched Flash JSON for triage (live path). */
  flash_triage_text?: string | null;
  /** Pre-fetched Flash JSON for extract (live path). */
  flash_extract_text?: string | null;
};

export type AgenticPipelineResult = {
  schema: "carpeos.agentic.pipeline-result/v1";
  ok: boolean;
  stage:
    | "disabled"
    | "admit"
    | "pack"
    | "triage"
    | "extract"
    | "verify"
    | "structure"
    | "gate"
    | "proposals"
    | "complete";
  admit_decision: "admit" | "drop" | null;
  triage_decision: "keep" | "drop" | "need_context" | null;
  pack_digest: string | null;
  proposals: AgenticProposalRecord[];
  /** Aggregate structure edge count across proposals (P4). */
  structure_edge_count: number;
  reason_codes: string[];
  canonical_effect: "none";
  network_used: boolean;
};

/**
 * Run E1→E5→gate and store proposal rows (canonical_effect none).
 * Idempotent on same inputs via proposal ids.
 */
export function runAgenticProposalPipeline(
  db: SqlDatabase,
  input: AgenticPipelineInput,
): AgenticPipelineResult {
  const base: AgenticPipelineResult = {
    schema: "carpeos.agentic.pipeline-result/v1",
    ok: false,
    stage: "admit",
    admit_decision: null,
    triage_decision: null,
    pack_digest: null,
    proposals: [],
    structure_edge_count: 0,
    reason_codes: [],
    canonical_effect: "none",
    network_used: false,
  };

  if (input.agentic_enabled === false) {
    return {
      ...base,
      stage: "disabled",
      reason_codes: ["agentic_off"],
      ok: true,
    };
  }

  const admit = ruleAdmitEvidence({
    source_event_id: input.source_event_id,
    trust_zone_id: input.trust_zone_id,
    hook_event_name: input.hook_event_name,
    signal_text: input.signal_text,
  });
  base.admit_decision = admit.decision;
  if (admit.decision === "drop") {
    return {
      ...base,
      ok: true,
      stage: "admit",
      reason_codes: admit.reason_codes,
    };
  }

  const pack_id = makeAgenticPackId({
    trust_zone_id: input.trust_zone_id,
    source_event_id: input.source_event_id,
    body_text: input.signal_text,
  });
  const packed = packAgenticEvidence({
    pack_id,
    body_text: input.signal_text,
    now_iso: (input.now ?? new Date()).toISOString(),
  });
  if (!packed.ok) {
    return {
      ...base,
      ok: false,
      stage: "pack",
      reason_codes: [packed.error_code, packed.detail],
    };
  }
  base.pack_digest = packed.pack_digest;

  const triage = runTriageStage({
    pack_text: packed.pack_text,
    pack_digest: packed.pack_digest,
    source_event_id: input.source_event_id,
    ...(input.mode !== undefined ? { mode: input.mode } : {}),
    ...(input.allow_network !== undefined ? { allow_network: input.allow_network } : {}),
    ...(input.flash_triage_text !== undefined && input.flash_triage_text !== null
      ? { flash_response_text: input.flash_triage_text }
      : {}),
  });
  base.triage_decision = triage.decision;
  base.network_used = base.network_used || triage.network_used;
  if (triage.decision === "drop") {
    return {
      ...base,
      ok: true,
      stage: "triage",
      reason_codes: triage.reason_codes,
    };
  }
  if (triage.decision === "need_context") {
    return {
      ...base,
      ok: true,
      stage: "triage",
      reason_codes: [...triage.reason_codes, "held_need_context"],
    };
  }

  const extract = runExtractStage({
    pack_text: packed.pack_text,
    pack_digest: packed.pack_digest,
    source_event_id: input.source_event_id,
    ...(input.mode !== undefined ? { mode: input.mode } : {}),
    ...(input.allow_network !== undefined ? { allow_network: input.allow_network } : {}),
    ...(input.flash_extract_text !== undefined && input.flash_extract_text !== null
      ? { flash_response_text: input.flash_extract_text }
      : {}),
    hint_kind: input.hint_kind ?? null,
  });
  base.network_used = base.network_used || extract.network_used;
  if (extract.candidates.length === 0) {
    return {
      ...base,
      ok: true,
      stage: "extract",
      reason_codes: extract.reason_codes,
    };
  }

  const proposals: AgenticProposalRecord[] = [];
  let structure_edge_count = 0;
  for (const candidate of extract.candidates) {
    const verified = verifyExtractCandidate(candidate, packed.pack_text);
    // E6 structure/link before gate so gate reason trail can include lineage.
    const unitRef = makeProposalId({
      trust_zone_id: input.trust_zone_id,
      source_event_id: input.source_event_id,
      pack_digest: packed.pack_digest,
      candidate,
    });
    const structured = structureAgenticLinks({
      unit_ref: unitRef,
      source_event_id: input.source_event_id,
      artifact_id: input.artifact_id ?? null,
      subject_ref: input.subject_ref ?? null,
      candidate,
      sibling_unit_event_ids: input.sibling_unit_event_ids ?? [],
    });
    structure_edge_count += structured.edges.length;
    const gate = evaluateAgenticGate({
      candidate,
      cite_ok: verified.cite_ok,
      secret_ok: verified.secret_ok,
      // ADR 0018: promote-when-verified is default; hold_first only when explicitly false
      allow_auto_promote: input.allow_auto_promote !== false,
      ...(input.hold_first === true ? { hold_first: true } : {}),
    });
    const gateWithStructure = {
      ...gate,
      reason_codes: [
        ...gate.reason_codes,
        ...structured.edges
          .filter((e) => e.kind === "derived_from")
          .map((e) => `edge:derived_from:${e.to_ref}`),
        ...structured.edges.filter((e) => e.kind === "about").map((e) => `edge:about:${e.to_ref}`),
      ],
    };
    const proposal = putAgenticProposal(db, {
      trust_zone_id: input.trust_zone_id,
      source_event_id: input.source_event_id,
      pack_digest: packed.pack_digest,
      candidate,
      cite_ok: verified.cite_ok,
      secret_ok: verified.secret_ok,
      verify_reason_codes: verified.reason_codes,
      gate: gateWithStructure,
      edges: structured.edges,
      structure_reason_codes: structured.reason_codes,
      ...(input.now !== undefined ? { now: input.now } : {}),
    });
    if (proposal.canonical_effect !== "none") {
      throw new Error("pipeline violated canonical_effect fence");
    }
    proposals.push(proposal);
  }

  return {
    ...base,
    ok: true,
    stage: "complete",
    proposals,
    structure_edge_count,
    reason_codes: ["proposals_written", `structure_edges:${structure_edge_count}`],
  };
}

export function listProposalsForZone(
  db: SqlDatabase,
  trust_zone_id: string,
  limit = 50,
): AgenticProposalRecord[] {
  return listAgenticProposals(db, { trust_zone_id, limit });
}
