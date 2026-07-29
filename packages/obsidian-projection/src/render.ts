import type {
  CanonicalEvent,
  ObsidianProjectionCategory,
  ObsidianProjectionNote,
  ObsidianSourceLineage,
} from "@carpeos/schema";
import type { LocalCanonicalEventSnapshot, LocalErasureSnapshot } from "@carpeos/local-store";
import { safePathSegment, vaultRootLink } from "./paths.js";
import {
  assertNoProtectedPlaintext,
  compareText,
  sha256Digest,
  stableJson,
  uniqueSorted,
} from "./utils.js";

export type ProjectionConfig = {
  outputRoot: string;
  projectionVersion?: string;
  visibleTrustZoneIds: readonly string[];
  pathPolicy?: "delete_missing" | "tombstone_missing";
  generatedAtPolicy?: "fixed_input" | "wall_clock_disclosed";
  nonAuthoritativeMarker?: string;
};

export type RenderedNote = {
  note: ObsidianProjectionNote;
  content: string;
};

type EventSnapshot = LocalCanonicalEventSnapshot;

const PROJECTION_VERSION = "obsidian/v1";
const DEFAULT_MARKER =
  "Generated non-authoritative CarpeOS projection. Editing this note has no canonical effect.";

export function normalizeProjectionConfig(config: ProjectionConfig): Required<ProjectionConfig> {
  return {
    outputRoot: config.outputRoot,
    projectionVersion: config.projectionVersion ?? PROJECTION_VERSION,
    visibleTrustZoneIds: uniqueSorted([...config.visibleTrustZoneIds]),
    pathPolicy: config.pathPolicy ?? "delete_missing",
    generatedAtPolicy: config.generatedAtPolicy ?? "fixed_input",
    nonAuthoritativeMarker: config.nonAuthoritativeMarker ?? DEFAULT_MARKER,
  };
}

export function renderProjectionNotes(input: {
  events: readonly EventSnapshot[];
  erasures: readonly LocalErasureSnapshot[];
  config: Required<ProjectionConfig>;
}): RenderedNote[] {
  const erasedEventIds = collectErasedEventIds(input.erasures);
  const supersededEventIds = collectSupersededEventIds(input.events, erasedEventIds);
  const eventsByReference = mapEventsByReference(input.events);
  const policy: RenderPolicy = {
    erasedEventIds,
    supersededEventIds,
    eventsByReference,
    allDecisionsByClaimId: mapAllDecisionsByClaimId(input.events),
    decisionsByClaimId: mapEligibleDecisionsByClaimId(input.events, {
      erasedEventIds,
      supersededEventIds,
      eventsByReference,
    }),
  };
  const notes: RenderedNote[] = [];

  for (const snapshot of [...input.events].sort(compareEventSnapshots)) {
    if (erasedEventIds.has(snapshot.event_id)) {
      continue;
    }
    if (snapshot.event_type === "Claim") {
      notes.push(...renderClaim(snapshot as EventSnapshotFor<"Claim">, policy, input.config));
      continue;
    }
    if (snapshot.event_type === "Observation") {
      notes.push(renderEventNote(snapshot, "observation", input.config, ["primary"]));
      continue;
    }
    if (snapshot.event_type === "EvidenceArtifact") {
      notes.push(renderEventNote(snapshot, "evidence_summary", input.config, ["support"]));
      continue;
    }
    if (snapshot.event_type === "Supersession") {
      notes.push(renderEventNote(snapshot, "supersession", input.config, ["supersession"]));
    }
  }

  for (const erasure of [...input.erasures].sort(compareErasureSnapshots)) {
    notes.push(renderErasureNote(erasure, input.config));
  }

  notes.push(...renderIndexes(notes, input.config));
  return notes.sort((left, right) => compareText(left.note.path, right.note.path));
}

export function renderMarkdown(note: ObsidianProjectionNote, body: string): string {
  const markdown = `---\n${renderYaml(note.front_matter)}---\n\n${body.trimEnd()}\n`;
  assertNoProtectedPlaintext(markdown);
  return markdown;
}

export function renderYaml(value: Record<string, unknown>): string {
  return Object.keys(value)
    .sort(compareText)
    .map((key) => `${key}: ${renderYamlValue(value[key])}`)
    .join("\n")
    .concat("\n");
}

