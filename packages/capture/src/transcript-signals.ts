/**
 * Bounded transcript → scoring/candidate signal recovery.
 *
 * Host hooks often store only a transcript_path (Claude) or a thin envelope.
 * This module reads a tail slice of a local transcript file and pulls
 * user/assistant prose that may become knowledge candidate spans.
 *
 * Precision-first: tool dumps, structured noise, and secret-like material are skipped.
 */
import { closeSync, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { containsSecretLikeMaterial } from "./meaningful-unit-policy.js";

export const TRANSCRIPT_SIGNAL_MAX_BYTES = 256_000;
export const TRANSCRIPT_SIGNAL_MAX_CHARS = 8_000;
export const TRANSCRIPT_CANDIDATE_MAX_CHARS = 1_200;

export type TranscriptSignals = {
  scoring?: string;
  candidate?: string;
};

const NOISE_LINE =
  /^(?:ok(?:ay)?|thanks?|thank you|lgtm|done|wip|test|ping|pong|yes|no|y|n|\.+|…)$/i;

/**
 * True when a filesystem path is an allowed local transcript location.
 * Absolute home-path strings never enter statements — only file contents do.
 */
export function isAllowedTranscriptPath(filePath: string): boolean {
  let resolved: string;
  try {
    resolved = realpathSync(resolve(filePath));
  } catch {
    return false;
  }
  const home = homedir();
  const allowedRoots = [resolve(home, ".claude"), resolve(home, ".codex"), resolve(home, ".grok")];
  return allowedRoots.some(
    (root) =>
      resolved === root || resolved.startsWith(`${root}/`) || resolved.startsWith(`${root}\\`),
  );
}

/**
 * Read a bounded tail of a local file as UTF-8 text.
 */
export function readTranscriptTail(
  filePath: string,
  maxBytes: number = TRANSCRIPT_SIGNAL_MAX_BYTES,
): string | undefined {
  if (!isAllowedTranscriptPath(filePath)) return undefined;
  let fd: number | undefined;
  try {
    fd = openSync(filePath, "r");
    const stat = fstatSync(fd);
    const size = Number(stat.size);
    if (!Number.isFinite(size) || size <= 0) return undefined;
    const bytes = Math.min(maxBytes, size);
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(bytes);
    const read = readSync(fd, buffer, 0, bytes, start);
    let text = buffer.subarray(0, read).toString("utf8");
    // If we started mid-line, drop the partial first line.
    if (start > 0) {
      const nl = text.indexOf("\n");
      if (nl >= 0) text = text.slice(nl + 1);
    }
    return text;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Extract scoring + candidate prose from a Claude/Codex-style JSONL transcript tail.
 */
export function signalsFromTranscriptText(text: string): TranscriptSignals {
  const proseStream: string[] = [];
  const seen = new Set<string>();

  for (const line of text.split(/\n+/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    let row: unknown;
    try {
      row = JSON.parse(trimmed);
    } catch {
      // Unparseable JSONL has no authenticated role or content boundary.
      continue;
    }
    if (row === null || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    if (inferRole(record) === undefined) continue;

    const prose = proseFromTranscriptRecord(record);
    if (prose === undefined) continue;
    if (!isDurableProse(prose)) continue;
    const duplicateKey = normalizeDuplicateKey(prose);
    // A correction begins a new statement epoch: an exact reassertion after it
    // is meaningful and must not be suppressed by an earlier assertion.
    if (seen.has(duplicateKey)) continue;
    if (isCorrectionOrReplacement(prose)) seen.clear();
    seen.add(duplicateKey);
    proseStream.push(prose);
  }

  const activeStream = removeCorrectedProse(proseStream);
  const recent = activeStream.slice(-8);
  const scoring = joinBounded(recent, TRANSCRIPT_SIGNAL_MAX_CHARS);

  let candidate: string | undefined;
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const value = recent[i];
    if (value !== undefined && isDurableProse(value)) {
      candidate = `Message: ${value}`.slice(0, TRANSCRIPT_CANDIDATE_MAX_CHARS);
      break;
    }
  }

  return {
    ...(scoring === undefined ? {} : { scoring }),
    ...(candidate === undefined ? {} : { candidate }),
  };
}

/**
 * Resolve signals from a transcript_path field when present and allowed.
 */
export function signalsFromTranscriptPath(filePath: unknown): TranscriptSignals {
  if (typeof filePath !== "string" || filePath.trim().length === 0) return {};
  const text = readTranscriptTail(filePath.trim());
  if (text === undefined || text.length === 0) return {};
  return signalsFromTranscriptText(text);
}

function inferRole(record: Record<string, unknown>): "user" | "assistant" | undefined {
  const type = String(record.type ?? "").toLowerCase();
  if (type === "user" || type === "human") return "user";
  if (type === "assistant" || type === "ai") return "assistant";
  const message = record.message;
  if (message !== null && typeof message === "object") {
    const role = String((message as Record<string, unknown>).role ?? "").toLowerCase();
    if (role === "user" || role === "human") return "user";
    if (role === "assistant" || role === "ai") return "assistant";
  }
  const role = String(record.role ?? "").toLowerCase();
  if (role === "user" || role === "human") return "user";
  if (role === "assistant" || role === "ai") return "assistant";
  return undefined;
}

function proseFromTranscriptRecord(record: Record<string, unknown>): string | undefined {
  const message = record.message;
  if (message !== null && typeof message === "object") {
    const content = (message as Record<string, unknown>).content;
    const fromContent = proseFromContent(content);
    if (fromContent !== undefined) return fromContent;
  }
  for (const key of ["content", "text", "prompt", "last_prompt"] as const) {
    const fromField = proseFromContent(record[key]);
    if (fromField !== undefined) return fromField;
  }
  return undefined;
}

function proseFromContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    return sanitizeProse(stripUserQueryXml(content));
  }
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const item of content) {
    if (typeof item === "string") {
      const text = sanitizeProse(stripUserQueryXml(item));
      if (text !== undefined) parts.push(text);
      continue;
    }
    if (item === null || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const type = String(row.type ?? "");
    // Skip tool plumbing and empty thinking.
    if (
      type === "tool_use" ||
      type === "tool_result" ||
      type === "thinking" ||
      type === "redacted_thinking"
    ) {
      continue;
    }
    if (type === "text" || type === "input_text" || type === "output_text") {
      const text = sanitizeProse(stripUserQueryXml(String(row.text ?? "")));
      if (text !== undefined) parts.push(text);
    }
  }
  if (parts.length === 0) return undefined;
  return sanitizeProse(parts.join(" "));
}

function stripUserQueryXml(value: string): string {
  return value
    .replace(/<\/?user_query>/gi, " ")
    .replace(/<\/?user_query\s*>/gi, " ")
    .trim();
}

function sanitizeProse(value: string): string | undefined {
  const normalized = value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length < 8) return undefined;
  if (NOISE_LINE.test(normalized)) return undefined;
  if (containsSecretLikeMaterial(normalized)) return undefined;
  // Tool dumps and serialized payloads are not candidate prose.
  if (
    /[{}[\]]|\b(?:reasoning_content|tool_calls?|raw_payload|transcript)\s*[:=]/i.test(normalized) ||
    (/\bPID\b/.test(normalized) && /\b%CPU\b/.test(normalized) && normalized.length > 200)
  ) {
    return undefined;
  }
  return normalized.slice(0, TRANSCRIPT_CANDIDATE_MAX_CHARS);
}

function isDurableProse(value: string): boolean {
  if (NOISE_LINE.test(value) || isFutureIntent(value)) return false;
  return (
    /\b(decid(?:e|ed|ing|es)|decisions?|prefer(?:ence)?|must|should|always|never|constraint|procedure|workflow|adopt(?:ed)?|chose|choose|default|policy|correction|corrected|retract(?:ed|ion)?|replace(?:d|ment)?|instead|no longer)\b/i.test(
      value,
    ) || /(결정|선호|반드시|항상|절대|기본값|정책|절차|정정|철회|대신|더 이상)/.test(value)
  );
}

function isFutureIntent(value: string): boolean {
  return (
    /\b(?:will|plan(?:s)? to|planning to|going to|intend(?:s|ed)? to|may|might|could)\b/i.test(
      value,
    ) || /(할 예정이다|계획이다|계획입니다|하려고 한다|할 수 있다)/.test(value)
  );
}

function normalizeDuplicateKey(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

function removeCorrectedProse(parts: readonly string[]): string[] {
  const blocked = new Set<number>();

  for (let correctionIndex = 0; correctionIndex < parts.length; correctionIndex += 1) {
    const correction = parts[correctionIndex];
    if (correction === undefined || !isCorrectionOrReplacement(correction)) continue;
    const obsoleteTerms = correctedTerms(correction);
    if (obsoleteTerms.length === 0) continue;

    for (let priorIndex = 0; priorIndex < correctionIndex; priorIndex += 1) {
      const prior = parts[priorIndex];
      if (
        prior !== undefined &&
        obsoleteTerms.some((term) => normalizeDuplicateKey(prior).includes(term))
      ) {
        blocked.add(priorIndex);
      }
    }
  }

  return parts.filter((_, index) => !blocked.has(index));
}

function isCorrectionOrReplacement(value: string): boolean {
  return (
    /\b(?:correction|corrected|retract(?:ed|ion)?|replace(?:d|ment)?|instead of|no longer|(?:(?:do|does|did) not|don't|must not|should not|never)\s+(?:use|prefer|allow|support))\b/i.test(
      value,
    ) ||
    /(?:정정|철회|대신|더 이상)|(?:사용|선호|허용|지원)하지\s*않(?:습니다|는다|다)?/.test(value)
  );
}

function correctedTerms(value: string): string[] {
  const normalized = normalizeDuplicateKey(value);
  const terms: string[] = [];
  for (const pattern of [
    /\binstead of ([a-z0-9][a-z0-9 _-]{1,80})/i,
    /\breplace ([a-z0-9][a-z0-9 _-]{1,80}) with\b/i,
    /\bno longer (?:use|prefer|allow|support) ([a-z0-9][a-z0-9 _-]{1,80})/i,
    /\b(?:(?:do|does|did) not|don't|must not|should not|never) (?:use|prefer|allow|support) ([a-z0-9][a-z0-9 _-]{1,80})/i,
    /(?:^|[:.]\s*|\s)([가-힣a-z0-9][가-힣a-z0-9 _-]{0,80}?)(?:을|를)\s*(?:사용|선호|허용|지원)하지\s*않/i,
  ] as const) {
    const match = pattern.exec(normalized);
    const term = match?.[1]?.trim();
    if (term !== undefined && term.length >= 2) terms.push(term);
  }
  return terms;
}

function joinBounded(parts: readonly string[], max: number): string | undefined {
  if (parts.length === 0) return undefined;
  const joined = parts.join(" ").replace(/\s+/g, " ").trim();
  if (joined.length === 0) return undefined;
  return joined.slice(0, max);
}

/** Agentic mode: larger bound than scoring's 8k; decisions often include "we will". */
export const AGENTIC_TRANSCRIPT_MAX_CHARS = 48_000;
export const AGENTIC_TRANSCRIPT_MAX_ITEMS = 64;

/**
 * Quality ultragoal Q3′ / QD5: agentic transcript extraction.
 * Reuses file I/O + JSONL parsing only — NO isDurableProse / isFutureIntent /
 * brace filter (those reject primary decision signals like "we will").
 */
export function agenticProseFromTranscriptJsonl(text: string): string {
  const proseStream: string[] = [];
  for (const line of text.split(/\n+/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let row: unknown;
    try {
      row = JSON.parse(trimmed);
    } catch {
      // Plain prose line in a mixed file.
      const plain = agenticSanitizeProse(trimmed);
      if (plain !== undefined) proseStream.push(plain);
      continue;
    }
    if (row === null || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    if (inferRole(record) === undefined) continue;
    const prose = proseFromTranscriptRecordAgentic(record);
    if (prose === undefined) continue;
    proseStream.push(prose);
    if (proseStream.length >= AGENTIC_TRANSCRIPT_MAX_ITEMS) break;
  }
  const joined = proseStream.join("\n").trim();
  return joined.slice(0, AGENTIC_TRANSCRIPT_MAX_CHARS);
}

/** Resolve agentic prose from a local transcript_path (allowed roots only). */
export function agenticProseFromTranscriptPath(filePath: string): string {
  const text = readTranscriptTail(filePath.trim());
  if (text === undefined || text.length === 0) return "";
  return agenticProseFromTranscriptJsonl(text);
}

function proseFromTranscriptRecordAgentic(record: Record<string, unknown>): string | undefined {
  const message = record.message;
  if (message !== null && typeof message === "object") {
    const content = (message as Record<string, unknown>).content;
    const fromContent = proseFromContentAgentic(content);
    if (fromContent !== undefined) return fromContent;
  }
  for (const key of ["content", "text", "prompt", "last_prompt"] as const) {
    const fromField = proseFromContentAgentic(record[key]);
    if (fromField !== undefined) return fromField;
  }
  return undefined;
}

function proseFromContentAgentic(content: unknown): string | undefined {
  if (typeof content === "string") {
    return agenticSanitizeProse(stripUserQueryXml(content));
  }
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const item of content) {
    if (typeof item === "string") {
      const text = agenticSanitizeProse(stripUserQueryXml(item));
      if (text !== undefined) parts.push(text);
      continue;
    }
    if (item === null || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const type = String(row.type ?? "");
    if (
      type === "tool_use" ||
      type === "tool_result" ||
      type === "thinking" ||
      type === "redacted_thinking"
    ) {
      continue;
    }
    if (type === "text" || type === "input_text" || type === "output_text") {
      const text = agenticSanitizeProse(stripUserQueryXml(String(row.text ?? "")));
      if (text !== undefined) parts.push(text);
    }
  }
  if (parts.length === 0) return undefined;
  return agenticSanitizeProse(parts.join(" "));
}

/** Agentic: keep braces and future-intent language; only drop secrets / pure noise. */
function agenticSanitizeProse(value: string): string | undefined {
  const normalized = value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length < 4) return undefined;
  if (NOISE_LINE.test(normalized)) return undefined;
  if (containsSecretLikeMaterial(normalized)) return undefined;
  return normalized.slice(0, TRANSCRIPT_CANDIDATE_MAX_CHARS);
}
