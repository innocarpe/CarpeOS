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
  "authority_evidence",
];
const ROLE_KEYS = {
  controller: ["ref", "status", "independent", "can_edit_release_workflow"],
  tag_authority: ["ref", "status", "protected", "allowed_actors_digest"],
  credential_issuer: ["ref", "status", "independent", "issues_to_release_job"],
};
const AUTHORITY_EVIDENCE_KEYS = [
  "schema_version",
  "source",
  "issuer_ref",
  "signed",
  "live",
  "repository_id",
  "release_workflow_sha",
  "verifier_sha",
  "ruleset_digest",
  "settings_digest",
  "controller_capability_digest",
  "protected_tag_policy_digest",
  "credential_issuer_ref",
  "credential_issuer_digest",
  "approval_digest",
  "signature",
  "evidence_digest",
  "observed_at",
];
const BYPASS_OBSERVATION_KEYS = [
  "gate_deleted",
  "gate_actor",
  "gate_actor_allowed",
  "gate_deleted_result",
  "tag_result",
  "credential_result",
  "evidence_digest",
];
const APP_KEYS = ["app_id", "installation_id", "slug", "status", "checks_write"];
const OWNERSHIP_KEYS = ["owner_ref", "rotation_owner_ref", "status"];
const FORBIDDEN_KEY =
  /token|secret|private_path|protected_plaintext|script|module|url|executable|shell/i;
const AUTHORITY_LABEL_KEYS = new Set(["credential_issuer", "credential_result"]);
const AUTHORITY_EVIDENCE_SCHEMA = "carpeos.release-authority-evidence/v1";
const AUTHORITY_EVIDENCE_SOURCES = new Set(["external", "external_authority", "live_external"]);
const BYPASS_RESULTS = new Set(["denied", "unknown"]);

export class ReleaseAuthorityError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "ReleaseAuthorityError";
    this.code = code;
  }
}

export function buildReleaseAuthorityReceipt(
  receipt,
  { authorityEvidence, externalEvidence } = {},
) {
  const normalized = { ...receipt };
  const suppliedEvidence = authorityEvidence ?? externalEvidence;
  if (suppliedEvidence !== undefined) normalized.authority_evidence = suppliedEvidence;
  const evidenceErrors = collectAuthorityEvidenceErrors(normalized.authority_evidence, normalized);
  if (normalized.status === "verified" && evidenceErrors.length > 0) {
    normalized.status = "blocked_unknown";
    normalized.blockers = [
      ...new Set([
        ...(Array.isArray(normalized.blockers) ? normalized.blockers : []),
        "authority_evidence_invalid",
      ]),
    ];
    delete normalized.authority_evidence;
  }
  assertReleaseAuthorityReceipt(
    { ...normalized, receipt_digest: undefined },
    { allowMissingDigest: true },
  );
  const unsigned = { ...normalized };
  delete unsigned.receipt_digest;
  const result = { ...unsigned, receipt_digest: digestJson(unsigned) };
  return assertReleaseAuthorityReceipt(result);
}