function renderClaim(
  snapshot: EventSnapshotFor<"Claim">,
  policy: RenderPolicy,
  config: Required<ProjectionConfig>,
): RenderedNote[] {
  const claim = snapshot.event.payload;
  if (policy.supersededEventIds.has(snapshot.event_id)) {
    return [];
  }
  const allDecisions = policy.allDecisionsByClaimId.get(claim.claim_id) ?? [];
  const decisions = policy.decisionsByClaimId.get(claim.claim_id) ?? [];
  const accepted = decisions.find((decision) => decision.event.payload.decision === "accepted");
  const rejected = decisions.find((decision) => decision.event.payload.decision === "rejected");
  const claimSupportEligible = hasEligibleSupport(snapshot.event, policy);
  const claimHasContradiction = hasContradictionLineage(snapshot.event);
  const hasIneligibleDecisionLineage = allDecisions.length !== decisions.length;

  if (
    hasIneligibleDecisionLineage ||
    claimHasContradiction ||
    (accepted !== undefined && rejected !== undefined)
  ) {
    const lineage = accepted === undefined ? [] : [accepted];
    return [
      renderEventNote(snapshot, "conflict", config, ["contradiction", "acceptance"], lineage),
    ];
  }
  if (rejected !== undefined) {
    return [
      renderEventNote(snapshot, "rejected_claim", config, ["primary", "rejection"], [rejected]),
    ];
  }
  if (!claimSupportEligible) {
    return [renderEventNote(snapshot, "conflict", config, ["contradiction"])];
  }
  if (accepted !== undefined && snapshot.event.lifecycle_status !== "draft") {
    return [
      renderEventNote(snapshot, "accepted_fact", config, ["primary", "acceptance"], [accepted]),
    ];
  }
  return [renderEventNote(snapshot, "proposed_claim", config, ["primary"])];
}

function renderEventNote(
  snapshot: EventSnapshot,
  category: ObsidianProjectionCategory,
  config: Required<ProjectionConfig>,
  relationships: readonly NonNullable<ObsidianSourceLineage["relationship"]>[],
  extraLineageSnapshots: readonly EventSnapshot[] = [],
): RenderedNote {
  const event = snapshot.event;
  const path = eventPath(category, event.subject_ref, event.event_id);
  const lineage = [
    sourceLineageFromEvent(snapshot, relationships[0] ?? "primary"),
    ...extraLineageSnapshots.map((item, index) =>
      sourceLineageFromEvent(item, relationships[index + 1] ?? "support"),
    ),
  ];
  const note = buildNote({ path, category, lineage });
  const body = renderMarkdown(
    note,
    [
      `# ${titleForEvent(category, event)}`,
      "",
      config.nonAuthoritativeMarker,
      "",
      `- Category: \`${category}\``,
      `- Canonical source: \`${event.event_id}\``,
      `- Subject: \`${event.subject_ref}\``,
      `- Event type: \`${event.event_type}\``,
      `- Trust zone: \`${event.trust_zone.trust_zone_id}\``,
      `- Recorded time: \`${event.recorded_time.start}\``,
      `- Valid time: \`${event.valid_time.start}\` to \`${event.valid_time.end ?? "open"}\``,
      "",
      bodyForEvent(event),
      "",
      "## Links",
      `- Subject index: ${vaultRootLink(subjectIndexPath(event.subject_ref), event.subject_ref)}`,
      `- Type index: ${vaultRootLink(typeIndexPath(event.event_type), event.event_type)}`,
    ].join("\n"),
  );
  return { note, content: body };
}

function renderErasureNote(
  snapshot: LocalErasureSnapshot,
  config: Required<ProjectionConfig>,
): RenderedNote {
  const erasure = snapshot.erasure;
  const target = `${erasure.target_ref.target_kind}-${erasure.target_ref.target_id}`;
  const path = eventPath("erasure", target, erasure.erasure_id);
  const note = buildNote({
    path,
    category: "erasure",
    lineage: [sourceLineageFromErasure(snapshot, "erasure")],
  });
  const body = renderMarkdown(
    note,
    [
      `# Erasure ${erasure.erasure_id}`,
      "",
      config.nonAuthoritativeMarker,
      "",
      `- Method: \`${erasure.method}\``,
      `- Target kind: \`${erasure.target_ref.target_kind}\``,
      `- Target id: \`${erasure.target_ref.target_id}\``,
      `- Requested at: \`${erasure.requested_at}\``,
      `- Completed at: \`${erasure.completed_at ?? "pending"}\``,
    ].join("\n"),
  );
  return { note, content: body };
}

