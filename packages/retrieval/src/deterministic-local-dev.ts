import { createHash } from "node:crypto";
import type { EmbeddingRecord } from "@carpeos/schema";

export const DETERMINISTIC_LOCAL_DEV_EMBEDDING = {
  model: "deterministic-local-dev",
  version: "v1",
  pooling: "mean" satisfies EmbeddingRecord["provenance"]["pooling"],
  dimensions: 768,
} as const;

export function deterministicLocalDevEmbedding(text: string): number[] {
  const digest = createHash("sha256").update(text, "utf8").digest();
  return Array.from({ length: DETERMINISTIC_LOCAL_DEV_EMBEDDING.dimensions }, (_, index) => {
    const byte = digest[index % digest.length] ?? 0;
    return byte / 255;
  });
}

export function isDeterministicLocalDevVectorCompatible(input: {
  embeddingModel: string;
  embeddingVersion: string;
  pooling: string;
  dimensions: number;
}): boolean {
  return (
    input.embeddingModel === DETERMINISTIC_LOCAL_DEV_EMBEDDING.model &&
    input.embeddingVersion === DETERMINISTIC_LOCAL_DEV_EMBEDDING.version &&
    input.pooling === DETERMINISTIC_LOCAL_DEV_EMBEDDING.pooling &&
    input.dimensions === DETERMINISTIC_LOCAL_DEV_EMBEDDING.dimensions
  );
}
