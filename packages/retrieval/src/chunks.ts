import type {
  CanonicalEvent,
  ErasureLedgerRecord,
  RetrievalChunk,
  RetrievalDerivation,
  RetrievalSourceRecord,
} from "@carpeos/schema";
import { validateConformance } from "@carpeos/schema";
import {
  erasureSourceRecord,
  eventSourceRecord,
  makeRetrievalDerivation,
  normalizeSourceRecords,
  RETRIEVAL_CHUNKER_VERSION,
  RETRIEVAL_PROJECTION_VERSION,
  sha256Hex,
  sha256Ref,
  stableJson,
} from "./provenance.js";

export type ChunkKind = RetrievalChunk["chunk_kind"];

export type BuildChunkInput = {
  chunkKind: ChunkKind;
  text: string;
  sourceRecords: readonly RetrievalSourceRecord[];
  derivation: RetrievalDerivation;
  trustZoneId?: string;
  lifecycleStatus?: RetrievalChunk["lifecycle_status"];
  epistemicAuthority?: RetrievalChunk["epistemic_authority"];
  status?: RetrievalChunk["status"];
  projectionVersion?: string;
  chunkerVersion?: string;
  chunkIndex?: number;
  createdAt?: string;
};

export type MeaningfulChunkInput = {
  events: readonly CanonicalEvent[];
  erasures?: readonly ErasureLedgerRecord[];
  config?: unknown;
  createdAt?: string;
};

export function makeChunkId(input: {
  sourceRecords: readonly RetrievalSourceRecord[];
  derivation: RetrievalDerivation;
  chunkIndex: number;
  chunkKind: ChunkKind;
  textDigest: string;
  projectionVersion: string;
  chunkerVersion: string;
}): string {
  const identity = {
    source_records: normalizeSourceRecords(input.sourceRecords),
    derivation: input.derivation,
    chunk_index: input.chunkIndex,
    chunk_kind: input.chunkKind,
    text_digest: input.textDigest,
    projection_version: input.projectionVersion,
    chunker_version: input.chunkerVersion,
  };

  return `chk_${sha256Hex(stableJson(identity)).slice(0, 40)}`;
}

export function buildRetrievalChunk(input: BuildChunkInput): RetrievalChunk {
  const sourceRecords = normalizeSourceRecords(input.sourceRecords);
  const trustZoneId = input.trustZoneId ?? sourceRecords[0]?.trust_zone_id;
  if (trustZoneId === undefined) {
    throw new Error("trust zone is required");
  }

  const text = normalizeChunkText(input.text);
  const textDigest = sha256Ref(text);
  const projectionVersion = input.projectionVersion ?? RETRIEVAL_PROJECTION_VERSION;
  const chunkerVersion = input.chunkerVersion ?? RETRIEVAL_CHUNKER_VERSION;
  const chunkIndex = input.chunkIndex ?? 0;
  const chunk: RetrievalChunk = {
    schema_version: "v1",
    record_type: "retrieval_chunk",
    chunk_id: makeChunkId({
      sourceRecords,
      derivation: input.derivation,
      chunkIndex,
      chunkKind: input.chunkKind,
      textDigest,
      projectionVersion,
      chunkerVersion,
    }),
    chunk_kind: input.chunkKind,
    trust_zone_id: trustZoneId,
    projection_version: projectionVersion,
    chunker_version: chunkerVersion,
    chunk_index: chunkIndex,
    text,
    text_digest: textDigest,
    source_records: sourceRecords,
    derivation: input.derivation,
    lifecycle_status: input.lifecycleStatus ?? deriveLifecycleStatus(sourceRecords),
    epistemic_authority: input.epistemicAuthority ?? deriveEpistemicAuthority(sourceRecords),
    status: input.status ?? "active",
    created_at: input.createdAt ?? latestRecordedAt(sourceRecords),
  };
  const conformance = validateConformance("retrievalProjection", chunk);
  if (!conformance.valid) {
    throw new Error(`invalid retrieval chunk: ${conformance.errors.join("; ")}`);
  }

  return chunk;
}

