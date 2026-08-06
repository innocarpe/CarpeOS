import type { AgenticExtractCandidate, AgenticGateResult } from "./types.js";
import { AGENTIC_POLICY_VERSION } from "./types.js";

const AUTO_PROMOTE_KINDS = new Set(["decision", "constraint", "preference"]);

/**
 * Deterministic gate features + hold-first policy (ADR 0017 D6).
 * Does not call LLM. Does not write canonical events.
 */
export function evaluateAgenticGate(input: {
  candidate: AgenticExtractCandidate;
  cite_ok: boolean;
  secret_ok: boolean;
  /** When false, never auto-promote (P1–P2 default). */
  allow_auto_promote?: boolean;
}): AgenticGateResult {
  const kind_allowlisted = AUTO_PROMOTE_KINDS.has(input.candidate.kind);
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

  // Hold-first: auto-promote only when explicitly enabled, allowlisted, and E5-clean.
  // Min confidence is a feature floor only (never sole authority).
  const conf = input.candidate.confidence;
  const confidence_ok = typeof conf !== "number" || conf >= 0.55;
  if (
    input.allow_auto_promote === true &&
    kind_allowlisted &&
    input.cite_ok &&
    input.secret_ok &&
    confidence_ok
  ) {
    return {
      schema: "carpeos.agentic.gate-result/v1",
      policy_version: AGENTIC_POLICY_VERSION,
      decision: "promote",
      reason_codes: ["allowlist_auto_promote", "cite_ok", "e5_clean"],
      features,
    };
  }

  return {
    schema: "carpeos.agentic.gate-result/v1",
    policy_version: AGENTIC_POLICY_VERSION,
    decision: "hold",
    reason_codes: ["hold_first_default"],
    features,
  };
}
