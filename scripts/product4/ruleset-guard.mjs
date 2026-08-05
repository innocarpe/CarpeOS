import {
  canonicalJson,
  digestJson,
  PRODUCT4_CONTEXT,
  PRODUCT4_POLICY_SHA256,
  PRODUCT4_REPOSITORY_ID,
} from "./policy-identity.mjs";

export const PRODUCT4_RULESET_ID = 19955787;
export const PRODUCT4_CONTEXT_NAME = "Product 4 Candidate Evidence";
export const RULESET_ACTIVATION_SCHEMA = "ruleset-activation-v1";

const SHA256 = /^[0-9a-f]{64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const FORBIDDEN_KEY =
  /token|secret|credential|private_path|protected_plaintext|script|module|url|executable|shell/i;
const OWNERSHIP_KEYS = [
  "schema_version",
  "receipt_type",
  "status",
  "repository_id",
  "ruleset_id",
  "context",
  "policy_sha256",
  "app",
  "authorities",
  "evidence",
  "approval",
  "blockers",
  "observed_at",
];
const AUTHORITY_KEYS = [
  "rotation_owner",
  "settings_admin",
  "release_controller",
  "credential_owner",
  "artifact_owner",
];
const RULESET_KEYS = [
  "schema_version",
  "receipt_type",
  "status",
  "repository_id",
  "ruleset_id",
  "context",
  "policy_sha256",
  "operation",
  "preimage_digest",
  "post_image_digest",
  "preservation_digest",
  "ownership_receipt_digest",
  "approval_digest",
  "response_loss",
  "rollback",
  "blockers",
  "observed_at",
];

export class RulesetGuardError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "RulesetGuardError";
    this.code = code;
  }
}

export function assertOwnershipReceipt(receipt) {
  if (!isRecord(receipt))
    throwRulesetError("invalid_ownership", "ownership receipt must be an object");
  const errors = [];
  assertExactKeys(receipt, OWNERSHIP_KEYS, "ownership", errors);
  if (receipt.schema_version !== "product4-ownership-v1") errors.push("schema_version is invalid");
  if (receipt.receipt_type !== "product4_ownership") errors.push("receipt_type is invalid");
  if (receipt.status !== "blocked_unknown" && receipt.status !== "verified")
    errors.push("status is invalid");
  if (receipt.repository_id !== PRODUCT4_REPOSITORY_ID) errors.push("repository_id is invalid");
  if (receipt.ruleset_id !== PRODUCT4_RULESET_ID) errors.push("ruleset_id is invalid");
  if (receipt.context !== PRODUCT4_CONTEXT || receipt.context !== PRODUCT4_CONTEXT_NAME)
    errors.push("context is not frozen");
  if (receipt.policy_sha256 !== PRODUCT4_POLICY_SHA256) errors.push("policy is not P4_0");
  assertApp(receipt.app, errors);
  assertAuthorities(receipt.authorities, errors);
  assertEvidence(receipt.evidence, receipt.app, errors);
  assertApproval(receipt.approval, errors);
  if (!Array.isArray(receipt.blockers) || receipt.blockers.length > 32)
    errors.push("blockers must be a bounded array");
  if (
    Array.isArray(receipt.blockers) &&
    receipt.blockers.some((item) => typeof item !== "string" || item.length > 200)
  )
    errors.push("blockers contain an invalid message");
  if (!TIMESTAMP.test(receipt.observed_at ?? "")) errors.push("observed_at is invalid");
  if (
    receipt.status === "blocked_unknown" &&
    (!Array.isArray(receipt.blockers) || receipt.blockers.length === 0)
  )
    errors.push("blocked_unknown ownership must name a blocker");
  if (receipt.status === "verified") {
    if (receipt.app.checks_write !== true) errors.push("verified ownership requires checks:write");
    if (AUTHORITY_KEYS.some((key) => receipt.authorities[key]?.status !== "verified"))
      errors.push("verified ownership requires every authority receipt");
    if (receipt.approval.approved !== true) errors.push("verified ownership requires approval");
    if (receipt.blockers.length !== 0) errors.push("verified ownership cannot retain blockers");
  }
  assertNoForbiddenKeys(receipt, errors);
  if (errors.length > 0) throwRulesetError("invalid_ownership", errors.join("; "));
  return receipt;
}

