export const WORKERS_AI_EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
export const EMBEDDING_DIMENSIONS = 768;
export const EMBEDDING_INPUT_TOKEN_LIMIT = 512;

export type Pooling = "mean" | "cls";

export type AiLike = {
  run(model: string, input: { text: string | string[]; pooling: Pooling }): Promise<unknown>;
};

export type EmbeddingSuccess = {
  ok: true;
  vectors: number[][];
  provenance: {
    embedding_model: typeof WORKERS_AI_EMBEDDING_MODEL;
    embedding_dimensions: typeof EMBEDDING_DIMENSIONS;
    embedding_version: "v1";
    pooling: Pooling;
    input_token_limit: typeof EMBEDDING_INPUT_TOKEN_LIMIT;
    created_at: string;
  };
};

export type EmbeddingFailureKind =
  | "workers_ai_allocation_exhausted"
  | "rate_limited"
  | "server_error"
  | "timeout"
  | "dimension_mismatch"
  | "invalid_request"
  | "metadata_limit"
  | "vector_id_limit"
  | "unknown_retryable"
  | "unknown_blocked";

export type EmbeddingFailure = {
  ok: false;
  retryable: boolean;
  failure_kind: EmbeddingFailureKind;
  error: string;
};

export type EmbeddingResult = EmbeddingSuccess | EmbeddingFailure;

export async function embedWithWorkersAi(
  ai: AiLike,
  input: { text: string | string[]; pooling?: Pooling; now?: Date },
): Promise<EmbeddingResult> {
  const texts = Array.isArray(input.text) ? input.text : [input.text];
  if (texts.length === 0) {
    return blocked("invalid_request", "embedding input is empty");
  }
  if (texts.some((text) => countApproxTokens(text) > EMBEDDING_INPUT_TOKEN_LIMIT)) {
    return blocked("invalid_request", "embedding input exceeds 512 token preflight limit");
  }

  try {
    const raw = await ai.run(WORKERS_AI_EMBEDDING_MODEL, {
      text: input.text,
      pooling: input.pooling ?? "mean",
    });
    const vectors = normalizeWorkersAiVectors(raw, texts.length);
    return {
      ok: true,
      vectors,
      provenance: {
        embedding_model: WORKERS_AI_EMBEDDING_MODEL,
        embedding_dimensions: EMBEDDING_DIMENSIONS,
        embedding_version: "v1",
        pooling: input.pooling ?? "mean",
        input_token_limit: EMBEDDING_INPUT_TOKEN_LIMIT,
        created_at: (input.now ?? new Date()).toISOString(),
      },
    };
  } catch (error) {
    return classifyEmbeddingError(error);
  }
}

export function classifyEmbeddingError(error: unknown): EmbeddingFailure {
  const status = errorStatus(error);
  if (status === 408) {
    return retryable("timeout", safeMessage("timeout"));
  }
  if (status === 425 || status === 429) {
    return retryable("rate_limited", safeMessage("rate_limited"));
  }
  if (status !== undefined && status >= 500) {
    return retryable("server_error", safeMessage("server_error"));
  }
  const message = errorMessage(error);
  if (/allocation|quota/i.test(message)) {
    return retryable(
      "workers_ai_allocation_exhausted",
      safeMessage("workers_ai_allocation_exhausted"),
    );
  }
  if (/dimension/i.test(message)) {
    return blocked("dimension_mismatch", safeMessage("dimension_mismatch"));
  }
  if (/malformed provider response|vector count/i.test(message)) {
    return blocked("invalid_request", safeMessage("invalid_request"));
  }
  if (/malformed|invalid/i.test(message)) {
    return blocked("invalid_request", safeMessage("invalid_request"));
  }
  return blocked("unknown_blocked", safeMessage("unknown_blocked"));
}

function normalizeWorkersAiVectors(raw: unknown, expectedCount: number): number[][] {
  const data = isObject(raw) && Array.isArray(raw.data) ? raw.data : raw;
  const vectors =
    Array.isArray(data) && (data.length === 0 || Array.isArray(data[0])) ? data : [data];
  if (!Array.isArray(vectors)) {
    throw new Error("malformed Workers AI embedding response");
  }
  if (vectors.length !== expectedCount) {
    throw new Error("malformed provider response: vector count mismatch");
  }
  return vectors.map((vector) => {
    if (
      !Array.isArray(vector) ||
      vector.length !== EMBEDDING_DIMENSIONS ||
      !vector.every((value) => typeof value === "number" && Number.isFinite(value))
    ) {
      throw new Error("dimension mismatch in Workers AI embedding response");
    }
    return [...vector];
  });
}

function countApproxTokens(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function retryable(failureKind: EmbeddingFailureKind, error: string): EmbeddingFailure {
  return { ok: false, retryable: true, failure_kind: failureKind, error };
}

function blocked(failureKind: EmbeddingFailureKind, error: string): EmbeddingFailure {
  return { ok: false, retryable: false, failure_kind: failureKind, error };
}

function safeMessage(failureKind: EmbeddingFailureKind): string {
  switch (failureKind) {
    case "workers_ai_allocation_exhausted":
      return "Workers AI allocation exhausted";
    case "rate_limited":
      return "Workers AI rate limited request";
    case "server_error":
      return "Workers AI server error";
    case "timeout":
      return "Workers AI request timed out";
    case "dimension_mismatch":
      return "Workers AI embedding dimensions did not match contract";
    case "invalid_request":
      return "Workers AI rejected embedding request";
    default:
      return "Workers AI embedding request failed";
  }
}

function errorStatus(error: unknown): number | undefined {
  if (isObject(error) && typeof error.status === "number") {
    return error.status;
  }
  if (isObject(error) && typeof error.statusCode === "number") {
    return error.statusCode;
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
