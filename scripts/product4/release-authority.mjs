import {
  digestJson,
  PRODUCT4_CONTEXT,
  PRODUCT4_POLICY_SHA256,
  PRODUCT4_REPOSITORY_ID,
} from "./policy-identity.mjs";

export const RELEASE_AUTHORITY_SCHEMA = "carpeos.release-authority/v1";
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const RELEASE_AUTHORITY_KEYS = [
  "schema_version",
  "receipt_type",
  "status",
  "repository_id",
  "app",
  "ownership",
  "controller",
  "tag_authority",
  "credential_issuer",
  "workflow_policy",
  "settings",
  "bypass_rehearsal",
  "rollback",
  "approval",
  "blockers",
  "observed_at",
  "receipt_digest",
];
const ROLE_KEYS = {
  controller: ["ref", "status", "independent", "can_edit_release_workflow"],
  tag_authority: ["ref", "status", "protected", "allowed_actors_digest"],
  credential_issuer: ["ref", "status", "independent", "issues_to_release_job"],
};
const APP_KEYS = ["app_id", "installation_id", "slug", "status", "checks_write"];
const OWNERSHIP_KEYS = ["owner_ref", "rotation_owner_ref", "status"];
const FORBIDDEN_KEY =
  /token|secret|private_path|protected_plaintext|script|module|url|executable|shell/i;
const AUTHORITY_LABEL_KEYS = new Set(["credential_issuer", "credential_result"]);

export class ReleaseAuthorityError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "ReleaseAuthorityError";
    this.code = code;
  }
}

export function buildReleaseAuthorityReceipt(receipt) {
  assertReleaseAuthorityReceipt(
    { ...receipt, receipt_digest: undefined },
    { allowMissingDigest: true },
  );
  const unsigned = { ...receipt };
  delete unsigned.receipt_digest;
  const result = { ...unsigned, receipt_digest: digestJson(unsigned) };
  return assertReleaseAuthorityReceipt(result);
}

export function assertReleaseAuthorityReceipt(receipt, { allowMissingDigest = false } = {}) {
  if (!isRecord(receipt)) throwAuthorityError("invalid_receipt", "authority receipt is required");
  const errors = [];
  if (Object.keys(receipt).some((key) => !RELEASE_AUTHORITY_KEYS.includes(key)))
    errors.push("receipt contains unsupported fields");
  if (receipt.schema_version !== RELEASE_AUTHORITY_SCHEMA) errors.push("schema_version is invalid");
  if (receipt.receipt_type !== "release_authority") errors.push("receipt_type is invalid");
  if (!new Set(["blocked_unknown", "verified"]).has(receipt.status))
    errors.push("status is invalid");
  if (receipt.repository_id !== PRODUCT4_REPOSITORY_ID) errors.push("repository_id is invalid");
  assertApp(receipt.app, errors);
  assertOwnership(receipt.ownership, errors);
  assertController(receipt.controller, errors);
  assertTagAuthority(receipt.tag_authority, errors);
  assertCredentialIssuer(receipt.credential_issuer, errors);
  assertWorkflowPolicy(receipt.workflow_policy, errors);
  assertSettings(receipt.settings, errors);
  assertBypassRehearsal(receipt.bypass_rehearsal, errors);
  assertRollback(receipt.rollback, errors);
  assertApproval(receipt.approval, errors);
  const blockersValid =
    Array.isArray(receipt.blockers) &&
    receipt.blockers.length <= 32 &&
    receipt.blockers.every(
      (item) => typeof item === "string" && item.length > 0 && item.length <= 200,
    );
  if (!blockersValid) errors.push("blockers are invalid");
  if (!TIMESTAMP.test(receipt.observed_at ?? "")) errors.push("observed_at is invalid");
  if (allowMissingDigest && receipt.receipt_digest === undefined) {
    // Builder validates the unsigned form before adding the derived digest.
  } else if (!SHA256.test(receipt.receipt_digest ?? "")) {
    errors.push("receipt_digest is invalid");
  }

  if (blockersValid && receipt.status === "blocked_unknown" && receipt.blockers.length === 0)
    errors.push("blocked_unknown receipt must retain blockers");
  if (receipt.status === "verified") {
    if (receipt.app?.status !== "verified" || receipt.app?.checks_write !== true)
      errors.push("verified receipt requires the independent App checks authority");
    if (receipt.ownership?.status !== "verified")
      errors.push("verified receipt requires owner and rotation proof");
    if (receipt.controller?.status !== "verified" || receipt.controller?.independent !== true)
      errors.push("verified receipt requires an independent controller");
    if (receipt.controller?.can_edit_release_workflow !== false)
      errors.push("controller must not edit the release workflow");
    if (receipt.tag_authority?.status !== "verified" || receipt.tag_authority?.protected !== true)
      errors.push("verified receipt requires protected tag authority");
    if (
      receipt.credential_issuer?.status !== "verified" ||
      receipt.credential_issuer?.independent !== true
    )
      errors.push("verified receipt requires an independent credential issuer");
    if (receipt.credential_issuer?.issues_to_release_job !== true)
      errors.push("verified receipt requires a protected release-job issuer");
    if (receipt.settings?.status !== "verified")
      errors.push("verified receipt requires settings proof");
    if (
      receipt.bypass_rehearsal?.status !== "passed" ||
      receipt.bypass_rehearsal?.gate_deleted_result !== "denied" ||
      receipt.bypass_rehearsal?.tag_result !== "denied" ||
      receipt.bypass_rehearsal?.credential_result !== "denied"
    )
      errors.push("verified receipt requires a passed bypass rehearsal");
    if (receipt.rollback?.status !== "verified")
      errors.push("verified receipt requires rollback ownership");
    if (receipt.approval?.approved !== true) errors.push("verified receipt requires approval");
    if (blockersValid && receipt.blockers.length !== 0)
      errors.push("verified receipt cannot retain blockers");
  }
  assertNoForbiddenKeys(receipt, errors);
  if (!allowMissingDigest && errors.length === 0) {
    const unsigned = { ...receipt };
    delete unsigned.receipt_digest;
    if (digestJson(unsigned) !== receipt.receipt_digest)
      errors.push("receipt_digest does not match receipt");
  }
  if (errors.length > 0) throwAuthorityError("invalid_receipt", errors.join("; "));
  return receipt;
}

