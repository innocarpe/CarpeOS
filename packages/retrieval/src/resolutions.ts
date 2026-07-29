/**
 * Multi-resolution latent ladder for retrieval units (ADR 0009 / plan M7).
 *
 * R0 id/kind → R1 embedding → R2 statement/summary → R3 full/protected ref
 */
export type ResolutionLevel = "R0" | "R1" | "R2" | "R3";

export type LatentUnit = {
  record_id: string;
  record_kind: string;
  /** R2 default pack/search text. Never raw hook JSON. */
  summary_text: string;
  /** Optional full visible text for R3 escalation. */
  full_text?: string;
  /** Optional embedding vector reference (R1). */
  embedding_ref?: string;
  /** Protected value pointer when full text is not inline. */
  protected_value_id?: string;
};

export type ResolvedUnit = {
  level: ResolutionLevel;
  record_id: string;
  record_kind: string;
  text?: string;
  embedding_ref?: string;
  protected_value_id?: string;
};

export type ResolveOptions = {
  /** Preferred maximum level. Defaults to R2. */
  maxLevel?: ResolutionLevel;
  /** Character budget for text payloads. */
  maxCharacters?: number;
  allowProtected?: boolean;
};

const LEVEL_ORDER: ResolutionLevel[] = ["R0", "R1", "R2", "R3"];

export function compareResolutionLevel(left: ResolutionLevel, right: ResolutionLevel): number {
  return LEVEL_ORDER.indexOf(left) - LEVEL_ORDER.indexOf(right);
}

/**
 * Resolve a latent unit to the highest allowed level that fits policy/budget.
 * Defaults to R2 (summary) — never invents R3 from raw hook payloads.
 */
export function resolveLatentUnit(unit: LatentUnit, options: ResolveOptions = {}): ResolvedUnit {
  const maxLevel = options.maxLevel ?? "R2";
  const maxCharacters = options.maxCharacters ?? 4_000;
  const allowProtected = options.allowProtected ?? false;

  if (compareResolutionLevel(maxLevel, "R3") >= 0) {
    if (unit.full_text !== undefined && unit.full_text.length <= maxCharacters) {
      return {
        level: "R3",
        record_id: unit.record_id,
        record_kind: unit.record_kind,
        text: unit.full_text,
        ...(unit.embedding_ref === undefined ? {} : { embedding_ref: unit.embedding_ref }),
      };
    }
    if (allowProtected && unit.protected_value_id !== undefined) {
      return {
        level: "R3",
        record_id: unit.record_id,
        record_kind: unit.record_kind,
        protected_value_id: unit.protected_value_id,
        ...(unit.embedding_ref === undefined ? {} : { embedding_ref: unit.embedding_ref }),
      };
    }
  }

  if (compareResolutionLevel(maxLevel, "R2") >= 0) {
    const summary =
      unit.summary_text.length <= maxCharacters
        ? unit.summary_text
        : `${unit.summary_text.slice(0, Math.max(0, maxCharacters - 1))}…`;
    return {
      level: "R2",
      record_id: unit.record_id,
      record_kind: unit.record_kind,
      text: summary,
      ...(unit.embedding_ref === undefined ? {} : { embedding_ref: unit.embedding_ref }),
    };
  }

  if (compareResolutionLevel(maxLevel, "R1") >= 0 && unit.embedding_ref !== undefined) {
    return {
      level: "R1",
      record_id: unit.record_id,
      record_kind: unit.record_kind,
      embedding_ref: unit.embedding_ref,
    };
  }

  return {
    level: "R0",
    record_id: unit.record_id,
    record_kind: unit.record_kind,
  };
}

/** Guard: R2 text must not look like raw provider hook JSON payloads. */
export function looksLikeRawHookJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return false;
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return (
      typeof parsed.hook_event_name === "string" ||
      typeof parsed.payload === "object" ||
      typeof parsed.raw === "string"
    );
  } catch {
    return false;
  }
}
