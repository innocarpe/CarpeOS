/**
 * Deterministic citation + secret + statement-grounding checks (E5).
 * ADR 0018 D3.1: quote ⊆ pack is not enough — statement must be grounded in cited spans.
 * No LLM.
 */

import type { AgenticCitation, AgenticExtractCandidate } from "./types.js";

const SECRETISH = /\b(api[_-]?key|secret|password|bearer\s+[a-z0-9._-]+|sk-[a-z0-9]{10,})\b/i;

/** Max statement length relative to longest cited quote (promote-when-verified). */
export const STATEMENT_QUOTE_LEN_FACTOR = 3;
/** Min token Jaccard overlap between statement and union of cited quotes. */
export const STATEMENT_QUOTE_OVERLAP_MIN = 0.35;

/**
 * Deterministic citation + secret + grounding checks (E5).
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

  if (cite_ok && candidate.citations.length > 0) {
    const grounded = statementGroundedInCitations(candidate.statement, candidate.citations);
    if (!grounded.ok) {
      cite_ok = false;
      reason_codes.push(...grounded.reason_codes);
    }
  }

  return { cite_ok, secret_ok, reason_codes };
}

export function statementGroundedInCitations(
  statement: string,
  citations: readonly AgenticCitation[],
): { ok: boolean; reason_codes: string[] } {
  const stmt = normalizeText(statement);
  if (stmt.length < 8) {
    return { ok: false, reason_codes: ["statement_too_short_for_grounding"] };
  }

  const quotes = citations.map((c) => c.quote.trim()).filter((q) => q.length > 0);
  if (quotes.length === 0) {
    return { ok: false, reason_codes: ["no_quote_for_grounding"] };
  }

  const maxQuoteLen = Math.max(...quotes.map((q) => normalizeText(q).length));
  if (stmt.length > maxQuoteLen * STATEMENT_QUOTE_LEN_FACTOR) {
    return { ok: false, reason_codes: ["statement_longer_than_cited_span"] };
  }

  // Exact / containment after normalize
  for (const q of quotes) {
    const nq = normalizeText(q);
    if (nq.length === 0) continue;
    if (stmt === nq || nq.includes(stmt) || stmt.includes(nq)) {
      return { ok: true, reason_codes: ["statement_grounded_containment"] };
    }
  }

  const stmtTokens = tokenize(stmt);
  const quoteTokens = new Set(quotes.flatMap((q) => tokenize(normalizeText(q))));
  if (stmtTokens.length === 0 || quoteTokens.size === 0) {
    return { ok: false, reason_codes: ["statement_ungrounded_empty_tokens"] };
  }
  let inter = 0;
  for (const t of stmtTokens) {
    if (quoteTokens.has(t)) inter += 1;
  }
  const union = new Set([...stmtTokens, ...quoteTokens]).size;
  const jaccard = union === 0 ? 0 : inter / union;
  // Also require a decent fraction of statement tokens to appear in quotes
  const coverage = inter / stmtTokens.length;
  if (jaccard >= STATEMENT_QUOTE_OVERLAP_MIN || coverage >= 0.6) {
    return { ok: true, reason_codes: ["statement_grounded_overlap"] };
  }

  return { ok: false, reason_codes: ["statement_not_grounded_in_citations"] };
}

function citationInPack(c: AgenticCitation, packText: string): boolean {
  const q = c.quote.trim();
  if (q.length === 0) return false;
  if (packText.includes(q)) return true;
  if (c.start >= 0 && c.end > c.start && c.end <= packText.length) {
    const slice = packText.slice(c.start, c.end);
    return slice === q || packText.includes(q);
  }
  return false;
}

/**
 * Q4′: NFC both sides so NFD Korean/composed Latin do not fail grounding.
 */
function normalizeText(value: string): string {
  return value
    .normalize("NFC")
    .toLowerCase()
    .replace(/[“”"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Q4′ / H0c: CJK-safe tokenize. Latin uses alnum tokens (≥3); Hangul/CJK
 * uses overlapping bigrams so Korean decisions ground without ASCII tokens.
 */
function tokenize(value: string): string[] {
  const nfc = value.normalize("NFC").toLowerCase();
  const tokens: string[] = [];
  for (const latin of nfc.split(/[^a-z0-9]+/)) {
    if (latin.length > 2) tokens.push(latin);
  }
  // Hangul syllables + CJK unified ideographs
  const cjkRuns = nfc.match(
    /[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uAC00-\uD7AF\u4E00-\u9FFF]+/g,
  );
  if (cjkRuns !== null) {
    for (const run of cjkRuns) {
      if (run.length === 1) {
        tokens.push(run);
        continue;
      }
      for (let i = 0; i < run.length - 1; i += 1) {
        tokens.push(run.slice(i, i + 2));
      }
    }
  }
  return tokens;
}
