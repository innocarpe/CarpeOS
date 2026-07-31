import { isIdempotencyKey } from "@carpeos/capture";
import {
  IdempotencyConflictError,
  isTrustZoneId,
  type LocalCanonicalEventSnapshot,
  type LocalErasureSnapshot,
  type LocalRetrievalInputSnapshot,
  type LocalCaptureStore,
  withLocalRetrievalDatabase,
} from "@carpeos/local-store";
import {
  rebuildLocalRetrievalIndex,
  searchLocalRetrievalIndex,
  sha256Hex,
} from "@carpeos/retrieval";
import { validateConformance } from "@carpeos/schema";
import type {
  BitemporalInterval,
  CanonicalEvent,
  ContextBudget,
  ContextBudgetUsage,
  EpistemicAuthority,
  EventType,
  LifecycleStatus,
  McpRecordRef,
  McpSafeError,
  McpToolName,
  McpVisibility,
  MemoryCaptureInput,
  MemoryContextPackInput,
  MemoryGetInput,
  MemoryProposeClaimInput,
  MemoryProposeClaimOutput,
  MemoryRelatedInput,
  MemorySearchInput,
  MemoryTimelineInput,
  MemoryTraceInput,
  RetrievalQuery,
} from "@carpeos/schema";
import {
  budgetContextPackWithExpertSlots,
  type ClassifiedPackSections,
  stableLength,
} from "./expert-slots.js";

export const CARPEOS_MCP_TOOLS = [
  "memory_search",
  "memory_get",
  "memory_context_pack",
  "memory_trace",
  "memory_timeline",
  "memory_related",
  "memory_capture",
  "memory_propose_claim",
] as const satisfies readonly McpToolName[];

export type CarpeosMcpToolName = (typeof CARPEOS_MCP_TOOLS)[number];

export type CarpeosMcpConfig = {
  visibleTrustZoneIds: readonly string[];
};

export type CarpeosMcpResult = {
  structuredContent: Record<string, unknown>;
  text: string;
  isError: boolean;
};

type BudgetedRecordOutput = {
  schema_version: "v1";
  tool: McpToolName;
  records: McpRecordRef[];
  budget: ContextBudgetUsage;
  error?: McpSafeError;
};

type ContextPackOutput = {
  schema_version: "v1";
  tool: "memory_context_pack";
  accepted_facts: AcceptedFact[];
  draft_claims: DraftClaim[];
  rejected_claims: DraftClaim[];
  observations: McpRecordRef[];
  evidence_summaries: McpRecordRef[];
  conflicts: McpRecordRef[];
  supersessions: McpRecordRef[];
  erasures: McpRecordRef[];
  verification_gaps: string[];
  redactions: string[];
  budget: ContextBudgetUsage;
  error?: McpSafeError;
};

type AcceptedFact = {
  claim_event_id: string;
  acceptance_decision_event_id: string;
  statement: string;
  source_event_ids: string[];
};

type DraftClaim = {
  claim_event_id: string;
  statement: string;
  support_event_ids: string[];
  status: "draft";
};

type BitemporalFilter = {
  validTime?: BitemporalInterval;
  recordedTime?: BitemporalInterval;
};

type EligibilityContext = {
  events: readonly CanonicalEvent[];
  eventSnapshots: readonly LocalCanonicalEventSnapshot[];
  eventById: ReadonlyMap<string, CanonicalEvent>;
  snapshotByEventId: ReadonlyMap<string, LocalCanonicalEventSnapshot>;
  supersededEventIds: ReadonlySet<string>;
  erasedEventIds: ReadonlySet<string>;
  acceptedByClaimId: ReadonlyMap<string, CanonicalEvent<"AcceptanceDecision">>;
  rejectedByClaimId: ReadonlyMap<string, CanonicalEvent<"AcceptanceDecision">>;
  visibility: McpVisibility;
};

export class CarpeosMcpError extends Error {
  readonly safeError: McpSafeError;

  constructor(code: McpSafeError["code"], message: string, refId?: string) {
    super(message);
    this.name = "CarpeosMcpError";
    this.safeError = {
      code,
      message,
      ...(refId === undefined ? {} : { ref_id: refId }),
    };
  }
}

export class CarpeosMcpApplication {
  private readonly store: LocalCaptureStore;
  private readonly configuredVisibleTrustZoneIds: readonly string[];

  constructor(input: { store: LocalCaptureStore; config: CarpeosMcpConfig }) {
    this.store = input.store;
    this.configuredVisibleTrustZoneIds = normalizeVisibleTrustZones(
      input.config.visibleTrustZoneIds,
    );
    requireVisibleIncludesLocal(
      this.configuredVisibleTrustZoneIds,
      this.store.trustZone.trust_zone_id,
    );
  }

  async dispatch(toolName: CarpeosMcpToolName, input: unknown): Promise<CarpeosMcpResult> {
    try {
      const validatedInput = validateToolInput(toolName, input);
      const output = this.dispatchUnsafe(toolName, validatedInput);
      return toMcpResult(output, false);
    } catch (error) {
      const safeError = toSafeError(error);
      const output = errorOutput(toolName, safeError);
      return toMcpResult(output, true);
    }
  }