export function buildReleaseAuthorityEvidence(input = {}) {
  const receipt = input.receipt;
  const value = {
    schema_version: AUTHORITY_EVIDENCE_SCHEMA,
    source: input.source ?? "external_authority",
    issuer_ref: input.issuer_ref ?? "external_release_authority",
    signed: input.signed ?? true,
    live: input.live ?? true,
    repository_id: input.repository_id ?? receipt?.repository_id ?? PRODUCT4_REPOSITORY_ID,
    release_workflow_sha:
      input.release_workflow_sha ??
      input.releaseWorkflowSha ??
      receipt?.workflow_policy?.release_workflow_sha,
    verifier_sha: input.verifier_sha ?? input.verifierSha ?? receipt?.workflow_policy?.verifier_sha,
    ruleset_digest:
      input.ruleset_digest ?? input.rulesetDigest ?? digestJson(receipt?.ownership ?? null),
    settings_digest:
      input.settings_digest ?? input.settingsDigest ?? digestJson(receipt?.settings ?? null),
    controller_capability_digest:
      input.controller_capability_digest ??
      input.controllerCapabilityDigest ??
      digestJson(receipt?.controller ?? null),
    protected_tag_policy_digest:
      input.protected_tag_policy_digest ??
      input.protectedTagPolicyDigest ??
      digestJson(receipt?.tag_authority ?? null),
    credential_issuer_ref:
      input.credential_issuer_ref ?? input.credentialIssuerRef ?? receipt?.credential_issuer?.ref,
    credential_issuer_digest:
      input.credential_issuer_digest ??
      input.credentialIssuerDigest ??
      digestJson(receipt?.credential_issuer ?? null),
    approval_digest:
      input.approval_digest ?? input.approvalDigest ?? receipt?.approval?.approval_digest,
    observed_at: input.observed_at ?? input.observedAt ?? receipt?.observed_at,
  };
  const signature = digestJson(value);
  const signed = { ...value, signature };
  return { ...signed, evidence_digest: digestJson(signed) };
}

export function assertReleaseAuthorityEvidence(evidence, receipt) {
  const errors = collectAuthorityEvidenceErrors(evidence, receipt);
  if (errors.length > 0) throwAuthorityError("invalid_evidence", errors.join("; "));
  return evidence;
}

export function buildBypassObservation({ receipt, releaseGate = {}, results = {} } = {}) {
  if (!isRecord(receipt)) throwAuthorityError("invalid_receipt", "authority receipt is required");
  const actor = releaseGate.actor ?? results.gate_actor;
  const deleted = releaseGate.deleted ?? results.gate_deleted;
  if (typeof actor !== "string" || typeof deleted !== "boolean")
    throwAuthorityError(
      "bypass_observation_missing",
      "bypass actor and deletion observation are required",
    );
  const observation = {
    gate_deleted: deleted,
    gate_actor: actor,
    gate_actor_allowed: receipt.controller?.ref === actor,
    gate_deleted_result: results.gate_deleted_result ?? "unknown",
    tag_result: results.tag_result ?? "unknown",
    credential_result: results.credential_result ?? "unknown",
  };
  const evidence = {
    ...observation,
    controller_ref: receipt.controller?.ref,
  };
  return { ...observation, evidence_digest: digestJson(evidence) };
}