export function reconcileReleaseAuthority({ receipt, releaseGate }) {
  assertReleaseAuthorityReceipt(receipt);
  const bypass = simulateReleaseBypass({ receipt, releaseGate: releaseGate ?? { deleted: true } });
  if (receipt.status !== "verified") {
    return {
      status: "blocked",
      tag_capability: "denied",
      credential_capability: "denied",
      bypass,
      blockers: [...receipt.blockers, "independent_authority_unknown"],
    };
  }
  if (bypass.tag_result !== "denied" || bypass.credential_result !== "denied") {
    return {
      status: "blocked",
      tag_capability: "denied",
      credential_capability: "denied",
      bypass,
      blockers: ["bypass_rehearsal_failed"],
    };
  }
  return {
    status: "procedural_ready",
    tag_capability: "controller_only",
    credential_capability: "protected_release_job_only",
    bypass,
    blockers: [],
  };
}

export function simulateReleaseBypass({ receipt, releaseGate }) {
  assertReleaseAuthorityReceipt(receipt);
  const deleted = releaseGate?.deleted === true;
  const actor = typeof releaseGate?.actor === "string" ? releaseGate.actor : "unknown_actor";
  const allowedActor = receipt.controller.ref === actor;
  return {
    gate_deleted: deleted,
    gate_actor: actor,
    gate_actor_allowed: allowedActor,
    gate_deleted_result: "denied",
    tag_result: "denied",
    credential_result: "denied",
    evidence_digest: digestJson({
      deleted,
      actor,
      allowed_actor: allowedActor,
      controller_ref: receipt.controller.ref,
    }),
  };
}

function assertApp(value, errors) {
  assertExactKeys(value, APP_KEYS, "app", errors);
  if (!isRecord(value)) return;
  if (!Number.isSafeInteger(value.app_id) || value.app_id <= 0)
    errors.push("app.app_id is invalid");
  if (!Number.isSafeInteger(value.installation_id) || value.installation_id <= 0)
    errors.push("app.installation_id is invalid");
  if (typeof value.slug !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(value.slug))
    errors.push("app.slug is invalid");
  assertStatus(value.status, "app.status", errors);
  if (typeof value.checks_write !== "boolean") errors.push("app.checks_write is invalid");
}

function assertOwnership(value, errors) {
  assertExactKeys(value, OWNERSHIP_KEYS, "ownership", errors);
  if (!isRecord(value)) return;
  assertRef(value.owner_ref, "ownership.owner_ref", errors);
  assertRef(value.rotation_owner_ref, "ownership.rotation_owner_ref", errors);
  assertStatus(value.status, "ownership.status", errors);
}
function assertController(value, errors) {
  assertExactKeys(value, ROLE_KEYS.controller, "controller", errors);
  if (!isRecord(value)) return;
  assertRef(value.ref, "controller.ref", errors);
  assertStatus(value.status, "controller.status", errors);
  if (typeof value.independent !== "boolean") errors.push("controller.independent is invalid");
  if (typeof value.can_edit_release_workflow !== "boolean")
    errors.push("controller.can_edit_release_workflow is invalid");
}

