import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  digestJson,
  MAINTENANCE_STUDY_FIXTURE_SHA256,
  PRODUCT4_CONTEXT,
  PRODUCT4_POLICY_SHA256,
} from "../product4/policy-identity.mjs";
import {
  buildBypassObservation,
  buildReleaseAuthorityEvidence,
  buildReleaseAuthorityReceipt,
  assertReleaseAuthorityReceipt,
  reconcileReleaseAuthority,
  simulateReleaseBypass,
} from "../product4/release-authority.mjs";

const timestamp = "2026-01-02T00:00:00Z";
const verificationAt = "2026-01-02T00:30:00Z";
const candidateSha = "a".repeat(40);
const workflowSha = "b".repeat(40);
const digest = "c".repeat(64);
const externalId = `carpeos-4.0.0:${candidateSha}:${MAINTENANCE_STUDY_FIXTURE_SHA256}`;

function authorityFields(overrides = {}) {
  return {
    schema_version: "carpeos.release-authority/v1",
    receipt_type: "release_authority",
    status: "blocked_unknown",
    repository_id: 1315097793,
    app: {
      app_id: 4242,
      installation_id: 4343,
      slug: "synthetic-product4-app",
      status: "unknown",
      checks_write: false,
    },
    ownership: {
      owner_ref: "owner_ref",
      rotation_owner_ref: "rotation_owner",
      status: "unknown",
    },
    controller: {
      ref: "release_controller",
      status: "unknown",
      independent: false,
      can_edit_release_workflow: false,
    },
    tag_authority: {
      ref: "tag_authority",
      status: "unknown",
      protected: false,
      allowed_actors_digest: digest,
    },
    credential_issuer: {
      ref: "credential_issuer",
      status: "unknown",
      independent: false,
      issues_to_release_job: false,
    },
    workflow_policy: {
      release_workflow_sha: workflowSha,
      verifier_sha: workflowSha,
      policy_sha256: PRODUCT4_POLICY_SHA256,
      context: PRODUCT4_CONTEXT,
    },
    settings: {
      status: "unknown",
      preimage_digest: digest,
      postimage_digest: digest,
      semantic_digest: digest,
    },
    bypass_rehearsal: {
      status: "not_run",
      gate_deleted_result: "unknown",
      tag_result: "unknown",
      credential_result: "unknown",
      evidence_digest: digest,
    },
    rollback: { owner_ref: "rollback_owner", status: "unknown", fresh_read_required: true },
    approval: { approved: false, approval_digest: digest },
    blockers: ["authority_unknown"],
    observed_at: timestamp,
    ...overrides,
  };
}

function verifiedFields(overrides = {}) {
  const fields = authorityFields({
    status: "verified",
    app: {
      app_id: 4242,
      installation_id: 4343,
      slug: "synthetic-product4-app",
      status: "verified",
      checks_write: true,
    },
    ownership: { owner_ref: "owner_ref", rotation_owner_ref: "rotation_owner", status: "verified" },
    controller: {
      ref: "release_controller",
      status: "verified",
      independent: true,
      can_edit_release_workflow: false,
    },
    tag_authority: {
      ref: "tag_authority",
      status: "verified",
      protected: true,
      allowed_actors_digest: digest,
    },
    credential_issuer: {
      ref: "credential_issuer",
      status: "verified",
      independent: true,
      issues_to_release_job: true,
    },
    settings: {
      status: "verified",
      preimage_digest: digest,
      postimage_digest: digest,
      semantic_digest: digest,
    },
    rollback: { owner_ref: "rollback_owner", status: "verified", fresh_read_required: true },
    approval: { approved: true, approval_digest: digest },
    blockers: [],
  });
  const bypass = buildBypassObservation({
    receipt: fields,
    releaseGate: { deleted: true, actor: "candidate_release_actor" },
    results: {
      gate_deleted_result: "denied",
      tag_result: "denied",
      credential_result: "denied",
    },
  });
  fields.bypass_rehearsal = {
    status: "passed",
    gate_deleted_result: bypass.gate_deleted_result,
    tag_result: bypass.tag_result,
    credential_result: bypass.credential_result,
    evidence_digest: bypass.evidence_digest,
  };
  return { ...fields, ...overrides };
}

function releaseRequest(fields) {
  return {
    repository_id: fields.repository_id,
    external_id: externalId,
    candidate_sha: candidateSha,
    fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
    approval_digest: fields.approval.approval_digest,
  };
}

