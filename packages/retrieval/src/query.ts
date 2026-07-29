import type {
  CanonicalEvent,
  ErasureLedgerRecord,
  ProjectionFreshness,
  RetrievalChunk,
  RetrievalFilters,
  RetrievalLineage,
  RetrievalQuery,
  RetrievalResult,
  RetrievalResultItem,
  RetrievalSourceRecord,
} from "@carpeos/schema";
import { validateConformance } from "@carpeos/schema";
import {
  rankHybrid,
  scoreFts,
  scoreRecency,
  scoreStructured,
  selectWithDiversity,
  type RetrievalCandidate,
} from "./ranking.js";
import {
  erasureSourceRecord,
  eventSourceRecord,
  normalizeSourceRecords,
  sha256Hex,
} from "./provenance.js";

export type SearchInput = {
  query: RetrievalQuery;
  chunks: readonly RetrievalChunk[];
  events: readonly CanonicalEvent[];
  erasures: readonly ErasureLedgerRecord[];
  freshness: readonly ProjectionFreshness[];
  semanticScores?: ReadonlyMap<string, number>;
};

export function searchMemory(input: SearchInput): RetrievalResult {
  const newestEpochMs =
    input.chunks.length === 0
      ? 0
      : Math.max(...input.chunks.map((chunk) => Date.parse(chunk.created_at)));
  const candidates: RetrievalCandidate[] = input.chunks.map((chunk) => ({
    chunk,
    structured_score: scoreStructured(input.query.query_text, chunk),
    fts_score: scoreFts(input.query.query_text, chunk.text),
    semantic_score: input.semanticScores?.get(chunk.chunk_id) ?? 0,
    recency_score: scoreRecency(chunk, newestEpochMs),
  }));
  const ranked = rankHybrid(candidates, input.query.ranking.weights);
  // Score first, then sparse diversity selection before canonical recheck.
  // Over-select slightly so excluded candidates after recheck still leave room.
  const diversified = selectWithDiversity(
    ranked,
    Math.max(input.query.limit * 2, input.query.limit),
  );
  const results = diversified
    .map((candidate) =>
      recheckCandidate({
        chunk: candidate.chunk,
        score: candidate.score,
        filters: input.query.filters,
        events: input.events,
        erasures: input.erasures,
        freshness: input.freshness,
      }),
    )
    .slice(0, input.query.limit);
  const result: RetrievalResult = {
    schema_version: "v1",
    record_type: "retrieval_result",
    query_id: input.query.query_id,
    projection_freshness: [...input.freshness],
    filters_applied: input.query.filters,
    results,
    warnings: input.freshness.filter((item) => item.stale).map((item) => `stale:${item.reason}`),
  };
  const conformance = validateConformance("retrievalProjection", result);
  if (!conformance.valid) {
    throw new Error(`invalid retrieval result: ${conformance.errors.join("; ")}`);
  }
  return result;
}

export function recheckCandidate(input: {
  chunk: RetrievalChunk;
  score: RetrievalResultItem["score"];
  filters: RetrievalFilters;
  events: readonly CanonicalEvent[];
  erasures: readonly ErasureLedgerRecord[];
  freshness: readonly ProjectionFreshness[];
}): RetrievalResultItem {
  const resolution = resolveCanonicalLineage(input.chunk, input.events, input.erasures);
  const base = {
    candidate_id: `cand_${sha256Hex(input.chunk.chunk_id).slice(0, 24)}`,
    chunk_id: input.chunk.chunk_id,
    score: input.score,
    lineage: resolution.lineage,
    canonical_rechecked: true as const,
  };

  if (resolution.reason !== undefined) {
    return { ...base, status: "excluded", reason: resolution.reason };
  }

  const staleFreshness = resolution.trustZoneIds
    .map((trustZoneId) => input.freshness.find((item) => item.trust_zone_id === trustZoneId))
    .find((item) => item?.stale === true);
  if (staleFreshness?.stale === true) {
    return { ...base, status: "excluded", reason: `projection stale: ${staleFreshness.reason}` };
  }
  if (
    resolution.trustZoneIds.some(
      (trustZoneId) => !input.filters.visible_trust_zone_ids.includes(trustZoneId),
    )
  ) {
    return { ...base, status: "excluded", reason: "trust zone not visible" };
  }
  if (
    input.filters.lifecycle_status !== undefined &&
    resolution.lifecycleStatuses.some(
      (lifecycleStatus) => !input.filters.lifecycle_status?.includes(lifecycleStatus),
    )
  ) {
    return { ...base, status: "excluded", reason: "lifecycle status excluded" };
  }
  if (
    input.filters.epistemic_authority !== undefined &&
    resolution.epistemicAuthorities.some(
      (epistemicAuthority) => !input.filters.epistemic_authority?.includes(epistemicAuthority),
    )
  ) {
    return { ...base, status: "excluded", reason: "epistemic authority excluded" };
  }
  if (resolution.superseded) {
    return { ...base, status: "excluded", reason: "source superseded" };
  }
  if (resolution.lineage.erasure_ids !== undefined && resolution.lineage.erasure_ids.length > 0) {
    return { ...base, status: "excluded", reason: "erasure applies" };
  }
  if (
    input.filters.conflict_policy === "exclude_conflicts" &&
    resolution.lineage.accepted_decision_event_ids !== undefined &&
    resolution.lineage.rejected_decision_event_ids !== undefined
  ) {
    return { ...base, status: "excluded", reason: "conflicting decisions" };
  }
  if (
    input.filters.protected_value_policy === "deny" &&
    input.chunk.chunk_kind === "evidence_excerpt"
  ) {
    return { ...base, status: "redacted", reason: "protected value denied" };
  }
  return { ...base, status: "visible", text: input.chunk.text };
}

