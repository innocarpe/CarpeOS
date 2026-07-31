import type {
  CanonicalEvent,
  EmbeddingRecord,
  ErasureLedgerRecord,
  ProjectionFreshness,
  RetrievalChunk,
  RetrievalOrigin,
  RetrievalQuery,
  RetrievalResult,
} from "@carpeos/schema";
import { validateConformance } from "@carpeos/schema";
import { buildMeaningfulChunks } from "./chunks.js";
import { rebuildGraphProjection, walkGraphNeighborhood } from "./graph-projection.js";
import {
  defaultEmbeddingProvider,
  isVectorCompatibleWithProvider,
  type EmbeddingProvider,
} from "./embedding-provider.js";
import { RETRIEVAL_PROJECTION_VERSION, sha256Ref, stableJson } from "./provenance.js";
import { searchMemory } from "./query.js";

export type SqlStatement = {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};

export type SqlDatabase = {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
};

export type RebuildRetrievalIndexResult = {
  chunks: RetrievalChunk[];
  freshness: ProjectionFreshness[];
};

type EventRow = {
  event_id: string;
  event_json: string;
  local_sequence?: number;
  zone_sequence?: number;
};

type ErasureRow = {
  erasure_json: string;
};

type CursorRow = {
  trust_zone_id: string;
  after_sequence: number;
};

type ChunkRow = {
  chunk_json: string;
};

type VectorRow = {
  chunk_id: string;
  vector_json: string;
  embedding_model: string;
  embedding_version: string;
  pooling: string;
};

export function assertSupportedLocalIndexRuntime(): void {
  const [major = 0, minor = 0, patch = 0] = process.versions.node
    .split(".")
    .map((part) => Number(part));
  if (major < 22 || (major === 22 && (minor < 22 || (minor === 22 && patch < 0)))) {
    throw new Error("Node >=22.22.0 is required for local retrieval FTS5 indexing");
  }
}

/** Retrieval-projection migration applied into the same local SQLite home DB. */
export const RETRIEVAL_LOCAL_INDEX_MIGRATION_ID = "003_retrieval_local_index" as const;

export function migrateLocalRetrievalIndex(db: SqlDatabase, appliedAt = new Date()): void {
  assertSupportedLocalIndexRuntime();
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS retrieval_chunks (
      chunk_id TEXT PRIMARY KEY,
      trust_zone_id TEXT NOT NULL,
      projection_version TEXT NOT NULL,
      chunk_kind TEXT NOT NULL,
      lifecycle_status TEXT NOT NULL,
      epistemic_authority TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'stale', 'projection_deleted')),
      max_zone_sequence INTEGER NOT NULL,
      text TEXT NOT NULL,
      chunk_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projection_freshness (
      projection_name TEXT NOT NULL,
      projection_version TEXT NOT NULL,
      trust_zone_id TEXT NOT NULL,
      freshness_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (projection_name, projection_version, trust_zone_id)
    );
    CREATE TABLE IF NOT EXISTS local_vectors (
      chunk_id TEXT PRIMARY KEY REFERENCES retrieval_chunks(chunk_id) ON DELETE CASCADE,
      vector_json TEXT NOT NULL,
      vector_digest TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      embedding_version TEXT NOT NULL,
      pooling TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  try {
    db.exec(
      "CREATE VIRTUAL TABLE IF NOT EXISTS retrieval_chunks_fts USING fts5(chunk_id UNINDEXED, text)",
    );
  } catch (error) {
    throw new Error("FTS5_UNAVAILABLE", { cause: error });
  }

  db.prepare(
    "INSERT OR IGNORE INTO schema_migrations (migration_id, applied_at) VALUES (?, ?)",
  ).run(RETRIEVAL_LOCAL_INDEX_MIGRATION_ID, appliedAt.toISOString());
}