export function projectFixedContext({ ruleset, ownershipReceipt, approval }) {
  assertRulesetPreimage(ruleset);
  assertOwnershipReceipt(ownershipReceipt);
  assertActivationApproval(approval);
  const preimage = clone(ruleset);
  const preimageDigest = digestJson(preimage);
  if (ownershipReceipt.status !== "verified") {
    return {
      status: "blocked",
      operation: "semantic_add_fixed_context",
      repository_id: PRODUCT4_REPOSITORY_ID,
      ruleset_id: PRODUCT4_RULESET_ID,
      context: PRODUCT4_CONTEXT_NAME,
      policy_sha256: PRODUCT4_POLICY_SHA256,
      preimage_digest: preimageDigest,
      post_image_digest: preimageDigest,
      preservation_digest: preservationDigest(preimage),
      ownership_receipt_digest: digestJson(ownershipReceipt),
      approval_digest: approval.approval_digest,
      response_loss: "none",
      rollback: { authorized: false, fresh_read_required: true, status: "blocked" },
      blockers: ["ownership_unknown"],
      observed_at: approval.observed_at,
    };
  }
  const existing = preimage.required_contexts.find(
    (item) => isRecord(item) && item.context === PRODUCT4_CONTEXT_NAME,
  );
  if (existing !== undefined) {
    if (existing.integration_id !== ownershipReceipt.app.app_id)
      throwRulesetError("context_conflict", "fixed context already belongs to another App");
    throwRulesetError("duplicate_refusal", "fixed context is already present");
  }
  const postImage = {
    ...preimage,
    required_contexts: [
      ...preimage.required_contexts,
      { context: PRODUCT4_CONTEXT_NAME, integration_id: ownershipReceipt.app.app_id },
    ],
  };
  assertSemanticProjection(preimage, postImage, ownershipReceipt.app.app_id);
  return {
    status: "dry_run",
    operation: "semantic_add_fixed_context",
    repository_id: PRODUCT4_REPOSITORY_ID,
    ruleset_id: PRODUCT4_RULESET_ID,
    context: PRODUCT4_CONTEXT_NAME,
    policy_sha256: PRODUCT4_POLICY_SHA256,
    preimage_digest: preimageDigest,
    post_image_digest: digestJson(postImage),
    preservation_digest: preservationDigest(preimage),
    ownership_receipt_digest: digestJson(ownershipReceipt),
    approval_digest: approval.approval_digest,
    response_loss: "none",
    rollback: { authorized: false, fresh_read_required: true, status: "not_requested" },
    blockers: [],
    observed_at: approval.observed_at,
    preimage,
    post_image: postImage,
  };
}

export function reconcileRulesetResponse({ projection, response }) {
  assertProjection(projection);
  if (!isRecord(response) || (response.status !== "lost" && response.status !== "received"))
    throwRulesetError("response_loss", "ruleset response must be received or lost");
  if (response.status === "lost") {
    return {
      ...projection,
      status: "blocked",
      response_loss: "blocked_indeterminate",
      rollback: { authorized: false, fresh_read_required: true, status: "blocked" },
      blockers: ["response_loss_requires_authenticated_reconciliation"],
    };
  }
  if (!isRecord(response.post_image))
    throwRulesetError("malformed_response", "post-image is required");
  assertSemanticProjection(
    projection.preimage,
    response.post_image,
    projection.post_image.required_contexts.at(-1).integration_id,
  );
  if (digestJson(response.post_image) !== projection.post_image_digest)
    throwRulesetError("drift_detected", "post-image digest differs from the projection");
  return {
    ...projection,
    status: "blocked",
    response_loss: "reconciled",
    blockers: ["live_activation_requires_independent_authorization"],
  };
}

export function prepareRollback({ projection, current, freshReadDigest, approval }) {
  assertProjection(projection);
  assertActivationApproval(approval);
  if (!isRecord(current) || digestJson(current) !== projection.post_image_digest)
    throwRulesetError("drift_detected", "rollback requires the exact projected post-image");
  if (freshReadDigest !== digestJson(current))
    throwRulesetError("stale_read", "rollback requires a fresh authenticated read");
  if (approval.approved !== true)
    throwRulesetError("approval_required", "rollback requires explicit approval");
  return {
    ...projection,
    status: "blocked",
    operation: "semantic_rollback",
    response_loss: "none",
    rollback: { authorized: true, fresh_read_required: true, status: "ready" },
    blockers: ["live_rollback_requires_independent_authorization"],
  };
}

