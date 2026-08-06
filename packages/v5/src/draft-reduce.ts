/**
 * Runtime draft reducer for live/fake extract outputs.
 * Produces draft-only records with canonical_effect: "none".
 * Distinct from fixture oracle validateReducerFixture (M0/M3 hashes).
 */

import {
  createRunScopeKey,
  createScopeCounterV2,
  formulaId,
  type ExtractResponse,
} from "./reducer.js";
import { digestSha256 } from "./jcs.js";

export type DraftReduceInput = {
  pack_id: string;
  pack_digest: string;
  redaction_policy_id?: string;
  profile_digest_binding?: string;
  extract: ExtractResponse;
  attempt_id: string;
  now_iso: string;
};

export type DraftProposalOutput = {
  schema: "carpeos.reducer-output/v1";
  run_scope_key: string;
  run_ordinal: number;
  run_id: string;
  proposal_id: string;
  status: "draft" | "no_candidate";
  reason_code: string;
  selected_attempt_ids: string[];
  selected_candidate_ids: string[];
  synthesis_id: string | null;
  proposal_row: {
    schema: "carpeos.proposal-row/v1";
    row_id: string;
    run_scope_key: string;
    run_ordinal: number;
    proposal_id: string;
    status: "draft" | "no_candidate";
    reason_code: string;
    transition_seq: number;
    selected_attempt_ids: string[];
    selected_candidate_ids: string[];
    synthesis_id: string | null;
    canonical_effect: "none";
    audit_envelope: {
      created_at: string;
      updated_at: string;
      actor_ref: null;
      trace_ref: null;
    };
  };
  transitions: Array<Record<string, unknown>>;
  prior: null;
  canonical_effect: "none";
  extract_digest: string;
};

/**
 * Map an extract response into a draft-only proposal projection.
 * Never allocates canonical sequences or outbox rows.
 */
export function reduceExtractToDraft(input: DraftReduceInput): DraftProposalOutput {
  const redaction_policy_id = input.redaction_policy_id ?? "redact_v1";
  const scopeBinding: {
    pack_id: string;
    redaction_policy_id: string;
    profile_digest_binding?: string;
  } = {
    pack_id: input.pack_id,
    redaction_policy_id,
  };
  if (input.profile_digest_binding !== undefined) {
    scopeBinding.profile_digest_binding = input.profile_digest_binding;
  }
  const run_scope_key = createRunScopeKey(scopeBinding);
  const counter = createScopeCounterV2();
  counter.createScope(run_scope_key);
  const run_ordinal = counter.nextOrdinal(run_scope_key);
  counter.mark(run_scope_key, run_ordinal);

  const run_id = formulaId("run_", { run_scope_key, run_ordinal, pack: input.pack_digest });
  const proposal_id = formulaId("prop_", { run_id, attempt: input.attempt_id });
  const extract_digest = digestSha256({
    schema: "carpeos.llm-attempt-result/v1",
    result: input.extract,
  });

  const noCandidate = input.extract.result === "no_candidate";
  const status: "draft" | "no_candidate" = noCandidate ? "no_candidate" : "draft";
  const reason_code = noCandidate ? "extract_no_candidate" : "selected_primary";

  const selected_candidate_ids = noCandidate
    ? []
    : input.extract.candidates.map((c, i) =>
        formulaId("cand_", {
          proposal_id,
          i,
          segment_id: c.segment_id,
          start: c.start,
          end: c.end,
        }),
      );

  const selected_attempt_ids = [input.attempt_id];
  const row_id = formulaId("row_", { proposal_id, run_ordinal });
  const transition_id = formulaId("tr_", { proposal_id, seq: 0 });

  const proposal_row = {
    schema: "carpeos.proposal-row/v1" as const,
    row_id,
    run_scope_key,
    run_ordinal,
    proposal_id,
    status,
    reason_code,
    transition_seq: 0,
    selected_attempt_ids,
    selected_candidate_ids,
    synthesis_id: null,
    canonical_effect: "none" as const,
    audit_envelope: {
      created_at: input.now_iso,
      updated_at: input.now_iso,
      actor_ref: null,
      trace_ref: null,
    },
  };

  return {
    schema: "carpeos.reducer-output/v1",
    run_scope_key,
    run_ordinal,
    run_id,
    proposal_id,
    status,
    reason_code,
    selected_attempt_ids,
    selected_candidate_ids,
    synthesis_id: null,
    proposal_row,
    transitions: [
      {
        schema: "carpeos.proposal-transition/v1",
        transition_id,
        run_scope_key,
        run_ordinal,
        proposal_id,
        transition_seq: 0,
        from_status: status,
        to_status: status,
        reason_code,
        canonical_effect: "none",
      },
    ],
    prior: null,
    canonical_effect: "none",
    extract_digest,
  };
}
