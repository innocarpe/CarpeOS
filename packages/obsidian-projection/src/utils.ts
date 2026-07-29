import { createHash } from "node:crypto";

export function sha256Digest(value: string | Uint8Array): string {
  return `sha-256:${createHash("sha256").update(value).digest("hex")}`;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(toStableJsonValue(value));
}

export function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

export function assertNoProtectedPlaintext(value: string): void {
  const protectedSentinels = [
    "protected_plaintext_marker",
    "raw_payload",
    "PRIVATE_MARKER",
    "BEGIN PRIVATE KEY",
  ];
  for (const sentinel of protectedSentinels) {
    if (value.includes(sentinel)) {
      throw new Error(`protected plaintext sentinel is not allowed in Obsidian projection`);
    }
  }
}

function toStableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toStableJsonValue(item));
  }
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(object).sort(compareText)) {
      const item = object[key];
      if (item !== undefined) {
        result[key] = toStableJsonValue(item);
      }
    }
    return result;
  }
  return value;
}