export function buildLineage(
  chunk: RetrievalChunk,
  events: readonly CanonicalEvent[],
  erasures: readonly ErasureLedgerRecord[],
): RetrievalLineage {
  return resolveCanonicalLineage(chunk, events, erasures).lineage;
}

type CanonicalLineageResolution = {
  lineage: RetrievalLineage;
  trustZoneIds: string[];
  lifecycleStatuses: CanonicalEvent["lifecycle_status"][];
  epistemicAuthorities: CanonicalEvent["epistemic_authority"][];
  superseded: boolean;
  reason?: string;
};

function resolveCanonicalLineage(
  chunk: RetrievalChunk,
  events: readonly CanonicalEvent[],
  erasures: readonly ErasureLedgerRecord[],
): CanonicalLineageResolution {
  const eventById = new Map(events.map((event) => [event.event_id, event]));
  const erasureById = new Map(erasures.map((erasure) => [erasure.erasure_id, erasure]));
  const sourceRecords: RetrievalSourceRecord[] = [];
  const sourceEvents: CanonicalEvent[] = [];
  const sourceErasures: ErasureLedgerRecord[] = [];

  for (const record of chunk.source_records) {
    if (record.source_record_kind === "event") {
      const event = eventById.get(record.source_record_id);
      if (event === undefined) {
        return makeFailedResolution(chunk, "canonical source missing");
      }

      const canonicalRecord = eventSourceRecord(event, record.relationship_role);
      if (
        canonicalRecord.source_fingerprint !== record.source_fingerprint ||
        canonicalRecord.trust_zone_id !== record.trust_zone_id ||
        canonicalRecord.zone_sequence !== record.zone_sequence ||
        (record.event_type !== undefined && canonicalRecord.event_type !== record.event_type)
      ) {
        return makeFailedResolution(chunk, "canonical source mismatch");
      }

      sourceEvents.push(event);
      sourceRecords.push(canonicalRecord);
      continue;
    }

    const erasure = erasureById.get(record.source_record_id);
    if (erasure === undefined) {
      return makeFailedResolution(chunk, "canonical source missing");
    }
    if (record.relationship_role !== "erasure" && record.relationship_role !== "lineage") {
      return makeFailedResolution(chunk, "canonical source mismatch");
    }

    const canonicalRecord = erasureSourceRecord(erasure, record.relationship_role);
    if (
      canonicalRecord.source_fingerprint !== record.source_fingerprint ||
      canonicalRecord.trust_zone_id !== record.trust_zone_id ||
      canonicalRecord.zone_sequence !== record.zone_sequence
    ) {
      return makeFailedResolution(chunk, "canonical source mismatch");
    }

    sourceErasures.push(erasure);
    sourceRecords.push(canonicalRecord);
  }

  const sourceEventIds = new Set(sourceEvents.map((event) => event.event_id));
  const sourceClaimIds = new Set(
    sourceEvents
      .filter((event): event is CanonicalEvent<"Claim"> => event.event_type === "Claim")
      .map((event) => event.payload.claim_id),
  );
  const decisionEvents = events.filter(
    (event): event is CanonicalEvent<"AcceptanceDecision"> =>
      event.event_type === "AcceptanceDecision" &&
      (sourceEventIds.has(event.event_id) ||
        event.payload.claim_refs.some((claimRef) => sourceClaimIds.has(claimRef))),
  );
  const supersessionEvents = events.filter(
    (event): event is CanonicalEvent<"Supersession"> =>
      event.event_type === "Supersession" &&
      (sourceEventIds.has(event.event_id) || sourceEventIds.has(event.payload.supersedes_event_id)),
  );
  const replacementEvents = supersessionEvents
    .map((event) =>
      event.payload.replacement_event_id === undefined
        ? undefined
        : eventById.get(event.payload.replacement_event_id),
    )
    .filter((event): event is CanonicalEvent => event !== undefined);

  for (const event of decisionEvents) {
    sourceRecords.push(eventSourceRecord(event, "acceptance"));
  }
  for (const event of supersessionEvents) {
    sourceRecords.push(eventSourceRecord(event, "supersession"));
  }
  for (const event of replacementEvents) {
    sourceRecords.push(eventSourceRecord(event, "lineage"));
  }

  const accepted = uniqueSorted(
    decisionEvents
      .filter((event) => event.payload.decision === "accepted")
      .map((event) => event.event_id),
  );
  const rejected = uniqueSorted(
    decisionEvents
      .filter((event) => event.payload.decision === "rejected")
      .map((event) => event.event_id),
  );
  const supersessions = uniqueSorted(supersessionEvents.map((event) => event.event_id));
  const erasureIds = uniqueSorted(
    [...sourceErasures, ...erasures.filter((erasure) => erasureTargetsChunk(erasure, chunk))].map(
      (erasure) => erasure.erasure_id,
    ),
  );
  const canonicalSourceRecords = normalizeSourceRecords(sourceRecords);

  const lineage: RetrievalLineage = {
    source_records: canonicalSourceRecords,
    canonical_rechecked: true,
    ...(accepted.length === 0 ? {} : { accepted_decision_event_ids: accepted }),
    ...(rejected.length === 0 ? {} : { rejected_decision_event_ids: rejected }),
    ...(supersessions.length === 0 ? {} : { supersession_event_ids: supersessions }),
    ...(erasureIds.length === 0 ? {} : { erasure_ids: erasureIds }),
  };

  return {
    lineage,
    trustZoneIds: uniqueSorted(sourceEvents.map((event) => event.trust_zone.trust_zone_id)),
    lifecycleStatuses: uniqueSorted(sourceEvents.map((event) => event.lifecycle_status)),
    epistemicAuthorities: uniqueSorted(sourceEvents.map((event) => event.epistemic_authority)),
    superseded: supersessionEvents.some((event) =>
      sourceEventIds.has(event.payload.supersedes_event_id),
    ),
  };
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}

