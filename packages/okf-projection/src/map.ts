import type { CanonicalEvent, ErasureLedgerRecord } from "@carpeos/schema";
import { renderRootIndex, renderRootLog } from "./render.js";
import type {
  OkfConceptFile,
  OkfFrontmatter,
  OkfMapConfig,
  OkfMapInput,
  OkfMapResult,
  OkfOmission,
  OkfSourceEntry,
} from "./types.js";
import { compareText, oneLine, safePathSegment, toOkfActor } from "./utils.js";

const PROJECTION_VERSION = "okf-export/v1" as const;
const OKF_VERSION = "0.2" as const;
const NON_AUTH_MARKER =
  "Generated non-authoritative CarpeOS projection. Editing this file has no canonical effect.";

/**
 * Pure mapper: CarpeOS events → OKF concept files + index/log markdown.
 * Does not touch the filesystem (K1). K2 will write these under a manifest.
 */
export function mapEventsToOkf(input: OkfMapInput, config: OkfMapConfig): OkfMapResult {
  const visibleZones = new Set(config.visibleTrustZoneIds);
  const includeHeld = config.includeHeld === true;
  const includeReferencedEvidence = config.includeReferencedEvidence !== false;
  const generatedBy = config.generatedBy ?? "carpeos/okf-export/v1";
  const generatedAt = config.generatedAt;

  const omissions: OkfOmission[] = [];
  const erasedEventIds = collectErasedEventIds(input.erasures ?? [], visibleZones);

  const visibleEvents = input.events.filter((row) => {
    if (!visibleZones.has(row.trust_zone_id)) {
      omissions.push({
        event_id: row.event_id,
        event_type: row.event_type,
        reason: "wrong_trust_zone",
      });
      return false;
    }
    if (erasedEventIds.has(row.event_id)) {
      omissions.push({
        event_id: row.event_id,
        event_type: row.event_type,
        reason: "erased",
      });
      return false;
    }
    return true;
  });

  const byEventId = new Map(visibleEvents.map((row) => [row.event_id, row.event]));
  const claims = visibleEvents.filter(
    (row): row is typeof row & { event: CanonicalEvent<"Claim"> } =>
      row.event.event_type === "Claim",
  );
  const observations = visibleEvents.filter(
    (row): row is typeof row & { event: CanonicalEvent<"Observation"> } =>
      row.event.event_type === "Observation",
  );
  const decisions = visibleEvents.filter(
    (row): row is typeof row & { event: CanonicalEvent<"AcceptanceDecision"> } =>
      row.event.event_type === "AcceptanceDecision",
  );
  const evidence = visibleEvents.filter(
    (row): row is typeof row & { event: CanonicalEvent<"EvidenceArtifact"> } =>
      row.event.event_type === "EvidenceArtifact",
  );
  const supersessions = visibleEvents.filter(
    (row): row is typeof row & { event: CanonicalEvent<"Supersession"> } =>
      row.event.event_type === "Supersession",
  );

  const acceptedByClaimId = mapAcceptedDecisions(decisions.map((row) => row.event));
  const rejectedClaimIds = mapRejectedClaimIds(decisions.map((row) => row.event));
  const supersededEventIds = new Set(
    supersessions.map((row) => row.event.payload.supersedes_event_id),
  );

  const concepts: OkfConceptFile[] = [];
  const referencedEvidenceIds = new Set<string>();
  const exportedEventIds = new Set<string>();

  for (const row of claims) {
    const claim = row.event;
    const claimId = claim.payload.claim_id;
    if (rejectedClaimIds.has(claimId)) {
      omissions.push({
        event_id: claim.event_id,
        event_type: "Claim",
        reason: "rejected",
      });
      continue;
    }
    const acceptance = acceptedByClaimId.get(claimId);
    if (acceptance === undefined) {
      // Claims without accepted lineage never become OKF concepts in 3.1
      // (includeHeld applies to Observations only).
      omissions.push({
        event_id: claim.event_id,
        event_type: "Claim",
        reason:
          claim.lifecycle_status === "draft" ? "draft_claim_excluded" : "acceptance_missing",
      });
      continue;
    }

    const path = `decisions/${safePathSegment(claimId)}.md`;
    const status = supersededEventIds.has(claim.event_id) ? "deprecated" : "stable";
    const sources = claimSources(claim, acceptance, byEventId, referencedEvidenceIds);
    const fm = baseFrontmatter({
      type: "Accepted Decision",
      title: `Decision: ${claimId}`,
      description: oneLine(claim.payload.statement),
      status,
      generatedBy,
      generatedAt,
      event: claim,
      extra: {
        carpeos_claim_id: claimId,
        carpeos_decision_id: acceptance.payload.decision_id,
      },
      verified: [
        {
          by: toOkfActor(acceptance.payload.decided_by),
          at: acceptance.payload.decided_at,
        },
      ],
      sources,
    });
    const body = [
      `# ${fm.title}`,
      "",
      NON_AUTH_MARKER,
      "",
      "## Statement",
      "",
      claim.payload.statement,
      "",
      "## Acceptance",
      "",
      `- Decision: \`${acceptance.payload.decision}\``,
      `- Decided by: \`${acceptance.payload.decided_by}\``,
      `- Decided at: \`${acceptance.payload.decided_at}\``,
      acceptance.payload.rationale
        ? `- Rationale: ${acceptance.payload.rationale}`
        : undefined,
      "",
      "## Claim type",
      "",
      `\`${claim.payload.claim_type}\``,
      "",
      renderSourceSection(sources),
    ]
      .filter((line): line is string => line !== undefined)
      .join("\n");

    concepts.push({ path, frontmatter: fm, body });
    exportedEventIds.add(claim.event_id);
    exportedEventIds.add(acceptance.event_id);
  }

  // Acceptance events without a mapped claim are informational omissions.
  for (const row of decisions) {
    if (exportedEventIds.has(row.event_id)) continue;
    const decision = row.event.payload.decision;
    if (decision === "rejected") {
      omissions.push({
        event_id: row.event_id,
        event_type: "AcceptanceDecision",
        reason: "rejected",
      });
      continue;
    }
    if (decision !== "accepted") {
      omissions.push({
        event_id: row.event_id,
        event_type: "AcceptanceDecision",
        reason: "acceptance_not_accepted",
      });
      continue;
    }
    // accepted but claim missing/erased
    omissions.push({
      event_id: row.event_id,
      event_type: "AcceptanceDecision",
      reason: "acceptance_missing",
    });
  }

  for (const row of observations) {
    const observation = row.event;
    const isDraft = observation.lifecycle_status === "draft";
    if (isDraft && !includeHeld) {
      omissions.push({
        event_id: observation.event_id,
        event_type: "Observation",
        reason: "held_excluded",
      });
      continue;
    }

    const obsId = observation.payload.observation_id;
    const path = isDraft
      ? `drafts/${safePathSegment(obsId)}.md`
      : `observations/${safePathSegment(obsId)}.md`;
    const type = isDraft ? "Draft Observation" : "Observation";
    const status = isDraft
      ? "draft"
      : supersededEventIds.has(observation.event_id)
        ? "deprecated"
        : "stable";

    for (const ref of observation.payload.evidence_artifact_refs) {
      referencedEvidenceIds.add(ref);
    }

    const sources = observationSources(observation, byEventId, referencedEvidenceIds);
    const fm = baseFrontmatter({
      type,
      title: `Observation: ${obsId}`,
      description: oneLine(observation.payload.statement),
      status,
      generatedBy,
      generatedAt,
      event: observation,
      extra: { carpeos_observation_id: obsId },
      sources,
    });
    const body = [
      `# ${fm.title}`,
      "",
      NON_AUTH_MARKER,
      "",
      "## Statement",
      "",
      observation.payload.statement,
      "",
      renderSourceSection(sources),
    ].join("\n");

    concepts.push({ path, frontmatter: fm, body });
    exportedEventIds.add(observation.event_id);
  }

  if (includeReferencedEvidence) {
    for (const row of evidence) {
      const artifact = row.event;
      const artifactId = artifact.payload.artifact_id;
      if (!referencedEvidenceIds.has(artifactId)) {
        omissions.push({
          event_id: artifact.event_id,
          event_type: "EvidenceArtifact",
          reason: "orphan_evidence",
        });
        continue;
      }
      const path = `evidence/${safePathSegment(artifactId)}.md`;
      const fm = baseFrontmatter({
        type: "Evidence Summary",
        title: `Evidence: ${artifactId}`,
        description: `Safe metadata for ${artifact.payload.kind} (${artifact.payload.media_type}).`,
        status: "stable",
        generatedBy,
        generatedAt,
        event: artifact,
        extra: { carpeos_artifact_id: artifactId },
      });
      const body = [
        `# ${fm.title}`,
        "",
        NON_AUTH_MARKER,
        "",
        "## Evidence Metadata",
        "",
        `- Artifact id: \`${artifactId}\``,
        `- Kind: \`${artifact.payload.kind}\``,
        `- Media type: \`${artifact.payload.media_type}\``,
        `- Content reference: \`${artifact.payload.content_ref.ref_type}\``,
        "",
        "Body content and protected plaintext are not exported.",
        "",
      ].join("\n");
      concepts.push({ path, frontmatter: fm, body });
      exportedEventIds.add(artifact.event_id);
    }
  }

  for (const row of supersessions) {
    const supersession = row.event;
    const targetId = supersession.payload.supersedes_event_id;
    if (!exportedEventIds.has(targetId) && !byEventId.has(targetId)) {
      // Target may still be in concepts via claim id path — check if target was exported.
    }
    const targetExported =
      exportedEventIds.has(targetId) ||
      concepts.some((c) => c.frontmatter.carpeos_event_id === targetId);
    if (!targetExported) {
      omissions.push({
        event_id: supersession.event_id,
        event_type: "Supersession",
        reason: "supersession_target_missing",
      });
      continue;
    }

    const sid = supersession.payload.supersession_id;
    const path = `lineage/${safePathSegment(sid)}.md`;
    const targetPath = concepts.find((c) => c.frontmatter.carpeos_event_id === targetId)?.path;
    const sources: OkfSourceEntry[] = targetPath
      ? [
          {
            id: "superseded",
            resource: `/${targetPath}`,
            title: "Superseded concept",
          },
        ]
      : [];
    const fm = baseFrontmatter({
      type: "Supersession",
      title: `Supersession: ${sid}`,
      description: oneLine(supersession.payload.reason),
      status: "stable",
      generatedBy,
      generatedAt,
      event: supersession,
      extra: { carpeos_supersession_id: sid },
      sources,
    });
    const body = [
      `# ${fm.title}`,
      "",
      NON_AUTH_MARKER,
      "",
      "## Supersession",
      "",
      `- Supersedes event: \`${targetId}\``,
      targetPath ? `- Supersedes concept: [link](/${targetPath})` : undefined,
      `- Replacement event: \`${supersession.payload.replacement_event_id ?? "none"}\``,
      `- Reason: ${supersession.payload.reason}`,
      "",
    ]
      .filter((line): line is string => line !== undefined)
      .join("\n");
    concepts.push({ path, frontmatter: fm, body });
  }

  concepts.sort((left, right) => compareText(left.path, right.path));
  omissions.sort((left, right) => compareText(left.event_id, right.event_id));

  const logInput: { generatedAt: string; conceptCount: number; note?: string } = {
    generatedAt,
    conceptCount: concepts.length,
  };
  if (config.exportNote !== undefined) {
    logInput.note = config.exportNote;
  }

  return {
    concepts,
    indexMarkdown: renderRootIndex({ okfVersion: OKF_VERSION, concepts }),
    logMarkdown: renderRootLog(logInput),
    omissions,
    okfVersion: OKF_VERSION,
    projectionVersion: PROJECTION_VERSION,
  };
}

