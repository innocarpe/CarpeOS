import { assertCandidateIntent } from "./candidate-intent.mjs";
import { assertCandidateState } from "./candidate-state.mjs";
import { assertEvaluatorAttestation } from "./evaluator.mjs";
import { assertEvidenceReceipt } from "./github-evidence-api.mjs";
import {
  digestJson,
  MAINTENANCE_STUDY_FIXTURE_SHA256,
  PRODUCT4_CONTEXT,
  PRODUCT4_POLICY_SHA256,
  PRODUCT4_REPOSITORY_ID,
} from "./policy-identity.mjs";
import { assertOwnershipReceipt, assertRulesetReceipt } from "./ruleset-guard.mjs";

export const PROMOTION_LEDGER_SCHEMA = "product4-promotion-ledger-v1";
export const PROMOTION_LEDGER_TYPE = "candidate_promotion_ledger";
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const ENTRY_KINDS = new Set([
  "intent_classified",
  "evidence_attested",
  "api_reconciled",
  "ownership_observed",
  "ruleset_rehearsed",
  "promotion_deferred",
  "promotion_blocked",
]);
const ENTRY_STATUSES = new Set(["observed", "blocked", "deferred"]);
const ENTRY_ACTORS = new Set(["base_evaluator", "reconciliation", "human_authority"]);
const LEDGER_KEYS = [
  "schema_version",
  "ledger_type",
  "repository_id",
  "head_sha",
  "tree_sha256",
  "fixture_sha256",
  "policy_sha256",
  "context",
  "external_id",
  "intent_digest",
  "state_digest",
  "attestation_digest",
  "api_evidence_digest",
  "ownership_receipt_digest",
  "ruleset_receipt_digest",
  "promotion_status",
  "canonical_write",
  "blockers",
  "entries",
  "ledger_digest",
];
const FORBIDDEN_KEY =
  /token|secret|credential|private_path|protected_plaintext|script|module|url|executable|shell/i;
const FORBIDDEN_AUTHORITY = /\b(?:Claim|AcceptanceDecision|Supersession)\b/;

export class PromotionLedgerError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "PromotionLedgerError";
    this.code = code;
  }
}

export function buildPromotionLedger({
  intent,
  state,
  attestation,
  apiEvidence,
  ownershipReceipt,
  rulesetReceipt,
  observedAt,
}) {
  assertCandidateIntent(intent);
  assertCandidateState(state);
  assertEvaluatorAttestation(attestation);
  assertEvidenceReceipt(apiEvidence);
  assertOwnershipReceipt(ownershipReceipt);
  assertRulesetReceipt(rulesetReceipt);
  assertTimestamp(observedAt, "observedAt");
  assertIdentityMatch(intent, state.identity, "state");
  assertIdentityMatch(intent, attestation, "attestation");
  assertIdentityMatch(intent, apiEvidence, "api evidence");

  const blockers = collectBlockers({
    intent,
    state,
    apiEvidence,
    ownershipReceipt,
    rulesetReceipt,
  });
  const entries = [
    entry(
      1,
      "intent_classified",
      intent.intent === true ? "observed" : "blocked",
      "base_evaluator",
      intent.classification_digest,
      observedAt,
    ),
    entry(
      2,
      "evidence_attested",
      "observed",
      "base_evaluator",
      digestJson(attestation),
      observedAt,
    ),
    entry(
      3,
      "api_reconciled",
      "observed",
      "reconciliation",
      apiEvidence.receipt_digest,
      observedAt,
    ),
    entry(
      4,
      "ownership_observed",
      ownershipReceipt.status === "verified" ? "observed" : "blocked",
      "reconciliation",
      digestJson(ownershipReceipt),
      observedAt,
    ),
    entry(
      5,
      "ruleset_rehearsed",
      rulesetReceipt.status === "activated" ? "observed" : "blocked",
      "reconciliation",
      digestJson(rulesetReceipt),
      observedAt,
    ),
    entry(
      6,
      blockers.length === 0 ? "promotion_deferred" : "promotion_blocked",
      blockers.length === 0 ? "deferred" : "blocked",
      blockers.length === 0 ? "human_authority" : "base_evaluator",
      digestJson(blockers),
      observedAt,
    ),
  ];
  const unsigned = {
    schema_version: PROMOTION_LEDGER_SCHEMA,
    ledger_type: PROMOTION_LEDGER_TYPE,
    repository_id: intent.repository_id,
    head_sha: intent.head_sha,
    tree_sha256: intent.tree_sha256,
    fixture_sha256: intent.fixture_sha256,
    policy_sha256: intent.intent_policy_sha256,
    context: intent.context,
    external_id: `carpeos-4.0.0:${intent.head_sha}:${intent.fixture_sha256}`,
    intent_digest: intent.classification_digest,
    state_digest: state.state_digest,
    attestation_digest: digestJson(attestation),
    api_evidence_digest: apiEvidence.receipt_digest,
    ownership_receipt_digest: digestJson(ownershipReceipt),
    ruleset_receipt_digest: digestJson(rulesetReceipt),
    promotion_status: blockers.length === 0 ? "pending_human_authority" : "blocked",
    canonical_write: "none",
    blockers,
    entries,
  };
  const ledger = { ...unsigned, ledger_digest: digestJson(unsigned) };
  return assertPromotionLedger(ledger);
}