  private dispatchUnsafe(toolName: CarpeosMcpToolName, input: unknown): Record<string, unknown> {
    assertPlainObject(input, toolName);
    switch (toolName) {
      case "memory_search":
        return this.memorySearch(input as MemorySearchInput);
      case "memory_get":
        return this.memoryGet(input as MemoryGetInput);
      case "memory_context_pack":
        return this.memoryContextPack(input as MemoryContextPackInput);
      case "memory_trace":
        return this.memoryTrace(input as MemoryTraceInput);
      case "memory_timeline":
        return this.memoryTimeline(input as MemoryTimelineInput);
      case "memory_related":
        return this.memoryRelated(input as MemoryRelatedInput);
      case "memory_capture":
        return this.memoryCapture(input as MemoryCaptureInput);
      case "memory_propose_claim":
        return this.memoryProposeClaim(input as MemoryProposeClaimInput);
    }
  }

  private memorySearch(input: MemorySearchInput): BudgetedRecordOutput {
    const visibility = this.requireVisibility(input.visibility);
    const result = withLocalRetrievalDatabase(this.store, (db) => {
      rebuildLocalRetrievalIndex(db, fixedProjectionNow());
      return searchLocalRetrievalIndex(db, {
        query: makeRetrievalQuery({
          text: requireString(input.query, "query"),
          visibility,
          budget: input.context_budget,
          includeHeld: input.include_held === true,
          ...(input.valid_time === undefined ? {} : { validTime: input.valid_time }),
          ...(input.recorded_time === undefined ? {} : { recordedTime: input.recorded_time }),
          ...(input.project_ids === undefined || input.project_ids.length === 0
            ? {}
            : { projectIds: input.project_ids }),
          ...(input.worktree_ids === undefined || input.worktree_ids.length === 0
            ? {}
            : { worktreeIds: input.worktree_ids }),
          ...(input.boost_worktree_id === undefined
            ? {}
            : { boostWorktreeId: input.boost_worktree_id }),
        }),
      });
    });
    const filter: BitemporalFilter = {
      ...(input.valid_time === undefined ? {} : { validTime: input.valid_time }),
      ...(input.recorded_time === undefined ? {} : { recordedTime: input.recorded_time }),
    };
    const allowedRecordIds = filteredRecordIds(
      this.snapshot(visibility.visible_trust_zone_ids),
      filter,
    );
    const records = result.results
      .filter((item) => item.status !== "excluded")
      .map((item) => recordFromRetrievalItem(item))
      .filter((record) => allowedRecordIds.has(record.record_id));
    const budgeted = applyBudget(records, input.context_budget);
    return {
      schema_version: "v1",
      tool: "memory_search",
      records: budgeted.items,
      budget: budgeted.budget,
    };
  }

  private memoryGet(input: MemoryGetInput): Record<string, unknown> {
    const visibility = this.requireVisibility(input.visibility);
    const snapshot = this.findRecord(input.record_id, visibility.visible_trust_zone_ids);
    if (snapshot === undefined) {
      throw new CarpeosMcpError(
        "not_found",
        "The requested memory record was not found or visible.",
        input.record_id,
      );
    }
    const record =
      "event" in snapshot
        ? snapshotToRecordRef(snapshot, visibility.protected_value_policy)
        : erasureToRecordRef(snapshot);
    return { schema_version: "v1", tool: "memory_get", record };
  }

  private memoryContextPack(input: MemoryContextPackInput): ContextPackOutput {
    const visibility = this.requireVisibility(input.visibility);
    const snapshot = applyBitemporalFilters(this.snapshot(visibility.visible_trust_zone_ids), {
      ...(input.valid_time === undefined ? {} : { validTime: input.valid_time }),
      ...(input.recorded_time === undefined ? {} : { recordedTime: input.recorded_time }),
    });
    const classified = classifyContext(snapshot, visibility, input.include_held === true);
    const budgeted = budgetContextPackWithExpertSlots(classified, input.context_budget);
    // Cache-friendly key insertion order: durable accepted knowledge first.
    return {
      schema_version: "v1",
      tool: "memory_context_pack",
      accepted_facts: budgeted.output.accepted_facts as AcceptedFact[],
      conflicts: budgeted.output.conflicts as McpRecordRef[],
      supersessions: budgeted.output.supersessions as McpRecordRef[],
      observations: budgeted.output.observations as McpRecordRef[],
      evidence_summaries: budgeted.output.evidence_summaries as McpRecordRef[],
      draft_claims: budgeted.output.draft_claims as DraftClaim[],
      rejected_claims: budgeted.output.rejected_claims as DraftClaim[],
      erasures: budgeted.output.erasures as McpRecordRef[],
      verification_gaps: budgeted.output.verification_gaps,
      redactions: budgeted.output.redactions,
      budget: budgeted.budget,
    };
  }

  private memoryTrace(input: MemoryTraceInput): BudgetedRecordOutput {
    const visibility = this.requireVisibility(input.visibility);
    const start = this.findRecord(input.record_id, visibility.visible_trust_zone_ids);
    if (start === undefined) {
      throw new CarpeosMcpError(
        "not_found",
        "The requested trace root was not found or visible.",
        input.record_id,
      );
    }
    const records = traceRecords(
      this.snapshot(visibility.visible_trust_zone_ids),
      input.record_id,
      input.max_depth ?? 4,
      visibility.protected_value_policy,
    );
    const budgeted = applyBudget(records, input.context_budget);
    return {
      schema_version: "v1",
      tool: "memory_trace",
      records: budgeted.items,
      budget: budgeted.budget,
    };
  }

