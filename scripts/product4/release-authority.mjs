import {
  digestJson,
  MAINTENANCE_STUDY_FIXTURE_SHA256,
  PRODUCT4_CONTEXT,
  PRODUCT4_POLICY_ID,
  PRODUCT4_POLICY_SHA256,
  PRODUCT4_REPOSITORY_ID,
} from "./policy-identity.mjs";

export const RELEASE_AUTHORITY_SCHEMA = "carpeos.release-authority/v1";
export const AUTHORITY_EVIDENCE_SCHEMA = "carpeos.release-authority-evidence/v1";

const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const TAG = /^v\d+\.\d+\.\d+$/;
const EXTERNAL_ID = /^carpeos-4\.0\.0:([0-9a-f]{40}):([0-9a-f]{64})$/;

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
  "provenance",
  "request",
  "release",
  "policy",
  "issuer",
  "trust_root",
  "signature",
  "protected_controller_receipt",
  "freshness",
  "verification_method",
  "bypass",
  "evidence_digest",
];
const AUTHORITY_EVIDENCE_REQUIRED_KEYS = [
  "schema_version",
  "provenance",
  "request",
  "release",
  "policy",
  "issuer",
  "trust_root",
  "freshness",
  "verification_method",
  "evidence_digest",
];
const PROVENANCE_KEYS = [
  "source",
  "issuer_ref",
  "receipt_ref",
  "request_digest",
  "release_digest",
  "observed_at",
];
const REQUEST_KEYS = [
  "repository_id",
  "external_id",
  "candidate_sha",
  "fixture_sha256",
  "approval_digest",
  "request_digest",
];
const RELEASE_KEYS = [
  "repository_id",
  "release_sha",
  "workflow_sha",
  "verifier_sha",
  "tag",
  "version",
  "approval_digest",
];
const POLICY_KEYS = ["policy_id", "policy_sha256", "context", "fixture_sha256"];
const ISSUER_KEYS = ["ref", "kind", "independent"];
const TRUST_ROOT_KEYS = ["ref", "digest"];
const SIGNATURE_KEYS = ["algorithm", "key_ref", "value"];
const FRESHNESS_KEYS = ["observed_at", "expires_at", "max_age_seconds"];
const PROTECTED_CONTROLLER_RECEIPT_KEYS = [
  "schema_version",
  "receipt_type",
  "repository_id",
  "request_digest",
  "release_sha",
  "release_workflow_sha",
  "verifier_sha",
  "policy_id",
  "policy_sha256",
  "context",
  "approval_digest",
  "controller_ref",
  "signature",
  "observed_at",
  "receipt_digest",
  "bypass_evidence_digest",
];
const PROTECTED_CONTROLLER_RECEIPT_REQUIRED_KEYS = [
  "schema_version",
  "receipt_type",
  "repository_id",
  "request_digest",
  "release_sha",
  "release_workflow_sha",
  "verifier_sha",
  "policy_id",
  "policy_sha256",
  "context",
  "approval_digest",
  "controller_ref",
  "signature",
  "observed_at",
  "receipt_digest",
];
const AUTHORITY_BYPASS_KEYS = [
  "gate_deleted_result",
  "tag_result",
  "credential_result",
  "evidence_digest",
];
const BYPASS_OBSERVATION_KEYS = [
  "gate_deleted",
  "gate_actor",
  "gate_actor_allowed",
  "gate_deleted_result",
  "tag_result",
  "credential_result",
  "evidence_digest",
  "authority_evidence_digest",
];
const APP_KEYS = ["app_id", "installation_id", "slug", "status", "checks_write"];
const OWNERSHIP_KEYS = ["owner_ref", "rotation_owner_ref", "status"];
const FORBIDDEN_KEY =
  /token|secret|private_path|protected_plaintext|script|module|url|executable|shell/i;
const AUTHORITY_LABEL_KEYS = new Set(["credential_issuer", "credential_result"]);
const EXTERNAL_SOURCES = new Set(["external", "external_authority", "live_external"]);
const VERIFICATION_METHODS = new Set([
  "self_asserted_digest",
  "independent_verifier_callback",
  "protected_controller_receipt",
]);
const EXTERNAL_SIGNATURE_ALGORITHMS = new Set(["ed25519", "sigstore"]);
const BYPASS_RESULTS = new Set(["denied", "unknown"]);

export class ReleaseAuthorityError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "ReleaseAuthorityError";
    this.code = code;
  }
}

/**
 * Build a receipt without granting authority. A receipt marked verified is only retained when an
 * external verifier callback or a protected-controller receipt supplies the authority evidence.
 */