export function appendPromotionEntry(ledger, nextEntry) {
  assertPromotionLedger(ledger);
  assertEntry(nextEntry, ledger.entries.length + 1);
  const unsigned = {
    ...ledger,
    entries: [...ledger.entries, { ...nextEntry }],
  };
  delete unsigned.ledger_digest;
  return assertPromotionLedger({ ...unsigned, ledger_digest: digestJson(unsigned) });
}

export function assertPromotionLedger(ledger) {
  if (!isRecord(ledger)) throwLedgerError("invalid_ledger", "promotion ledger must be an object");
  const errors = [];
  if (Object.keys(ledger).some((key) => !LEDGER_KEYS.includes(key)))
    errors.push("ledger contains unsupported fields");
  if (ledger.schema_version !== PROMOTION_LEDGER_SCHEMA) errors.push("schema_version is invalid");
  if (ledger.ledger_type !== PROMOTION_LEDGER_TYPE) errors.push("ledger_type is invalid");
  if (ledger.repository_id !== PRODUCT4_REPOSITORY_ID) errors.push("repository_id is invalid");
  if (!SHA1.test(ledger.head_sha ?? "")) errors.push("head_sha is invalid");
  if (!SHA256.test(ledger.tree_sha256 ?? "")) errors.push("tree_sha256 is invalid");
  if (ledger.fixture_sha256 !== MAINTENANCE_STUDY_FIXTURE_SHA256)
    errors.push("fixture_sha256 is invalid");
  if (ledger.policy_sha256 !== PRODUCT4_POLICY_SHA256) errors.push("policy_sha256 is not P4_0");
  if (ledger.context !== PRODUCT4_CONTEXT) errors.push("context is invalid");
  if (ledger.external_id !== `carpeos-4.0.0:${ledger.head_sha}:${MAINTENANCE_STUDY_FIXTURE_SHA256}`)
    errors.push("external_id is not C-bound");
  for (const key of [
    "intent_digest",
    "state_digest",
    "attestation_digest",
    "api_evidence_digest",
    "ownership_receipt_digest",
    "ruleset_receipt_digest",
    "ledger_digest",
  ])
    if (!SHA256.test(ledger[key] ?? "")) errors.push(`${key} is invalid`);
  if (!new Set(["blocked", "pending_human_authority"]).has(ledger.promotion_status))
    errors.push("promotion_status is invalid");
  if (ledger.canonical_write !== "none") errors.push("canonical_write must remain none");
  const blockersValid =
    Array.isArray(ledger.blockers) &&
    ledger.blockers.length <= 32 &&
    ledger.blockers.every(
      (blocker) => typeof blocker === "string" && blocker.length > 0 && blocker.length <= 200,
    );
  if (!blockersValid) errors.push("blockers are invalid");
  if (blockersValid && ledger.promotion_status === "blocked" && ledger.blockers.length === 0)
    errors.push("blocked ledger must retain blockers");
  if (
    blockersValid &&
    ledger.promotion_status === "pending_human_authority" &&
    ledger.blockers.length !== 0
  )
    errors.push("pending ledger cannot retain blockers");
  if (!Array.isArray(ledger.entries) || ledger.entries.length < 1 || ledger.entries.length > 128)
    errors.push("entries are invalid");
  else {
    ledger.entries.forEach((item, index) => {
      try {
        assertEntry(item, index + 1);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `entry ${index + 1} is invalid`);
      }
    });
  }
  assertNoForbiddenFields(ledger, errors);
  if (errors.length === 0) {
    const unsigned = { ...ledger };
    delete unsigned.ledger_digest;
    if (digestJson(unsigned) !== ledger.ledger_digest) errors.push("ledger_digest is invalid");
  }
  if (errors.length > 0) throwLedgerError("invalid_ledger", errors.join("; "));
  return ledger;
}