function externalEvidence(fields, request, bypass, overrides = {}) {
  const requestWithDigest = { ...request, request_digest: digestJson(request) };
  const release = {
    repository_id: fields.repository_id,
    release_sha: candidateSha,
    workflow_sha: fields.workflow_policy.release_workflow_sha,
    verifier_sha: fields.workflow_policy.verifier_sha,
    tag: "v4.0.0",
    version: "4.0.0",
    approval_digest: fields.approval.approval_digest,
  };
  const policy = {
    policy_id: "P4_0",
    policy_sha256: PRODUCT4_POLICY_SHA256,
    context: PRODUCT4_CONTEXT,
    fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
  };
  const provenance = {
    source: "external_authority",
    issuer_ref: "external_verifier",
    receipt_ref: "external-authority-receipt",
    request_digest: requestWithDigest.request_digest,
    release_digest: digestJson(release),
    observed_at: fields.observed_at,
  };
  const issuer = { ref: "external_verifier", kind: "external_verifier", independent: true };
  const trustRoot = { ref: "external-trust-root", digest: "d".repeat(64) };
  const freshness = {
    observed_at: fields.observed_at,
    expires_at: "2026-01-02T01:00:00Z",
    max_age_seconds: 3600,
  };
  const unsigned = {
    schema_version: "carpeos.release-authority-evidence/v1",
    provenance,
    request: requestWithDigest,
    release,
    policy,
    issuer,
    trust_root: trustRoot,
    freshness,
    verification_method: "independent_verifier_callback",
    signature: {
      algorithm: "ed25519",
      key_ref: "external_verifier",
      value: "e".repeat(64),
    },
    bypass: {
      gate_deleted_result: bypass.gate_deleted_result,
      tag_result: bypass.tag_result,
      credential_result: bypass.credential_result,
      evidence_digest: bypass.evidence_digest,
    },
    ...overrides,
  };
  return { ...unsigned, evidence_digest: digestJson(unsigned) };
}

function verifiedReceipt() {
  const fields = verifiedFields();
  const request = releaseRequest(fields);
  const bypass = buildBypassObservation({
    receipt: fields,
    releaseGate: { deleted: true, actor: "candidate_release_actor" },
    results: {
      gate_deleted_result: "denied",
      tag_result: "denied",
      credential_result: "denied",
    },
  });
  const evidence = externalEvidence(fields, request, bypass);
  return buildReleaseAuthorityReceipt(fields, {
    authorityEvidence: evidence,
    authorityVerifier: () => evidence,
    releaseRequest: request,
    verificationAt,
  });
}

test("keeps missing authority procedural and denies every release capability", () => {
  const blocked = buildReleaseAuthorityReceipt(authorityFields());
  const reconciliation = reconcileReleaseAuthority({ receipt: blocked });
  assert.equal(reconciliation.status, "blocked");
  assert.equal(reconciliation.tag_capability, "denied");
  assert.equal(reconciliation.credential_capability, "denied");
  assert.throws(
    () => simulateReleaseBypass({ receipt: blocked, releaseGate: { deleted: true } }),
    /bypass_observation_missing/,
  );
});

test("rejects a self-minted buildReleaseAuthorityEvidence digest", () => {
  const fields = verifiedFields();
  const localEvidence = buildReleaseAuthorityEvidence({
    receipt: fields,
    candidate_sha: candidateSha,
    release_sha: candidateSha,
    version: "4.0.0",
  });
  const receipt = buildReleaseAuthorityReceipt({ ...fields, authority_evidence: localEvidence });
  assert.equal(localEvidence.provenance.source, "local");
  assert.equal(localEvidence.verification_method, "self_asserted_digest");
  assert.equal(receipt.status, "blocked_unknown");
  assert.ok(receipt.blockers.includes("authority_evidence_invalid"));
  assert.equal(receipt.authority_evidence, undefined);
});

test("keeps the runtime and schema nested authority contract aligned", () => {
  const schema = JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../../schemas/release-authority-v1.json", import.meta.url)),
      "utf8",
    ),
  );
  const authoritySchema = schema.$defs.authorityEvidence;
  assert.equal(schema.properties.authority_evidence.$ref, "#/$defs/authorityEvidence");
  assert.equal(authoritySchema.additionalProperties, false);
  assert.deepEqual(authoritySchema.required, [
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
  ]);
  assert.ok(authoritySchema.properties.provenance);
  assert.ok(authoritySchema.properties.request);
  assert.ok(authoritySchema.properties.release);
  assert.ok(authoritySchema.properties.policy);
  assert.ok(authoritySchema.properties.freshness);
  assert.equal(
    buildReleaseAuthorityEvidence({ receipt: authorityFields() }).provenance.source,
    "local",
  );
  const injected = verifiedReceipt().authority_evidence;
  assert.deepEqual(
    Object.keys(injected).sort(),
    [
      "bypass",
      "evidence_digest",
      "freshness",
      "issuer",
      "policy",
      "provenance",
      "release",
      "request",
      "schema_version",
      "signature",
      "trust_root",
      "verification_method",
    ].sort(),
  );
  for (const key of Object.keys(injected)) assert.ok(authoritySchema.properties[key]);
});

