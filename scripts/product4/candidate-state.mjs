import {
  digestJson,
  MAINTENANCE_STUDY_FIXTURE_SHA256,
  PRODUCT4_CONTEXT,
  PRODUCT4_POLICY_SHA256,
  PRODUCT4_REPOSITORY_ID,
} from "./policy-identity.mjs";

export const PRODUCT4_STATE_SCHEMA = "carpeos.product4-candidate-state/v1";
export const PRODUCT4_CHECK_NAME = "Product 4 Candidate Evidence";
export const CANDIDATE_STATES = Object.freeze([
  "classification_pending",
  "pending_evidence",
  "not_applicable",
  "bc-preflip",
]);

const SHA256 = /^[0-9a-f]{64}$/;
const SHA1 = /^[0-9a-f]{40}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const FORBIDDEN_KEY =
  /token|secret|credential|private_path|protected_plaintext|script|module|url|executable|shell|candidate_success/i;
const IDENTITY_KEYS = [
  "repository_id",
  "head_sha",
  "tree_sha256",
  "fixture_sha256",
  "intent_policy_sha256",
  "context",
];
const STATE_KEYS = [
  "schema_version",
  "identity",
  "intent",
  "state",
  "transitions",
  "evidence_tuple",
  "state_digest",
];
const TRANSITION_KEYS = ["from", "to", "actor", "evidence_digest", "observed_at"];
const EVIDENCE_KEYS = [
  "base_sha",
  "head_sha",
  "tree_sha256",
  "fixture_sha256",
  "intent_policy_sha256",
  "context",
  "check_name",
  "external_id",
  "attestation_sha256",
];

export function createCandidateState({ intentEnvelope, observedAt = "2026-01-02T00:00:00Z" }) {
  const identity = identityFromIntent(intentEnvelope);
  assertTimestamp(observedAt, "observedAt");
  const state = {
    schema_version: PRODUCT4_STATE_SCHEMA,
    identity,
    intent: null,
    state: "classification_pending",
    transitions: [],
    evidence_tuple: null,
  };
  return withStateDigest(state);
}

export function classifyCandidateState({
  state,
  intentEnvelope,
  observedAt = "2026-01-02T00:00:00Z",
}) {
  assertCandidateState(state);
  const identity = identityFromIntent(intentEnvelope);
  assertSameIdentity(state.identity, identity);
  assertTimestamp(observedAt, "observedAt");
  if (state.state !== "classification_pending" || state.intent !== null) {
    throwStateError("state_conflict", "classification is write-once");
  }
  if (intentEnvelope.intent !== true && intentEnvelope.intent !== false) {
    throwStateError("classification_pending", "immutable intent is missing or ambiguous");
  }
  const nextState = intentEnvelope.intent ? "pending_evidence" : "not_applicable";
  return transition(state, {
    to: nextState,
    intent: intentEnvelope.intent,
    actor: "base_classifier",
    evidence_digest: intentEnvelope.classification_digest,
    observed_at: observedAt,
  });
}

export function promoteCandidateState({
  state,
  evidenceTuple,
  approval,
  observedAt = "2026-01-02T00:00:00Z",
}) {
  assertCandidateState(state);
  assertTimestamp(observedAt, "observedAt");
  if (state.state !== "pending_evidence" || state.intent !== true) {
    throwStateError("invalid_transition", "only a candidate pending evidence may be promoted");
  }
  assertEvidenceTuple(evidenceTuple, state.identity);
  assertApproval(approval);
  return transition(
    { ...state, evidence_tuple: { ...evidenceTuple } },
    {
      to: "bc-preflip",
      intent: true,
      actor: "human_authority",
      evidence_digest: approval.approval_digest,
      observed_at: observedAt,
    },
  );
}