function collectErasedEventIds(
  erasures: readonly { trust_zone_id: string; erasure: ErasureLedgerRecord }[],
  visibleZones: ReadonlySet<string>,
): Set<string> {
  const erased = new Set<string>();
  for (const row of erasures) {
    if (!visibleZones.has(row.trust_zone_id)) continue;
    const target = row.erasure.target_ref;
    if (target.target_kind === "event") {
      erased.add(target.target_id);
    }
  }
  return erased;
}

function mapAcceptedDecisions(
  decisions: readonly CanonicalEvent<"AcceptanceDecision">[],
): Map<string, CanonicalEvent<"AcceptanceDecision">> {
  const map = new Map<string, CanonicalEvent<"AcceptanceDecision">>();
  for (const decision of decisions) {
    if (decision.payload.decision !== "accepted") continue;
    for (const claimRef of decision.payload.claim_refs) {
      const existing = map.get(claimRef);
      if (existing === undefined || decision.payload.decided_at > existing.payload.decided_at) {
        map.set(claimRef, decision);
      }
    }
  }
  return map;
}

function mapRejectedClaimIds(
  decisions: readonly CanonicalEvent<"AcceptanceDecision">[],
): Set<string> {
  const rejected = new Set<string>();
  for (const decision of decisions) {
    if (decision.payload.decision !== "rejected") continue;
    for (const claimRef of decision.payload.claim_refs) {
      rejected.add(claimRef);
    }
  }
  return rejected;
}