export function buildMeaningfulChunks(input: MeaningfulChunkInput): RetrievalChunk[] {
  const events = [...input.events].sort(compareCanonicalRecords);
  const erasures = [...(input.erasures ?? [])].sort(compareErasureRecords);
  const chunks: RetrievalChunk[] = [];
  const config = input.config ?? { policy: "meaningful_units_only" };

  const claims = events.filter(
    (event): event is CanonicalEvent<"Claim"> => event.event_type === "Claim",
  );
  for (const claim of claims) {
    const supportingEvents = relatedEventsForClaim(claim, events);
    const relatedErasures = erasures.filter((erasure) =>
      erasureTargetsAny(erasure, supportingEvents),
    );
    const sourceRecords = [
      eventSourceRecord(claim, "primary"),
      ...supportingEvents
        .filter((event) => event.event_id !== claim.event_id)
        .map((event) => eventSourceRecord(event, relationshipRoleForEvent(event))),
      ...relatedErasures.map((erasure) => erasureSourceRecord(erasure, "erasure")),
    ];
    chunks.push(
      buildRetrievalChunk(
        withCreatedAt(input.createdAt, {
          chunkKind: "claim",
          text: claim.payload.statement,
          sourceRecords,
          derivation: makeRetrievalDerivation({ sourceRecords, config }),
          chunkIndex: chunks.length,
        }),
      ),
    );
  }

  const decisions = events.filter(
    (event): event is CanonicalEvent<"AcceptanceDecision"> =>
      event.event_type === "AcceptanceDecision",
  );
  for (const decision of decisions) {
    const sourceRecords = [eventSourceRecord(decision, "primary")];
    chunks.push(
      buildRetrievalChunk(
        withCreatedAt(input.createdAt, {
          chunkKind: "decision",
          text: `${decision.payload.decision}: ${decision.payload.claim_refs.join(", ")}`,
          sourceRecords,
          derivation: makeRetrievalDerivation({ sourceRecords, config }),
          chunkIndex: chunks.length,
        }),
      ),
    );
  }

  const observations = events.filter(
    (event): event is CanonicalEvent<"Observation"> => event.event_type === "Observation",
  );
  for (const observation of observations) {
    const sourceRecords = [eventSourceRecord(observation, "primary")];
    chunks.push(
      buildRetrievalChunk(
        withCreatedAt(input.createdAt, {
          chunkKind: "summary",
          text: observation.payload.statement,
          sourceRecords,
          derivation: makeRetrievalDerivation({ sourceRecords, config }),
          chunkIndex: chunks.length,
        }),
      ),
    );
  }

  // Metadata-only evidence units (not raw hook/protected payloads). Aligns with
  // docs/guides/retrieval.md: claims, observations, decisions, selected evidence metadata.
  const evidenceArtifacts = events.filter(
    (event): event is CanonicalEvent<"EvidenceArtifact"> => event.event_type === "EvidenceArtifact",
  );
  for (const evidence of evidenceArtifacts) {
    const sourceRecords = [eventSourceRecord(evidence, "primary")];
    chunks.push(
      buildRetrievalChunk(
        withCreatedAt(input.createdAt, {
          chunkKind: "evidence_excerpt",
          text: formatEvidenceMetadataText(evidence),
          sourceRecords,
          derivation: makeRetrievalDerivation({ sourceRecords, config }),
          chunkIndex: chunks.length,
        }),
      ),
    );
  }

  return chunks;
}

/** Searchable metadata for EvidenceArtifact — never includes protected raw content. */
export function formatEvidenceMetadataText(event: CanonicalEvent<"EvidenceArtifact">): string {
  const { artifact_id, kind, media_type } = event.payload;
  return [
    "EvidenceArtifact",
    `kind=${kind}`,
    `media_type=${media_type}`,
    `artifact_id=${artifact_id}`,
    `subject_ref=${event.subject_ref}`,
    `event_id=${event.event_id}`,
  ].join(" ");
}