export function assertCandidateState(state) {
  if (!isRecord(state)) throwStateError("invalid_state", "candidate state must be an object");
  const errors = [];
  assertExactKeys(state, STATE_KEYS, "state", errors);
  if (state.schema_version !== PRODUCT4_STATE_SCHEMA) errors.push("schema_version is invalid");
  if (!isRecord(state.identity)) errors.push("identity is required");
  else assertIdentity(state.identity, errors);
  if (state.intent !== null && typeof state.intent !== "boolean") errors.push("intent is invalid");
  if (!CANDIDATE_STATES.includes(state.state)) errors.push("state is invalid");
  if (!Array.isArray(state.transitions) || state.transitions.length > 2) {
    errors.push("transitions must contain at most two entries");
  } else {
    for (const [index, event] of state.transitions.entries()) {
      assertTransition(event, index, errors);
    }
    assertTransitionOrder(state.transitions, state.intent, state.state, errors);
  }
  if (state.evidence_tuple !== null) {
    if (!isRecord(state.identity)) errors.push("evidence tuple cannot be checked without identity");
    else {
      try {
        assertEvidenceTuple(state.evidence_tuple, state.identity);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "evidence_tuple is invalid");
      }
    }
  }
  assertNoForbiddenKeys(state, errors);
  if (!SHA256.test(state.state_digest ?? "")) errors.push("state_digest is invalid");
  else {
    const unsigned = { ...state };
    delete unsigned.state_digest;
    if (digestJson(unsigned) !== state.state_digest)
      errors.push("state_digest does not match state");
  }
  if (errors.length > 0) throwStateError("invalid_state", errors.join("; "));
  return state;
}

function transition(state, event) {
  const next = {
    ...state,
    intent: event.intent,
    state: event.to,
    transitions: [
      ...state.transitions,
      {
        from: state.state,
        to: event.to,
        actor: event.actor,
        evidence_digest: event.evidence_digest,
        observed_at: event.observed_at,
      },
    ],
  };
  const result = withStateDigest(next);
  assertCandidateState(result);
  return result;
}

function identityFromIntent(intentEnvelope) {
  if (!isRecord(intentEnvelope)) throwStateError("invalid_intent", "intent envelope is required");
  const identity = {
    repository_id: intentEnvelope.repository_id,
    head_sha: intentEnvelope.head_sha,
    tree_sha256: intentEnvelope.tree_sha256,
    fixture_sha256: intentEnvelope.fixture_sha256,
    intent_policy_sha256: intentEnvelope.intent_policy_sha256,
    context: intentEnvelope.context,
  };
  const errors = [];
  assertIdentity(identity, errors);
  if (intentEnvelope.intent_policy_sha256 !== PRODUCT4_POLICY_SHA256)
    errors.push("intent policy is not active P4_0");
  if (intentEnvelope.context !== PRODUCT4_CONTEXT) errors.push("context is not frozen");
  if (errors.length > 0) throwStateError("invalid_intent", errors.join("; "));
  return identity;
}

function assertIdentity(identity, errors) {
  assertExactKeys(identity, IDENTITY_KEYS, "identity", errors);
  if (identity.repository_id !== PRODUCT4_REPOSITORY_ID) errors.push("repository_id is invalid");
  if (!SHA1.test(identity.head_sha ?? "")) errors.push("head_sha is invalid");
  if (!SHA256.test(identity.tree_sha256 ?? "")) errors.push("tree_sha256 is invalid");
  if (identity.fixture_sha256 !== MAINTENANCE_STUDY_FIXTURE_SHA256)
    errors.push("fixture_sha256 is invalid");
  if (identity.intent_policy_sha256 !== PRODUCT4_POLICY_SHA256)
    errors.push("intent_policy_sha256 is not P4_0");
  if (identity.context !== PRODUCT4_CONTEXT) errors.push("context is invalid");
}

function assertSameIdentity(left, right) {
  if (digestJson(left) !== digestJson(right))
    throwStateError("identity_conflict", "candidate identity changed; require a new C");
}

function assertTransition(event, index, errors) {
  if (!isRecord(event)) {
    errors.push(`transitions[${index}] must be an object`);
    return;
  }
  assertExactKeys(event, TRANSITION_KEYS, `transitions[${index}]`, errors);
  if (event.from !== null && !CANDIDATE_STATES.includes(event.from))
    errors.push(`transitions[${index}].from is invalid`);
  if (!CANDIDATE_STATES.includes(event.to)) errors.push(`transitions[${index}].to is invalid`);
  if (event.actor !== "base_classifier" && event.actor !== "human_authority")
    errors.push(`transitions[${index}].actor is invalid`);
  if (!SHA256.test(event.evidence_digest ?? ""))
    errors.push(`transitions[${index}].evidence_digest is invalid`);
  if (!TIMESTAMP.test(event.observed_at ?? ""))
    errors.push(`transitions[${index}].observed_at is invalid`);
}

