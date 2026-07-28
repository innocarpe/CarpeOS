import { describe, expect, it } from "vitest";
import {
  type VectorFilter,
  type VectorMatch,
  type VectorizeInputVector,
  type VectorizeLike,
  deleteVectors,
  makeVectorId,
  queryVectors,
  upsertVectors,
} from "../src/vectorize.js";

describe("Vectorize adapter contract", () => {
  it("enforces ids, dimensions, batches, metadata size, and indexed metadata fields", async () => {
    const index = new FakeVectorize();
    const base = vectorRecord("chunk_a");

    await expect(upsertVectors(index, [])).rejects.toThrow("1..1000");
    await expect(
      upsertVectors(
        index,
        Array.from({ length: 1001 }, () => base),
      ),
    ).rejects.toThrow("1..1000");
    await expect(upsertVectors(index, [{ ...base, id: "x".repeat(65) }])).rejects.toThrow(
      "vector id exceeds 64 bytes",
    );
    await expect(upsertVectors(index, [{ ...base, values: vector(767) }])).rejects.toThrow(
      "vector dimension mismatch",
    );
    await expect(
      upsertVectors(index, [{ ...base, values: withValue(Number.NaN) }]),
    ).rejects.toThrow("vector values must be finite");
    await expect(
      upsertVectors(index, [
        { ...base, metadata: { ...base.metadata, missing_index: "x" } as never },
      ]),
    ).rejects.toThrow("metadata field is not indexed");
    await expect(
      upsertVectors(index, [
        { ...base, metadata: { trust_zone_id: "tz_a", status: "x".repeat(11 * 1024) } },
      ]),
    ).rejects.toThrow("vector metadata exceeds 10KiB");
  });

  it("upserts as full replacement and models async mutation visibility", async () => {
    const index = new FakeVectorize();
    const first = vectorRecord("chunk_a", { status: "active" });
    const second = vectorRecord("chunk_a", { status: "stale" });

    const mutation = await upsertVectors(index, [first]);
    expect(mutation.visible_immediately).toBe(false);
    expect(mutation.mutation_id).toMatch(/^mut_/);
    expect(
      await queryVectors(index, {
        vector: vector(),
        namespace: "tz_a",
        filter: { trust_zone_id: "tz_a", status: "active" },
        topK: 10,
        returnMetadata: "indexed",
      }),
    ).toMatchObject({ count: 0 });

    index.flush();
    await upsertVectors(index, [second]);
    index.flush();
    const result = await queryVectors(index, {
      vector: vector(),
      namespace: "tz_a",
      filter: { trust_zone_id: "tz_a", status: "stale" },
      topK: 10,
      returnMetadata: "indexed",
    });
    expect(result.count).toBe(1);
    expect(result.matches[0]?.metadata).toMatchObject({ status: "stale" });
  });

  it("validates filters before topK and rejects namespace or missing metadata index", async () => {
    const index = new FakeVectorize();

    await expect(
      queryVectors(index, {
        vector: vector(),
        namespace: "tz_a",
        filter: {},
        topK: 500,
      }),
    ).rejects.toThrow("vector filter must be nonempty");
    await expect(
      queryVectors(index, {
        vector: vector(),
        namespace: "tz_a",
        filter: { missing_index: "x" },
        topK: 10,
      }),
    ).rejects.toThrow("filter field is not indexed");
    await expect(
      queryVectors(index, {
        vector: vector(),
        namespace: "tz_b",
        filter: { trust_zone_id: "tz_a" },
        topK: 10,
      }),
    ).rejects.toThrow("vector namespace must match trust zone");
    await expect(
      queryVectors(index, {
        vector: vector(),
        namespace: "tz_a",
        filter: { trust_zone_id: "tz_a" },
        topK: 51,
        returnMetadata: "indexed",
      }),
    ).rejects.toThrow("topK must be between 1 and 50");
    await expect(
      queryVectors(index, {
        vector: vector(),
        namespace: "tz_a",
        filter: { trust_zone_id: "tz_a" },
        topK: 100,
        returnMetadata: "none",
        returnValues: false,
      }),
    ).resolves.toMatchObject({ count: 0 });
  });

  it("deletes by deterministic ids and rejects oversized generated ids", async () => {
    const index = new FakeVectorize();
    const id = makeVectorId({ trustZoneId: "tz_a", chunkId: `chk_${"a".repeat(40)}` });
    expect(new TextEncoder().encode(id).byteLength).toBeLessThanOrEqual(64);
    await upsertVectors(index, [vectorRecord("chunk_a")]);
    index.flush();
    await deleteVectors(index, ["chunk_a"]);
    index.flush();
    const result = await queryVectors(index, {
      vector: vector(),
      namespace: "tz_a",
      filter: { trust_zone_id: "tz_a" },
      topK: 10,
    });
    expect(result.count).toBe(0);
    await expect(deleteVectors(index, ["x".repeat(65)])).rejects.toThrow("vector id exceeds 64");
  });
});

class FakeVectorize implements VectorizeLike {
  private readonly visible = new Map<string, VectorizeInputVector>();
  private readonly pending: Array<() => void> = [];
  private mutation = 0;

  async upsert(vectors: VectorizeInputVector[]) {
    const snapshot = vectors.map((vector) => ({ ...vector, values: [...vector.values] }));
    this.pending.push(() => {
      for (const vector of snapshot) {
        this.visible.set(vector.id, vector);
      }
    });
    this.mutation += 1;
    return { mutationId: `mut_${this.mutation}` };
  }

  async deleteByIds(ids: string[]) {
    this.pending.push(() => {
      for (const id of ids) {
        this.visible.delete(id);
      }
    });
    this.mutation += 1;
    return { mutationId: `mut_${this.mutation}` };
  }

  async query(
    _vector: number[],
    options: { topK: number; namespace: string; filter: VectorFilter },
  ) {
    const matches: VectorMatch[] = [...this.visible.values()]
      .filter((vector) => vector.namespace === options.namespace)
      .filter((vector) =>
        Object.entries(options.filter).every(
          ([key, value]) => vector.metadata[key as never] === value,
        ),
      )
      .slice(0, options.topK)
      .map((vector) => ({
        id: vector.id,
        namespace: vector.namespace,
        metadata: vector.metadata,
        score: 1,
      }));
    return { matches, count: matches.length };
  }

  flush(): void {
    for (const mutation of this.pending.splice(0)) {
      mutation();
    }
  }
}

function vectorRecord(id: string, metadata: Record<string, string> = {}): VectorizeInputVector {
  return {
    id,
    values: vector(),
    namespace: "tz_a",
    metadata: {
      trust_zone_id: "tz_a",
      chunk_id: id,
      projection_version: "retrieval/v1",
      status: "active",
      ...metadata,
    },
  };
}

function vector(length = 768): number[] {
  return Array.from({ length }, (_, index) => index / 768);
}

function withValue(value: number): number[] {
  const output = vector();
  output[0] = value;
  return output;
}