test("accepts only injected external proof with exact request, policy, and bypass bindings", () => {
  const verified = verifiedReceipt();
  const request = verified.authority_evidence.request;
  assert.equal(verified.status, "verified");
  const observations = buildBypassObservation({
    receipt: verified,
    releaseGate: { deleted: true, actor: "candidate_release_actor" },
    results: {
      gate_deleted_result: "denied",
      tag_result: "denied",
      credential_result: "denied",
    },
  });
  const reconciliation = reconcileReleaseAuthority({
    receipt: verified,
    releaseGate: { deleted: true, actor: "candidate_release_actor", observations },
    expectedRequest: request,
    verificationAt,
  });
  assert.equal(reconciliation.status, "procedural_ready");
  assert.equal(reconciliation.tag_capability, "controller_only");
  assert.equal(reconciliation.credential_capability, "protected_release_job_only");
});

test("rejects stale or mismatched injected authority proof", () => {
  const fields = verifiedFields();
  const request = releaseRequest(fields);
  const bypass = fields.bypass_rehearsal;
  const stale = externalEvidence(fields, request, bypass, {
    freshness: {
      observed_at: "2026-01-01T00:00:00Z",
      expires_at: "2026-01-01T01:00:00Z",
      max_age_seconds: 3600,
    },
  });
  const staleReceipt = buildReleaseAuthorityReceipt(fields, {
    authorityEvidence: stale,
    authorityVerifier: () => stale,
    releaseRequest: request,
  });
  assert.equal(staleReceipt.status, "blocked_unknown");

  const mismatched = externalEvidence(fields, request, bypass, {
    release: {
      repository_id: fields.repository_id,
      release_sha: candidateSha,
      workflow_sha: "f".repeat(40),
      verifier_sha: workflowSha,
      tag: "v4.0.0",
      version: "4.0.0",
      approval_digest: fields.approval.approval_digest,
    },
  });
  const mismatchedReceipt = buildReleaseAuthorityReceipt(fields, {
    authorityEvidence: mismatched,
    authorityVerifier: () => mismatched,
    releaseRequest: request,
  });
  assert.equal(mismatchedReceipt.status, "blocked_unknown");
});

test("checks expiry against verification time, including the exact boundary", () => {
  const fields = verifiedFields();
  const request = releaseRequest(fields);
  const bypass = fields.bypass_rehearsal;
  const expiredEvidence = externalEvidence(fields, request, bypass, {
    freshness: {
      observed_at: timestamp,
      expires_at: verificationAt,
      max_age_seconds: 3600,
    },
  });
  const expired = buildReleaseAuthorityReceipt(fields, {
    authorityEvidence: expiredEvidence,
    authorityVerifier: () => expiredEvidence,
    releaseRequest: request,
    verificationAt,
  });
  assert.equal(expired.status, "blocked_unknown");
  assert.ok(expired.blockers.includes("authority_evidence_invalid"));

  const expiredUnsigned = { ...fields, authority_evidence: expiredEvidence };
  const forgedVerified = {
    ...expiredUnsigned,
    receipt_digest: digestJson(expiredUnsigned),
  };
  assert.throws(
    () =>
      assertReleaseAuthorityReceipt(forgedVerified, {
        expectedRequest: request,
        verificationAt,
      }),
    /authority_evidence_expired/,
  );

  const futureEvidence = externalEvidence(fields, request, bypass, {
    freshness: {
      observed_at: timestamp,
      expires_at: "2026-01-02T00:30:01Z",
      max_age_seconds: 3600,
    },
  });
  const future = buildReleaseAuthorityReceipt(fields, {
    authorityEvidence: futureEvidence,
    authorityVerifier: () => futureEvidence,
    releaseRequest: request,
    verificationAt,
  });
  assert.equal(future.status, "verified");
  assert.doesNotThrow(() =>
    assertReleaseAuthorityReceipt(future, { expectedRequest: request, verificationAt }),
  );
});

test("rejects forged bypass denial even when the caller supplies a valid digest", () => {
  const verified = verifiedReceipt();
  const observations = buildBypassObservation({
    receipt: verified,
    releaseGate: { deleted: true, actor: "candidate_release_actor" },
    results: {
      gate_deleted_result: "denied",
      tag_result: "denied",
      credential_result: "unknown",
    },
  });
  assert.throws(
    () =>
      simulateReleaseBypass({
        receipt: verified,
        releaseGate: { deleted: true, actor: "candidate_release_actor", observations },
        verificationAt,
      }),
    /bypass_observation_unverified/,
  );
});
