import { createHash } from "node:crypto";
import type { EmbeddingRecord } from "@carpeos/schema";
import {
  DETERMINISTIC_LOCAL_DEV_EMBEDDING,
  deterministicLocalDevEmbedding,
} from "./deterministic-local-dev.js";

/**
 * Self-reported semantic quality of an embedding provider.
 *
 * - `synthetic-dev-only`: hash of whole text; not for product semantic recall
 * - `local-lexical`: offline bag-of-hashed-tokens; deterministic, no network
 * - `model-backed`: external or local neural model (future adapter)
 */
export type EmbeddingSemanticQuality = "synthetic-dev-only" | "local-lexical" | "model-backed";

export type EmbeddingProviderInfo = {
  id: string;
  model: string;
  version: string;
  pooling: EmbeddingRecord["provenance"]["pooling"];
  dimensions: number;
  semantic_quality: EmbeddingSemanticQuality;
};

export type EmbeddingProvider = {
  info: EmbeddingProviderInfo;
  embed(text: string): number[] | Promise<number[]>;
};

/** Offline product default: deterministic lexical feature hashing. */
export const LOCAL_LEXICAL_HASH_EMBEDDING = {
  id: "local-lexical-hash",
  model: "local-lexical-hash",
  version: "v1",
  pooling: "mean" satisfies EmbeddingRecord["provenance"]["pooling"],
  dimensions: 768,
  semantic_quality: "local-lexical" satisfies EmbeddingSemanticQuality,
} as const;

const TOKEN_RE = /[a-z0-9_]+/g;

/**
 * Bag-of-hashed-tokens embedding.
 *
 * Unlike whole-text SHA vectors, overlapping tokens produce overlapping
 * dimensions so near-duplicate statements score higher under cosine similarity.
 * Fully offline and deterministic for CI.
 */
export function localLexicalHashEmbedding(
  text: string,
  dimensions: number = LOCAL_LEXICAL_HASH_EMBEDDING.dimensions,
): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const tokens = text.toLowerCase().match(TOKEN_RE) ?? [];
  if (tokens.length === 0) {
    // Empty input still needs a unit vector for cosine safety.
    vector[0] = 1;
    return vector;
  }

  for (const token of tokens) {
    const digest = createHash("sha256").update(token, "utf8").digest();
    // Two hashes → signed feature hashing (reduces collision bias).
    const bucket = ((digest[0]! << 24) | (digest[1]! << 16) | (digest[2]! << 8) | digest[3]!) >>> 0;
    const signByte = digest[4] ?? 0;
    const index = bucket % dimensions;
    const current = vector[index] ?? 0;
    vector[index] = current + (signByte & 1 ? 1 : -1);
  }

  let norm = 0;
  for (const value of vector) {
    norm += value * value;
  }
  norm = Math.sqrt(norm);
  if (norm === 0) {
    vector[0] = 1;
    return vector;
  }
  return vector.map((value) => value / norm);
}

export function createLocalLexicalHashProvider(): EmbeddingProvider {
  return {
    info: { ...LOCAL_LEXICAL_HASH_EMBEDDING },
    embed(text: string): number[] {
      return localLexicalHashEmbedding(text, LOCAL_LEXICAL_HASH_EMBEDDING.dimensions);
    },
  };
}

export function createDeterministicLocalDevProvider(): EmbeddingProvider {
  return {
    info: {
      id: "deterministic-local-dev",
      model: DETERMINISTIC_LOCAL_DEV_EMBEDDING.model,
      version: DETERMINISTIC_LOCAL_DEV_EMBEDDING.version,
      pooling: DETERMINISTIC_LOCAL_DEV_EMBEDDING.pooling,
      dimensions: DETERMINISTIC_LOCAL_DEV_EMBEDDING.dimensions,
      semantic_quality: "synthetic-dev-only",
    },
    embed(text: string): number[] {
      return deterministicLocalDevEmbedding(text);
    },
  };
}

const PROVIDERS: Record<string, () => EmbeddingProvider> = {
  [LOCAL_LEXICAL_HASH_EMBEDDING.id]: createLocalLexicalHashProvider,
  "deterministic-local-dev": createDeterministicLocalDevProvider,
};

/** Default product provider for offline local search. */
export function defaultEmbeddingProvider(): EmbeddingProvider {
  return createLocalLexicalHashProvider();
}

export function resolveEmbeddingProvider(id?: string): EmbeddingProvider {
  if (id === undefined || id.length === 0) {
    return defaultEmbeddingProvider();
  }
  const factory = PROVIDERS[id];
  if (factory === undefined) {
    throw new Error(`unknown embedding provider: ${id}`);
  }
  return factory();
}

export function isVectorCompatibleWithProvider(
  provider: EmbeddingProvider,
  input: {
    embeddingModel: string;
    embeddingVersion: string;
    pooling: string;
    dimensions: number;
  },
): boolean {
  const info = provider.info;
  return (
    input.embeddingModel === info.model &&
    input.embeddingVersion === info.version &&
    input.pooling === info.pooling &&
    input.dimensions === info.dimensions
  );
}
