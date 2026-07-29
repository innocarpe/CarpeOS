import { createHash } from "node:crypto";

/**
 * Long-horizon agent run ledger (plan M8).
 * Projection/metadata only — not a sixth canonical event_type.
 */
export type RunLedgerStatus = "running" | "completed" | "failed" | "cancelled";

export type RunLedgerEntry = {
  schema_version: "v1";
  record_type: "run_ledger_entry";
  run_id: string;
  agent_id?: string;
  round: number;
  started_at: string;
  ended_at?: string;
  event_ids: string[];
  artifact_ids: string[];
  status: RunLedgerStatus;
  subject_ref: string;
  canonical_effect: "none";
};

export type BuildRunLedgerEntryInput = {
  runId?: string;
  agentId?: string;
  round: number;
  startedAt: string;
  endedAt?: string;
  eventIds?: readonly string[];
  artifactIds?: readonly string[];
  status?: RunLedgerStatus;
  subjectRef: string;
};

export function buildRunLedgerEntry(input: BuildRunLedgerEntryInput): RunLedgerEntry {
  if (!Number.isInteger(input.round) || input.round < 0) {
    throw new Error("round must be a non-negative integer");
  }
  const run_id =
    input.runId ??
    `run_${sha256Hex(
      stableJson({
        subject_ref: input.subjectRef,
        started_at: input.startedAt,
        agent_id: input.agentId ?? null,
      }),
    ).slice(0, 24)}`;

  return {
    schema_version: "v1",
    record_type: "run_ledger_entry",
    run_id,
    ...(input.agentId === undefined ? {} : { agent_id: input.agentId }),
    round: input.round,
    started_at: input.startedAt,
    ...(input.endedAt === undefined ? {} : { ended_at: input.endedAt }),
    event_ids: uniqueSorted(input.eventIds ?? []),
    artifact_ids: uniqueSorted(input.artifactIds ?? []),
    status: input.status ?? "running",
    subject_ref: input.subjectRef,
    canonical_effect: "none",
  };
}

export function linkEventsToRun(
  entry: RunLedgerEntry,
  eventIds: readonly string[],
): RunLedgerEntry {
  return {
    ...entry,
    event_ids: uniqueSorted([...entry.event_ids, ...eventIds]),
  };
}

export function completeRunLedgerEntry(
  entry: RunLedgerEntry,
  endedAt: string,
  status: Exclude<RunLedgerStatus, "running"> = "completed",
): RunLedgerEntry {
  return {
    ...entry,
    ended_at: endedAt,
    status,
  };
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const ordered: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      ordered[key] = canonicalize(record[key]);
    }
    return ordered;
  }
  return value;
}