export function assertRulesetReceipt(receipt) {
  if (!isRecord(receipt)) throwRulesetError("invalid_receipt", "ruleset receipt must be an object");
  const errors = [];
  assertExactKeys(receipt, RULESET_KEYS, "ruleset", errors);
  if (receipt.schema_version !== RULESET_ACTIVATION_SCHEMA)
    errors.push("schema_version is invalid");
  if (receipt.receipt_type !== "product4_ruleset_activation")
    errors.push("receipt_type is invalid");
  if (!["dry_run", "blocked", "activated", "rolled_back"].includes(receipt.status))
    errors.push("status is invalid");
  if (receipt.repository_id !== PRODUCT4_REPOSITORY_ID) errors.push("repository_id is invalid");
  if (receipt.ruleset_id !== PRODUCT4_RULESET_ID) errors.push("ruleset_id is invalid");
  if (receipt.context !== PRODUCT4_CONTEXT_NAME) errors.push("context is invalid");
  if (receipt.policy_sha256 !== PRODUCT4_POLICY_SHA256) errors.push("policy is not P4_0");
  if (!["semantic_add_fixed_context", "semantic_rollback"].includes(receipt.operation))
    errors.push("operation is invalid");
  for (const key of [
    "preimage_digest",
    "post_image_digest",
    "preservation_digest",
    "ownership_receipt_digest",
    "approval_digest",
  ])
    if (!SHA256.test(receipt[key] ?? "")) errors.push(`${key} is invalid`);
  if (!["none", "reconciled", "blocked_indeterminate"].includes(receipt.response_loss))
    errors.push("response_loss is invalid");
  if (!isRecord(receipt.rollback) || receipt.rollback.fresh_read_required !== true)
    errors.push("rollback guard is invalid");
  if (!Array.isArray(receipt.blockers) || receipt.blockers.some((item) => typeof item !== "string"))
    errors.push("blockers are invalid");
  if (!TIMESTAMP.test(receipt.observed_at ?? "")) errors.push("observed_at is invalid");
  assertNoForbiddenKeys(receipt, errors);
  if (errors.length > 0) throwRulesetError("invalid_receipt", errors.join("; "));
  return receipt;
}

function assertProjection(projection) {
  if (!isRecord(projection) || !isRecord(projection.preimage) || !isRecord(projection.post_image))
    throwRulesetError("invalid_projection", "semantic projection pre/post images are required");
  if (
    projection.context !== PRODUCT4_CONTEXT_NAME ||
    projection.policy_sha256 !== PRODUCT4_POLICY_SHA256
  )
    throwRulesetError("context_mismatch", "projection is not frozen to P4_0");
  if (digestJson(projection.preimage) !== projection.preimage_digest)
    throwRulesetError("invalid_projection", "preimage digest does not match");
  if (digestJson(projection.post_image) !== projection.post_image_digest)
    throwRulesetError("invalid_projection", "post-image digest does not match");
}

function assertRulesetPreimage(ruleset) {
  if (!isRecord(ruleset))
    throwRulesetError("invalid_ruleset", "ruleset preimage must be an object");
  if (ruleset.repository_id !== PRODUCT4_REPOSITORY_ID)
    throwRulesetError("invalid_ruleset", "repository id is invalid");
  if (ruleset.ruleset_id !== PRODUCT4_RULESET_ID)
    throwRulesetError("invalid_ruleset", "ruleset id is invalid");
  if (
    typeof ruleset.name !== "string" ||
    typeof ruleset.target !== "string" ||
    typeof ruleset.enforcement !== "string"
  )
    throwRulesetError("invalid_ruleset", "ruleset name, target, and enforcement are required");
  if (
    !Array.isArray(ruleset.bypass_actors) ||
    !isRecord(ruleset.conditions) ||
    !Array.isArray(ruleset.rules)
  )
    throwRulesetError("invalid_ruleset", "ruleset semantic fields are required");
  if (!Array.isArray(ruleset.required_contexts))
    throwRulesetError("invalid_ruleset", "required_contexts must be an array");
  const errors = [];
  assertNoForbiddenKeys(ruleset, errors);
  if (errors.length > 0) throwRulesetError("unsafe_ruleset", errors.join("; "));
}

