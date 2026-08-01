export function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

/** Safe single path segment: alnum, underscore, hyphen; collapse others. */
export function safePathSegment(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "unnamed";
  }
  const cleaned = trimmed
    .replaceAll(/[^A-Za-z0-9._-]+/g, "_")
    .replaceAll(/_+/g, "_")
    .replaceAll(/^\.+|\.+$/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 120) : "unnamed";
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
      throw new Error("protected plaintext sentinel is not allowed in OKF projection");
    }
  }
}

export function oneLine(value: string, max = 200): string {
  const collapsed = value.replaceAll(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1)}…`;
}

/** Map free-form actor ids into OKF actor convention when missing a prefix. */
export function toOkfActor(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("human:") || trimmed.startsWith("process:") || trimmed.includes("/")) {
    return trimmed;
  }
  return `human:${trimmed}`;
}
