import {
  canonicalJson,
  digestJson,
  MAINTENANCE_STUDY_FIXTURE_SHA256,
  PRODUCT4_CONTEXT,
  PRODUCT4_POLICY_ID,
  PRODUCT4_POLICY_SHA256,
  PRODUCT4_REPOSITORY_ID,
} from "./policy-identity.mjs";

export const CANDIDATE_INTENT_SCHEMA_VERSION = "product4-candidate-intent-v1";
export const CANDIDATE_INTENT_STATES = Object.freeze([
  "classification_pending",
  "pending_evidence",
  "not_applicable",
]);
export const CANDIDATE_INTENT_KEYS = Object.freeze([
  "schema_version",
  "repository_id",
  "head_sha",
  "tree_sha256",
  "fixture_sha256",
  "intent_policy_sha256",
  "context",
  "intent",
  "state",
  "scope_digest",
  "issuer_workflow_sha",
  "classification_digest",
]);

const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const INPUT_KEYS = new Set([
  "repository_id",
  "head_sha",
  "tree_sha256",
  "fixture_sha256",
  "intent_policy_sha256",
  "context",
  "issuer_workflow_sha",
  "classification",
  "scope_digest",
  "mutableMetadata",
]);
const MUTABLE_KEY =
  /^(?:title|labels?|comments?|candidate[_-]?reported[_-]?status|candidate[_-]?status)$/i;
const FORBIDDEN_AUTHORITY = new Set(["Claim", "AcceptanceDecision", "Supersession"]);
const MAX_CLASSIFICATION_DEPTH = 8;
const MAX_CLASSIFICATION_KEYS = 64;
const MAX_CLASSIFICATION_ITEMS = 128;
const MAX_CLASSIFICATION_STRING = 512;

/**
 * A deterministic, base-owned Product 4 candidate-intent identity.
 *
 * `classification` is the only input that can select intent. It may be a
 * boolean or a JSON object containing one (or more equivalent) boolean
 * fields: `intent`, `candidate`, or `is_candidate`. Pull-request metadata is
 * deliberately accepted only through `mutableMetadata`; it is validated for
 * shape and never included in the identity.
 */
export function buildCandidateIntent(input) {
  const normalized = normalizeInput(input);
  const classification = classifyCandidateIntent(normalized);
  const scopeDigest = resolveScopeDigest(normalized.classification, normalized.scope_digest);
  const unsigned = {
    schema_version: CANDIDATE_INTENT_SCHEMA_VERSION,
    repository_id: PRODUCT4_REPOSITORY_ID,
    head_sha: normalized.head_sha,
    tree_sha256: normalized.tree_sha256,
    fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
    intent_policy_sha256: PRODUCT4_POLICY_SHA256,
    context: PRODUCT4_CONTEXT,
    intent: classification.intent,
    state: classification.state,
    scope_digest: scopeDigest,
    issuer_workflow_sha: normalized.issuer_workflow_sha,
  };
  const envelope = {
    ...unsigned,
    classification_digest: computeClassificationDigest(unsigned),
  };
  return assertCandidateIntent(envelope);
}

/**
 * Classify only from immutable, base-owned input. Mutable metadata is never
 * inspected and therefore cannot flip an identity's intent.
 */
export function classifyCandidateIntent(input) {
  const normalized = normalizeInput(input);
  return classifyImmutableClassification(normalized.classification);
}

