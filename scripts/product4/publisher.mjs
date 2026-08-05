import { assertEvaluatorAttestation, attestationDigest, EvaluatorError } from "./evaluator.mjs";

export class PublisherError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "PublisherError";
    this.code = code;
  }
}

export function publishAttestation({ attestation, dataSink }) {
  if (typeof dataSink !== "function")
    throwPublisherError("sink_required", "publisher data sink is required");
  try {
    assertEvaluatorAttestation(attestation);
  } catch (error) {
    if (error instanceof EvaluatorError) throwPublisherError("attestation_refusal", error.message);
    throw error;
  }
  const payload = clone(attestation);
  const digest = attestationDigest(payload);
  const sinkResult = dataSink(payload);
  return {
    status: "published_data_only",
    attestation_digest: digest,
    sink_result: sanitizeSinkResult(sinkResult),
  };
}

function sanitizeSinkResult(value) {
  if (value === undefined) return null;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  if (Array.isArray(value)) return value.map(sanitizeSinkResult);
  if (typeof value === "object") {
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      if (
        /token|secret|credential|private_path|protected_plaintext|script|module|url|executable|shell/i.test(
          key,
        )
      )
        throwPublisherError("unsafe_sink_result", `${key} is not allowed`);
      result[key] = sanitizeSinkResult(child);
    }
    return result;
  }
  throwPublisherError("unsafe_sink_result", "sink returned an unsupported value");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function throwPublisherError(code, message) {
  throw new PublisherError(code, message);
}