function baseFrontmatter(input: {
  type: OkfFrontmatter["type"];
  title: string;
  description?: string;
  status: NonNullable<OkfFrontmatter["status"]>;
  generatedBy: string;
  generatedAt: string;
  event: CanonicalEvent;
  extra?: Partial<
    Pick<
      OkfFrontmatter,
      | "carpeos_claim_id"
      | "carpeos_observation_id"
      | "carpeos_artifact_id"
      | "carpeos_decision_id"
      | "carpeos_supersession_id"
    >
  >;
  verified?: OkfFrontmatter["verified"];
  sources?: OkfSourceEntry[];
}): OkfFrontmatter {
  const fm: OkfFrontmatter = {
    type: input.type,
    title: input.title,
    status: input.status,
    generated: { by: input.generatedBy, at: input.generatedAt },
    carpeos_projection: true,
    canonical_effect: "none",
    carpeos_event_id: input.event.event_id,
    carpeos_event_type: input.event.event_type,
    carpeos_trust_zone_id: input.event.trust_zone.trust_zone_id,
  };
  if (input.description !== undefined) {
    fm.description = input.description;
  }
  if (input.verified !== undefined && input.verified.length > 0) {
    fm.verified = input.verified;
  }
  if (input.sources !== undefined && input.sources.length > 0) {
    fm.sources = input.sources;
  }
  if (input.extra?.carpeos_claim_id !== undefined) {
    fm.carpeos_claim_id = input.extra.carpeos_claim_id;
  }
  if (input.extra?.carpeos_observation_id !== undefined) {
    fm.carpeos_observation_id = input.extra.carpeos_observation_id;
  }
  if (input.extra?.carpeos_artifact_id !== undefined) {
    fm.carpeos_artifact_id = input.extra.carpeos_artifact_id;
  }
  if (input.extra?.carpeos_decision_id !== undefined) {
    fm.carpeos_decision_id = input.extra.carpeos_decision_id;
  }
  if (input.extra?.carpeos_supersession_id !== undefined) {
    fm.carpeos_supersession_id = input.extra.carpeos_supersession_id;
  }
  return fm;
}