/** Validate an envelope and its digest without repairing or mutating it. */
export function assertCandidateIntent(envelope) {
  if (!isRecord(envelope))
    throwCandidateIntentError("invalid_identity", "envelope must be an object");

  const actualKeys = Object.keys(envelope);
  if (
    actualKeys.length !== CANDIDATE_INTENT_KEYS.length ||
    CANDIDATE_INTENT_KEYS.some((key) => !Object.hasOwn(envelope, key)) ||
    actualKeys.some((key) => !CANDIDATE_INTENT_KEYS.includes(key))
  ) {
    throwCandidateIntentError("invalid_identity", "envelope fields must match the exact contract");
  }

  if (envelope.schema_version !== CANDIDATE_INTENT_SCHEMA_VERSION) {
    throwCandidateIntentError("invalid_identity", "schema_version is invalid");
  }
  if (envelope.repository_id !== PRODUCT4_REPOSITORY_ID) {
    throwCandidateIntentError(
      "invalid_identity",
      "repository_id is not Product 4 repository 1315097793",
    );
  }
  assertSha(envelope.head_sha, SHA1, "head_sha");
  assertSha(envelope.tree_sha256, SHA256, "tree_sha256");
  if (envelope.fixture_sha256 !== MAINTENANCE_STUDY_FIXTURE_SHA256) {
    throwCandidateIntentError(
      "fixture_mismatch",
      "fixture_sha256 is not the frozen maintenance fixture",
    );
  }
  if (envelope.intent_policy_sha256 !== PRODUCT4_POLICY_SHA256) {
    throwCandidateIntentError("policy_not_active", "intent policy is not the frozen P4_0 policy");
  }
  if (envelope.context !== PRODUCT4_CONTEXT) {
    throwCandidateIntentError("context_mismatch", "context is not Product 4 Candidate Evidence");
  }
  if (typeof envelope.intent !== "boolean") {
    throwCandidateIntentError("invalid_identity", "intent must be a boolean");
  }
  if (!CANDIDATE_INTENT_STATES.includes(envelope.state)) {
    throwCandidateIntentError("invalid_identity", "state is not a legal candidate-intent state");
  }
  assertStateIntentPair(envelope.intent, envelope.state);
  assertSha(envelope.scope_digest, SHA256, "scope_digest");
  assertSha(envelope.issuer_workflow_sha, SHA1, "issuer_workflow_sha");
  assertSha(envelope.classification_digest, SHA256, "classification_digest");

  const expectedDigest = computeClassificationDigest(envelope);
  if (expectedDigest !== envelope.classification_digest) {
    throwCandidateIntentError(
      "identity_changed",
      "classification_digest does not match the unsigned canonical envelope",
    );
  }
  return envelope;
}

/**
 * Compute the digest over an unsigned canonical envelope. A supplied
 * `classification_digest` is ignored so callers can verify either a signed
 * envelope or an unsigned candidate identity.
 */
export function computeClassificationDigest(envelope) {
  if (!isRecord(envelope)) {
    throwCandidateIntentError("invalid_identity", "digest input must be an object");
  }
  const unsigned = { ...envelope };
  delete unsigned.classification_digest;
  try {
    return digestJson(unsigned);
  } catch (error) {
    throwCandidateIntentError(
      "invalid_identity",
      `unsigned envelope is not canonically serializable: ${errorMessage(error)}`,
    );
  }
}

/** Return a copy of an envelope with its derived digest removed. */
export function unsignedCandidateIntent(envelope) {
  if (!isRecord(envelope)) {
    throwCandidateIntentError("invalid_identity", "envelope must be an object");
  }
  const unsigned = { ...envelope };
  delete unsigned.classification_digest;
  return unsigned;
}

/**
 * Enforce write-once identity semantics. Re-emitting an identical envelope is
 * idempotent; changing C/tree/classification creates a new identity and cannot
 * repair the previously issued envelope.
 */
export function assertCandidateIntentWriteOnce(existing, next) {
  assertCandidateIntent(existing);
  assertCandidateIntent(next);
  if (existing.classification_digest !== next.classification_digest) {
    throwCandidateIntentError(
      "identity_changed",
      "candidate intent is write-once; changed immutable inputs require a new identity",
    );
  }
  if (canonicalJson(existing) !== canonicalJson(next)) {
    throwCandidateIntentError(
      "identity_conflict",
      "candidate intent identity is reused with different envelope fields",
    );
  }
  return existing;
}

// Explicit aliases make the digest/write-once helper discoverable to callers
// that use the shorter terminology used by the Product 4 receipts.
export const candidateIntentDigest = computeClassificationDigest;
export const classificationDigest = computeClassificationDigest;

