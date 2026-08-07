/**
 * Post-extract quality filter (quality ultragoal Q5′ / QD2).
 * Provenance-primary: promote-eligible candidates must cite extract-view prose.
 * Secondary belt: metadata restatement / hook tautology regex (EN + common KO).
 */

import type { AgenticExtractCandidate, AgenticKnowledgeKind } from "./types.js";

export type QualityFilterResult = {
  keep: boolean;
  reason_codes: string[];
};

const PROMOTE_KINDS = new Set<AgenticKnowledgeKind>(["decision", "constraint", "preference"]);

const METADATA_RESTATEMENT =
  /\b(session\s*id|hook\s*event|agent\s*type|the\s+reason\s+for\s+the\s+session|last\s+assistant\s+message)\b/i;
const METADATA_RESTATEMENT_KO = /(세션\s*id|훅\s*이벤트|에이전트\s*유형)/i;
const HOOK_TAUTOLOGY =
  /\b(the\s+hook\s+event\s+is|session\s+ended\s+with\s+reason|hook_event_name)\b/i;

/**
 * Filter one extract candidate against the extract view the model saw.
 * When CARPEOS_AGENTIC_QUALITY_FILTERS=off, always keep (QD10 kill switch).
 */
export function qualityFilterCandidate(
  candidate: AgenticExtractCandidate,
  extractViewText: string,
  options?: { filters_off?: boolean },
): QualityFilterResult {
  if (options?.filters_off === true || process.env.CARPEOS_AGENTIC_QUALITY_FILTERS === "off") {
    return { keep: true, reason_codes: ["quality_filters_off"] };
  }

  const reason_codes: string[] = [];

  // Only load-bearing kinds are provenance-checked for promote path; others may pass through
  // as diagnostics (gate still holds fact_candidate).
  if (!PROMOTE_KINDS.has(candidate.kind) && candidate.kind !== "procedure") {
    return { keep: true, reason_codes: ["quality_non_promote_kind_passthrough"] };
  }

  if (candidate.citations.length === 0) {
    return { keep: false, reason_codes: ["quality_no_citations"] };
  }

  for (const c of candidate.citations) {
    const quote = c.quote.trim();
    if (quote.length === 0) {
      return { keep: false, reason_codes: ["quality_empty_quote"] };
    }
    // Authenticated offset: view.slice(start,end) === quote when offsets present.
    if (
      typeof c.start === "number" &&
      typeof c.end === "number" &&
      c.end > c.start &&
      c.end <= extractViewText.length
    ) {
      const slice = extractViewText.slice(c.start, c.end);
      if (slice !== quote) {
        // Ambiguous: allow if quote is unique substring; else reject.
        const first = extractViewText.indexOf(quote);
        const last = extractViewText.lastIndexOf(quote);
        if (first < 0) {
          return { keep: false, reason_codes: ["quality_offset_mismatch", "quality_quote_absent"] };
        }
        if (first !== last) {
          return { keep: false, reason_codes: ["quality_ambiguous_quote"] };
        }
        reason_codes.push("quality_offset_rebound");
      }
    } else if (!extractViewText.includes(quote)) {
      return { keep: false, reason_codes: ["quality_quote_not_in_extract_view"] };
    } else {
      const first = extractViewText.indexOf(quote);
      const last = extractViewText.lastIndexOf(quote);
      if (first !== last) {
        return { keep: false, reason_codes: ["quality_ambiguous_quote"] };
      }
    }
  }

  const statement = candidate.statement.trim();
  if (METADATA_RESTATEMENT.test(statement) || METADATA_RESTATEMENT_KO.test(statement)) {
    return { keep: false, reason_codes: ["quality_metadata_restatement"] };
  }
  if (HOOK_TAUTOLOGY.test(statement)) {
    return { keep: false, reason_codes: ["quality_hook_tautology"] };
  }

  return { keep: true, reason_codes: reason_codes.length > 0 ? reason_codes : ["quality_ok"] };
}
