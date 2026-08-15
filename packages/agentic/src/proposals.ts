/**
 * Sidecar proposal records after E5 verify + gate (P1d).
 * canonical_effect remains "none" until P2 materialize bridge.
 */

import { AGENTIC_DRAFT_CLAIM_KINDS } from "./claims.js";
import { digestSha256, stableJson } from "./digest.js";
import type { SqlDatabase } from "./sql.js";
import {
  AGENTIC_POLICY_VERSION,
  type AgenticEdgeProposal,
  type AgenticExtractCandidate,
  type AgenticGateResult,
} from "./types.js";

export type AgenticProposalRecord = {
  schema: "carpeos.agentic.proposal/v1";
  proposal_id: string;
  trust_zone_id: string;
  source_event_id: string;
  pack_digest: string;
  candidate: AgenticExtractCandidate;
  cite_ok: boolean;
  secret_ok: boolean;
  verify_reason_codes: string[];
  /** P4 structure/link edge proposals (materialize via provenance + graph rebuild). */
  edges: AgenticEdgeProposal[];
  structure_reason_codes: string[];
  gate: AgenticGateResult;
  policy_version: typeof AGENTIC_POLICY_VERSION;
  /** Always none until materialize (P2/P5). */
  canonical_effect: "none";
  created_at: string;
  /** Primary materialize event (Observation or Claim). */
  materialized_event_id: string | null;
  /** P5: draft Claim event id when dual-written or claim-only. */
  materialized_claim_event_id: string | null;
};

type ProposalRow = { proposal_json: string };

export function migrateAgenticProposals(db: SqlDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agentic_proposals (
      proposal_id TEXT PRIMARY KEY,
      trust_zone_id TEXT NOT NULL,
      source_event_id TEXT NOT NULL,
      pack_digest TEXT NOT NULL,
      gate_decision TEXT NOT NULL,
      proposal_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      materialized_event_id TEXT,
      UNIQUE(trust_zone_id, source_event_id, pack_digest, proposal_id)
    );
    CREATE INDEX IF NOT EXISTS idx_agentic_proposals_zone
      ON agentic_proposals (trust_zone_id, gate_decision, created_at);
  `);
}

export function makeProposalId(input: {
  trust_zone_id: string;
  source_event_id: string;
  pack_digest: string;
  candidate: AgenticExtractCandidate;
  /** Disambiguate identical candidates within one pack (near-dup hold path). */
  candidate_ordinal?: number;
}): string {
  return `agp_${digestSha256({
    schema: "carpeos.agentic.proposal-id/v1",
    trust_zone_id: input.trust_zone_id,
    source_event_id: input.source_event_id,
    pack_digest: input.pack_digest,
    kind: input.candidate.kind,
    statement: input.candidate.statement,
    citations: input.candidate.citations,
    candidate_ordinal: input.candidate_ordinal ?? 0,
  }).slice("sha256:".length, "sha256:".length + 40)}`;
}

/** Idempotent upsert of a proposal; never sets canonical_effect other than none. */
export function putAgenticProposal(
  db: SqlDatabase,
  input: {
    trust_zone_id: string;
    source_event_id: string;
    pack_digest: string;
    candidate: AgenticExtractCandidate;
    cite_ok: boolean;
    secret_ok: boolean;
    verify_reason_codes: string[];
    gate: AgenticGateResult;
    edges?: readonly AgenticEdgeProposal[];
    structure_reason_codes?: readonly string[];
    candidate_ordinal?: number;
    now?: Date;
  },
): AgenticProposalRecord {
  migrateAgenticProposals(db);
  const proposal_id = makeProposalId({
    trust_zone_id: input.trust_zone_id,
    source_event_id: input.source_event_id,
    pack_digest: input.pack_digest,
    candidate: input.candidate,
    ...(input.candidate_ordinal !== undefined
      ? { candidate_ordinal: input.candidate_ordinal }
      : {}),
  });
  const existing = getAgenticProposal(db, proposal_id);
  if (existing !== undefined) {
    return existing;
  }
  const created_at = (input.now ?? new Date()).toISOString();
  const record: AgenticProposalRecord = {
    schema: "carpeos.agentic.proposal/v1",
    proposal_id,
    trust_zone_id: input.trust_zone_id,
    source_event_id: input.source_event_id,
    pack_digest: input.pack_digest,
    candidate: input.candidate,
    cite_ok: input.cite_ok,
    secret_ok: input.secret_ok,
    verify_reason_codes: input.verify_reason_codes,
    edges: [...(input.edges ?? [])],
    structure_reason_codes: [...(input.structure_reason_codes ?? [])],
    gate: input.gate,
    policy_version: AGENTIC_POLICY_VERSION,
    canonical_effect: "none",
    created_at,
    materialized_event_id: null,
    materialized_claim_event_id: null,
  };
  if (record.canonical_effect !== "none") {
    throw new Error("proposal records must have canonical_effect none until materialize");
  }
  db.prepare(`
    INSERT INTO agentic_proposals (
      proposal_id, trust_zone_id, source_event_id, pack_digest, gate_decision,
      proposal_json, created_at, materialized_event_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.proposal_id,
    record.trust_zone_id,
    record.source_event_id,
    record.pack_digest,
    record.gate.decision,
    stableJson(record),
    record.created_at,
    null,
  );
  return record;
}