function assertTransitionOrder(transitions, intent, state, errors) {
  if (transitions.length === 0) {
    if (state !== "classification_pending" || intent !== null)
      errors.push("unclassified state must have no transitions");
    return;
  }
  const first = transitions[0];
  if (first.from !== "classification_pending" || first.actor !== "base_classifier")
    errors.push("first transition must be base classification");
  if (first.to !== "pending_evidence" && first.to !== "not_applicable")
    errors.push("first transition must classify candidate intent");
  if (transitions.length === 1 && state !== first.to)
    errors.push("state does not match transition");
  if (transitions.length === 2) {
    const second = transitions[1];
    if (
      first.to !== "pending_evidence" ||
      second.from !== "pending_evidence" ||
      second.to !== "bc-preflip"
    )
      errors.push("promotion order is invalid");
    if (second.actor !== "human_authority") errors.push("promotion requires human authority");
    if (state !== "bc-preflip" || intent !== true) errors.push("promoted state is invalid");
  }
}

function assertEvidenceTuple(tuple, identity) {
  if (!isRecord(tuple)) throwStateError("invalid_evidence", "evidence tuple must be an object");
  const errors = [];
  assertExactKeys(tuple, EVIDENCE_KEYS, "evidence_tuple", errors);
  if (!SHA1.test(tuple.base_sha ?? "")) errors.push("evidence_tuple.base_sha is invalid");
  if (tuple.head_sha !== identity.head_sha) errors.push("evidence_tuple.head_sha mismatches C");
  if (tuple.tree_sha256 !== identity.tree_sha256)
    errors.push("evidence_tuple.tree_sha256 mismatches C");
  if (tuple.fixture_sha256 !== identity.fixture_sha256)
    errors.push("evidence_tuple.fixture_sha256 mismatches fixture");
  if (tuple.intent_policy_sha256 !== identity.intent_policy_sha256)
    errors.push("evidence_tuple.intent_policy_sha256 mismatches P4_0");
  if (tuple.context !== PRODUCT4_CONTEXT) errors.push("evidence_tuple.context is invalid");
  if (tuple.check_name !== PRODUCT4_CHECK_NAME) errors.push("evidence_tuple.check_name is invalid");
  if (typeof tuple.external_id !== "string" || tuple.external_id.length > 180)
    errors.push("evidence_tuple.external_id is invalid");
  if (!SHA256.test(tuple.attestation_sha256 ?? ""))
    errors.push("evidence_tuple.attestation_sha256 is invalid");
  if (errors.length > 0) throwStateError("invalid_evidence", errors.join("; "));
}

function assertApproval(approval) {
  if (!isRecord(approval) || approval.approved !== true)
    throwStateError("approval_required", "promotion requires explicit human approval");
  if (approval.actor_ref !== "human_authority")
    throwStateError("approval_required", "promotion approval actor is invalid");
  if (!SHA256.test(approval.approval_digest ?? ""))
    throwStateError("approval_required", "promotion approval digest is invalid");
  const errors = [];
  assertExactKeys(approval, ["approved", "actor_ref", "approval_digest"], "approval", errors);
  assertNoForbiddenKeys(approval, errors);
  if (errors.length > 0) throwStateError("approval_required", errors.join("; "));
}

function assertExactKeys(value, allowed, label, errors) {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${label}.${key} is not allowed`);
  }
}

function assertNoForbiddenKeys(value, errors, path = "$") {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertNoForbiddenKeys(item, errors, `${path}[${index}]`);
    }
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) errors.push(`${path}.${key} is not allowed`);
    assertNoForbiddenKeys(child, errors, `${path}.${key}`);
  }
}

function assertTimestamp(value, label) {
  if (!TIMESTAMP.test(value)) throwStateError("invalid_timestamp", `${label} is invalid`);
}

function withStateDigest(state) {
  const { state_digest: _ignored, ...unsigned } = state;
  return { ...unsigned, state_digest: digestJson(unsigned) };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function throwStateError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.name = "CandidateStateError";
  error.code = code;
  throw error;
}