export function rebuildLocalRetrievalIndex(
  db: SqlDatabase,
  now = new Date(),
): RebuildRetrievalIndexResult {
  migrateLocalRetrievalIndex(db, now);
  const events = readCanonicalEventsForProjection(db);
  const erasures = readErasuresForProjection(db);
  const origins = readCaptureOriginsForProjection(db);
  const chunks = buildMeaningfulChunks({ events, erasures, createdAt: now.toISOString() })
    .map((chunk) => applyProjectionStatus(chunk))
    .map((chunk) => attachChunkOrigin(chunk, events, origins));
  const currentIds = new Set(chunks.map((chunk) => chunk.chunk_id));
  const existing = db.prepare("SELECT chunk_json FROM retrieval_chunks").all() as ChunkRow[];

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of existing) {
      const chunk = JSON.parse(row.chunk_json) as RetrievalChunk;
      if (!currentIds.has(chunk.chunk_id)) {
        writeChunk(db, { ...chunk, status: "stale" }, now);
      }
    }
    for (const chunk of chunks) {
      writeChunk(db, chunk, now);
    }
    replaceFts(db, chunks);
    // Graph projection is rebuildable and non-authoritative (ADR 0013).
    rebuildGraphProjection(db, { events, erasures, now, transactional: false });
    // Freshness advances by max scanned event sequence for the zone, not only
    // sequences that produced chunks (capture-only homes used to stay stale).
    const freshness = writeFreshness(db, chunks, now, events);
    db.exec("COMMIT");
    return { chunks, freshness };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function storeLocalVector(
  db: SqlDatabase,
  input: {
    record: EmbeddingRecord;
    vector: readonly number[];
  },
): void {
  const conformance = validateConformance("retrievalProjection", input.record);
  if (!conformance.valid) {
    throw new Error(`invalid embedding record: ${conformance.errors.join("; ")}`);
  }
  assertVectorIntegrity(
    input.vector,
    input.record.vector_digest,
    input.record.provenance.embedding_dimensions,
  );
  db.prepare(`
    INSERT INTO local_vectors (
      chunk_id, vector_json, vector_digest, embedding_model, embedding_version, pooling, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chunk_id) DO UPDATE SET
      vector_json=excluded.vector_json,
      vector_digest=excluded.vector_digest,
      embedding_model=excluded.embedding_model,
      embedding_version=excluded.embedding_version,
      pooling=excluded.pooling,
      created_at=excluded.created_at
  `).run(
    input.record.chunk_id,
    stableJson(input.vector),
    input.record.vector_digest,
    input.record.provenance.embedding_model,
    input.record.provenance.embedding_version,
    input.record.provenance.pooling,
    input.record.created_at,
  );
}

export function assertVectorIntegrity(
  vector: readonly number[],
  expectedDigest: string,
  dimensions = 768,
): void {
  if (vector.length !== dimensions) {
    throw new Error(
      `embedding vector dimension mismatch: expected ${dimensions}, got ${vector.length}`,
    );
  }
  if (!vector.every((value) => Number.isFinite(value))) {
    throw new Error("embedding vector must contain only finite numbers");
  }
  const digest = vectorDigest(vector);
  if (digest !== expectedDigest) {
    throw new Error("embedding vector digest mismatch");
  }
}

export function vectorDigest(vector: readonly number[]): `sha-256:${string}` {
  return sha256Ref(stableJson(vector));
}

export function searchLocalRetrievalIndex(
  db: SqlDatabase,
  input: {
    query: RetrievalQuery;
    events?: readonly CanonicalEvent[];
    erasures?: readonly ErasureLedgerRecord[];
    /** Defaults to the offline local-lexical-hash product provider. */
    embeddingProvider?: EmbeddingProvider;
  },
): RetrievalResult {
  migrateLocalRetrievalIndex(db);
  const provider = input.embeddingProvider ?? defaultEmbeddingProvider();
  // Over-fetch candidates so hybrid rank can prefer Observation/Claim over
  // recent evidence_excerpt rows that share FTS tokens.
  const candidateLimit = Math.max(input.query.limit * 4, 32);
  const ftsChunkIds = ftsCandidateChunkIds(db, input.query, candidateLimit);
  const structuredChunkIds = structuredCandidateChunkIds(db, input.query, candidateLimit);
  const seedChunkIds = [...new Set([...ftsChunkIds, ...structuredChunkIds])].sort();
  const seedChunks = readChunks(db, seedChunkIds);
  const { chunkIds, graphProximity } = expandChunksWithGraphNeighborhood(db, seedChunks, {
    visibleTrustZoneIds: input.query.filters.visible_trust_zone_ids,
    maxDepth: 2,
    maxNodes: Math.max(candidateLimit, 64),
  });
  const chunks = readChunks(db, chunkIds);
  const storedVectors = readVectors(db, chunkIds, provider);
  const queryVector = embedSync(provider, input.query.query_text);
  const semanticScores = new Map(
    chunks.map((chunk) => {
      const stored = storedVectors.get(chunk.chunk_id);
      const vector = stored ?? embedSync(provider, chunk.text);
      return [chunk.chunk_id, cosine(queryVector, vector)] as const;
    }),
  );
  return searchMemory({
    query: input.query,
    chunks,
    events: input.events ?? readCanonicalEventsForProjection(db),
    erasures: input.erasures ?? readErasuresForProjection(db),
    freshness: readFreshness(db),
    semanticScores,
    graphProximity,
    embeddingProvider: {
      id: provider.info.id,
      model: provider.info.model,
      version: provider.info.version,
      dimensions: provider.info.dimensions,
      semantic_quality: provider.info.semantic_quality,
    },
  });
}