function collectBlockers({ intent, state, apiEvidence, ownershipReceipt, rulesetReceipt }) {
  const blockers = [];
  if (intent.intent !== true || intent.state !== "pending_evidence")
    blockers.push("candidate_intent_not_active");
  if (state.state !== "bc-preflip") blockers.push("human_authority_required");
  if (apiEvidence.status !== "verified") blockers.push("api_evidence_not_verified");
  if (ownershipReceipt.status !== "verified") blockers.push("ownership_unknown");
  if (rulesetReceipt.status !== "activated") blockers.push("ruleset_activation_not_verified");
  return blockers;
}

function assertIdentityMatch(intent, value, label) {
  for (const key of [
    "repository_id",
    "head_sha",
    "tree_sha256",
    "fixture_sha256",
    "intent_policy_sha256",
    "policy_sha256",
    "context",
  ]) {
    const expected =
      key === "intent_policy_sha256" || key === "policy_sha256"
        ? intent.intent_policy_sha256
        : intent[key];
    const actual = value[key];
    if (actual !== undefined && actual !== expected)
      throwLedgerError("identity_conflict", `${label} ${key} does not match C/P4_0 identity`);
  }
}

function entry(sequence, kind, status, actor, evidenceDigest, observedAt) {
  return {
    sequence,
    kind,
    status,
    actor,
    evidence_digest: evidenceDigest,
    observed_at: observedAt,
  };
}

function assertEntry(value, expectedSequence) {
  if (!isRecord(value)) throwLedgerError("invalid_entry", "ledger entry must be an object");
  const allowed = ["sequence", "kind", "status", "actor", "evidence_digest", "observed_at"];
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throwLedgerError("invalid_entry", `entry ${expectedSequence} contains unsupported fields`);
  if (value.sequence !== expectedSequence)
    throwLedgerError("invalid_entry", "entry sequence is not append-only");
  if (!ENTRY_KINDS.has(value.kind)) throwLedgerError("invalid_entry", "entry kind is invalid");
  if (!ENTRY_STATUSES.has(value.status))
    throwLedgerError("invalid_entry", "entry status is invalid");
  if (!ENTRY_ACTORS.has(value.actor)) throwLedgerError("invalid_entry", "entry actor is invalid");
  if (!SHA256.test(value.evidence_digest ?? ""))
    throwLedgerError("invalid_entry", "entry evidence digest is invalid");
  if (!TIMESTAMP.test(value.observed_at ?? ""))
    throwLedgerError("invalid_entry", "entry timestamp is invalid");
}

function assertNoForbiddenFields(value, errors, path = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertNoForbiddenFields(item, errors, `${path}[${index}]`);
    });
    return;
  }
  if (!isRecord(value)) {
    if (typeof value === "string" && FORBIDDEN_AUTHORITY.test(value))
      errors.push(`${path} contains forbidden authority`);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) errors.push(`${path}.${key} is not allowed`);
    assertNoForbiddenFields(child, errors, `${path}.${key}`);
  }
}

function assertTimestamp(value, label) {
  if (!TIMESTAMP.test(value ?? "")) throwLedgerError("invalid_timestamp", `${label} is invalid`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function throwLedgerError(code, message) {
  throw new PromotionLedgerError(code, message);
}