  private memoryTimeline(input: MemoryTimelineInput): BudgetedRecordOutput {
    const visibility = this.requireVisibility(input.visibility);
    const snapshot = applyBitemporalFilters(this.snapshot(visibility.visible_trust_zone_ids), {
      ...(input.valid_time === undefined ? {} : { validTime: input.valid_time }),
      ...(input.recorded_time === undefined ? {} : { recordedTime: input.recorded_time }),
    });
    const records = [
      ...snapshot.events.map((event) =>
        snapshotToRecordRef(event, visibility.protected_value_policy),
      ),
      ...snapshot.erasures.map((erasure) => erasureToRecordRef(erasure)),
    ].sort(compareRecordRefsByTime(snapshot));
    const budgeted = applyBudget(records, input.context_budget);
    return {
      schema_version: "v1",
      tool: "memory_timeline",
      records: budgeted.items,
      budget: budgeted.budget,
    };
  }

  private memoryRelated(input: MemoryRelatedInput): BudgetedRecordOutput {
    const visibility = this.requireVisibility(input.visibility);
    const start = this.findRecord(input.record_id, visibility.visible_trust_zone_ids);
    if (start === undefined) {
      throw new CarpeosMcpError(
        "not_found",
        "The requested related root was not found or visible.",
        input.record_id,
      );
    }
    const records = relatedRecords(
      this.snapshot(visibility.visible_trust_zone_ids),
      input.record_id,
      input.max_depth ?? 2,
      visibility.protected_value_policy,
    );
    const budgeted = applyBudget(records, input.context_budget);
    return {
      schema_version: "v1",
      tool: "memory_related",
      records: budgeted.items,
      budget: budgeted.budget,
    };
  }

  private memoryCapture(input: MemoryCaptureInput): Record<string, unknown> {
    const visibility = this.requireVisibility(input.visibility);
    requireVisibleIncludesLocal(
      visibility.visible_trust_zone_ids,
      this.store.trustZone.trust_zone_id,
    );
    const result = this.store.captureHook(
      {
        provider: requireString(input.provider, "provider"),
        hook_event_name: requireString(input.hook_event_name, "hook_event_name"),
        captured_at: requireString(input.captured_at, "captured_at"),
        media_type: requireString(input.media_type, "media_type"),
        subject_ref: requireString(input.subject_ref, "subject_ref"),
        payload: input.payload,
        ...(input.idempotency_key === undefined ? {} : { idempotency_key: input.idempotency_key }),
      },
      { extract: true },
    );
    return {
      schema_version: "v1",
      tool: "memory_capture",
      status: result.status,
      event_id: result.event.event_id,
      recorded_time: result.event.recorded_time,
      ...(result.extraction === undefined
        ? {}
        : {
            extraction: {
              status: result.extraction.status,
              ...(result.extraction.status === "extracted" || result.extraction.status === "replay"
                ? { observation_event_id: result.extraction.event.event_id }
                : {}),
              ...(result.extraction.status === "skipped"
                ? { reason: result.extraction.reason }
                : {}),
            },
          }),
    };
  }

  private memoryProposeClaim(input: MemoryProposeClaimInput): MemoryProposeClaimOutput {
    const visibility = this.requireVisibility(input.visibility);
    requireVisibleIncludesLocal(
      visibility.visible_trust_zone_ids,
      this.store.trustZone.trust_zone_id,
    );
    const result = this.store.proposeClaimDraft({
      statement: requireString(input.statement, "statement"),
      support: input.support,
      visibleTrustZoneIds: visibility.visible_trust_zone_ids,
      ...(input.claim_type === undefined ? {} : { claimType: input.claim_type }),
      ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
      ...(input.subject_ref === undefined ? {} : { subjectRef: input.subject_ref }),
      ...(input.valid_time === undefined ? {} : { validTime: input.valid_time }),
      ...(input.idempotency_key === undefined ? {} : { idempotencyKey: input.idempotency_key }),
    });
    return {
      schema_version: "v1",
      tool: "memory_propose_claim",
      status: result.status,
      event_id: result.event.event_id,
      claim_id: result.event.payload.claim_id,
      lifecycle_status: "draft",
      valid_time: result.event.valid_time,
      recorded_time: result.event.recorded_time,
      valid_time_defaulted: result.valid_time_defaulted,
      acceptance_decision_event_ids: [],
    };
  }

  private requireVisibility(visibility: McpVisibility): McpVisibility {
    if (visibility === undefined) {
      throw new CarpeosMcpError("unauthorized", "visibility is required");
    }
    const visibleTrustZoneIds = normalizeVisibleTrustZones(visibility.visible_trust_zone_ids);
    for (const trustZoneId of visibleTrustZoneIds) {
      if (!this.configuredVisibleTrustZoneIds.includes(trustZoneId)) {
        throw new CarpeosMcpError(
          "unauthorized",
          "requested trust zone is not configured as visible",
          trustZoneId,
        );
      }
    }
    requireVisibleIncludesLocal(visibleTrustZoneIds, this.store.trustZone.trust_zone_id);
    return {
      visible_trust_zone_ids: visibleTrustZoneIds,
      protected_value_policy: visibility.protected_value_policy,
    };
  }

  private snapshot(visibleTrustZoneIds: readonly string[]): LocalRetrievalInputSnapshot {
    return this.store.getRetrievalInputSnapshot({ visibleTrustZoneIds });
  }