function assertSemanticProjection(preimage, postImage, appId) {
  assertRulesetPreimage(preimage);
  assertRulesetPreimage(postImage);
  const withoutContexts = (value) => {
    const cloneValue = clone(value);
    delete cloneValue.required_contexts;
    return cloneValue;
  };
  if (canonicalJson(withoutContexts(preimage)) !== canonicalJson(withoutContexts(postImage)))
    throwRulesetError("preservation_failure", "projection changed unrelated ruleset fields");
  const newContexts = postImage.required_contexts.filter(
    (item) => isRecord(item) && item.context === PRODUCT4_CONTEXT_NAME,
  );
  if (newContexts.length !== 1 || newContexts[0].integration_id !== appId)
    throwRulesetError("projection_failure", "projection must add exactly one fixed context");
  const oldContexts = preimage.required_contexts.filter(
    (item) => isRecord(item) && item.context === PRODUCT4_CONTEXT_NAME,
  );
  if (oldContexts.length !== 0)
    throwRulesetError("duplicate_refusal", "preimage already has fixed context");
}

function preservationDigest(ruleset) {
  const preserved = clone(ruleset);
  delete preserved.required_contexts;
  return digestJson(preserved);
}

function assertApp(app, errors) {
  if (!isRecord(app)) {
    errors.push("app is required");
    return;
  }
  if (!Number.isSafeInteger(app.app_id) || app.app_id <= 0) errors.push("app_id is invalid");
  if (!Number.isSafeInteger(app.installation_id) || app.installation_id <= 0)
    errors.push("installation_id is invalid");
  if (typeof app.slug !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(app.slug))
    errors.push("app slug is invalid");
  if (typeof app.checks_write !== "boolean") errors.push("checks_write is invalid");
}

function assertAuthorities(authorities, errors) {
  if (!isRecord(authorities)) {
    errors.push("authorities are required");
    return;
  }
  for (const key of AUTHORITY_KEYS) {
    const authority = authorities[key];
    if (!isRecord(authority) || !["unknown", "verified"].includes(authority.status))
      errors.push(`${key} is invalid`);
    if (
      !isRecord(authority) ||
      typeof authority.ref !== "string" ||
      !/^[a-z][a-z0-9_-]{2,63}$/.test(authority.ref)
    )
      errors.push(`${key}.ref is invalid`);
  }
}

function assertEvidence(evidence, app, errors) {
  if (!isRecord(evidence)) {
    errors.push("evidence is required");
    return;
  }
  if (evidence.repository_id !== PRODUCT4_REPOSITORY_ID)
    errors.push("evidence repository mismatch");
  if (evidence.ruleset_id !== PRODUCT4_RULESET_ID) errors.push("evidence ruleset mismatch");
  if (evidence.app_id !== app?.app_id || evidence.installation_id !== app?.installation_id)
    errors.push("evidence App mismatch");
  if (evidence.policy_sha256 !== PRODUCT4_POLICY_SHA256) errors.push("evidence policy mismatch");
  if (!SHA256.test(evidence.preimage_digest ?? ""))
    errors.push("evidence preimage digest is invalid");
}

function assertApproval(approval, errors) {
  if (!isRecord(approval)) {
    errors.push("approval is required");
    return;
  }
  if (typeof approval.approved !== "boolean" || !SHA256.test(approval.approval_digest ?? ""))
    errors.push("approval is invalid");
}

function assertActivationApproval(approval) {
  if (
    !isRecord(approval) ||
    approval.approved !== true ||
    !SHA256.test(approval.approval_digest ?? "")
  )
    throwRulesetError("approval_required", "explicit approval digest is required");
  if (!TIMESTAMP.test(approval.observed_at ?? ""))
    throwRulesetError("approval_required", "approval observed_at is required");
  const errors = [];
  assertNoForbiddenKeys(approval, errors);
  if (errors.length > 0) throwRulesetError("approval_required", errors.join("; "));
}

function assertExactKeys(value, allowed, label, errors) {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) errors.push(`${label}.${key} is not allowed`);
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
    if (FORBIDDEN_KEY.test(key) && key !== "credential_owner")
      errors.push(`${path}.${key} is not allowed`);
    assertNoForbiddenKeys(child, errors, `${path}.${key}`);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function throwRulesetError(code, message) {
  throw new RulesetGuardError(code, message);
}