/**
 * Expand hybrid seeds with a bounded graph neighborhood.
 *
 * Graph structure only adds candidates and proximity ranks; acceptance is never
 * implied (ADR 0013). Missing graph tables/nodes fail open to seeds only.
 */
function expandChunksWithGraphNeighborhood(
  db: SqlDatabase,
  seedChunks: readonly RetrievalChunk[],
  options: {
    visibleTrustZoneIds: readonly string[];
    maxDepth: number;
    maxNodes: number;
  },
): { chunkIds: string[]; graphProximity: Map<string, number> } {
  const graphProximity = new Map<string, number>();
  const eventToChunks = new Map<string, string[]>();
  for (const chunk of seedChunks) {
    graphProximity.set(chunk.chunk_id, 0);
    for (const record of chunk.source_records) {
      if (record.source_record_kind !== "event") continue;
      const list = eventToChunks.get(record.source_record_id) ?? [];
      list.push(chunk.chunk_id);
      eventToChunks.set(record.source_record_id, list);
    }
  }

  const seedEventIds = [...eventToChunks.keys()].sort();
  const discoveredEventHops = new Map<string, number>();
  for (const eventId of seedEventIds) {
    discoveredEventHops.set(eventId, 0);
    try {
      const walk = walkGraphNeighborhood(db, {
        root_id: eventId,
        max_depth: options.maxDepth,
        max_nodes: options.maxNodes,
        visible_trust_zone_ids: options.visibleTrustZoneIds,
      });
      for (const node of walk.nodes) {
        const eventIdFromNode =
          node.source_event_id ??
          (node.node_id.startsWith("evt:") ? node.node_id.slice(4) : undefined);
        if (eventIdFromNode === undefined) continue;
        // Approximate hop: 0 for seeds, 1 otherwise within this walk budget.
        const hop = eventIdFromNode === eventId ? 0 : 1;
        const prev = discoveredEventHops.get(eventIdFromNode);
        if (prev === undefined || hop < prev) {
          discoveredEventHops.set(eventIdFromNode, hop);
        }
      }
    } catch {
      // Graph not ready; keep seeds only.
    }
  }

  // Pull chunks whose primary/source event appears in the neighborhood.
  const extraChunkIds = new Set<string>(seedChunks.map((chunk) => chunk.chunk_id));
  if (discoveredEventHops.size > 0) {
    const allChunkRows = db
      .prepare(
        `SELECT chunk_id, chunk_json FROM retrieval_chunks
         WHERE status IN ('active', 'projection_deleted')`,
      )
      .all() as Array<{ chunk_id: string; chunk_json: string }>;
    const visibleZones = new Set(options.visibleTrustZoneIds);
    for (const row of allChunkRows) {
      const chunk = JSON.parse(row.chunk_json) as RetrievalChunk;
      if (!visibleZones.has(chunk.trust_zone_id)) {
        continue;
      }
      // Do not pull lineage that itself references non-visible zones.
      if (
        chunk.source_records.some(
          (record) =>
            record.source_record_kind === "event" && !visibleZones.has(record.trust_zone_id),
        )
      ) {
        continue;
      }
      let bestHop: number | undefined;
      for (const record of chunk.source_records) {
        if (record.source_record_kind !== "event") continue;
        const hop = discoveredEventHops.get(record.source_record_id);
        if (hop === undefined) continue;
        bestHop = bestHop === undefined ? hop : Math.min(bestHop, hop);
      }
      if (bestHop === undefined) continue;
      extraChunkIds.add(chunk.chunk_id);
      const prev = graphProximity.get(chunk.chunk_id);
      if (prev === undefined || bestHop < prev) {
        graphProximity.set(chunk.chunk_id, bestHop);
      }
    }
  }

  return {
    chunkIds: [...extraChunkIds].sort(),
    graphProximity,
  };
}

/** Sync-only path for local providers; async model-backed adapters come later. */
function embedSync(provider: EmbeddingProvider, text: string): number[] {
  const value = provider.embed(text);
  if (value instanceof Promise) {
    throw new Error(
      `embedding provider "${provider.info.id}" returned a Promise; async providers are not wired in the local search path yet`,
    );
  }
  return value;
}