function withCreatedAt<T extends Omit<BuildChunkInput, "createdAt">>(
  createdAt: string | undefined,
  input: T,
): T | (T & { createdAt: string }) {
  return createdAt === undefined ? input : { ...input, createdAt };
}

export function normalizeChunkText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    throw new Error("chunk text must not be empty");
  }
  if (containsProtectedRawPayload(normalized)) {
    throw new Error("chunk text must not include protected raw payload material");
  }
  return normalized;
}

export function containsProtectedRawPayload(text: string): boolean {
  return /\b(?:ciphertext|plaintext|raw_payload|transcript_secret|local-aes256\.key)\b/i.test(text);
}

function relatedEventsForClaim(
  claim: CanonicalEvent<"Claim">,
  events: readonly CanonicalEvent[],
): CanonicalEvent[] {
  const supportIds = new Set(claim.payload.support.map((support) => support.ref_id));
  const claimIds = new Set([claim.payload.claim_id]);
  return events.filter((event) => {
    if (event.event_id === claim.event_id) {
      return true;
    }
    if (event.event_type === "Observation" && supportIds.has(event.payload.observation_id)) {
      return true;
    }
    if (
      event.event_type === "AcceptanceDecision" &&
      event.payload.claim_refs.some((claimRef) => claimIds.has(claimRef))
    ) {
      return true;
    }
    if (
      event.event_type === "Supersession" &&
      (event.payload.supersedes_event_id === claim.event_id ||
        event.payload.replacement_event_id === claim.event_id)
    ) {
      return true;
    }
    return false;
  });
}

function erasureTargetsAny(
  erasure: ErasureLedgerRecord,
  events: readonly CanonicalEvent[],
): boolean {
  const ids = new Set(events.map((event) => event.event_id));
  return erasure.target_ref.target_kind === "event" && ids.has(erasure.target_ref.target_id);
}

function relationshipRoleForEvent(
  event: CanonicalEvent,
): RetrievalSourceRecord["relationship_role"] {
  if (event.event_type === "AcceptanceDecision") {
    return "acceptance";
  }
  if (event.event_type === "Supersession") {
    return "supersession";
  }
  return "support";
}

function deriveLifecycleStatus(
  sourceRecords: readonly RetrievalSourceRecord[],
): RetrievalChunk["lifecycle_status"] {
  return sourceRecords.some((record) => record.lifecycle_status === "draft") ? "draft" : "active";
}

function deriveEpistemicAuthority(
  sourceRecords: readonly RetrievalSourceRecord[],
): RetrievalChunk["epistemic_authority"] {
  if (sourceRecords.some((record) => record.epistemic_authority === "verified")) {
    return "verified";
  }
  if (sourceRecords.some((record) => record.epistemic_authority === "derived")) {
    return "derived";
  }
  return (
    sourceRecords.find((record) => record.epistemic_authority !== undefined)?.epistemic_authority ??
    "derived"
  );
}

function latestRecordedAt(sourceRecords: readonly RetrievalSourceRecord[]): string {
  return sourceRecords
    .map((record) => record.recorded_time.start)
    .sort((left, right) => right.localeCompare(left))[0] as string;
}

function compareCanonicalRecords(left: CanonicalEvent, right: CanonicalEvent): number {
  return (
    (left.zone_sequence ?? 0) - (right.zone_sequence ?? 0) ||
    left.event_id.localeCompare(right.event_id)
  );
}

function compareErasureRecords(left: ErasureLedgerRecord, right: ErasureLedgerRecord): number {
  return (
    (left.zone_sequence ?? 0) - (right.zone_sequence ?? 0) ||
    left.erasure_id.localeCompare(right.erasure_id)
  );
}