  private findRecord(recordId: string, visibleTrustZoneIds: readonly string[]) {
    const events = this.store.listCanonicalEventSnapshots({ visibleTrustZoneIds });
    const event = events.find(
      (item) => item.event_id === recordId || eventPayloadIds(item.event).includes(recordId),
    );
    if (event !== undefined) {
      return event;
    }
    return this.store
      .listErasureSnapshots({ visibleTrustZoneIds })
      .find((item) => item.erasure_id === recordId);
  }
}

function validateToolInput(toolName: CarpeosMcpToolName, input: unknown): Record<string, unknown> {
  assertPlainObject(input, toolName);
  const withTool = { ...input, tool: toolName };
  const result = validateConformance("mcpApi", withTool);
  if (!result.valid) {
    throw new CarpeosMcpError("invalid_schema", `invalid ${toolName} input`);
  }
  return withTool;
}

export function normalizeVisibleTrustZones(values: readonly string[] | undefined): string[] {
  if (values === undefined || values.length === 0) {
    throw new CarpeosMcpError("unauthorized", "visible trust zones are required");
  }
  const normalized = [...new Set(values.map((value) => value.trim()))].sort();
  for (const value of normalized) {
    if (!isTrustZoneId(value)) {
      throw new CarpeosMcpError("unauthorized", "visible trust zone id is invalid", value);
    }
  }
  return normalized;
}

export function requireVisibleIncludesLocal(
  visibleTrustZoneIds: readonly string[],
  localTrustZoneId: string,
): void {
  if (!visibleTrustZoneIds.includes(localTrustZoneId)) {
    throw new CarpeosMcpError(
      "unauthorized",
      "visible trust zones must include the active local trust zone",
      localTrustZoneId,
    );
  }
}

function makeRetrievalQuery(input: {
  text: string;
  visibility: McpVisibility;
  budget: ContextBudget;
  includeHeld?: boolean;
  validTime?: BitemporalInterval;
  recordedTime?: BitemporalInterval;
  projectIds?: readonly string[];
  worktreeIds?: readonly string[];
  boostWorktreeId?: string;
}): RetrievalQuery {
  return {
    schema_version: "v1",
    record_type: "retrieval_query",
    query_id: `query_${sha256Hex(stableQueryIdentity(input)).slice(0, 24)}`,
    query_text: input.text,
    filters: {
      visible_trust_zone_ids: [...input.visibility.visible_trust_zone_ids],
      // Product 2.0: promoted (active) meaning only by default; draft/held requires include_held.
      lifecycle_status: input.includeHeld === true ? ["active", "draft"] : ["active"],
      epistemic_authority: [
        "unverified",
        "self_reported",
        "observed",
        "imported",
        "derived",
        "verified",
      ],
      protected_value_policy: input.visibility.protected_value_policy,
      conflict_policy: "surface_conflicts",
      ...(input.validTime === undefined ? {} : { valid_time: input.validTime }),
      ...(input.recordedTime === undefined ? {} : { recorded_time: input.recordedTime }),
      ...(input.projectIds === undefined || input.projectIds.length === 0
        ? {}
        : { project_ids: [...input.projectIds] }),
      ...(input.worktreeIds === undefined || input.worktreeIds.length === 0
        ? {}
        : { worktree_ids: [...input.worktreeIds] }),
    },
    ranking: {
      mode: "hybrid",
      weights: { structured: 1, fts: 1, semantic: 1, recency: 0.1 },
      ...(input.boostWorktreeId === undefined ? {} : { boost_worktree_id: input.boostWorktreeId }),
    },
    limit: Math.max(input.budget.max_items * 4, input.budget.max_items),
  };
}

function stableQueryIdentity(input: {
  text: string;
  visibility: McpVisibility;
  budget: ContextBudget;
  includeHeld?: boolean;
  validTime?: BitemporalInterval;
  recordedTime?: BitemporalInterval;
  projectIds?: readonly string[];
  worktreeIds?: readonly string[];
  boostWorktreeId?: string;
}): string {
  return JSON.stringify({
    text: input.text,
    visibility: input.visibility,
    budget: input.budget,
    include_held: input.includeHeld === true,
    valid_time: input.validTime ?? null,
    recorded_time: input.recordedTime ?? null,
    project_ids: input.projectIds ?? null,
    worktree_ids: input.worktreeIds ?? null,
    boost_worktree_id: input.boostWorktreeId ?? null,
  });
}

function fixedProjectionNow(): Date {
  return new Date("2026-01-01T00:00:00Z");
}

function recordFromRetrievalItem(item: {
  chunk_id: string;
  status: string;
  lineage: {
    source_records: Array<{
      source_record_id: string;
      source_record_kind: "event" | "erasure";
      trust_zone_id: string;
      event_type?: EventType;
      lifecycle_status?: LifecycleStatus;
      epistemic_authority?: EpistemicAuthority;
    }>;
  };
}): McpRecordRef {
  const primary =
    item.lineage.source_records.find((record) => record.source_record_kind === "event") ??
    item.lineage.source_records[0];
  if (primary === undefined) {
    return {
      record_id: item.chunk_id,
      record_kind: "projection",
      trust_zone_id: "tz_unknown",
      lifecycle_status: "active",
      epistemic_authority: "derived",
    };
  }
  return {
    record_id: primary.source_record_id,
    record_kind: primary.source_record_kind,
    ...(primary.event_type === undefined ? {} : { event_type: primary.event_type }),
    trust_zone_id: primary.trust_zone_id,
    lifecycle_status: primary.lifecycle_status ?? "active",
    epistemic_authority: primary.epistemic_authority ?? "derived",
    source_event_ids: item.lineage.source_records
      .filter((record) => record.source_record_kind === "event")
      .map((record) => record.source_record_id)
      .sort(),
    ...(item.status === "redacted" ? { redactions: ["protected_value"] } : {}),
  };
}

