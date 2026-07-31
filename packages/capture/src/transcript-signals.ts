/**
 * Bounded transcript → scoring/candidate signal recovery.
 *
 * Host hooks often store only a transcript_path (Claude) or a thin envelope.
 * This module reads a tail slice of a local transcript file and pulls
 * user/assistant prose that may become knowledge candidate spans.
 *
 * Precision-first: tool dumps, structured noise, and secret-like material are skipped.
 */
import { openSync, readSync, closeSync, fstatSync, realpathSync } from "node:fs";
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
  const allowedRoots = [
    resolve(home, ".claude", "projects"),
    resolve(home, ".codex"),
    resolve(home, ".grok"),
  ];
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
  const lines = text.split(/\n+/);
  const userChunks: string[] = [];
  const assistantChunks: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let row: unknown;
    try {
      row = JSON.parse(trimmed);
    } catch {
      // Plain text line — weak scoring only.
      const plain = sanitizeProse(trimmed);
      if (plain !== undefined) userChunks.push(plain);
      continue;
    }
    if (row === null || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const role = inferRole(record);
    if (role === undefined) continue;
    const prose = proseFromTranscriptRecord(record);
    if (prose === undefined) continue;
    if (role === "assistant") assistantChunks.push(prose);
    else userChunks.push(prose);
  }

  // Prefer recent turns.
  const recentUsers = userChunks.slice(-6);
  const recentAssistants = assistantChunks.slice(-8);
  const scoringParts = [...recentUsers, ...recentAssistants];
  const scoring = joinBounded(scoringParts, TRANSCRIPT_SIGNAL_MAX_CHARS);

  // Candidate: last durable assistant prose, else last durable user prose.
  let candidate: string | undefined;
  for (let i = recentAssistants.length - 1; i >= 0; i -= 1) {
    const value = recentAssistants[i];
    if (value !== undefined && isDurableProse(value)) {
      candidate = `Message: ${value}`.slice(0, TRANSCRIPT_CANDIDATE_MAX_CHARS);
      break;
    }
  }
  if (candidate === undefined) {
    for (let i = recentUsers.length - 1; i >= 0; i -= 1) {
      const value = recentUsers[i];
      if (value !== undefined && isDurableProse(value)) {
        candidate = `Message: ${value}`.slice(0, TRANSCRIPT_CANDIDATE_MAX_CHARS);
        break;
      }
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
  // Heavy tool dumps / process tables are not knowledge statements.
  if (/\bPID\b/.test(normalized) && /\b%CPU\b/.test(normalized) && normalized.length > 200) {
    return undefined;
  }
  return normalized.slice(0, TRANSCRIPT_CANDIDATE_MAX_CHARS);
}

function isDurableProse(value: string): boolean {
  if (value.length < 20) return false;
  if (NOISE_LINE.test(value)) return false;
  // Prefer content that looks like a decision/preference/constraint/procedure,
  // or at least a multi-word task statement.
  if (
    /\b(decid(?:e|ed|ing|es)|decision|prefer|must|should|always|never|constraint|procedure|workflow|adopt|chose|choose|default|will use|going with|plan is)\b/i.test(
      value,
    )
  ) {
    return true;
  }
  return value.split(/\s+/).length >= 8;
}

function joinBounded(parts: readonly string[], max: number): string | undefined {
  if (parts.length === 0) return undefined;
  const joined = parts.join(" ").replace(/\s+/g, " ").trim();
  if (joined.length === 0) return undefined;
  return joined.slice(0, max);
}