function assertTagAuthority(value, errors) {
  assertExactKeys(value, ROLE_KEYS.tag_authority, "tag_authority", errors);
  if (!isRecord(value)) return;
  assertRef(value.ref, "tag_authority.ref", errors);
  assertStatus(value.status, "tag_authority.status", errors);
  if (typeof value.protected !== "boolean") errors.push("tag_authority.protected is invalid");
  if (!SHA256.test(value.allowed_actors_digest ?? ""))
    errors.push("tag authority actor digest is invalid");
}

function assertCredentialIssuer(value, errors) {
  assertExactKeys(value, ROLE_KEYS.credential_issuer, "credential_issuer", errors);
  if (!isRecord(value)) return;
  assertRef(value.ref, "credential_issuer.ref", errors);
  assertStatus(value.status, "credential_issuer.status", errors);
  if (typeof value.independent !== "boolean")
    errors.push("credential_issuer.independent is invalid");
  if (typeof value.issues_to_release_job !== "boolean")
    errors.push("credential_issuer.issues_to_release_job is invalid");
}

function assertWorkflowPolicy(value, errors) {
  assertExactKeys(
    value,
    ["release_workflow_sha", "verifier_sha", "policy_sha256", "context"],
    "workflow_policy",
    errors,
  );
  if (!isRecord(value)) return;
  if (!SHA1.test(value.release_workflow_sha ?? "")) errors.push("release workflow SHA is invalid");
  if (!SHA1.test(value.verifier_sha ?? "")) errors.push("verifier SHA is invalid");
  if (value.policy_sha256 !== PRODUCT4_POLICY_SHA256) errors.push("workflow policy is not P4_0");
  if (value.context !== PRODUCT4_CONTEXT) errors.push("workflow context is invalid");
}

function assertSettings(value, errors) {
  assertExactKeys(
    value,
    ["status", "preimage_digest", "postimage_digest", "semantic_digest"],
    "settings",
    errors,
  );
  if (!isRecord(value)) return;
  assertStatus(value.status, "settings.status", errors);
  for (const key of ["preimage_digest", "postimage_digest", "semantic_digest"])
    if (!SHA256.test(value[key] ?? "")) errors.push(`settings.${key} is invalid`);
}

function assertBypassRehearsal(value, errors) {
  assertExactKeys(
    value,
    ["status", "gate_deleted_result", "tag_result", "credential_result", "evidence_digest"],
    "bypass_rehearsal",
    errors,
  );
  if (!isRecord(value)) return;
  if (!new Set(["not_run", "passed", "blocked"]).has(value.status))
    errors.push("bypass status is invalid");
  for (const key of ["gate_deleted_result", "tag_result", "credential_result"])
    if (!new Set(["denied", "unknown"]).has(value[key])) errors.push(`bypass ${key} is invalid`);
  if (!SHA256.test(value.evidence_digest ?? "")) errors.push("bypass evidence digest is invalid");
}

function assertRollback(value, errors) {
  assertExactKeys(value, ["owner_ref", "status", "fresh_read_required"], "rollback", errors);
  if (!isRecord(value)) return;
  assertRef(value.owner_ref, "rollback.owner_ref", errors);
  assertStatus(value.status, "rollback.status", errors);
  if (value.fresh_read_required !== true) errors.push("rollback must require a fresh read");
}

function assertApproval(value, errors) {
  assertExactKeys(value, ["approved", "approval_digest"], "approval", errors);
  if (!isRecord(value)) return;
  if (typeof value.approved !== "boolean") errors.push("approval.approved is invalid");
  if (!SHA256.test(value.approval_digest ?? "")) errors.push("approval digest is invalid");
}

function assertRef(value, label, errors) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_-]{2,63}$/.test(value))
    errors.push(`${label} is invalid`);
}

function assertStatus(value, label, errors) {
  if (value !== "unknown" && value !== "verified") errors.push(`${label} is invalid`);
}

function assertExactKeys(value, allowed, label, errors) {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) errors.push(`${label}.${key} is not allowed`);
}

function assertNoForbiddenKeys(value, errors, path = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertNoForbiddenKeys(item, errors, `${path}[${index}]`);
    });
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key) && !AUTHORITY_LABEL_KEYS.has(key))
      errors.push(`${path}.${key} is not allowed`);
    assertNoForbiddenKeys(child, errors, `${path}.${key}`);
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function throwAuthorityError(code, message) {
  throw new ReleaseAuthorityError(code, message);
}
