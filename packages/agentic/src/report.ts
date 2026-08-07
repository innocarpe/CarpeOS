/**
 * Operator-facing report redaction (quality ultragoal Q1.5′ / QD7).
 *
 * Default flush/run/status/timer surfaces must not emit candidate statements,
 * citation quotes, or prepared pack views. Pass verbose=true for debug only.
 */

import type { AgenticPipelineResult } from "./pipeline.js";
import type { AgenticProposalRecord } from "./proposals.js";
import type { AgenticRunnerReport } from "./runner.js";
import type { AgenticCitation, AgenticExtractCandidate } from "./types.js";

export const AGENTIC_REPORT_REDACTED_PLACEHOLDER = "[redacted]" as const;

export type AgenticReportRedactionOptions = {
  /** When true, leave statements/quotes/views intact (operator debug). */
  verbose?: boolean;
};

export type AgenticRedactedRunnerReport = AgenticRunnerReport & {
  /** true when statements/quotes/views were stripped for default operator output. */
  redacted: boolean;
};

function redactCitation(c: AgenticCitation): AgenticCitation {
  return {
    ...c,
    quote: AGENTIC_REPORT_REDACTED_PLACEHOLDER,
  };
}

function redactCandidate(candidate: AgenticExtractCandidate): AgenticExtractCandidate {
  return {
    ...candidate,
    statement: AGENTIC_REPORT_REDACTED_PLACEHOLDER,
    citations: candidate.citations.map(redactCitation),
  };
}

/** Redact a single proposal for default CLI/timer JSON. */
export function redactAgenticProposalForReport(
  proposal: AgenticProposalRecord,
  options?: AgenticReportRedactionOptions,
): AgenticProposalRecord {
  if (options?.verbose === true) return proposal;
  return {
    ...proposal,
    candidate: redactCandidate(proposal.candidate),
  };
}

/** Redact pipeline result views + proposal statements/quotes. */
export function redactAgenticPipelineResultForReport(
  result: AgenticPipelineResult,
  options?: AgenticReportRedactionOptions,
): AgenticPipelineResult {
  if (options?.verbose === true) return result;
  return {
    ...result,
    triage_view_text: result.triage_view_text !== null ? AGENTIC_REPORT_REDACTED_PLACEHOLDER : null,
    extract_view_text:
      result.extract_view_text !== null ? AGENTIC_REPORT_REDACTED_PLACEHOLDER : null,
    proposals: result.proposals.map((p) => redactAgenticProposalForReport(p, options)),
  };
}

/**
 * Default operator serialization of processAgenticOnce report.
 * Safe for agentic flush / run / timer logs.
 */
export function redactAgenticRunnerReport(
  report: AgenticRunnerReport,
  options?: AgenticReportRedactionOptions,
): AgenticRedactedRunnerReport {
  if (options?.verbose === true) {
    return { ...report, redacted: false };
  }
  return {
    ...report,
    redacted: true,
    pipelines: report.pipelines.map((p) => redactAgenticPipelineResultForReport(p, options)),
  };
}

/**
 * True when a JSON-serialized operator report still contains private statement/quote text.
 * Used by regression tests (not a runtime gate).
 */
export function reportJsonLeaksPrivateText(
  json: string,
  knownPrivateFragments: readonly string[],
): string[] {
  const hits: string[] = [];
  for (const frag of knownPrivateFragments) {
    if (frag.length === 0) continue;
    if (json.includes(frag)) hits.push(frag);
  }
  return hits;
}