function snapshotToRecordRef(
  snapshot: LocalCanonicalEventSnapshot,
  protectedValuePolicy: McpVisibility["protected_value_policy"],
): McpRecordRef {
  return {
    record_id: snapshot.event_id,
    record_kind: "event",
    event_type: snapshot.event_type,
    trust_zone_id: snapshot.trust_zone_id,
    lifecycle_status: snapshot.event.lifecycle_status,
    epistemic_authority: snapshot.event.epistemic_authority,
    source_event_ids: relatedEventIds(snapshot.event).filter(isEventId),
    ...(protectedValuePolicy === "deny" &&
    snapshot.protected_value_id !== null &&
    snapshot.protected_value_id !== ""
      ? { redactions: ["protected_value"] }
      : {}),
  };
}

function erasureToRecordRef(snapshot: LocalErasureSnapshot): McpRecordRef {
  return {
    record_id: snapshot.erasure_id,
    record_kind: "erasure",
    trust_zone_id: snapshot.trust_zone_id,
    lifecycle_status: "active",
    epistemic_authority: "verified",
    source_event_ids:
      snapshot.erasure.target_ref.target_kind === "event"
        ? [snapshot.erasure.target_ref.target_id]
        : [],
  };
}

function classifyContext(
  snapshot: LocalRetrievalInputSnapshot,
  visibility: McpVisibility,
  includeHeld = false,
): ClassifiedPackSections {
  const events = snapshot.events.map((item) => item.event);
  const context = buildEligibilityContext(snapshot, visibility);
  const eventsByClaimId = new Map(
    events
      .filter((event): event is CanonicalEvent<"Claim"> => event.event_type === "Claim")
      .map((event) => [event.payload.claim_id, event]),
  );

  const accepted_facts: ClassifiedPackSections["accepted_facts"] = [];
  const draft_claims: ClassifiedPackSections["draft_claims"] = [];
  const rejected_claims: ClassifiedPackSections["rejected_claims"] = [];
  const conflicts: ClassifiedPackSections["conflicts"] = [];
  const redactions: string[] = [];

  for (const claim of [...eventsByClaimId.values()].sort(compareEvents)) {
    const claimId = claim.payload.claim_id;
    const supportEventIds = supportEventIdsForClaim(claim, events);
    const denied = hasProtectedDeniedSupport(claim, context);
    if (denied) {
      redactions.push(`protected_value:${claim.event_id}`);
    }
    const accepted = context.acceptedByClaimId.get(claimId);
    const rejected = context.rejectedByClaimId.get(claimId);
    if ((accepted !== undefined && rejected !== undefined) || hasContradictingSupport(claim)) {
      const claimSnapshot = snapshot.events.find((item) => item.event_id === claim.event_id);
      if (claimSnapshot !== undefined) {
        const value = snapshotToRecordRef(claimSnapshot, visibility.protected_value_policy);
        conflicts.push({ diversity_key: claim.subject_ref, value });
      }
    }
    if (accepted !== undefined && acceptedFactEligible(claim, context)) {
      const value: AcceptedFact = {
        claim_event_id: claim.event_id,
        acceptance_decision_event_id: accepted.event_id,
        statement: claim.payload.statement,
        source_event_ids: uniqueSorted([claim.event_id, accepted.event_id, ...supportEventIds]),
      };
      accepted_facts.push({ diversity_key: claim.subject_ref, value });
    } else if (rejected !== undefined) {
      const value: DraftClaim = {
        claim_event_id: claim.event_id,
        statement: claim.payload.statement,
        support_event_ids: supportEventIds,
        status: "draft",
      };
      rejected_claims.push({ diversity_key: claim.subject_ref, value });
    } else if (claim.lifecycle_status === "draft") {
      const value: DraftClaim = {
        claim_event_id: claim.event_id,
        statement: claim.payload.statement,
        support_event_ids: supportEventIds,
        status: "draft",
      };
      draft_claims.push({ diversity_key: claim.subject_ref, value });
    }
  }

  const procedure_summaries: ClassifiedPackSections["procedure_summaries"] = [];
  const evidence_summaries: ClassifiedPackSections["evidence_summaries"] = [];
  for (const item of snapshot.events.filter((event) => event.event_type === "EvidenceArtifact")) {
    const value = snapshotToRecordRef(item, visibility.protected_value_policy);
    const slot = {
      diversity_key: item.event.subject_ref,
      value,
    };
    if (
      item.event.event_type === "EvidenceArtifact" &&
      item.event.payload.kind === "procedure_trace"
    ) {
      procedure_summaries.push(slot);
    } else {
      evidence_summaries.push(slot);
    }
  }

  return {
    accepted_facts,
    draft_claims,
    rejected_claims,
    observations: snapshot.events
      .filter((item) => item.event_type === "Observation")
      .filter((item) => includeHeld || item.event.lifecycle_status === "active")
      .map((item) => ({
        diversity_key: item.event.subject_ref,
        value: snapshotToRecordRef(item, visibility.protected_value_policy),
      })),
    evidence_summaries,
    procedure_summaries,
    conflicts,
    supersessions: snapshot.events
      .filter((item) => item.event_type === "Supersession")
      .map((item) => ({
        diversity_key: item.event.subject_ref,
        value: snapshotToRecordRef(item, visibility.protected_value_policy),
      })),
    erasures: snapshot.erasures.map((item) => ({
      diversity_key: item.trust_zone_id,
      value: erasureToRecordRef(item),
    })),
    verification_gaps: [],
    redactions: uniqueSorted(redactions),
  };
}