function makeFailedResolution(chunk: RetrievalChunk, reason: string): CanonicalLineageResolution {
  const lineage: RetrievalLineage = {
    source_records: chunk.source_records,
    canonical_rechecked: true,
  };

  return {
    lineage,
    trustZoneIds: uniqueSorted(chunk.source_records.map((record) => record.trust_zone_id)),
    lifecycleStatuses: uniqueSorted(
      chunk.source_records
        .map((record) => record.lifecycle_status)
        .filter((status): status is CanonicalEvent["lifecycle_status"] => status !== undefined),
    ),
    epistemicAuthorities: uniqueSorted(
      chunk.source_records
        .map((record) => record.epistemic_authority)
        .filter(
          (authority): authority is CanonicalEvent["epistemic_authority"] =>
            authority !== undefined,
        ),
    ),
    superseded: false,
    reason,
  };
}

function erasureTargetsChunk(erasure: ErasureLedgerRecord, chunk: RetrievalChunk): boolean {
  if (erasure.method === "projection_delete") {
    return (
      erasure.target_ref.target_id === chunk.chunk_id ||
      erasure.target_ref.target_id === chunk.projection_version
    );
  }
  if (erasure.target_ref.target_kind === "event") {
    return chunk.source_records.some(
      (record) => record.source_record_id === erasure.target_ref.target_id,
    );
  }
  return false;
}
