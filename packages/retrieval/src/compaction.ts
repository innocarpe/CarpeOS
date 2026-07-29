import type { ContextBudgetUsage } from "@carpeos/schema";
import { sha256Hex, stableJson } from "./provenance.js";

/**
 * Rebuildable, non-authoritative compaction projection (ADR 0009 L4).
 * Compaction never mutates claims or acceptance; it only summarizes pointers.
 */
export type CompactionProjection = {
  schema_version: "v1";
  record_type: "compaction_projection";
  compaction_id: string;
  trust_zone_id: string;
  created_at: string;
  summary_text: string;
  source_event_ids: string[];
  source_chunk_ids: string[];
  budget: ContextBudgetUsage;
  canonical_effect: "none";
};

export type BuildCompactionInput = {
  trustZoneId: string;
  createdAt: string;
  /** Ordered visible texts already selected for compaction. */
  items: readonly {
    eventId?: string;
    chunkId?: string;
    text: string;
  }[];
  /** Optional hard caps for the summary projection itself. */
  maxSummaryCharacters?: number;
};

export function buildCompactionProjection(input: BuildCompactionInput): CompactionProjection {
  const source_event_ids = uniqueSorted(
    input.items.map((item) => item.eventId).filter((value): value is string => value !== undefined),
  );
  const source_chunk_ids = uniqueSorted(
    input.items.map((item) => item.chunkId).filter((value): value is string => value !== undefined),
  );
  const joined = input.items.map((item) => item.text.trim()).filter(Boolean);
  const maxSummaryCharacters = input.maxSummaryCharacters ?? 2_000;
  let summary_text = joined.join("\n");
  let truncated = false;
  if (summary_text.length > maxSummaryCharacters) {
    summary_text = `${summary_text.slice(0, maxSummaryCharacters - 1)}…`;
    truncated = true;
  }
  const fullCharacters = joined.join("\n").length;
  const compaction_id = `cmp_${sha256Hex(
    stableJson({
      trust_zone_id: input.trustZoneId,
      created_at: input.createdAt,
      source_event_ids,
      source_chunk_ids,
      summary_text,
    }),
  ).slice(0, 32)}`;

  return {
    schema_version: "v1",
    record_type: "compaction_projection",
    compaction_id,
    trust_zone_id: input.trustZoneId,
    created_at: input.createdAt,
    summary_text,
    source_event_ids,
    source_chunk_ids,
    budget: {
      used: {
        items: input.items.length,
        characters: summary_text.length,
      },
      truncated,
      omitted: {
        items: 0,
        characters: Math.max(0, fullCharacters - summary_text.length),
      },
    },
    canonical_effect: "none",
  };
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