export function assertReleaseAuthorityReceipt(
  receipt,
  { allowMissingDigest = false, expectedWorkflowSha, expectedVerifierSha } = {},
) {
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
  if (
    expectedWorkflowSha !== undefined &&
    receipt.workflow_policy?.release_workflow_sha !== expectedWorkflowSha
  )
    errors.push("release workflow SHA does not match current workflow");
  if (
    expectedVerifierSha !== undefined &&
    receipt.workflow_policy?.verifier_sha !== expectedVerifierSha
  )
    errors.push("verifier SHA does not match current verifier");
  assertSettings(receipt.settings, errors);
  assertBypassRehearsal(receipt.bypass_rehearsal, errors);
  assertRollback(receipt.rollback, errors);
  assertApproval(receipt.approval, errors);
  if (receipt.authority_evidence !== undefined)
    errors.push(...collectAuthorityEvidenceErrors(receipt.authority_evidence, receipt));
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
    if (receipt.authority_evidence === undefined)
      errors.push("verified receipt requires independent authority evidence");
    if (collectAuthorityEvidenceErrors(receipt.authority_evidence, receipt).length > 0)
      errors.push("verified receipt authority evidence is not bound");
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

export function reconcileReleaseAuthority({ receipt, releaseGate } = {}) {
  assertReleaseAuthorityReceipt(receipt);
  let bypass;
  try {
    bypass = simulateReleaseBypass({ receipt, releaseGate });
  } catch (error) {
    const code = error instanceof ReleaseAuthorityError ? error.code : "bypass_observation_invalid";
    return {
      status: "blocked",
      tag_capability: "denied",
      credential_capability: "denied",
      bypass: {
        status: "blocked",
        gate_deleted_result: "unknown",
        tag_result: "unknown",
        credential_result: "unknown",
      },
      blockers: [...(receipt.blockers ?? []), code],
    };
  }
  const blockers = [];
  if (receipt.status !== "verified")
    blockers.push(...receipt.blockers, "independent_authority_unknown");
  if (receipt.status === "verified") {
    if (
      bypass.gate_deleted_result !== receipt.bypass_rehearsal.gate_deleted_result ||
      bypass.tag_result !== receipt.bypass_rehearsal.tag_result ||
      bypass.credential_result !== receipt.bypass_rehearsal.credential_result ||
      bypass.evidence_digest !== receipt.bypass_rehearsal.evidence_digest
    )
      blockers.push("bypass_observation_inconsistent");
    if (
      bypass.tag_result !== "denied" ||
      bypass.credential_result !== "denied" ||
      bypass.gate_deleted_result !== "denied"
    )
      blockers.push("bypass_rehearsal_failed");
  }
  if (blockers.length > 0) {
    return {
      status: "blocked",
      tag_capability: "denied",
      credential_capability: "denied",
      bypass,
      blockers: [...new Set(blockers)],
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

export function simulateReleaseBypass({ receipt, releaseGate } = {}) {
  assertReleaseAuthorityReceipt(receipt);
  if (!isRecord(releaseGate)) {
    throwAuthorityError("bypass_observation_missing", "bypass observations are required");
  }
  const inlineObservations = Object.fromEntries(
    BYPASS_OBSERVATION_KEYS.filter((key) => releaseGate[key] !== undefined).map((key) => [
      key,
      releaseGate[key],
    ]),
  );
  const observations =
    releaseGate.observations ??
    releaseGate.observation ??
    releaseGate.observed_results ??
    releaseGate.observed ??
    releaseGate.results ??
    (Object.keys(inlineObservations).length > 0 ? inlineObservations : undefined);
  if (!isRecord(observations)) {
    throwAuthorityError("bypass_observation_missing", "bypass results are required");
  }
  if (Object.keys(observations).some((key) => !BYPASS_OBSERVATION_KEYS.includes(key)))
    throwAuthorityError("bypass_observation_inconsistent", "unsupported bypass observation fields");
  const deleted = releaseGate.deleted ?? observations.gate_deleted;
  const actor = releaseGate.actor ?? observations.gate_actor;
  if (typeof deleted !== "boolean" || typeof actor !== "string") {
    throwAuthorityError("bypass_observation_missing", "bypass actor and deletion are required");
  }
  const expectedAllowedActor = receipt.controller.ref === actor;
  if (observations.gate_deleted !== undefined && observations.gate_deleted !== deleted)
    throwAuthorityError("bypass_observation_inconsistent", "gate deletion observation conflicts");
  if (observations.gate_actor !== undefined && observations.gate_actor !== actor)
    throwAuthorityError("bypass_observation_inconsistent", "gate actor observation conflicts");
  if (
    observations.gate_actor_allowed !== undefined &&
    observations.gate_actor_allowed !== expectedAllowedActor
  )
    throwAuthorityError("bypass_observation_inconsistent", "gate actor authorization conflicts");
  for (const key of ["gate_deleted_result", "tag_result", "credential_result"]) {
    if (!BYPASS_RESULTS.has(observations[key]))
      throwAuthorityError("bypass_observation_missing", `${key} observation is required`);
  }
  const evidence = {
    gate_deleted: deleted,
    gate_actor: actor,
    gate_actor_allowed: expectedAllowedActor,
    gate_deleted_result: observations.gate_deleted_result,
    tag_result: observations.tag_result,
    credential_result: observations.credential_result,
    controller_ref: receipt.controller.ref,
  };
  if (
    !SHA256.test(observations.evidence_digest ?? "") ||
    digestJson(evidence) !== observations.evidence_digest
  )
    throwAuthorityError("bypass_observation_inconsistent", "bypass evidence digest is invalid");
  return {
    gate_deleted: deleted,
    gate_actor: actor,
    gate_actor_allowed: expectedAllowedActor,
    gate_deleted_result: observations.gate_deleted_result,
    tag_result: observations.tag_result,
    credential_result: observations.credential_result,
    evidence_digest: observations.evidence_digest,
  };
}
function collectAuthorityEvidenceErrors(evidence, receipt) {
  const errors = [];
  if (!isRecord(evidence)) {
    errors.push("authority evidence is required");
    return errors;
  }
  assertExactKeys(evidence, AUTHORITY_EVIDENCE_KEYS, "authority_evidence", errors);
  if (evidence.schema_version !== AUTHORITY_EVIDENCE_SCHEMA)
    errors.push("authority evidence schema is invalid");
  if (!AUTHORITY_EVIDENCE_SOURCES.has(evidence.source))
    errors.push("authority evidence source is not external");
  assertRef(evidence.issuer_ref, "authority evidence issuer_ref", errors);
  if (evidence.signed !== true) errors.push("authority evidence is not signed");
  if (evidence.live !== true) errors.push("authority evidence is not live");
  if (evidence.repository_id !== PRODUCT4_REPOSITORY_ID)
    errors.push("authority evidence repository is invalid");
  if (!SHA1.test(evidence.release_workflow_sha ?? ""))
    errors.push("authority evidence release workflow SHA is invalid");
  if (!SHA1.test(evidence.verifier_sha ?? ""))
    errors.push("authority evidence verifier SHA is invalid");
  for (const key of [
    "ruleset_digest",
    "settings_digest",
    "controller_capability_digest",
    "protected_tag_policy_digest",
    "credential_issuer_digest",
    "approval_digest",
    "signature",
    "evidence_digest",
  ])
    if (!SHA256.test(evidence[key] ?? "")) errors.push(`authority evidence ${key} is invalid`);
  assertRef(evidence.credential_issuer_ref, "authority evidence credential issuer", errors);
  if (!TIMESTAMP.test(evidence.observed_at ?? ""))
    errors.push("authority evidence timestamp is invalid");
  if (SHA256.test(evidence.signature ?? "")) {
    const unsigned = { ...evidence };
    delete unsigned.signature;
    delete unsigned.evidence_digest;
    if (digestJson(unsigned) !== evidence.signature)
      errors.push("authority evidence signature does not match");
  }
  if (SHA256.test(evidence.evidence_digest ?? "")) {
    const signed = { ...evidence };
    delete signed.evidence_digest;
    if (digestJson(signed) !== evidence.evidence_digest)
      errors.push("authority evidence digest does not match");
  }
  if (isRecord(receipt)) {
    const bindings = [
      ["repository_id", receipt.repository_id],
      ["release_workflow_sha", receipt.workflow_policy?.release_workflow_sha],
      ["verifier_sha", receipt.workflow_policy?.verifier_sha],
      ["ruleset_digest", digestJson(receipt.ownership ?? null)],
      ["settings_digest", digestJson(receipt.settings ?? null)],
      ["controller_capability_digest", digestJson(receipt.controller ?? null)],
      ["protected_tag_policy_digest", digestJson(receipt.tag_authority ?? null)],
      ["credential_issuer_ref", receipt.credential_issuer?.ref],
      ["credential_issuer_digest", digestJson(receipt.credential_issuer ?? null)],
      ["approval_digest", receipt.approval?.approval_digest],
    ];
    for (const [key, expected] of bindings)
      if (expected !== undefined && evidence[key] !== expected)
        errors.push(`authority evidence ${key} is not bound`);
    const roleRefs = new Set([
      receipt.controller?.ref,
      receipt.tag_authority?.ref,
      receipt.credential_issuer?.ref,
      receipt.ownership?.owner_ref,
      receipt.ownership?.rotation_owner_ref,
    ]);
    if (roleRefs.has(evidence.issuer_ref))
      errors.push("authority evidence issuer is not independent");
    if (receipt.observed_at !== undefined && evidence.observed_at !== receipt.observed_at)
      errors.push("authority evidence timestamp is not bound");
  }
  return errors;
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