function renderIndexes(
  notes: readonly RenderedNote[],
  config: Required<ProjectionConfig>,
): RenderedNote[] {
  const sourceIds = notes.flatMap((note) => note.note.front_matter.source_ids);
  const configLineage: ObsidianSourceLineage = {
    source_kind: "config",
    source_id: config.projectionVersion,
    trust_zone_id: config.visibleTrustZoneIds[0] ?? "tz_local_default",
    zone_sequence: 1,
    source_fingerprint: sha256Digest(stableJson(config)),
    relationship: "config",
  };
  const bySubject = new Map<string, RenderedNote[]>();
  const byType = new Map<string, RenderedNote[]>();

  for (const rendered of notes) {
    const subject = rendered.note.path.split("/")[1] ?? "unknown";
    const type = rendered.note.category;
    bySubject.set(subject, [...(bySubject.get(subject) ?? []), rendered]);
    byType.set(type, [...(byType.get(type) ?? []), rendered]);
  }

  return [
    ...[...bySubject.entries()].map(([subject, subjectNotes]) =>
      renderIndexNote({
        path: subjectIndexPath(subject),
        title: `Subject ${subject}`,
        notes: subjectNotes,
        lineage: configLineage,
        sourceIds,
      }),
    ),
    ...[...byType.entries()].map(([type, typeNotes]) =>
      renderIndexNote({
        path: typeIndexPath(type),
        title: `Type ${type}`,
        notes: typeNotes,
        lineage: configLineage,
        sourceIds,
      }),
    ),
  ];
}

function renderIndexNote(input: {
  path: string;
  title: string;
  notes: readonly RenderedNote[];
  lineage: ObsidianSourceLineage;
  sourceIds: readonly string[];
}): RenderedNote {
  const note = buildNote({
    path: input.path,
    category: "index",
    lineage: [input.lineage],
    sourceIds: uniqueSorted([...input.sourceIds, input.lineage.source_id]),
  });
  const body = renderMarkdown(
    note,
    [
      `# ${input.title}`,
      "",
      "Generated non-authoritative CarpeOS projection. Editing this note has no canonical effect.",
      "",
      ...input.notes
        .slice()
        .sort((left, right) => compareText(left.note.path, right.note.path))
        .map((rendered) => `- ${vaultRootLink(rendered.note.path, rendered.note.path)}`),
    ].join("\n"),
  );
  return { note, content: body };
}

function buildNote(input: {
  path: string;
  category: ObsidianProjectionCategory;
  lineage: readonly ObsidianSourceLineage[];
  sourceIds?: readonly string[];
}): ObsidianProjectionNote {
  const sourceIds = input.sourceIds ?? input.lineage.map((item) => item.source_id);
  return {
    schema_version: "v1",
    note_type: "obsidian_projection_note",
    path: input.path,
    category: input.category,
    source_lineage: [...input.lineage].sort(compareLineage),
    front_matter: {
      carpeos_projection: true,
      category: input.category,
      source_ids: uniqueSorted(sourceIds),
      canonical_effect: "none",
    },
  };
}

function bodyForEvent(event: CanonicalEvent): string {
  switch (event.event_type) {
    case "Claim":
      return `## Statement\n${event.payload.statement}`;
    case "Observation":
      return `## Observation\n${event.payload.statement}`;
    case "EvidenceArtifact":
      return [
        "## Evidence Metadata",
        `- Artifact id: \`${event.payload.artifact_id}\``,
        `- Kind: \`${event.payload.kind}\``,
        `- Media type: \`${event.payload.media_type}\``,
        `- Content reference: \`${event.payload.content_ref.ref_type}\``,
      ].join("\n");
    case "AcceptanceDecision":
      return `## Decision\n${event.payload.decision}`;
    case "Supersession":
      return [
        "## Supersession",
        `- Supersedes: \`${event.payload.supersedes_event_id}\``,
        `- Replacement: \`${event.payload.replacement_event_id ?? "none"}\``,
        `- Reason: ${event.payload.reason}`,
      ].join("\n");
  }
}

