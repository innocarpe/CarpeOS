import type { AgenticCitation, AgenticExtractCandidate } from "./types.js";

const SECRETISH = /\b(api[_-]?key|secret|password|bearer\s+[a-z0-9._\-]+|sk-[a-z0-9]{10,})\b/i;

/**
 * Deterministic citation + secret checks (E5). No LLM.
 */
export function verifyExtractCandidate(
  candidate: AgenticExtractCandidate,
  packText: string,
): { cite_ok: boolean; secret_ok: boolean; reason_codes: string[] } {
  const reason_codes: string[] = [];
  let cite_ok = true;
  let secret_ok = true;

  if (SECRETISH.test(candidate.statement)) {
    secret_ok = false;
    reason_codes.push("secret_like_statement");
  }

  if (candidate.citations.length === 0) {
    cite_ok = false;
    reason_codes.push("no_citations");
  }

  for (const c of candidate.citations) {
    if (!citationInPack(c, packText)) {
      cite_ok = false;
      reason_codes.push("citation_not_in_pack");
      break;
    }
    if (SECRETISH.test(c.quote)) {
      secret_ok = false;
      reason_codes.push("secret_like_quote");
    }
  }

  return { cite_ok, secret_ok, reason_codes };
}

function citationInPack(c: AgenticCitation, packText: string): boolean {
  const q = c.quote.trim();
  if (q.length === 0) return false;
  if (packText.includes(q)) return true;
  // Fallback: offset window if pack is raw contiguous text
  if (c.start >= 0 && c.end > c.start && c.end <= packText.length) {
    const slice = packText.slice(c.start, c.end);
    return slice === q || packText.includes(q);
  }
  return false;
}