function applyBudget<T>(
  items: readonly T[],
  budget: ContextBudget,
): { items: T[]; budget: ContextBudgetUsage } {
  const kept: T[] = [];
  let usedCharacters = 0;
  let omittedItems = 0;
  let omittedCharacters = 0;
  for (const item of items) {
    const characters = stableLength(item);
    if (kept.length + 1 > budget.max_items || usedCharacters + characters > budget.max_characters) {
      omittedItems += 1;
      omittedCharacters += characters;
      continue;
    }
    kept.push(item);
    usedCharacters += characters;
  }
  return {
    items: kept,
    budget: {
      used: { items: kept.length, characters: usedCharacters },
      truncated: omittedItems > 0 || omittedCharacters > 0,
      omitted: { items: omittedItems, characters: omittedCharacters },
    },
  };
}

function traceRecords(
  snapshot: LocalRetrievalInputSnapshot,
  rootId: string,
  maxDepth: number,
  protectedValuePolicy: McpVisibility["protected_value_policy"],
): McpRecordRef[] {
  const byId = eventLookup(snapshot.events);
  const seen = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || seen.has(current.id) || current.depth > maxDepth) {
      continue;
    }
    const event = byId.get(current.id);
    if (event === undefined) {
      continue;
    }
    seen.add(event.event_id);
    for (const id of relatedEventIds(event.event)) {
      queue.push({ id, depth: current.depth + 1 });
    }
  }
  return [...seen]
    .map((id) => byId.get(id))
    .filter((item): item is LocalCanonicalEventSnapshot => item !== undefined)
    .map((item) => snapshotToRecordRef(item, protectedValuePolicy))
    .sort(compareRecordRefs);
}

function relatedRecords(
  snapshot: LocalRetrievalInputSnapshot,
  rootId: string,
  maxDepth: number,
  protectedValuePolicy: McpVisibility["protected_value_policy"],
): McpRecordRef[] {
  const traced = traceRecords(snapshot, rootId, maxDepth, protectedValuePolicy);
  const root = snapshot.events.find(
    (item) => item.event_id === rootId || eventPayloadIds(item.event).includes(rootId),
  );
  const targetClaimIds = root?.event.event_type === "Claim" ? [root.event.payload.claim_id] : [];
  const decisionRelated = snapshot.events
    .filter(
      (item) =>
        item.event.event_type === "AcceptanceDecision" &&
        item.event.payload.claim_refs.some((claimRef) => targetClaimIds.includes(claimRef)),
    )
    .map((item) => snapshotToRecordRef(item, protectedValuePolicy));
  return [
    ...new Map([...traced, ...decisionRelated].map((item) => [item.record_id, item])).values(),
  ].sort(compareRecordRefs);
}

function eventLookup(
  events: readonly LocalCanonicalEventSnapshot[],
): Map<string, LocalCanonicalEventSnapshot> {
  const byId = new Map<string, LocalCanonicalEventSnapshot>();
  for (const item of events) {
    byId.set(item.event_id, item);
    for (const id of eventPayloadIds(item.event)) {
      byId.set(id, item);
    }
  }
  return byId;
}

function relatedEventIds(event: CanonicalEvent): string[] {
  const ids = event.provenance.map((ref) => ref.ref_id);
  if (event.event_type === "Claim") {
    ids.push(...event.payload.support.map((ref) => ref.ref_id));
  }
  if (event.event_type === "AcceptanceDecision") {
    ids.push(...event.payload.claim_refs);
  }
  if (event.event_type === "Supersession") {
    ids.push(event.payload.supersedes_event_id);
    if (event.payload.replacement_event_id !== undefined) {
      ids.push(event.payload.replacement_event_id);
    }
  }
  return uniqueSorted(ids);
}

function eventPayloadIds(event: CanonicalEvent): string[] {
  switch (event.event_type) {
    case "EvidenceArtifact":
      return [event.payload.artifact_id];
    case "Observation":
      return [event.payload.observation_id];
    case "Claim":
      return [event.payload.claim_id];
    case "AcceptanceDecision":
      return [event.payload.decision_id];
    case "Supersession":
      return [event.payload.supersession_id];
  }
}

function decisionsByClaim(
  decisions: readonly CanonicalEvent<"AcceptanceDecision">[],
  decision: "accepted" | "rejected",
): Map<string, CanonicalEvent<"AcceptanceDecision">> {
  const result = new Map<string, CanonicalEvent<"AcceptanceDecision">>();
  for (const item of decisions
    .filter((candidate) => candidate.payload.decision === decision)
    .sort(compareEvents)) {
    for (const claimRef of item.payload.claim_refs) {
      if (!result.has(claimRef)) {
        result.set(claimRef, item);
      }
    }
  }
  return result;
}