function titleForEvent(category: ObsidianProjectionCategory, event: CanonicalEvent): string {
  if (event.event_type === "Claim") {
    return `${category.replaceAll("_", " ")} ${event.payload.claim_id}`;
  }
  if (event.event_type === "Observation") {
    return `Observation ${event.payload.observation_id}`;
  }
  if (event.event_type === "EvidenceArtifact") {
    return `Evidence ${event.payload.artifact_id}`;
  }
  if (event.event_type === "Supersession") {
    return `Supersession ${event.payload.supersession_id}`;
  }
  return `${event.event_type} ${event.event_id}`;
}

function eventPath(category: string, subjectRef: string, eventId: string): string {
  return `${category}/${safePathSegment(subjectRef)}/${safePathSegment(eventId)}.md`;
}

function subjectIndexPath(subjectRef: string): string {
  return `indexes/subjects/${safePathSegment(subjectRef)}.md`;
}

function typeIndexPath(eventType: string): string {
  return `indexes/types/${safePathSegment(eventType)}.md`;
}

function sourceLineageFromEvent(
  snapshot: EventSnapshot,
  relationship: NonNullable<ObsidianSourceLineage["relationship"]>,
): ObsidianSourceLineage {
  return {
    source_kind: "event",
    source_id: snapshot.event_id,
    trust_zone_id: snapshot.trust_zone_id,
    zone_sequence: snapshot.zone_sequence,
    source_fingerprint: snapshot.event.request_fingerprint,
    relationship,
  };
}

function sourceLineageFromErasure(
  snapshot: LocalErasureSnapshot,
  relationship: NonNullable<ObsidianSourceLineage["relationship"]>,
): ObsidianSourceLineage {
  return {
    source_kind: "erasure",
    source_id: snapshot.erasure_id,
    trust_zone_id: snapshot.trust_zone_id,
    zone_sequence: snapshot.zone_sequence,
    source_fingerprint: sha256Digest(stableJson(snapshot.erasure)),
    relationship,
  };
}

function collectErasedEventIds(erasures: readonly LocalErasureSnapshot[]): Set<string> {
  const erased = new Set<string>();
  for (const snapshot of erasures) {
    const target = snapshot.erasure.target_ref;
    if (target.target_kind === "event") {
      erased.add(target.target_id);
    }
  }
  return erased;
}

function collectSupersededEventIds(
  events: readonly EventSnapshot[],
  erasedEventIds: ReadonlySet<string>,
): Set<string> {
  const superseded = new Set<string>();
  for (const snapshot of events) {
    if (snapshot.event_type !== "Supersession" || erasedEventIds.has(snapshot.event_id)) {
      continue;
    }
    superseded.add((snapshot.event as CanonicalEvent<"Supersession">).payload.supersedes_event_id);
  }
  return superseded;
}

function mapEventsByReference(events: readonly EventSnapshot[]): Map<string, EventSnapshot> {
  const byRef = new Map<string, EventSnapshot>();
  for (const snapshot of events) {
    byRef.set(snapshot.event_id, snapshot);
    if (snapshot.event_type === "EvidenceArtifact") {
      byRef.set(
        (snapshot.event as CanonicalEvent<"EvidenceArtifact">).payload.artifact_id,
        snapshot,
      );
    } else if (snapshot.event_type === "Observation") {
      byRef.set((snapshot.event as CanonicalEvent<"Observation">).payload.observation_id, snapshot);
    } else if (snapshot.event_type === "Claim") {
      byRef.set((snapshot.event as CanonicalEvent<"Claim">).payload.claim_id, snapshot);
    } else if (snapshot.event_type === "AcceptanceDecision") {
      byRef.set(
        (snapshot.event as CanonicalEvent<"AcceptanceDecision">).payload.decision_id,
        snapshot,
      );
    }
  }
  return byRef;
}

function mapAllDecisionsByClaimId(
  events: readonly EventSnapshot[],
): Map<string, EventSnapshotFor<"AcceptanceDecision">[]> {
  const decisions = new Map<string, EventSnapshotFor<"AcceptanceDecision">[]>();
  for (const snapshot of events) {
    if (snapshot.event_type !== "AcceptanceDecision") {
      continue;
    }
    const decision = snapshot as EventSnapshotFor<"AcceptanceDecision">;
    for (const claimRef of decision.event.payload.claim_refs) {
      decisions.set(claimRef, [...(decisions.get(claimRef) ?? []), decision]);
    }
  }
  return decisions;
}