function readCanonicalEventsForProjection(db: SqlDatabase): CanonicalEvent[] {
  const rows = [
    ...(db
      .prepare("SELECT event_id, event_json, local_sequence FROM canonical_events")
      .all() as EventRow[]),
    ...(db
      .prepare("SELECT event_id, event_json, zone_sequence FROM sync_inbox_events")
      .all() as EventRow[]),
  ];
  const byId = new Map<string, CanonicalEvent>();
  for (const row of rows.sort((left, right) => left.event_id.localeCompare(right.event_id))) {
    if (byId.has(row.event_id)) {
      continue;
    }
    const event = JSON.parse(row.event_json) as CanonicalEvent;
    byId.set(row.event_id, {
      ...event,
      zone_sequence: event.zone_sequence ?? row.zone_sequence ?? row.local_sequence ?? 0,
    });
  }
  return [...byId.values()].sort(
    (left, right) =>
      (left.zone_sequence ?? 0) - (right.zone_sequence ?? 0) ||
      left.event_id.localeCompare(right.event_id),
  );
}

function readErasuresForProjection(db: SqlDatabase): ErasureLedgerRecord[] {
  return (db.prepare("SELECT erasure_json FROM sync_inbox_erasures").all() as ErasureRow[])
    .map((row) => JSON.parse(row.erasure_json) as ErasureLedgerRecord)
    .sort(
      (left, right) =>
        (left.zone_sequence ?? 0) - (right.zone_sequence ?? 0) ||
        left.erasure_id.localeCompare(right.erasure_id),
    );
}

function writeChunk(db: SqlDatabase, chunk: RetrievalChunk, now: Date): void {
  const conformance = validateConformance("retrievalProjection", chunk);
  if (!conformance.valid) {
    throw new Error(`invalid retrieval chunk: ${conformance.errors.join("; ")}`);
  }
  db.prepare(`
    INSERT INTO retrieval_chunks (
      chunk_id, trust_zone_id, projection_version, chunk_kind, lifecycle_status,
      epistemic_authority, status, max_zone_sequence, text, chunk_json, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chunk_id) DO UPDATE SET
      trust_zone_id=excluded.trust_zone_id,
      projection_version=excluded.projection_version,
      chunk_kind=excluded.chunk_kind,
      lifecycle_status=excluded.lifecycle_status,
      epistemic_authority=excluded.epistemic_authority,
      status=excluded.status,
      max_zone_sequence=excluded.max_zone_sequence,
      text=excluded.text,
      chunk_json=excluded.chunk_json,
      updated_at=excluded.updated_at
  `).run(
    chunk.chunk_id,
    chunk.trust_zone_id,
    chunk.projection_version,
    chunk.chunk_kind,
    chunk.lifecycle_status,
    chunk.epistemic_authority,
    chunk.status,
    Math.max(...chunk.source_records.map((record) => record.zone_sequence)),
    chunk.text,
    stableJson(chunk),
    now.toISOString(),
  );
}

function replaceFts(db: SqlDatabase, chunks: readonly RetrievalChunk[]): void {
  db.prepare("DELETE FROM retrieval_chunks_fts").run();
  for (const chunk of chunks.filter((item) => item.status === "active")) {
    db.prepare("INSERT INTO retrieval_chunks_fts (chunk_id, text) VALUES (?, ?)").run(
      chunk.chunk_id,
      chunk.text,
    );
  }
}

