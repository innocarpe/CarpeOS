import { createHash } from "node:crypto";

/**
 * RFC 8785-style deterministic JSON Canonicalization (subset used by V5 contracts).
 * Sorted object keys, no whitespace, UTF-8 JSON string encoding for strings.
 */
export function jcs(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("JCS rejects non-finite numbers");
    }
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => jcs(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${jcs(record[key])}`)
      .join(",")}}`;
  }
  throw new Error(`JCS unsupported type: ${typeof value}`);
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

export function sha256Jcs(value: unknown): string {
  return sha256Hex(jcs(value));
}

export function digestSha256(value: unknown): `sha256:${string}` {
  return `sha256:${sha256Jcs(value)}`;
}

/** Recursively remove only `audit_envelope` members. */
export function auditFree<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => auditFree(item)) as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (key === "audit_envelope") continue;
      out[key] = auditFree(nested);
    }
    return out as T;
  }
  return value;
}