export function getAgenticProposal(
  db: SqlDatabase,
  proposalId: string,
): AgenticProposalRecord | undefined {
  migrateAgenticProposals(db);
  const row = db
    .prepare("SELECT proposal_json FROM agentic_proposals WHERE proposal_id = ?")
    .get(proposalId) as ProposalRow | undefined;
  return row === undefined ? undefined : normalizeProposal(JSON.parse(row.proposal_json));
}

/** Backfill edges fields for proposals written before P4. */
function normalizeProposal(raw: AgenticProposalRecord): AgenticProposalRecord {
  return {
    ...raw,
    edges: Array.isArray(raw.edges) ? raw.edges : [],
    structure_reason_codes: Array.isArray(raw.structure_reason_codes)
      ? raw.structure_reason_codes
      : [],
    materialized_claim_event_id:
      typeof raw.materialized_claim_event_id === "string" ? raw.materialized_claim_event_id : null,
  };
}

export function listAgenticProposals(
  db: SqlDatabase,
  input: {
    trust_zone_id?: string;
    gate_decision?: "promote" | "hold" | "reject";
    limit?: number;
    /** Default asc (legacy). Use desc for recent-first near-dup windows. */
    order?: "asc" | "desc";
    /** When true, only rows with no primary materialize event yet. */
    unmaterialized_only?: boolean;
  } = {},
): AgenticProposalRecord[] {
  migrateAgenticProposals(db);
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("list limit must be a positive integer");
  }
  let sql = `SELECT proposal_json FROM agentic_proposals WHERE 1=1`;
  const params: unknown[] = [];
  if (input.trust_zone_id !== undefined) {
    sql += ` AND trust_zone_id = ?`;
    params.push(input.trust_zone_id);
  }
  if (input.gate_decision !== undefined) {
    sql += ` AND gate_decision = ?`;
    params.push(input.gate_decision);
  }
  if (input.unmaterialized_only === true) {
    sql += ` AND materialized_event_id IS NULL`;
  }
  const order = input.order === "desc" ? "DESC" : "ASC";
  sql += ` ORDER BY created_at ${order}, proposal_id ${order} LIMIT ?`;
  params.push(limit);
  const rows = db.prepare(sql).all(...params) as ProposalRow[];
  return rows.map((r) => normalizeProposal(JSON.parse(r.proposal_json)));
}

/**
 * Promote proposals not yet written to Observation — HITL-free backlog drain.
 */
export function listUnmaterializedPromoteProposals(
  db: SqlDatabase,
  input: { trust_zone_id?: string; limit?: number } = {},
): AgenticProposalRecord[] {
  return listAgenticProposals(db, {
    ...(input.trust_zone_id !== undefined ? { trust_zone_id: input.trust_zone_id } : {}),
    gate_decision: "promote",
    unmaterialized_only: true,
    limit: input.limit ?? 50,
    order: "asc",
  });
}

/** Mark proposal materialized (P2/P5); keeps record for idempotency. */
export function markProposalMaterialized(
  db: SqlDatabase,
  input: {
    proposalId: string;
    eventId: string;
    claimEventId?: string | null;
    now?: Date;
  },
): boolean {
  migrateAgenticProposals(db);
  const existing = getAgenticProposal(db, input.proposalId);
  if (existing === undefined) return false;
  if (existing.materialized_event_id !== null) {
    return existing.materialized_event_id === input.eventId;
  }
  const claimId = input.claimEventId ?? null;
  const updated: AgenticProposalRecord = {
    ...existing,
    materialized_event_id: input.eventId,
    materialized_claim_event_id: claimId,
  };
  db.prepare(`
    UPDATE agentic_proposals
    SET proposal_json = ?, materialized_event_id = ?
    WHERE proposal_id = ?
  `).run(stableJson(updated), input.eventId, input.proposalId);
  return true;
}

/** List proposals that materialized a draft Claim (P5 operator surface). */
export function listAgenticDraftClaimProposals(
  db: SqlDatabase,
  input: { trust_zone_id?: string; limit?: number } = {},
): AgenticProposalRecord[] {
  const rows = listAgenticProposals(db, {
    ...(input.trust_zone_id !== undefined ? { trust_zone_id: input.trust_zone_id } : {}),
    limit: input.limit ?? 50,
  });
  return rows.filter(
    (p) =>
      p.materialized_claim_event_id !== null ||
      (p.materialized_event_id !== null && AGENTIC_DRAFT_CLAIM_KINDS.has(p.candidate.kind)),
  );
}
