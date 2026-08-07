import type { AgenticExtractCandidate, AgenticGateResult } from "./types.js";
import { AGENTIC_POLICY_VERSION } from "./types.js";

/** ADR 0018 usable allowlist v1 — procedure and fact_candidate stay out. */
const USABLE_PROMOTE_KINDS = new Set(["decision", "constraint", "preference"]);

/**
 * Deterministic gate: promote-when-verified (ADR 0018 D3).
 * Default is promote for allowlisted kinds when E5 clean — not hold-first.
 * Does not call LLM. Does not write canonical events.
 */
export function evaluateAgenticGate(input: {
  candidate: AgenticExtractCandidate;
  cite_ok: boolean;
  secret_ok: boolean;
  /**
   * When false, force hold even if verified (debug staging only).
   * Product default: true (or omit).
   */
  allow_auto_promote?: boolean;
  /** Debug: force hold-first product path (CARPEOS_AGENTIC_HOLD_FIRST). */
  hold_first?: boolean;
}): AgenticGateResult {
  const kind_allowlisted = USABLE_PROMOTE_KINDS.has(input.candidate.kind);
  const features = {
    cite_ok: input.cite_ok,
    secret_ok: input.secret_ok,
    kind_allowlisted,
    model_confidence: input.candidate.confidence,
  };

  if (!input.secret_ok) {
    return {
      schema: "carpeos.agentic.gate-result/v1",
      policy_version: AGENTIC_POLICY_VERSION,
      decision: "reject",
      reason_codes: ["secret_like_material"],
      features,
    };
  }

  if (!input.cite_ok || input.candidate.citations.length === 0) {
    return {
      schema: "carpeos.agentic.gate-result/v1",
      policy_version: AGENTIC_POLICY_VERSION,
      decision: "reject",
      reason_codes: ["missing_or_failed_citation"],
      features,
    };
  }

  if (input.candidate.statement.trim().length < 8) {
    return {
      schema: "carpeos.agentic.gate-result/v1",
      policy_version: AGENTIC_POLICY_VERSION,
      decision: "reject",
      reason_codes: ["statement_too_short"],
      features,
    };
  }

  // Side-channel kinds: never auto usable in v1.
  if (input.candidate.kind === "open_question") {
    return {
      schema: "carpeos.agentic.gate-result/v1",
      policy_version: AGENTIC_POLICY_VERSION,
      decision: "hold",
      reason_codes: ["open_question_side_channel"],
      features,
    };
  }
  if (input.candidate.kind === "procedure") {
    return {
      schema: "carpeos.agentic.gate-result/v1",
      policy_version: AGENTIC_POLICY_VERSION,
      decision: "hold",
      reason_codes: ["procedure_hold_biased_v1"],
      features,
    };
  }
  if (input.candidate.kind === "fact_candidate") {
    return {
      schema: "carpeos.agentic.gate-result/v1",
      policy_version: AGENTIC_POLICY_VERSION,
      decision: "hold",
      reason_codes: ["fact_candidate_not_in_v1_allowlist"],
      features,
    };
  }

  const conf = input.candidate.confidence;
  const confidence_ok = typeof conf !== "number" || conf >= 0.55;
  const promoteEnabled = input.hold_first === true ? false : input.allow_auto_promote !== false;

  if (
    promoteEnabled &&
    kind_allowlisted &&
    input.cite_ok &&
    input.secret_ok &&
    confidence_ok
  ) {
    return {
      schema: "carpeos.agentic.gate-result/v1",
      policy_version: AGENTIC_POLICY_VERSION,
      decision: "promote",
      reason_codes: ["promote_when_verified", "allowlist_kind", "cite_ok", "e5_clean"],
      features,
    };
  }

  if (!kind_allowlisted) {
    return {
      schema: "carpeos.agentic.gate-result/v1",
      policy_version: AGENTIC_POLICY_VERSION,
      decision: "hold",
      reason_codes: ["kind_not_in_usable_allowlist"],
      features,
    };
  }

  return {
    schema: "carpeos.agentic.gate-result/v1",
    policy_version: AGENTIC_POLICY_VERSION,
    decision: "hold",
    reason_codes: promoteEnabled
      ? ["hold_confidence_or_features"]
      : ["hold_first_debug_override"],
    features,
  };
}