export function buildReleaseAuthorityReceipt(receipt, options = {}) {
  const normalized = { ...receipt };
  const expectedRequest =
    options.releaseRequest ?? options.release_request ?? options.expectedRequest;
  const verificationAt = resolveVerificationAt(options, expectedRequest);
  let suppliedEvidence = options.authorityEvidence ?? options.externalEvidence;
  let verifierSupplied = false;
  const verifier =
    options.authorityVerifier ??
    options.verifyAuthority ??
    options.externalVerifier ??
    options.independentVerifier ??
    options.verifier;
  const protectedControllerReceipt =
    options.protectedControllerReceipt ?? options.protectedController ?? options.protectedReceipt;

  if (typeof verifier === "function") {
    try {
      const verification =
        verifier.length >= 2
          ? verifier(normalized, expectedRequest, suppliedEvidence, verificationAt)
          : verifier({
              receipt: normalized,
              request: expectedRequest,
              evidence: suppliedEvidence,
              verificationAt,
            });
      const returnedEvidence = extractEvidence(verification);
      if (returnedEvidence !== undefined) suppliedEvidence = returnedEvidence;
      verifierSupplied = returnedEvidence !== undefined;
    } catch {
      suppliedEvidence = undefined;
      verifierSupplied = false;
    }
  }

  if (suppliedEvidence === undefined && protectedControllerReceipt !== undefined) {
    suppliedEvidence = buildProtectedControllerEvidence(
      normalized,
      protectedControllerReceipt,
      expectedRequest,
      options,
    );
  }
  if (suppliedEvidence !== undefined) normalized.authority_evidence = suppliedEvidence;

  const evidenceErrors = collectAuthorityEvidenceErrors(normalized.authority_evidence, normalized, {
    expectedRequest,
    verificationAt,
    requireExternal: normalized.status === "verified",
    requireVerifierCallback: normalized.status === "verified",
    verifierSupplied,
  });
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
    { allowMissingDigest: true, expectedRequest, verificationAt },
  );
  const unsigned = { ...normalized };
  delete unsigned.receipt_digest;
  const result = { ...unsigned, receipt_digest: digestJson(unsigned) };
  return assertReleaseAuthorityReceipt(result, { expectedRequest, verificationAt });
}

/**
 * This helper intentionally emits local, self-asserted evidence. Its digest is useful for
 * diagnostics only and is never accepted as independent release authority.
 */
export function buildReleaseAuthorityEvidence(input = {}) {
  const receipt = input.receipt;
  const observedAt =
    input.observed_at ?? input.observedAt ?? receipt?.observed_at ?? "1970-01-01T00:00:00Z";
  const request = buildEvidenceRequest(receipt, input);
  const release = buildEvidenceRelease(receipt, input, request);
  const policy = buildEvidencePolicy(input);
  const freshness = buildFreshness(observedAt, input);
  const provenance = {
    source: "local",
    issuer_ref: "local_builder",
    receipt_ref: "local-build",
    request_digest: request.request_digest,
    release_digest: digestJson(release),
    observed_at: observedAt,
  };
  const issuer = { ref: "local_builder", kind: "local_builder", independent: false };
  const trustRoot = { ref: "local_builder", digest: digestJson(issuer) };
  const unsigned = {
    schema_version: AUTHORITY_EVIDENCE_SCHEMA,
    provenance,
    request,
    release,
    policy,
    issuer,
    trust_root: trustRoot,
    freshness,
    verification_method: "self_asserted_digest",
    signature: {
      algorithm: "local_digest",
      key_ref: "local_builder",
      value: digestJson({
        provenance,
        request,
        release,
        policy,
        issuer,
        trust_root: trustRoot,
        freshness,
      }),
    },
  };
  const bypass = input.bypass ?? input.bypass_rehearsal;
  if (isRecord(bypass)) unsigned.bypass = buildAuthorityBypass(bypass);
  return { ...unsigned, evidence_digest: digestJson(unsigned) };
}

export function assertReleaseAuthorityEvidence(evidence, receipt, options = {}) {
  const verificationAt = resolveVerificationAt(options, options.expectedRequest);
  const errors = collectAuthorityEvidenceErrors(evidence, receipt, {
    ...options,
    verificationAt,
    requireExternal: options.requireExternal ?? true,
    requireVerifierCallback: options.requireVerifierCallback ?? options.requireExternal ?? true,
  });
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
  const result = { ...observation, evidence_digest: digestJson(evidence) };
  if (receipt.authority_evidence?.evidence_digest)
    result.authority_evidence_digest = receipt.authority_evidence.evidence_digest;
  return result;
}

