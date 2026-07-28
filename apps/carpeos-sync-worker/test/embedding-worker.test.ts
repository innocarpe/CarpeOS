import { describe, expect, it } from "vitest";
import {
  EMBEDDING_DIMENSIONS,
  WORKERS_AI_EMBEDDING_MODEL,
  type AiLike,
  embedWithWorkersAi,
} from "../src/embeddings.js";

describe("Workers AI embedding adapter", () => {
  it("calls provider-neutral Ai binding with bge-base model, pooling, and provenance", async () => {
    const ai: AiLike = {
      async run(model, input) {
        expect(model).toBe(WORKERS_AI_EMBEDDING_MODEL);
        expect(input).toEqual({ text: ["alpha"], pooling: "mean" });
        return { data: [vector()] };
      },
    };

    const result = await embedWithWorkersAi(ai, {
      text: ["alpha"],
      pooling: "mean",
      now: new Date("2026-01-01T00:00:00Z"),
    });

    expect(result).toMatchObject({
      ok: true,
      provenance: {
        embedding_model: WORKERS_AI_EMBEDDING_MODEL,
        embedding_dimensions: EMBEDDING_DIMENSIONS,
        embedding_version: "v1",
        pooling: "mean",
        input_token_limit: 512,
      },
    });
    if (result.ok) {
      expect(result.vectors[0]).toHaveLength(768);
    }
  });

  it("preflights 512-token limit and malformed or dimension responses as blocked", async () => {
    const ai: AiLike = {
      async run() {
        return { data: [vector(767)] };
      },
    };
    const tooLong = await embedWithWorkersAi(ai, { text: "x ".repeat(513) });
    const malformed = await embedWithWorkersAi(ai, { text: "alpha" });

    expect(tooLong).toMatchObject({
      ok: false,
      retryable: false,
      failure_kind: "invalid_request",
    });
    expect(malformed).toMatchObject({
      ok: false,
      retryable: false,
      failure_kind: "dimension_mismatch",
      error: "Workers AI embedding dimensions did not match contract",
    });
  });

  it("blocks zero, extra, and missing vectors when provider count differs from input count", async () => {
    const zero = await embedWithWorkersAi(returning({ data: [] }), { text: ["alpha"] });
    const extra = await embedWithWorkersAi(returning({ data: [vector(), vector()] }), {
      text: ["alpha"],
    });
    const missing = await embedWithWorkersAi(returning({ data: [vector()] }), {
      text: ["alpha", "beta"],
    });

    for (const result of [zero, extra, missing]) {
      expect(result).toMatchObject({
        ok: false,
        retryable: false,
        failure_kind: "invalid_request",
        error: "Workers AI rejected embedding request",
      });
    }
  });

  it("returns stable safe messages without provider body for retryable and blocked errors", async () => {
    const echoed = "short secret\nhttps://example.invalid/token\nsource text alpha";
    const retryable = await embedWithWorkersAi(failingAi(429, echoed), { text: "safe input" });
    const blocked = await embedWithWorkersAi(failingAi(undefined, `invalid request ${echoed}`), {
      text: "safe input",
    });
    const unknown = await embedWithWorkersAi(
      failingAi(undefined, "short echoed source\nhttps://echo.example/echo"),
      { text: "safe input" },
    );

    expect(retryable).toMatchObject({
      ok: false,
      retryable: true,
      failure_kind: "rate_limited",
      error: "Workers AI rate limited request",
    });
    expect(blocked).toMatchObject({
      ok: false,
      retryable: false,
      failure_kind: "invalid_request",
      error: "Workers AI rejected embedding request",
    });
    expect(unknown).toMatchObject({
      ok: false,
      retryable: false,
      failure_kind: "unknown_blocked",
      error: "Workers AI embedding request failed",
    });
  });

  it("classifies retryable provider failures and redacts source/error text", async () => {
    for (const [status, failureKind] of [
      [408, "timeout"],
      [425, "rate_limited"],
      [429, "rate_limited"],
      [500, "server_error"],
    ] as const) {
      const result = await embedWithWorkersAi(
        failingAi(status, `source "${"secret ".repeat(20)}"`),
        {
          text: "safe input",
        },
      );
      expect(result).toMatchObject({ ok: false, retryable: true, failure_kind: failureKind });
      if (result.ok) {
        throw new Error("expected retryable failure");
      }
      expect(result.error).not.toContain("secret");
      expect(result.error).not.toContain("source");
    }

    const quota = await embedWithWorkersAi(
      failingAi(undefined, "Workers AI allocation exhausted"),
      {
        text: "safe input",
      },
    );
    expect(quota).toMatchObject({
      ok: false,
      retryable: true,
      failure_kind: "workers_ai_allocation_exhausted",
    });
  });
});

function returning(value: unknown): AiLike {
  return {
    async run() {
      return value;
    },
  };
}

function vector(length = 768): number[] {
  return Array.from({ length }, (_, index) => index / 768);
}

function failingAi(status: number | undefined, message: string): AiLike {
  return {
    async run() {
      throw Object.assign(new Error(message), status === undefined ? {} : { status });
    },
  };
}