function writeFreshness(
  db: SqlDatabase,
  chunks: readonly RetrievalChunk[],
  now: Date,
  scannedEvents: readonly CanonicalEvent[] = [],
): ProjectionFreshness[] {
  const cursorRows = db
    .prepare("SELECT trust_zone_id, after_sequence FROM sync_cursors")
    .all() as CursorRow[];
  const zoneIds = new Set([
    ...cursorRows.map((row) => row.trust_zone_id),
    ...chunks.flatMap((chunk) => chunk.source_records.map((record) => record.trust_zone_id)),
    ...scannedEvents.map((event) => event.trust_zone.trust_zone_id),
  ]);
  const freshness = [...zoneIds].sort().map((trustZoneId): ProjectionFreshness => {
    const lastFromChunks = Math.max(
      0,
      ...chunks
        .flatMap((chunk) => chunk.source_records)
        .filter((record) => record.trust_zone_id === trustZoneId)
        .map((record) => record.zone_sequence),
    );
    const lastFromScan = Math.max(
      0,
      ...scannedEvents
        .filter((event) => event.trust_zone.trust_zone_id === trustZoneId)
        .map((event) => event.zone_sequence ?? 0),
    );
    const lastIndexed = Math.max(lastFromChunks, lastFromScan);
    const cursor = cursorRows.find((row) => row.trust_zone_id === trustZoneId);
    const afterSequence = Number(cursor?.after_sequence ?? lastIndexed);
    return lastIndexed < afterSequence
      ? {
          schema_version: "v1",
          record_type: "projection_freshness",
          projection_name: "retrieval_projection",
          projection_version: RETRIEVAL_PROJECTION_VERSION,
          trust_zone_id: trustZoneId,
          last_indexed_zone_sequence: lastIndexed,
          sync_cursor_after_sequence: afterSequence,
          stale: true,
          reason: "behind_sync_cursor",
          checked_at: now.toISOString(),
        }
      : {
          schema_version: "v1",
          record_type: "projection_freshness",
          projection_name: "retrieval_projection",
          projection_version: RETRIEVAL_PROJECTION_VERSION,
          trust_zone_id: trustZoneId,
          last_indexed_zone_sequence: lastIndexed,
          sync_cursor_after_sequence: afterSequence,
          stale: false,
          checked_at: now.toISOString(),
        };
  });
  for (const item of freshness) {
    db.prepare(`
      INSERT INTO projection_freshness (
        projection_name, projection_version, trust_zone_id, freshness_json, updated_at
      )
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(projection_name, projection_version, trust_zone_id) DO UPDATE SET
        freshness_json=excluded.freshness_json,
        updated_at=excluded.updated_at
    `).run(
      item.projection_name,
      item.projection_version,
      item.trust_zone_id,
      stableJson(item),
      now.toISOString(),
    );
  }
  return freshness;
}

function readFreshness(db: SqlDatabase): ProjectionFreshness[] {
  return (
    db.prepare("SELECT freshness_json FROM projection_freshness").all() as {
      freshness_json: string;
    }[]
  )
    .map((row) => JSON.parse(row.freshness_json) as ProjectionFreshness)
    .sort((left, right) => left.trust_zone_id.localeCompare(right.trust_zone_id));
}

function readChunks(db: SqlDatabase, chunkIds: readonly string[]): RetrievalChunk[] {
  if (chunkIds.length === 0) {
    return [];
  }
  return chunkIds
    .map(
      (chunkId) =>
        db.prepare("SELECT chunk_json FROM retrieval_chunks WHERE chunk_id = ?").get(chunkId) as
          | ChunkRow
          | undefined,
    )
    .filter((row): row is ChunkRow => row !== undefined)
    .map((row) => JSON.parse(row.chunk_json) as RetrievalChunk);
}

function ftsCandidateChunkIds(db: SqlDatabase, query: RetrievalQuery, limit: number): string[] {
  const match = query.query_text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(" OR ");
  if (match.length === 0) {
    return [];
  }
  return (
    db
      .prepare(`
        SELECT fts.chunk_id
        FROM retrieval_chunks_fts AS fts
        JOIN retrieval_chunks AS chunks ON chunks.chunk_id = fts.chunk_id
        WHERE retrieval_chunks_fts MATCH ?
          AND chunks.trust_zone_id IN (${query.filters.visible_trust_zone_ids.map(() => "?").join(",")})
          AND chunks.status IN ('active', 'projection_deleted')
        ORDER BY chunks.max_zone_sequence DESC, chunks.chunk_id ASC
        LIMIT ?
      `)
      .all(match, ...query.filters.visible_trust_zone_ids, limit) as { chunk_id: string }[]
  ).map((row) => row.chunk_id);
}

function structuredCandidateChunkIds(
  db: SqlDatabase,
  query: RetrievalQuery,
  limit: number,
): string[] {
  const queryTerms = new Set(tokenize(query.query_text));
  if (queryTerms.size === 0) {
    return [];
  }
  return (
    db
      .prepare(`
        SELECT chunk_id, chunk_kind, lifecycle_status, epistemic_authority
        FROM retrieval_chunks
        WHERE trust_zone_id IN (${query.filters.visible_trust_zone_ids.map(() => "?").join(",")})
          AND status IN ('active', 'projection_deleted')
        ORDER BY max_zone_sequence DESC, chunk_id ASC
        LIMIT ?
      `)
      .all(...query.filters.visible_trust_zone_ids, limit) as {
      chunk_id: string;
      chunk_kind: string;
      lifecycle_status: string;
      epistemic_authority: string;
    }[]
  )
    .filter((row) =>
      [row.chunk_kind, row.lifecycle_status, row.epistemic_authority].some((term) =>
        queryTerms.has(term),
      ),
    )
    .map((row) => row.chunk_id);
}