function claimSources(
  claim: CanonicalEvent<"Claim">,
  acceptance: CanonicalEvent<"AcceptanceDecision">,
  byEventId: ReadonlyMap<string, CanonicalEvent>,
  referencedEvidenceIds: Set<string>,
): OkfSourceEntry[] {
  const sources: OkfSourceEntry[] = [
    {
      id: "acceptance",
      resource: `carpeos:event:${acceptance.event_id}`,
      title: "Acceptance decision",
      author: toOkfActor(acceptance.payload.decided_by),
    },
  ];
  for (const ref of claim.payload.support) {
    if (ref.ref_type === "observation") {
      const obsEvent = findObservationById(byEventId, ref.ref_id);
      if (obsEvent) {
        sources.push({
          id: `support-${ref.ref_id}`,
          resource: `/observations/${safePathSegment(ref.ref_id)}.md`,
          title: `Observation ${ref.ref_id}`,
        });
        for (const evidenceId of obsEvent.payload.evidence_artifact_refs) {
          referencedEvidenceIds.add(evidenceId);
        }
      } else {
        sources.push({
          id: `support-${ref.ref_id}`,
          resource: `carpeos:observation:${ref.ref_id}`,
          title: `Observation ${ref.ref_id}`,
        });
      }
    } else if (ref.ref_type === "artifact") {
      referencedEvidenceIds.add(ref.ref_id);
      sources.push({
        id: `support-${ref.ref_id}`,
        resource: `/evidence/${safePathSegment(ref.ref_id)}.md`,
        title: `Evidence ${ref.ref_id}`,
      });
    } else {
      sources.push({
        id: `support-${ref.ref_type}-${ref.ref_id}`,
        resource: `carpeos:${ref.ref_type}:${ref.ref_id}`,
        title: `${ref.ref_type} ${ref.ref_id}`,
      });
    }
  }
  return sources;
}

