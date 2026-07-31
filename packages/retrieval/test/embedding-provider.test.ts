import { describe, expect, it } from "vitest";
import {
  createDeterministicLocalDevProvider,
  createLocalLexicalHashProvider,
  defaultEmbeddingProvider,
  localLexicalHashEmbedding,
  resolveEmbeddingProvider,
} from "../src/embedding-provider.js";
import { cosineSimilarity } from "../src/ranking.js";

describe("embedding provider", () => {
  it("defaults to offline local-lexical-hash with non-synthetic quality", () => {
    const provider = defaultEmbeddingProvider();
    expect(provider.info.id).toBe("local-lexical-hash");
    expect(provider.info.semantic_quality).toBe("local-lexical");
    expect(provider.info.semantic_quality).not.toBe("synthetic-dev-only");
  });

  it("gives higher cosine similarity to overlapping statements than to unrelated text", () => {
    const left = localLexicalHashEmbedding(
      "Example Alpha prefers local-first retrieval for decision threads",
    );
    const related = localLexicalHashEmbedding(
      "local-first retrieval for decision threads in Example Alpha",
    );
    const unrelated = localLexicalHashEmbedding("unrelated vegetable garden schedule");
    expect(cosineSimilarity(left, related)).toBeGreaterThan(cosineSimilarity(left, unrelated));
  });

  it("keeps deterministic-local-dev available as an explicit synthetic provider", () => {
    const synthetic = resolveEmbeddingProvider("deterministic-local-dev");
    expect(synthetic.info.semantic_quality).toBe("synthetic-dev-only");
    const lexical = createLocalLexicalHashProvider();
    expect(createDeterministicLocalDevProvider().info.id).toBe("deterministic-local-dev");
    expect(lexical.info.dimensions).toBe(768);
  });
});