function normalizeInput(input) {
  if (!isRecord(input)) {
    throwCandidateIntentError("invalid_input", "candidate intent input must be an object");
  }
  const unknownKeys = Object.keys(input).filter((key) => !INPUT_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throwCandidateIntentError(
      "invalid_input",
      `unsupported input fields: ${unknownKeys.join(", ")}`,
    );
  }

  const repositoryId =
    input.repository_id === undefined ? PRODUCT4_REPOSITORY_ID : input.repository_id;
  if (repositoryId !== PRODUCT4_REPOSITORY_ID) {
    throwCandidateIntentError(
      "invalid_identity",
      "repository_id is not Product 4 repository 1315097793",
    );
  }
  const fixtureSha =
    input.fixture_sha256 === undefined ? MAINTENANCE_STUDY_FIXTURE_SHA256 : input.fixture_sha256;
  if (fixtureSha !== MAINTENANCE_STUDY_FIXTURE_SHA256) {
    throwCandidateIntentError(
      "fixture_mismatch",
      "fixture_sha256 is not the frozen maintenance fixture",
    );
  }
  const policySha =
    input.intent_policy_sha256 === undefined ? PRODUCT4_POLICY_SHA256 : input.intent_policy_sha256;
  if (policySha !== PRODUCT4_POLICY_SHA256) {
    throwCandidateIntentError("policy_not_active", "intent policy is not the frozen P4_0 policy");
  }
  const context = input.context === undefined ? PRODUCT4_CONTEXT : input.context;
  if (context !== PRODUCT4_CONTEXT) {
    throwCandidateIntentError("context_mismatch", "context is not Product 4 Candidate Evidence");
  }

  assertSha(input.head_sha, SHA1, "head_sha");
  assertSha(input.tree_sha256, SHA256, "tree_sha256");
  assertSha(input.issuer_workflow_sha, SHA1, "issuer_workflow_sha");
  if (input.scope_digest !== undefined) assertSha(input.scope_digest, SHA256, "scope_digest");
  validateClassificationValue(input.classification);
  validateMutableMetadata(input.mutableMetadata);

  return {
    repository_id: repositoryId,
    head_sha: input.head_sha,
    tree_sha256: input.tree_sha256,
    fixture_sha256: fixtureSha,
    intent_policy_sha256: policySha,
    context,
    issuer_workflow_sha: input.issuer_workflow_sha,
    classification: input.classification,
    scope_digest: input.scope_digest,
  };
}

function classifyImmutableClassification(classification) {
  if (classification === undefined || classification === null) {
    return { intent: false, state: "classification_pending" };
  }
  if (typeof classification === "boolean") {
    return {
      intent: classification,
      state: classification ? "pending_evidence" : "not_applicable",
    };
  }
  if (!isRecord(classification)) return { intent: false, state: "classification_pending" };

  const candidates = [];
  for (const key of ["intent", "candidate", "is_candidate"]) {
    if (Object.hasOwn(classification, key)) {
      if (typeof classification[key] !== "boolean")
        return { intent: false, state: "classification_pending" };
      candidates.push(classification[key]);
    }
  }
  if (candidates.length === 0 || candidates.some((value) => value !== candidates[0])) {
    return { intent: false, state: "classification_pending" };
  }
  const intent = candidates[0];
  return { intent, state: intent ? "pending_evidence" : "not_applicable" };
}

function resolveScopeDigest(classification, suppliedScopeDigest) {
  if (suppliedScopeDigest !== undefined) return suppliedScopeDigest;
  if (isRecord(classification) && classification.scope_digest !== undefined) {
    assertSha(classification.scope_digest, SHA256, "classification.scope_digest");
    return classification.scope_digest;
  }
  const digestInput = classification === undefined ? { classification: null } : classification;
  try {
    return digestJson(digestInput);
  } catch (error) {
    throwCandidateIntentError(
      "invalid_classification",
      `classification input is not canonically serializable: ${errorMessage(error)}`,
    );
  }
}