function supportEventIdsForClaim(
  claim: CanonicalEvent<"Claim">,
  events: readonly CanonicalEvent[],
): string[] {
  const byPayloadId = new Map<string, string>();
  for (const event of events) {
    byPayloadId.set(event.event_id, event.event_id);
    for (const id of eventPayloadIds(event)) {
      byPayloadId.set(id, event.event_id);
    }
  }
  const supportEventIds = uniqueSorted(
    claim.payload.support.map((ref) => byPayloadId.get(ref.ref_id) ?? ref.ref_id).filter(isEventId),
  );
  return supportEventIds.length === 0 ? [claim.event_id] : supportEventIds;
}

function buildEligibilityContext(
  snapshot: LocalRetrievalInputSnapshot,
  visibility: McpVisibility,
): EligibilityContext {
  const events = snapshot.events.map((item) => item.event);
  const eventById = new Map<string, CanonicalEvent>();
  const snapshotByEventId = new Map<string, LocalCanonicalEventSnapshot>();
  for (const eventSnapshot of snapshot.events) {
    eventById.set(eventSnapshot.event_id, eventSnapshot.event);
    snapshotByEventId.set(eventSnapshot.event_id, eventSnapshot);
    for (const id of eventPayloadIds(eventSnapshot.event)) {
      eventById.set(id, eventSnapshot.event);
    }
  }
  const decisions = events.filter(
    (event): event is CanonicalEvent<"AcceptanceDecision"> =>
      event.event_type === "AcceptanceDecision",
  );
  return {
    events,
    eventSnapshots: snapshot.events,
    eventById,
    snapshotByEventId,
    supersededEventIds: new Set(
      events
        .filter(
          (event): event is CanonicalEvent<"Supersession"> => event.event_type === "Supersession",
        )
        .map((event) => event.payload.supersedes_event_id),
    ),
    erasedEventIds: new Set(
      snapshot.erasures
        .filter((item) => item.erasure.target_ref.target_kind === "event")
        .map((item) => item.erasure.target_ref.target_id),
    ),
    acceptedByClaimId: decisionsByClaim(decisions, "accepted"),
    rejectedByClaimId: decisionsByClaim(decisions, "rejected"),
    visibility,
  };
}

function acceptedFactEligible(
  claim: CanonicalEvent<"Claim">,
  context: EligibilityContext,
): boolean {
  if (!eventEligible(claim, context, { requireActive: true })) {
    return false;
  }
  if (hasContradictingSupport(claim) || hasProtectedDeniedSupport(claim, context)) {
    return false;
  }
  const accepted = context.acceptedByClaimId.get(claim.payload.claim_id);
  if (accepted === undefined || !eventEligible(accepted, context, { requireActive: true })) {
    return false;
  }
  const rejected = context.rejectedByClaimId.get(claim.payload.claim_id);
  if (rejected !== undefined && eventEligible(rejected, context, { requireActive: true })) {
    return false;
  }
  for (const supportEvent of supportEventsForClaim(claim, context)) {
    if (!eventEligible(supportEvent, context, { requireActive: false })) {
      return false;
    }
  }
  return true;
}

function eventEligible(
  event: CanonicalEvent,
  context: EligibilityContext,
  input: { requireActive: boolean },
): boolean {
  if (input.requireActive && event.lifecycle_status !== "active") {
    return false;
  }
  if (event.epistemic_authority === "unverified") {
    return false;
  }
  if (
    context.erasedEventIds.has(event.event_id) ||
    context.supersededEventIds.has(event.event_id)
  ) {
    return false;
  }
  return context.eventSnapshots.some((item) => item.event_id === event.event_id);
}

function supportEventsForClaim(
  claim: CanonicalEvent<"Claim">,
  context: EligibilityContext,
): CanonicalEvent[] {
  return claim.payload.support
    .map((ref) => context.eventById.get(ref.ref_id))
    .filter((event): event is CanonicalEvent => event !== undefined);
}

function hasContradictingSupport(claim: CanonicalEvent<"Claim">): boolean {
  return claim.payload.support.some((ref) => ref.relationship === "contradicts");
}

function hasProtectedDeniedSupport(
  claim: CanonicalEvent<"Claim">,
  context: EligibilityContext,
): boolean {
  if (context.visibility.protected_value_policy !== "deny") {
    return false;
  }
  return supportEventsForClaim(claim, context).some((event) => {
    const snapshot = context.snapshotByEventId.get(event.event_id);
    return (
      snapshot?.protected_value_id !== null &&
      snapshot?.protected_value_id !== undefined &&
      snapshot.protected_value_id !== ""
    );
  });
}

function applyBitemporalFilters(
  snapshot: LocalRetrievalInputSnapshot,
  filter: BitemporalFilter,
): LocalRetrievalInputSnapshot {
  if (filter.validTime === undefined && filter.recordedTime === undefined) {
    return snapshot;
  }
  return {
    ...snapshot,
    events: snapshot.events.filter((event) => eventMatchesBitemporalFilter(event.event, filter)),
    erasures: snapshot.erasures.filter((erasure) =>
      erasureMatchesBitemporalFilter(erasure, filter),
    ),
  };
}