function mapEligibleDecisionsByClaimId(
  events: readonly EventSnapshot[],
  policy: Pick<RenderPolicy, "erasedEventIds" | "supersededEventIds" | "eventsByReference">,
): Map<string, EventSnapshotFor<"AcceptanceDecision">[]> {
  const claimsByClaimId = new Map<string, EventSnapshotFor<"Claim">>();
  for (const snapshot of events) {
    if (snapshot.event_type === "Claim") {
      claimsByClaimId.set(
        (snapshot.event as CanonicalEvent<"Claim">).payload.claim_id,
        snapshot as EventSnapshotFor<"Claim">,
      );
    }
  }
  const decisions = new Map<string, EventSnapshotFor<"AcceptanceDecision">[]>();
  for (const snapshot of events) {
    if (snapshot.event_type !== "AcceptanceDecision") {
      continue;
    }
    if (
      policy.erasedEventIds.has(snapshot.event_id) ||
      policy.supersededEventIds.has(snapshot.event_id)
    ) {
      continue;
    }
    const decision = snapshot as EventSnapshotFor<"AcceptanceDecision">;
    for (const claimRef of decision.event.payload.claim_refs) {
      const claim = claimsByClaimId.get(claimRef);
      if (claim !== undefined && hasEligibleSupport(claim.event, policy)) {
        decisions.set(claimRef, [...(decisions.get(claimRef) ?? []), decision]);
      }
    }
  }
  return decisions;
}

function hasContradictionLineage(event: CanonicalEvent<"Claim">): boolean {
  return [...event.provenance, ...event.payload.support].some(
    (ref) => ref.relationship === "contradicts",
  );
}

function hasEligibleSupport(
  event: CanonicalEvent<"Claim">,
  policy: Pick<RenderPolicy, "erasedEventIds" | "supersededEventIds" | "eventsByReference">,
): boolean {
  for (const ref of [...event.provenance, ...event.payload.support]) {
    if (ref.ref_type === "external") {
      continue;
    }
    const snapshot = policy.eventsByReference.get(ref.ref_id);
    if (snapshot === undefined) {
      return false;
    }
    if (
      policy.erasedEventIds.has(snapshot.event_id) ||
      policy.supersededEventIds.has(snapshot.event_id)
    ) {
      return false;
    }
  }
  return true;
}

function renderYamlValue(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    return `\n${value.map((item) => `  - ${renderYamlScalar(item)}`).join("\n")}`;
  }
  return renderYamlScalar(value);
}

function renderYamlScalar(value: unknown): string {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("YAML scalar numbers must be finite");
    }
    return String(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (value === null) {
    return "null";
  }
  throw new Error("YAML front matter supports only scalar values and scalar lists");
}

function compareEventSnapshots(left: EventSnapshot, right: EventSnapshot): number {
  return (
    left.trust_zone_id.localeCompare(right.trust_zone_id) ||
    left.zone_sequence - right.zone_sequence ||
    left.event_id.localeCompare(right.event_id)
  );
}

function compareErasureSnapshots(left: LocalErasureSnapshot, right: LocalErasureSnapshot): number {
  return (
    left.trust_zone_id.localeCompare(right.trust_zone_id) ||
    left.zone_sequence - right.zone_sequence ||
    left.erasure_id.localeCompare(right.erasure_id)
  );
}

function compareLineage(left: ObsidianSourceLineage, right: ObsidianSourceLineage): number {
  return (
    left.source_kind.localeCompare(right.source_kind) ||
    left.source_id.localeCompare(right.source_id) ||
    (left.relationship ?? "").localeCompare(right.relationship ?? "")
  );
}

type EventSnapshotFor<TEventType extends CanonicalEvent["event_type"]> = Omit<
  LocalCanonicalEventSnapshot,
  "event" | "event_type"
> & {
  event_type: TEventType;
  event: CanonicalEvent<TEventType>;
};

type RenderPolicy = {
  erasedEventIds: ReadonlySet<string>;
  supersededEventIds: ReadonlySet<string>;
  eventsByReference: ReadonlyMap<string, EventSnapshot>;
  allDecisionsByClaimId: ReadonlyMap<string, EventSnapshotFor<"AcceptanceDecision">[]>;
  decisionsByClaimId: ReadonlyMap<string, EventSnapshotFor<"AcceptanceDecision">[]>;
};