function validateClassificationValue(
  value,
  depth = 0,
  path = "classification",
  { allowMutableKeys = false, allowAuthorityKeys = false } = {},
) {
  if (value === undefined || value === null || typeof value === "boolean") return;
  if (depth > MAX_CLASSIFICATION_DEPTH) {
    throwCandidateIntentError("invalid_classification", `${path} exceeds the bounded depth`);
  }
  if (typeof value === "string") {
    if (value.length > MAX_CLASSIFICATION_STRING)
      throwCandidateIntentError(
        "invalid_classification",
        `${path} exceeds the bounded string length`,
      );
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throwCandidateIntentError("invalid_classification", `${path} must contain finite numbers`);
    return;
  }
  if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
    throwCandidateIntentError("invalid_classification", `${path} contains a non-JSON value`);
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_CLASSIFICATION_ITEMS)
      throwCandidateIntentError("invalid_classification", `${path} exceeds the bounded item count`);
    for (const [index, child] of value.entries()) {
      validateClassificationValue(child, depth + 1, `${path}[${index}]`, {
        allowMutableKeys,
        allowAuthorityKeys,
      });
    }
    return;
  }
  if (!isRecord(value)) {
    throwCandidateIntentError("invalid_classification", `${path} must contain plain JSON values`);
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throwCandidateIntentError("invalid_classification", `${path} must contain plain JSON objects`);
  }
  const keys = Object.keys(value);
  if (keys.length > MAX_CLASSIFICATION_KEYS)
    throwCandidateIntentError("invalid_classification", `${path} exceeds the bounded field count`);
  for (const key of keys) {
    if (!allowMutableKeys && MUTABLE_KEY.test(key)) {
      throwCandidateIntentError(
        "mutable_metadata",
        `${path}.${key} cannot classify immutable intent`,
      );
    }
    if (!allowAuthorityKeys && FORBIDDEN_AUTHORITY.has(key)) {
      throwCandidateIntentError(
        "auto_authority",
        `${path}.${key} cannot create automatic authority`,
      );
    }
    if (key.length > 128)
      throwCandidateIntentError("invalid_classification", `${path} has an oversized field name`);
    validateClassificationValue(value[key], depth + 1, `${path}.${key}`, {
      allowMutableKeys,
      allowAuthorityKeys,
    });
  }
}

function validateMutableMetadata(value) {
  if (value === undefined) return;
  if (!isRecord(value)) {
    throwCandidateIntentError("invalid_input", "mutableMetadata must be an object when supplied");
  }
  // The object is intentionally not traversed into the identity. Keep the
  // accepted input bounded so an ignored metadata payload cannot be used as a
  // memory/serialization sink.
  validateClassificationValue(value, 0, "mutableMetadata", {
    allowMutableKeys: true,
    allowAuthorityKeys: true,
  });
}

function assertStateIntentPair(intent, state) {
  if (state === "pending_evidence" && intent !== true) {
    throwCandidateIntentError(
      "invalid_identity",
      "pending_evidence requires immutable intent true",
    );
  }
  if (state === "not_applicable" && intent !== false) {
    throwCandidateIntentError("invalid_identity", "not_applicable requires immutable intent false");
  }
  if (state === "classification_pending" && intent !== false) {
    throwCandidateIntentError(
      "invalid_identity",
      "classification_pending is fail-closed with intent false",
    );
  }
}

function assertSha(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throwCandidateIntentError("invalid_identity", `${label} must be a bounded lowercase SHA`);
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function throwCandidateIntentError(code, message) {
  const error = new CandidateIntentError(code, message);
  throw error;
}

export class CandidateIntentError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "CandidateIntentError";
    this.code = code;
  }
}

// Keep the imported policy id explicit in this module's public surface: the
// envelope is bound to the frozen P4_0 policy, never to an arbitrary rotation.
export { PRODUCT4_POLICY_ID };