function readVectors(
  db: SqlDatabase,
  chunkIds: readonly string[],
  provider: EmbeddingProvider,
): Map<string, number[]> {
  const vectors = new Map<string, number[]>();
  for (const chunkId of chunkIds) {
    const row = db
      .prepare(`
        SELECT chunk_id, vector_json, embedding_model, embedding_version, pooling
        FROM local_vectors
        WHERE chunk_id = ?
      `)
      .get(chunkId) as VectorRow | undefined;
    if (row !== undefined) {
      const vector = JSON.parse(row.vector_json) as number[];
      if (
        isVectorCompatibleWithProvider(provider, {
          embeddingModel: row.embedding_model,
          embeddingVersion: row.embedding_version,
          pooling: row.pooling,
          dimensions: vector.length,
        }) &&
        vector.every((value) => Number.isFinite(value))
      ) {
        vectors.set(row.chunk_id, vector);
      }
    }
  }
  return vectors;
}

function applyProjectionStatus(chunk: RetrievalChunk): RetrievalChunk {
  return chunk.source_records.some((record) => record.source_record_kind === "erasure")
    ? { ...chunk, status: "projection_deleted" }
    : chunk;
}

function cosine(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length === 0) {
    return 0;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  return leftNorm === 0 || rightNorm === 0 ? 0 : dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Capture origin facets keyed by the captured event id.
 *
 * Only hashed and label-shaped fields are read; absolute workspace paths are
 * never stored in `capture_requests` (ADR 0013 privacy shape).
 */
function readCaptureOriginsForProjection(db: SqlDatabase): Map<string, RetrievalOrigin> {
  const origins = new Map<string, RetrievalOrigin>();
  let rows: CaptureOriginRow[];
  try {
    rows = db
      .prepare(
        `SELECT event_id, project_id, worktree_id, worktree_name, git_branch
         FROM capture_requests`,
      )
      .all() as CaptureOriginRow[];
  } catch {
    // Store predates the capture identity migration; origin stays unknown.
    return origins;
  }

  for (const row of rows) {
    const origin: RetrievalOrigin = {
      ...(row.project_id ? { project_id: row.project_id } : {}),
      ...(row.worktree_id ? { worktree_id: row.worktree_id } : {}),
      ...(row.worktree_name ? { worktree_name: row.worktree_name } : {}),
      ...(row.git_branch ? { git_branch: row.git_branch } : {}),
    };
    if (Object.keys(origin).length > 0) {
      origins.set(row.event_id, origin);
    }
  }
  return origins;
}

/**
 * Attach the capture origin of a chunk's primary source event.
 *
 * Derived units (Observation, Claim) inherit origin by following provenance back
 * to the captured evidence event. Chunks that cannot resolve an origin keep it
 * undefined, which retrieval treats as unknown rather than excluded.
 */
function attachChunkOrigin(
  chunk: RetrievalChunk,
  events: readonly CanonicalEvent[],
  origins: Map<string, RetrievalOrigin>,
): RetrievalChunk {
  if (origins.size === 0) {
    return chunk;
  }
  const byId = new Map(events.map((event) => [event.event_id, event]));
  for (const record of chunk.source_records) {
    if (record.source_record_kind !== "event") continue;
    const direct = origins.get(record.source_record_id);
    if (direct !== undefined) {
      return { ...chunk, origin: direct };
    }
    const inherited = inheritOriginFromProvenance(byId.get(record.source_record_id), origins);
    if (inherited !== undefined) {
      return { ...chunk, origin: inherited };
    }
  }
  return chunk;
}

function inheritOriginFromProvenance(
  event: CanonicalEvent | undefined,
  origins: Map<string, RetrievalOrigin>,
): RetrievalOrigin | undefined {
  if (event === undefined) return undefined;
  for (const ref of event.provenance ?? []) {
    const origin = origins.get(ref.ref_id);
    if (origin !== undefined) {
      return origin;
    }
  }
  return undefined;
}

type CaptureOriginRow = {
  event_id: string;
  project_id: string | null;
  worktree_id: string | null;
  worktree_name: string | null;
  git_branch: string | null;
};
