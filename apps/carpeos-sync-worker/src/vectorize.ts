import { EMBEDDING_DIMENSIONS } from "./embeddings.js";

export const MAX_VECTOR_ID_BYTES = 64;
export const MAX_VECTOR_BATCH = 1000;
export const MAX_METADATA_BYTES = 10 * 1024;
export const MAX_FILTER_BYTES = 2048;
export const INDEXED_METADATA_FIELDS = [
  "trust_zone_id",
  "namespace",
  "chunk_id",
  "projection_version",
  "chunk_kind",
  "lifecycle_status",
  "epistemic_authority",
  "source_record_kind",
  "source_record_id",
  "status",
] as const;

export type IndexedMetadataField = (typeof INDEXED_METADATA_FIELDS)[number];
export type VectorMetadata = Partial<Record<IndexedMetadataField, string | number | boolean>>;

export type VectorizeLike = {
  upsert(
    vectors: VectorizeInputVector[],
  ): Promise<{ mutationId?: string; ids?: string[]; count?: number }>;
  deleteByIds(ids: string[]): Promise<{ mutationId?: string; ids?: string[]; count?: number }>;
  query(
    vector: number[],
    options: {
      topK: number;
      namespace: string;
      filter: VectorFilter;
      returnMetadata: "all" | "indexed" | "none";
      returnValues: boolean;
    },
  ): Promise<{ matches: VectorMatch[]; count: number }>;
};

export type VectorizeInputVector = {
  id: string;
  values: number[];
  namespace: string;
  metadata: VectorMetadata;
};

export type VectorFilter = Record<string, string | number | boolean>;

export type VectorMatch = {
  id: string;
  score: number;
  namespace?: string;
  values?: number[];
  metadata?: VectorMetadata;
};

export function makeVectorId(input: { trustZoneId: string; chunkId: string }): string {
  const candidate = `${input.trustZoneId}:${input.chunkId}`;
  if (byteLength(candidate) <= MAX_VECTOR_ID_BYTES) {
    return candidate;
  }
  return `${input.trustZoneId.slice(0, 12)}:${input.chunkId.slice(0, 40)}`;
}

export async function upsertVectors(
  index: VectorizeLike,
  vectors: readonly VectorizeInputVector[],
): Promise<{ mutation_id: string; visible_immediately: false }> {
  if (vectors.length === 0 || vectors.length > MAX_VECTOR_BATCH) {
    throw new Error("vector batch must contain 1..1000 items");
  }
  for (const vector of vectors) {
    validateVector(vector.values);
    validateVectorId(vector.id);
    validateMetadata(vector.metadata);
    assertNamespaceTrustZone(vector.namespace, vector.metadata.trust_zone_id);
  }
  const result = await index.upsert(
    vectors.map((vector) => ({ ...vector, values: [...vector.values] })),
  );
  return { mutation_id: result.mutationId ?? `sync_${Date.now()}`, visible_immediately: false };
}

export async function deleteVectors(
  index: VectorizeLike,
  ids: readonly string[],
): Promise<{ mutation_id: string; visible_immediately: false }> {
  if (ids.length === 0 || ids.length > MAX_VECTOR_BATCH) {
    throw new Error("vector delete batch must contain 1..1000 ids");
  }
  for (const id of ids) {
    validateVectorId(id);
  }
  const result = await index.deleteByIds([...ids]);
  return { mutation_id: result.mutationId ?? `delete_${Date.now()}`, visible_immediately: false };
}

export async function queryVectors(
  index: VectorizeLike,
  input: {
    vector: number[];
    namespace: string;
    filter: VectorFilter;
    topK: number;
    returnMetadata?: "all" | "indexed" | "none";
    returnValues?: boolean;
  },
): Promise<{ matches: VectorMatch[]; count: number }> {
  validateVector(input.vector);
  validateFilter(input.filter);
  assertNamespaceTrustZone(input.namespace, input.filter.trust_zone_id);
  const includePayload = input.returnMetadata !== "none" || input.returnValues === true;
  const topKMax = includePayload ? 50 : 100;
  if (!Number.isInteger(input.topK) || input.topK < 1 || input.topK > topKMax) {
    throw new Error(`topK must be between 1 and ${topKMax}`);
  }
  return index.query(input.vector, {
    topK: input.topK,
    namespace: input.namespace,
    filter: input.filter,
    returnMetadata: input.returnMetadata ?? "indexed",
    returnValues: input.returnValues ?? false,
  });
}

export function validateVector(vector: readonly number[]): void {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`vector dimension mismatch: expected ${EMBEDDING_DIMENSIONS}`);
  }
  if (!vector.every((value) => Number.isFinite(value))) {
    throw new Error("vector values must be finite");
  }
}

export function validateMetadata(metadata: VectorMetadata): void {
  const keys = Object.keys(metadata);
  for (const key of keys) {
    if (!INDEXED_METADATA_FIELDS.includes(key as IndexedMetadataField)) {
      throw new Error(`metadata field is not indexed: ${key}`);
    }
  }
  if (byteLength(JSON.stringify(metadata)) >= MAX_METADATA_BYTES) {
    throw new Error("vector metadata exceeds 10KiB");
  }
}

export function validateFilter(filter: VectorFilter): void {
  const keys = Object.keys(filter);
  if (keys.length === 0) {
    throw new Error("vector filter must be nonempty");
  }
  for (const key of keys) {
    if (!INDEXED_METADATA_FIELDS.includes(key as IndexedMetadataField)) {
      throw new Error(`filter field is not indexed: ${key}`);
    }
  }
  if (byteLength(JSON.stringify(filter)) >= MAX_FILTER_BYTES) {
    throw new Error("vector filter exceeds 2048 bytes");
  }
}

function validateVectorId(id: string): void {
  if (byteLength(id) > MAX_VECTOR_ID_BYTES) {
    throw new Error("vector id exceeds 64 bytes");
  }
}

function assertNamespaceTrustZone(namespace: string, trustZoneId: unknown): void {
  if (typeof trustZoneId !== "string" || trustZoneId.length === 0 || namespace !== trustZoneId) {
    throw new Error("vector namespace must match trust zone");
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