function filteredRecordIds(
  snapshot: LocalRetrievalInputSnapshot,
  filter: BitemporalFilter,
): ReadonlySet<string> {
  const filtered = applyBitemporalFilters(snapshot, filter);
  return new Set([
    ...filtered.events.flatMap((event) => [event.event_id, ...eventPayloadIds(event.event)]),
    ...filtered.erasures.map((erasure) => erasure.erasure_id),
  ]);
}

function eventMatchesBitemporalFilter(event: CanonicalEvent, filter: BitemporalFilter): boolean {
  return (
    (filter.validTime === undefined || intervalsOverlap(event.valid_time, filter.validTime)) &&
    (filter.recordedTime === undefined ||
      timestampWithinInterval(event.recorded_time.start, filter.recordedTime))
  );
}

function erasureMatchesBitemporalFilter(
  snapshot: LocalErasureSnapshot,
  filter: BitemporalFilter,
): boolean {
  return (
    filter.recordedTime === undefined ||
    timestampWithinInterval(snapshot.erasure.requested_at, filter.recordedTime)
  );
}

function intervalsOverlap(left: BitemporalInterval, right: BitemporalInterval): boolean {
  const leftStart = Date.parse(left.start);
  const rightStart = Date.parse(right.start);
  const leftEnd = left.end === null ? Number.POSITIVE_INFINITY : Date.parse(left.end);
  const rightEnd = right.end === null ? Number.POSITIVE_INFINITY : Date.parse(right.end);
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

function timestampWithinInterval(timestamp: string, interval: BitemporalInterval): boolean {
  const value = Date.parse(timestamp);
  const start = Date.parse(interval.start);
  const end = interval.end === null ? Number.POSITIVE_INFINITY : Date.parse(interval.end);
  return start <= value && value <= end;
}

function isEventId(value: string): boolean {
  return /^evt_[a-z0-9][a-z0-9_-]{7,127}$/.test(value);
}

function compareEvents(left: CanonicalEvent, right: CanonicalEvent): number {
  return (
    left.recorded_time.start.localeCompare(right.recorded_time.start) ||
    left.event_id.localeCompare(right.event_id)
  );
}

function compareRecordRefs(left: McpRecordRef, right: McpRecordRef): number {
  return left.record_id.localeCompare(right.record_id);
}

function compareRecordRefsByTime(snapshot: LocalRetrievalInputSnapshot) {
  const times = new Map<string, string>();
  for (const event of snapshot.events) {
    times.set(event.event_id, event.event.recorded_time.start);
  }
  for (const erasure of snapshot.erasures) {
    times.set(erasure.erasure_id, erasure.erasure.completed_at ?? erasure.erasure.requested_at);
  }
  return (left: McpRecordRef, right: McpRecordRef) =>
    (times.get(left.record_id) ?? "").localeCompare(times.get(right.record_id) ?? "") ||
    compareRecordRefs(left, right);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function assertPlainObject(
  value: unknown,
  toolName: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CarpeosMcpError("invalid_schema", `${toolName} input must be a JSON object`);
  }
}

function requireString(value: string | undefined, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CarpeosMcpError("invalid_schema", `${field} is required`);
  }
  return value.trim();
}

function toMcpResult(output: Record<string, unknown>, isError: boolean): CarpeosMcpResult {
  return {
    structuredContent: output,
    text: JSON.stringify(output),
    isError,
  };
}

function toSafeError(error: unknown): McpSafeError {
  if (error instanceof CarpeosMcpError) {
    return error.safeError;
  }
  if (error instanceof IdempotencyConflictError) {
    return {
      code: "idempotency_conflict",
      message: "The idempotency key was already used for different logical content.",
      ref_id: error.idempotencyKey,
    };
  }
  if (error instanceof Error && error.message.includes("not found")) {
    return { code: "not_found", message: "The requested memory record was not found." };
  }
  if (
    error instanceof Error &&
    error.message.includes("idempotency_key") &&
    !isIdempotencyKey("")
  ) {
    return { code: "invalid_schema", message: "The idempotency key is invalid." };
  }
  return { code: "internal_error", message: "The local CarpeOS MCP operation failed." };
}

function errorOutput(toolName: McpToolName, error: McpSafeError): Record<string, unknown> {
  const budget = {
    used: { items: 0, characters: 0 },
    truncated: false,
    omitted: { items: 0, characters: 0 },
  };
  if (toolName === "memory_context_pack") {
    return {
      schema_version: "v1",
      tool: toolName,
      accepted_facts: [],
      draft_claims: [],
      rejected_claims: [],
      observations: [],
      evidence_summaries: [],
      conflicts: [],
      supersessions: [],
      erasures: [],
      verification_gaps: [],
      redactions: [],
      budget,
      error,
    };
  }
  if (toolName === "memory_capture") {
    return {
      schema_version: "v1",
      tool: toolName,
      error,
    };
  }
  if (toolName === "memory_propose_claim") {
    return {
      schema_version: "v1",
      tool: toolName,
      error,
    };
  }
  if (toolName === "memory_get") {
    return {
      schema_version: "v1",
      tool: toolName,
      record: {
        record_id: error.ref_id ?? "unavailable",
        record_kind: "projection",
        trust_zone_id: "tz_error",
        lifecycle_status: "active",
        epistemic_authority: "derived",
      },
      error,
    };
  }
  return { schema_version: "v1", tool: toolName, records: [], budget, error };
}