function observationSources(
  observation: CanonicalEvent<"Observation">,
  byEventId: ReadonlyMap<string, CanonicalEvent>,
  referencedEvidenceIds: Set<string>,
): OkfSourceEntry[] {
  const sources: OkfSourceEntry[] = [];
  for (const evidenceId of observation.payload.evidence_artifact_refs) {
    referencedEvidenceIds.add(evidenceId);
    const evidenceEvent = findEvidenceByArtifactId(byEventId, evidenceId);
    sources.push({
      id: `evidence-${evidenceId}`,
      resource: `/evidence/${safePathSegment(evidenceId)}.md`,
      title: evidenceEvent
        ? `Evidence ${evidenceId}`
        : `Evidence ${evidenceId} (metadata only)`,
    });
  }
  return sources;
}

function findObservationById(
  byEventId: ReadonlyMap<string, CanonicalEvent>,
  observationId: string,
): CanonicalEvent<"Observation"> | undefined {
  for (const event of byEventId.values()) {
    if (event.event_type === "Observation" && event.payload.observation_id === observationId) {
      return event;
    }
  }
  return undefined;
}

function findEvidenceByArtifactId(
  byEventId: ReadonlyMap<string, CanonicalEvent>,
  artifactId: string,
): CanonicalEvent<"EvidenceArtifact"> | undefined {
  for (const event of byEventId.values()) {
    if (event.event_type === "EvidenceArtifact" && event.payload.artifact_id === artifactId) {
      return event;
    }
  }
  return undefined;
}

function renderSourceSection(sources: readonly OkfSourceEntry[]): string {
  if (sources.length === 0) {
    return "## Sources\n\n_None recorded._\n";
  }
  const lines = ["## Sources", ""];
  for (const source of sources) {
    lines.push(`- \`${source.id}\`: ${source.resource}${source.title ? ` — ${source.title}` : ""}`);
  }
  lines.push("");
  return lines.join("\n");
}