export function assertReleaseAuthorityReceipt(receipt, options = {}) {
  const {
    allowMissingDigest = false,
    expectedWorkflowSha,
    expectedVerifierSha,
    expectedRequest,
  } = options;
  const verificationAt = resolveVerificationAt(options, expectedRequest);
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
    errors.push(
      ...collectAuthorityEvidenceErrors(receipt.authority_evidence, receipt, {
        expectedRequest,
        verificationAt,
        requireExternal: receipt.status === "verified",
      }),
    );
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
    if (
      collectAuthorityEvidenceErrors(receipt.authority_evidence, receipt, {
        expectedRequest,
        verificationAt,
        requireExternal: true,
      }).length > 0
    )
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

export function reconcileReleaseAuthority({
  receipt,
  releaseGate,
  expectedRequest,
  ...options
} = {}) {
  const verificationAt = resolveVerificationAt(options, expectedRequest);
  assertReleaseAuthorityReceipt(receipt, { expectedRequest, verificationAt });
  let bypass;
  try {
    bypass = simulateReleaseBypass({
      receipt,
      releaseGate,
      expectedRequest,
      verificationAt,
    });
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

export function simulateReleaseBypass({ receipt, releaseGate, expectedRequest, ...options } = {}) {
  const verificationAt = resolveVerificationAt(options, expectedRequest);
  assertReleaseAuthorityReceipt(receipt, { expectedRequest, verificationAt });
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
  if (
    receipt.status === "verified" ||
    observations.gate_deleted_result === "denied" ||
    observations.tag_result === "denied" ||
    observations.credential_result === "denied"
  )
    assertExternalBypassEvidence(receipt, observations);
  return {
    gate_deleted: deleted,
    gate_actor: actor,
    gate_actor_allowed: expectedAllowedActor,
    gate_deleted_result: observations.gate_deleted_result,
    tag_result: observations.tag_result,
    credential_result: observations.credential_result,
    evidence_digest: observations.evidence_digest,
    ...(observations.authority_evidence_digest
      ? { authority_evidence_digest: observations.authority_evidence_digest }
      : {}),
  };
}

function collectAuthorityEvidenceErrors(
  evidence,
  receipt,
  {
    expectedRequest,
    verificationAt,
    requireExternal = false,
    requireVerifierCallback = false,
    verifierSupplied = false,
  } = {},
) {
  const errors = [];
  if (!isRecord(evidence)) {
    errors.push("authority evidence is required");
    return errors;
  }
  if (requireExternal && !TIMESTAMP.test(verificationAt ?? ""))
    errors.push("authority verification time is invalid");
  assertExactKeys(evidence, AUTHORITY_EVIDENCE_KEYS, "authority_evidence", errors);
  assertRequiredKeys(evidence, AUTHORITY_EVIDENCE_REQUIRED_KEYS, "authority_evidence", errors);
  if (evidence.schema_version !== AUTHORITY_EVIDENCE_SCHEMA)
    errors.push("authority evidence schema is invalid");

  const provenance = evidence.provenance;
  assertNestedObject(provenance, PROVENANCE_KEYS, "authority evidence provenance", errors);
  if (isRecord(provenance)) {
    if (typeof provenance.source !== "string") errors.push("authority evidence source is invalid");
    if (!EXTERNAL_SOURCES.has(provenance.source) && provenance.source !== "local")
      errors.push("authority evidence source is invalid");
    assertRef(provenance.issuer_ref, "authority evidence provenance issuer_ref", errors);
    assertRef(provenance.receipt_ref, "authority evidence provenance receipt_ref", errors);
    if (!SHA256.test(provenance.request_digest ?? ""))
      errors.push("authority evidence provenance request digest is invalid");
    if (!SHA256.test(provenance.release_digest ?? ""))
      errors.push("authority evidence provenance release digest is invalid");
    if (!TIMESTAMP.test(provenance.observed_at ?? ""))
      errors.push("authority evidence provenance timestamp is invalid");
  }

  const request = evidence.request;
  assertNestedObject(request, REQUEST_KEYS, "authority evidence request", errors);
  if (isRecord(request)) {
    if (request.repository_id !== PRODUCT4_REPOSITORY_ID)
      errors.push("authority evidence request repository is invalid");
    assertExternalId(request.external_id, request.candidate_sha, request.fixture_sha256, errors);
    if (!SHA1.test(request.candidate_sha ?? ""))
      errors.push("authority evidence request candidate SHA is invalid");
    if (request.fixture_sha256 !== MAINTENANCE_STUDY_FIXTURE_SHA256)
      errors.push("authority evidence request fixture is not frozen");
    if (!SHA256.test(request.approval_digest ?? ""))
      errors.push("authority evidence request approval digest is invalid");
    if (!SHA256.test(request.request_digest ?? ""))
      errors.push("authority evidence request digest is invalid");
    else if (digestJson(stripKey(request, "request_digest")) !== request.request_digest)
      errors.push("authority evidence request digest does not match");
  }

  const release = evidence.release;
  assertNestedObject(release, RELEASE_KEYS, "authority evidence release", errors);
  if (isRecord(release)) {
    if (release.repository_id !== PRODUCT4_REPOSITORY_ID)
      errors.push("authority evidence release repository is invalid");
    if (!SHA1.test(release.release_sha ?? ""))
      errors.push("authority evidence release SHA is invalid");
    if (!SHA1.test(release.workflow_sha ?? ""))
      errors.push("authority evidence release workflow SHA is invalid");
    if (!SHA1.test(release.verifier_sha ?? ""))
      errors.push("authority evidence release verifier SHA is invalid");
    if (!TAG.test(release.tag ?? "") || !VERSION.test(release.version ?? ""))
      errors.push("authority evidence release tag or version is invalid");
    if (!SHA256.test(release.approval_digest ?? ""))
      errors.push("authority evidence release approval digest is invalid");
  }

  const policy = evidence.policy;
  assertNestedObject(policy, POLICY_KEYS, "authority evidence policy", errors);
  if (isRecord(policy)) {
    if (policy.policy_id !== PRODUCT4_POLICY_ID)
      errors.push("authority evidence policy id is invalid");
    if (policy.policy_sha256 !== PRODUCT4_POLICY_SHA256)
      errors.push("authority evidence policy is not P4_0");
    if (policy.context !== PRODUCT4_CONTEXT)
      errors.push("authority evidence policy context is invalid");
    if (policy.fixture_sha256 !== MAINTENANCE_STUDY_FIXTURE_SHA256)
      errors.push("authority evidence policy fixture is invalid");
  }

  const issuer = evidence.issuer;
  assertNestedObject(issuer, ISSUER_KEYS, "authority evidence issuer", errors);
  if (isRecord(issuer)) {
    assertRef(issuer.ref, "authority evidence issuer ref", errors);
    if (!new Set(["external_verifier", "protected_controller", "local_builder"]).has(issuer.kind))
      errors.push("authority evidence issuer kind is invalid");
    if (typeof issuer.independent !== "boolean")
      errors.push("authority evidence issuer independence is invalid");
  }

  const trustRoot = evidence.trust_root;
  assertNestedObject(trustRoot, TRUST_ROOT_KEYS, "authority evidence trust root", errors);
  if (isRecord(trustRoot)) {
    assertRef(trustRoot.ref, "authority evidence trust root ref", errors);
    if (!SHA256.test(trustRoot.digest ?? ""))
      errors.push("authority evidence trust root digest is invalid");
  }

  const freshness = evidence.freshness;
  assertNestedObject(freshness, FRESHNESS_KEYS, "authority evidence freshness", errors);
  if (isRecord(freshness)) {
    if (!TIMESTAMP.test(freshness.observed_at ?? ""))
      errors.push("authority evidence freshness timestamp is invalid");
    if (!TIMESTAMP.test(freshness.expires_at ?? ""))
      errors.push("authority evidence expiry is invalid");
    if (
      typeof freshness.max_age_seconds !== "number" ||
      !Number.isSafeInteger(freshness.max_age_seconds)
    )
      errors.push("authority evidence freshness max age is invalid");
    else if (freshness.max_age_seconds <= 0 || freshness.max_age_seconds > 604800)
      errors.push("authority evidence freshness max age is outside bounds");
    if (
      TIMESTAMP.test(freshness.observed_at ?? "") &&
      TIMESTAMP.test(freshness.expires_at ?? "") &&
      Date.parse(freshness.expires_at) <= Date.parse(freshness.observed_at)
    )
      errors.push("authority evidence expiry is not after observation");
    if (
      requireExternal &&
      TIMESTAMP.test(freshness.expires_at ?? "") &&
      TIMESTAMP.test(verificationAt ?? "") &&
      Date.parse(freshness.expires_at) <= Date.parse(verificationAt)
    )
      errors.push(
        "authority_evidence_expired: authority evidence expires at or before verification time",
      );
  }

  const signaturePresent = evidence.signature !== undefined;
  const protectedPresent = evidence.protected_controller_receipt !== undefined;
  if (signaturePresent === protectedPresent)
    errors.push(
      "authority evidence requires exactly one signature or protected-controller receipt",
    );
  if (signaturePresent) assertSignature(evidence.signature, errors);
  if (protectedPresent)
    assertProtectedControllerReceipt(evidence.protected_controller_receipt, errors);

  if (!VERIFICATION_METHODS.has(evidence.verification_method))
    errors.push("authority evidence verification method is invalid");
  if (!SHA256.test(evidence.evidence_digest ?? ""))
    errors.push("authority evidence digest is invalid");
  if (SHA256.test(evidence.evidence_digest ?? "")) {
    const unsigned = stripKey(evidence, "evidence_digest");
    if (digestJson(unsigned) !== evidence.evidence_digest)
      errors.push("authority evidence digest does not match");
  }

  if (
    isRecord(provenance) &&
    isRecord(request) &&
    provenance.request_digest !== request.request_digest
  )
    errors.push("authority evidence request provenance is not bound");
  if (
    isRecord(provenance) &&
    isRecord(release) &&
    provenance.release_digest !== digestJson(release)
  )
    errors.push("authority evidence release provenance is not bound");
  if (isRecord(provenance) && isRecord(issuer) && provenance.issuer_ref !== issuer.ref)
    errors.push("authority evidence issuer provenance is not bound");
  if (
    isRecord(freshness) &&
    isRecord(provenance) &&
    freshness.observed_at !== provenance.observed_at
  )
    errors.push("authority evidence freshness is not bound");

  if (isRecord(evidence.bypass)) assertAuthorityBypass(evidence.bypass, errors);
  else if (evidence.bypass !== undefined) errors.push("authority evidence bypass is invalid");
  if (evidence.verification_method !== "self_asserted_digest" && !isRecord(evidence.bypass))
    errors.push("external authority evidence requires bypass proof");
  if (protectedPresent && isRecord(evidence.protected_controller_receipt)) {
    const protectedReceipt = evidence.protected_controller_receipt;
    const protectedBindings = [
      ["request_digest", protectedReceipt.request_digest, request?.request_digest],
      ["release_sha", protectedReceipt.release_sha, release?.release_sha],
      ["release_workflow_sha", protectedReceipt.release_workflow_sha, release?.workflow_sha],
      ["verifier_sha", protectedReceipt.verifier_sha, release?.verifier_sha],
      ["policy_id", protectedReceipt.policy_id, policy?.policy_id],
      ["policy_sha256", protectedReceipt.policy_sha256, policy?.policy_sha256],
      ["context", protectedReceipt.context, policy?.context],
      ["approval_digest", protectedReceipt.approval_digest, request?.approval_digest],
      ["observed_at", protectedReceipt.observed_at, freshness?.observed_at],
    ];
    for (const [label, actual, expectedValue] of protectedBindings)
      if (expectedValue !== undefined && actual !== expectedValue)
        errors.push(`protected-controller ${label} is not bound`);
    if (
      isRecord(evidence.bypass) &&
      protectedReceipt.bypass_evidence_digest !== undefined &&
      protectedReceipt.bypass_evidence_digest !== evidence.bypass.evidence_digest
    )
      errors.push("protected-controller bypass evidence is not bound");
  }
  if (
    requireVerifierCallback &&
    evidence.verification_method === "independent_verifier_callback" &&
    expectedRequest === undefined
  )
    errors.push("independent verifier requires an exact release request");

  if (requireExternal) {
    if (!isRecord(provenance) || !EXTERNAL_SOURCES.has(provenance.source))
      errors.push("verified authority evidence must be externally sourced");
    if (!isRecord(issuer) || issuer.independent !== true)
      errors.push("verified authority evidence requires an independent issuer");
    if (evidence.verification_method === "self_asserted_digest")
      errors.push("self-asserted authority evidence cannot verify a receipt");
    if (
      evidence.verification_method === "independent_verifier_callback" &&
      (typeof evidence.signature === "string" ||
        (isRecord(evidence.signature) &&
          !EXTERNAL_SIGNATURE_ALGORITHMS.has(evidence.signature.algorithm)))
    )
      errors.push("independent verifier evidence requires an external signature");
    if (evidence.verification_method === "independent_verifier_callback" && !signaturePresent)
      errors.push("independent verifier evidence requires a signature");
    if (evidence.verification_method === "protected_controller_receipt" && !protectedPresent)
      errors.push("protected-controller evidence requires its receipt");
    if (
      requireVerifierCallback &&
      evidence.verification_method === "independent_verifier_callback" &&
      !verifierSupplied
    )
      errors.push("independent verifier callback is required");
  }

  if (isRecord(receipt)) {
    const expected = [
      ["request.repository_id", request?.repository_id, receipt.repository_id],
      ["release.repository_id", release?.repository_id, receipt.repository_id],
      [
        "release.workflow_sha",
        release?.workflow_sha,
        receipt.workflow_policy?.release_workflow_sha,
      ],
      ["release.verifier_sha", release?.verifier_sha, receipt.workflow_policy?.verifier_sha],
      ["release.approval_digest", release?.approval_digest, receipt.approval?.approval_digest],
      ["request.approval_digest", request?.approval_digest, receipt.approval?.approval_digest],
      ["policy.policy_sha256", policy?.policy_sha256, receipt.workflow_policy?.policy_sha256],
      ["policy.context", policy?.context, receipt.workflow_policy?.context],
      ["freshness.observed_at", freshness?.observed_at, receipt.observed_at],
      ["provenance.observed_at", provenance?.observed_at, receipt.observed_at],
    ];
    for (const [label, actual, expectedValue] of expected)
      if (expectedValue !== undefined && actual !== expectedValue)
        errors.push(`authority evidence ${label} is not bound`);
    if (isRecord(evidence.bypass) && isRecord(receipt.bypass_rehearsal)) {
      for (const key of ["gate_deleted_result", "tag_result", "credential_result"])
        if (evidence.bypass[key] !== receipt.bypass_rehearsal[key])
          errors.push(`authority evidence bypass ${key} is not bound`);
      if (evidence.bypass.evidence_digest !== receipt.bypass_rehearsal.evidence_digest)
        errors.push("authority evidence bypass digest is not bound");
    }
    if (
      protectedPresent &&
      isRecord(evidence.protected_controller_receipt) &&
      evidence.protected_controller_receipt.controller_ref !== receipt.controller?.ref
    )
      errors.push("protected-controller controller is not bound");
    const roleRefs = new Set([
      receipt.controller?.ref,
      receipt.tag_authority?.ref,
      receipt.credential_issuer?.ref,
      receipt.ownership?.owner_ref,
      receipt.ownership?.rotation_owner_ref,
    ]);
    if (isRecord(issuer) && roleRefs.has(issuer.ref) && issuer.independent !== true)
      errors.push("authority evidence issuer is not independent");
  }

  if (expectedRequest !== undefined && isRecord(request)) {
    const expectedFields = normalizeExpectedRequest(expectedRequest);
    for (const key of REQUEST_KEYS.filter((item) => item !== "request_digest")) {
      if (expectedFields[key] !== undefined && request[key] !== expectedFields[key])
        errors.push(`authority evidence request ${key} does not match release request`);
    }
    if (
      expectedFields.request_digest !== undefined &&
      request.request_digest !== expectedFields.request_digest
    )
      errors.push("authority evidence request digest does not match release request");
  }
  return errors;
}

function assertExternalBypassEvidence(receipt, observations) {
  const evidence = receipt.authority_evidence;
  if (!isRecord(evidence) || !isRecord(evidence.bypass))
    throwAuthorityError(
      "bypass_observation_unverified",
      "bypass denial lacks external authority proof",
    );
  if (
    evidence.bypass.gate_deleted_result !== observations.gate_deleted_result ||
    evidence.bypass.tag_result !== observations.tag_result ||
    evidence.bypass.credential_result !== observations.credential_result ||
    evidence.bypass.evidence_digest !== observations.evidence_digest
  )
    throwAuthorityError(
      "bypass_observation_unverified",
      "bypass denial is not bound to authority evidence",
    );
  if (
    observations.authority_evidence_digest !== undefined &&
    observations.authority_evidence_digest !== evidence.evidence_digest
  )
    throwAuthorityError(
      "bypass_observation_unverified",
      "bypass authority evidence digest is mismatched",
    );
}

function buildProtectedControllerEvidence(receipt, protectedReceipt, expectedRequest, options) {
  if (!isRecord(protectedReceipt)) return protectedReceipt;
  const request = buildEvidenceRequest(receipt, {
    ...(isRecord(expectedRequest) ? expectedRequest : {}),
    ...(isRecord(options.request) ? options.request : {}),
  });
  const release = buildEvidenceRelease(receipt, options, request);
  const policy = buildEvidencePolicy(options);
  const observedAt = options.observed_at ?? options.observedAt ?? receipt.observed_at;
  const provenance = {
    source: "external_authority",
    issuer_ref:
      protectedReceipt.controller_ref ?? receipt.controller?.ref ?? "protected_controller",
    receipt_ref: protectedReceipt.receipt_digest ?? "protected-controller-receipt",
    request_digest: request.request_digest,
    release_digest: digestJson(release),
    observed_at: observedAt,
  };
  const issuer = {
    ref: provenance.issuer_ref,
    kind: "protected_controller",
    independent: true,
  };
  const trustRoot = {
    ref: options.trust_root_ref ?? "protected_controller_root",
    digest: options.trust_root_digest ?? protectedReceipt.receipt_digest,
  };
  const freshness = buildFreshness(observedAt, options);
  const evidence = {
    schema_version: AUTHORITY_EVIDENCE_SCHEMA,
    provenance,
    request,
    release,
    policy,
    issuer,
    trust_root: trustRoot,
    protected_controller_receipt: protectedReceipt,
    freshness,
    verification_method: "protected_controller_receipt",
  };
  const bypass = options.bypass ?? options.bypass_rehearsal ?? receipt.bypass_rehearsal;
  if (isRecord(bypass)) evidence.bypass = buildAuthorityBypass(bypass);
  return { ...evidence, evidence_digest: digestJson(evidence) };
}

function extractEvidence(value) {
  if (value === true || value === undefined) return undefined;
  if (!isRecord(value)) return undefined;
  if (isRecord(value.authority_evidence)) return value.authority_evidence;
  if (isRecord(value.externalEvidence)) return value.externalEvidence;
  if (isRecord(value.evidence)) return value.evidence;
  if (value.schema_version === AUTHORITY_EVIDENCE_SCHEMA) return value;
  return undefined;
}

function buildEvidenceRequest(receipt, input = {}) {
  const supplied = isRecord(input.releaseRequest)
    ? input.releaseRequest
    : isRecord(input.release_request)
      ? input.release_request
      : isRecord(input.request)
        ? input.request
        : {};
  const candidateSha =
    supplied.candidate_sha ??
    supplied.candidateSha ??
    input.candidate_sha ??
    input.candidateSha ??
    "0".repeat(40);
  const fixtureSha =
    supplied.fixture_sha256 ??
    supplied.fixtureSha256 ??
    input.fixture_sha256 ??
    input.fixtureSha256 ??
    MAINTENANCE_STUDY_FIXTURE_SHA256;
  const repositoryId =
    supplied.repository_id ??
    input.repository_id ??
    receipt?.repository_id ??
    PRODUCT4_REPOSITORY_ID;
  const externalId =
    supplied.external_id ??
    supplied.externalId ??
    input.external_id ??
    input.externalId ??
    `carpeos-4.0.0:${candidateSha}:${fixtureSha}`;
  const base = {
    repository_id: repositoryId,
    external_id: externalId,
    candidate_sha: candidateSha,
    fixture_sha256: fixtureSha,
    approval_digest:
      supplied.approval_digest ??
      supplied.approvalDigest ??
      input.approval_digest ??
      input.approvalDigest ??
      receipt?.approval?.approval_digest ??
      "0".repeat(64),
  };
  return { ...base, request_digest: digestJson(base) };
}

function buildEvidenceRelease(receipt, input = {}, request) {
  const workflowSha =
    input.release_workflow_sha ??
    input.releaseWorkflowSha ??
    input.workflow_sha ??
    input.workflowSha ??
    receipt?.workflow_policy?.release_workflow_sha ??
    "0".repeat(40);
  const verifierSha =
    input.verifier_sha ??
    input.verifierSha ??
    input.workflow_verifier_sha ??
    receipt?.workflow_policy?.verifier_sha ??
    "0".repeat(40);
  const releaseSha = input.release_sha ?? input.releaseSha ?? request.candidate_sha;
  const version = input.version ?? "0.0.0";
  return {
    repository_id: receipt?.repository_id ?? PRODUCT4_REPOSITORY_ID,
    release_sha: releaseSha,
    workflow_sha: workflowSha,
    verifier_sha: verifierSha,
    tag: input.tag ?? `v${version}`,
    version,
    approval_digest: receipt?.approval?.approval_digest ?? request.approval_digest,
  };
}

function buildEvidencePolicy(input = {}) {
  return {
    policy_id: PRODUCT4_POLICY_ID,
    policy_sha256: PRODUCT4_POLICY_SHA256,
    context: PRODUCT4_CONTEXT,
    fixture_sha256: input.fixture_sha256 ?? input.fixtureSha256 ?? MAINTENANCE_STUDY_FIXTURE_SHA256,
  };
}

function buildFreshness(observedAt, input = {}) {
  const maxAge = input.max_age_seconds ?? input.maxAgeSeconds ?? 3600;
  const expiresAt = input.expires_at ?? input.expiresAt ?? addSeconds(observedAt, maxAge);
  return { observed_at: observedAt, expires_at: expiresAt, max_age_seconds: maxAge };
}

function buildAuthorityBypass(value) {
  const result = {
    gate_deleted_result: value.gate_deleted_result,
    tag_result: value.tag_result,
    credential_result: value.credential_result,
    evidence_digest: value.evidence_digest,
  };
  return result;
}

function assertNestedObject(value, keys, label, errors) {
  if (!isRecord(value)) {
    errors.push(`${label} is required`);
    return;
  }
  assertExactKeys(value, keys, label, errors);
  assertRequiredKeys(value, keys, label, errors);
}

function assertSignature(value, errors) {
  if (typeof value === "string") {
    if (!SHA256.test(value)) errors.push("authority evidence signature is invalid");
    return;
  }
  assertNestedObject(value, SIGNATURE_KEYS, "authority evidence signature", errors);
  if (!isRecord(value)) return;
  if (!new Set(["ed25519", "sigstore", "sha256", "local_digest"]).has(value.algorithm))
    errors.push("authority evidence signature algorithm is invalid");
  assertRef(value.key_ref, "authority evidence signature key_ref", errors);
  if (!SHA256.test(value.value ?? "")) errors.push("authority evidence signature value is invalid");
}

function assertProtectedControllerReceipt(value, errors) {
  assertExactKeys(
    value,
    PROTECTED_CONTROLLER_RECEIPT_KEYS,
    "authority evidence protected-controller receipt",
    errors,
  );
  assertRequiredKeys(
    value,
    PROTECTED_CONTROLLER_RECEIPT_REQUIRED_KEYS,
    "authority evidence protected-controller receipt",
    errors,
  );
  if (!isRecord(value)) return;
  if (value.schema_version !== "carpeos.protected-controller-authority/v1")
    errors.push("protected-controller receipt schema is invalid");
  if (value.receipt_type !== "protected_controller_authority")
    errors.push("protected-controller receipt type is invalid");
  if (value.repository_id !== PRODUCT4_REPOSITORY_ID)
    errors.push("protected-controller receipt repository is invalid");
  if (!SHA256.test(value.request_digest ?? ""))
    errors.push("protected-controller request digest is invalid");
  if (!SHA1.test(value.release_sha ?? ""))
    errors.push("protected-controller release SHA is invalid");
  if (!SHA1.test(value.release_workflow_sha ?? ""))
    errors.push("protected-controller workflow SHA is invalid");
  if (!SHA1.test(value.verifier_sha ?? ""))
    errors.push("protected-controller verifier SHA is invalid");
  if (value.policy_id !== PRODUCT4_POLICY_ID)
    errors.push("protected-controller policy id is invalid");
  if (value.policy_sha256 !== PRODUCT4_POLICY_SHA256)
    errors.push("protected-controller policy is invalid");
  if (value.context !== PRODUCT4_CONTEXT) errors.push("protected-controller context is invalid");
  if (!SHA256.test(value.approval_digest ?? ""))
    errors.push("protected-controller approval is invalid");
  assertRef(value.controller_ref, "protected-controller ref", errors);
  if (!SHA256.test(value.signature ?? "")) errors.push("protected-controller signature is invalid");
  if (!TIMESTAMP.test(value.observed_at ?? ""))
    errors.push("protected-controller timestamp is invalid");
  if (!SHA256.test(value.receipt_digest ?? ""))
    errors.push("protected-controller receipt digest is invalid");
  if (
    value.bypass_evidence_digest !== undefined &&
    !SHA256.test(value.bypass_evidence_digest ?? "")
  )
    errors.push("protected-controller bypass digest is invalid");
}

function assertAuthorityBypass(value, errors) {
  assertNestedObject(value, AUTHORITY_BYPASS_KEYS, "authority evidence bypass", errors);
  if (!isRecord(value)) return;
  for (const key of ["gate_deleted_result", "tag_result", "credential_result"])
    if (!BYPASS_RESULTS.has(value[key])) errors.push(`authority evidence bypass ${key} is invalid`);
  if (!SHA256.test(value.evidence_digest ?? ""))
    errors.push("authority evidence bypass digest is invalid");
}

function assertExternalId(value, candidateSha, fixtureSha, errors) {
  if (typeof value !== "string" || !EXTERNAL_ID.test(value)) {
    errors.push("authority evidence request external id is invalid");
    return;
  }
  const match = value.match(EXTERNAL_ID);
  if (match[1] !== candidateSha || match[2] !== fixtureSha)
    errors.push("authority evidence request external id is not bound");
}

function normalizeExpectedRequest(value) {
  if (!isRecord(value)) return {};
  const normalized = {
    repository_id: value.repository_id,
    external_id: value.external_id ?? value.externalId,
    candidate_sha: value.candidate_sha ?? value.candidateSha,
    fixture_sha256: value.fixture_sha256 ?? value.fixtureSha256,
    approval_digest: value.approval_digest ?? value.approvalDigest,
  };
  const suppliedDigest = value.request_digest ?? value.requestDigest;
  return {
    ...normalized,
    ...(suppliedDigest ? { request_digest: suppliedDigest } : {}),
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

function assertRequiredKeys(value, required, label, errors) {
  if (!isRecord(value)) return;
  for (const key of required) if (!(key in value)) errors.push(`${label}.${key} is required`);
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

function stripKey(value, key) {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

function resolveVerificationAt(options = {}, expectedRequest) {
  const supplied =
    options.verificationAt ??
    options.verification_at ??
    options.verificationTime ??
    options.verification_time ??
    options.currentVerificationAt ??
    options.current_verification_at ??
    options.currentVerificationTime ??
    options.current_verification_time ??
    options.currentTime ??
    options.current_time ??
    options.now ??
    options.nowAt ??
    options.verifiedAt ??
    options.verified_at ??
    expectedRequest?.verificationAt ??
    expectedRequest?.verification_at ??
    expectedRequest?.verificationTime ??
    expectedRequest?.verification_time;
  if (supplied === undefined) return new Date().toISOString().replace(".000Z", "Z");
  if (supplied instanceof Date)
    return Number.isFinite(supplied.getTime())
      ? supplied.toISOString().replace(".000Z", "Z")
      : supplied;
  if (typeof supplied === "number")
    return Number.isFinite(supplied)
      ? new Date(supplied).toISOString().replace(".000Z", "Z")
      : supplied;
  return supplied;
}

function addSeconds(timestamp, seconds) {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed) || !Number.isFinite(seconds)) return timestamp;
  return new Date(parsed + seconds * 1000).toISOString().replace(".000Z", "Z");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function throwAuthorityError(code, message) {
  throw new ReleaseAuthorityError(code, message);
}
