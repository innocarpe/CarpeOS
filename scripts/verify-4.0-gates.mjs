#!/usr/bin/env node
/**
 * Verify Product 4 release evidence without requesting credentials or mutating release state.
 *
 * The verifier only reads receipts and the already-built pack-once artifact. A blocked result is
 * procedural evidence; it never becomes a technical release-blocking claim or grants authority.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertArtifact } from "./pack-once.mjs";
import { assertEvaluatorAttestation } from "./product4/evaluator.mjs";
import { assertEvaluatorResult } from "./product4/evaluator-runner.mjs";
import {
  digestJson,
  MAINTENANCE_STUDY_FIXTURE_SHA256,
  PRODUCT4_CONTEXT,
  PRODUCT4_POLICY_SHA256,
  PRODUCT4_REPOSITORY_ID,
} from "./product4/policy-identity.mjs";
import { assertPromotionLedger } from "./product4/promotion-ledger.mjs";
import {
  assertReleaseAuthorityReceipt,
  reconcileReleaseAuthority,
} from "./product4/release-authority.mjs";
import { assertOwnershipReceipt, assertRulesetReceipt } from "./product4/ruleset-guard.mjs";

export const RELEASE_IDENTITY_SCHEMA = "carpeos.release-identity/v1";
export const RELEASE_GATE_SCHEMA = "carpeos.release-gate/v1";
export const RELEASE_RECEIPT_PATHS = Object.freeze({
  ownership: "product4-ownership-v1/1315097793.json",
  ruleset: "ruleset-activation-v1/19955787.json",
  evaluator: "product4-evaluator-result-v1.json",
  promotion: "product4-promotion-ledger-v1.json",
  installSmoke: "product4-install-smoke-v1.json",
  ancestry: "product4-release-ancestry-v1.json",
  releaseDiff: "product4-release-diff-v1.json",
  tagIdentity: "product4-tag-identity-v1.json",
  approval: "product4-release-approval-v1.json",
});

const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const TAG = /^v\d+\.\d+\.\d+$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const RELEASE_IDENTITY_KEYS = [
  "schema_version",
  "release_type",
  "repository_id",
  "package_name",
  "version",
  "tag",
  "release_sha",
  "candidate_sha",
  "base_sha",
  "policy_sha256",
  "context",
  "evidence",
  "authority_receipt_digest",
  "approval_digest",
  "decision",
  "blockers",
  "observed_at",
  "identity_digest",
];
const EVIDENCE_KEYS = [
  "candidate_attestation_digest",
  "promotion_ledger_digest",
  "ownership_receipt_digest",
  "ruleset_receipt_digest",
  "manifest_digest",
  "artifact_sha256",
  "install_smoke_digest",
  "ancestry_digest",
  "release_diff_digest",
  "tag_identity_digest",
];
const FORBIDDEN_KEY =
  /token|secret|credential|private_path|protected_plaintext|executable|shell|script|module/i;

export class ReleaseGateError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "ReleaseGateError";
    this.code = code;
  }
}

export function buildReleaseIdentity({
  version,
  tag,
  releaseSha,
  candidateSha,
  baseSha,
  evidence,
  authorityReceiptDigest,
  approvalDigest,
  decision,
  blockers,
  observedAt,
}) {
  const unsigned = {
    schema_version: RELEASE_IDENTITY_SCHEMA,
    release_type: "product4_release_identity",
    repository_id: PRODUCT4_REPOSITORY_ID,
    package_name: "@innocarpe/carpeos",
    version,
    tag,
    release_sha: releaseSha,
    candidate_sha: candidateSha,
    base_sha: baseSha,
    policy_sha256: PRODUCT4_POLICY_SHA256,
    context: PRODUCT4_CONTEXT,
    evidence: { ...evidence },
    authority_receipt_digest: authorityReceiptDigest,
    approval_digest: approvalDigest,
    decision,
    blockers: [...blockers],
    observed_at: observedAt,
  };
  return assertReleaseIdentity({ ...unsigned, identity_digest: digestJson(unsigned) });
}

export function assertReleaseIdentity(identity) {
  if (!isRecord(identity)) throwGateError("invalid_identity", "release identity must be an object");
  const errors = [];
  if (Object.keys(identity).some((key) => !RELEASE_IDENTITY_KEYS.includes(key)))
    errors.push("identity contains unsupported fields");
  if (identity.schema_version !== RELEASE_IDENTITY_SCHEMA) errors.push("schema_version is invalid");
  if (identity.release_type !== "product4_release_identity") errors.push("release_type is invalid");
  if (identity.repository_id !== PRODUCT4_REPOSITORY_ID) errors.push("repository_id is invalid");
  if (identity.package_name !== "@innocarpe/carpeos") errors.push("package_name is invalid");
  if (!VERSION.test(identity.version ?? "")) errors.push("version is invalid");
  if (!TAG.test(identity.tag ?? "") || identity.tag !== `v${identity.version}`)
    errors.push("tag is invalid or does not match version");
  for (const key of ["release_sha", "candidate_sha", "base_sha"])
    if (!SHA1.test(identity[key] ?? "")) errors.push(`${key} is invalid`);
  if (identity.policy_sha256 !== PRODUCT4_POLICY_SHA256) errors.push("policy is not P4_0");
  if (identity.context !== PRODUCT4_CONTEXT) errors.push("context is invalid");
  assertExactKeys(identity.evidence, EVIDENCE_KEYS, "evidence", errors);
  if (!isRecord(identity.evidence)) errors.push("evidence is required");
  else {
    for (const key of EVIDENCE_KEYS)
      if (!SHA256.test(identity.evidence[key] ?? "")) errors.push(`evidence.${key} is invalid`);
  }
  for (const key of ["authority_receipt_digest", "approval_digest"])
    if (!SHA256.test(identity[key] ?? "")) errors.push(`${key} is invalid`);
  if (!new Set(["defer", "ready"]).has(identity.decision)) errors.push("decision is invalid");
  const blockersValid =
    Array.isArray(identity.blockers) &&
    identity.blockers.length <= 32 &&
    identity.blockers.every(
      (item) => typeof item === "string" && item.length > 0 && item.length <= 200,
    );
  if (!blockersValid) errors.push("blockers are invalid");
  if (identity.decision === "ready" && blockersValid && identity.blockers.length !== 0)
    errors.push("ready identity cannot retain blockers");
  if (identity.decision === "defer" && blockersValid && identity.blockers.length === 0)
    errors.push("deferred identity must retain blockers");
  if (!TIMESTAMP.test(identity.observed_at ?? "")) errors.push("observed_at is invalid");
  if (!SHA256.test(identity.identity_digest ?? "")) errors.push("identity_digest is invalid");
  assertNoForbiddenFields(identity, errors);
  if (errors.length === 0) {
    const unsigned = { ...identity };
    delete unsigned.identity_digest;
    if (digestJson(unsigned) !== identity.identity_digest)
      errors.push("identity_digest does not match identity");
  }
  if (errors.length > 0) throwGateError("invalid_identity", errors.join("; "));
  return identity;
}

export function verifyReleaseGates(input = {}) {
  const blockers = [];
  const evidence = {};
  const observedAt = input.observedAt ?? new Date().toISOString();
  const report = {
    schema_version: RELEASE_GATE_SCHEMA,
    status: "blocked",
    decision: "defer",
    technical_release_blocking_claim: "none",
    evidence_scope: "procedural_only",
    blockers,
    identity: null,
    authority: null,
    observed_at: observedAt,
  };

  requireTimestamp(observedAt, blockers, "observed_at");
  const authority = checkReceipt(
    input.authorityReceipt,
    "release_authority_missing",
    "release authority",
    blockers,
    assertReleaseAuthorityReceipt,
  );
  if (authority) {
    report.authority = safeAuthorityReconciliation(authority, blockers);
    evidence.authority = authority.receipt_digest;
    if (authority.status !== "verified") blockers.push("release_authority_not_verified");
    if (report.authority.status !== "procedural_ready")
      blockers.push("release_authority_bypass_unproven");
  }

  const ownership = checkReceipt(
    input.ownershipReceipt,
    "ownership_receipt_missing",
    "ownership receipt",
    blockers,
    assertOwnershipReceipt,
  );
  if (ownership) {
    evidence.ownership = digestJson(ownership);
    if (ownership.status !== "verified") blockers.push("ownership_not_active");
  }

  const ruleset = checkReceipt(
    input.rulesetReceipt,
    "ruleset_receipt_missing",
    "ruleset receipt",
    blockers,
    assertRulesetReceipt,
  );
  if (ruleset) {
    evidence.ruleset = digestJson(ruleset);
    if (
      ruleset.status !== "activated" ||
      ruleset.response_loss !== "none" ||
      ruleset.blockers.length !== 0
    )
      blockers.push("ruleset_not_active_or_reconciled");
  }

  const evaluatorResult = checkReceipt(
    input.evaluatorResult,
    "evaluator_result_missing",
    "evaluator result",
    blockers,
    assertEvaluatorResult,
  );
  let candidateSha;
  let baseSha;
  if (evaluatorResult) {
    candidateSha = evaluatorResult.head_sha;
    evidence.candidate = evaluatorResult.attestation_digest;
    if (evaluatorResult.status !== "trusted" || evaluatorResult.success !== true)
      blockers.push("trusted_p4_0_evidence_missing");
    if (evaluatorResult.intent?.intent !== true || evaluatorResult.state?.state !== "bc-preflip")
      blockers.push("candidate_intent_or_human_promotion_missing");
    if (evaluatorResult.attestation === null) {
      blockers.push("evaluator_attestation_missing");
    } else {
      try {
        assertEvaluatorAttestation(evaluatorResult.attestation);
        if (evaluatorResult.attestation_digest !== digestJson(evaluatorResult.attestation))
          blockers.push("evaluator_attestation_digest_mismatch");
      } catch (error) {
        blockers.push(`evaluator_attestation_invalid:${errorMessage(error)}`);
      }
      if (evaluatorResult.attestation?.base_sha) baseSha = evaluatorResult.attestation.base_sha;
    }
    if (evaluatorResult.policy_sha256 !== PRODUCT4_POLICY_SHA256)
      blockers.push("evaluator_policy_not_active");
    if (evaluatorResult.context !== PRODUCT4_CONTEXT) blockers.push("evaluator_context_mismatch");
    if (evaluatorResult.fixture_sha256 !== MAINTENANCE_STUDY_FIXTURE_SHA256)
      blockers.push("evaluator_fixture_mismatch");
  }

  const promotion = checkReceipt(
    input.promotionLedger,
    "promotion_ledger_missing",
    "promotion ledger",
    blockers,
    assertPromotionLedger,
  );
  if (promotion) {
    evidence.promotion = promotion.ledger_digest;
    if (
      promotion.promotion_status !== "pending_human_authority" ||
      promotion.canonical_write !== "none"
    )
      blockers.push("promotion_decision_not_human_authority_only");
    if (candidateSha && promotion.head_sha !== candidateSha)
      blockers.push("promotion_candidate_mismatch");
    if (evaluatorResult && promotion.tree_sha256 !== evaluatorResult.tree_sha256)
      blockers.push("promotion_tree_mismatch");
    if (evaluatorResult && promotion.fixture_sha256 !== evaluatorResult.fixture_sha256)
      blockers.push("promotion_fixture_mismatch");
    if (evaluatorResult && promotion.policy_sha256 !== evaluatorResult.policy_sha256)
      blockers.push("promotion_policy_mismatch");
  }

  const manifest = resolveManifest(input, blockers);
  let version;
  let tag;
  let releaseSha = input.releaseSha;
  if (manifest) {
    version = manifest.version;
    tag = manifest.annotated_tag;
    evidence.manifest = digestJson(manifest);
    evidence.artifact = manifest.sha256.slice("sha256:".length);
    if (manifest.package_name !== "@innocarpe/carpeos") blockers.push("manifest_package_mismatch");
    if (releaseSha && manifest.git_sha !== releaseSha)
      blockers.push("manifest_release_sha_mismatch");
    releaseSha ??= manifest.git_sha;
    if (input.tag && tag !== input.tag) blockers.push("manifest_tag_mismatch");
  }
  if (!releaseSha || !SHA1.test(releaseSha)) blockers.push("release_sha_missing_or_invalid");
  if (input.tag && !TAG.test(input.tag)) blockers.push("release_tag_invalid");
  if (input.tag && tag && input.tag !== tag) blockers.push("release_tag_identity_mismatch");

  const installSmoke = checkReceipt(
    input.installSmoke,
    "install_smoke_missing",
    "install and smoke receipt",
    blockers,
    (value) => assertInstallSmokeReceipt(value, manifest),
  );
  if (installSmoke) evidence.installSmoke = installSmoke.receipt_digest;

  const ancestry = checkReceipt(
    input.ancestry,
    "release_ancestry_missing",
    "C to R ancestry receipt",
    blockers,
    (value) => assertAncestryReceipt(value, { candidateSha, releaseSha }),
  );
  if (ancestry) {
    evidence.ancestry = ancestry.receipt_digest;
    if (baseSha && ancestry.base_sha !== baseSha) blockers.push("ancestry_base_mismatch");
    baseSha ??= ancestry.base_sha;
    if (ancestry.base_is_ancestor !== true || ancestry.candidate_is_ancestor !== true)
      blockers.push("release_ancestry_not_proven");
  }

  const releaseDiff = checkReceipt(
    input.releaseDiff,
    "release_diff_missing",
    "release-only diff receipt",
    blockers,
    (value) => assertReleaseDiffReceipt(value, { candidateSha, releaseSha }),
  );
  if (releaseDiff) {
    evidence.releaseDiff = releaseDiff.receipt_digest;
    if (releaseDiff.only_allowed_paths !== true) blockers.push("release_diff_allowlist_failed");
  }

  const tagIdentity = checkReceipt(
    input.tagIdentity,
    "tag_identity_missing",
    "tag identity receipt",
    blockers,
    (value) => assertTagIdentityReceipt(value, { tag, version, releaseSha }),
  );
  if (tagIdentity) {
    evidence.tagIdentity = tagIdentity.receipt_digest;
    if (tagIdentity.protected !== true || tagIdentity.annotated !== true)
      blockers.push("protected_tag_identity_unproven");
    if (authority && tagIdentity.actor_ref !== authority.tag_authority.ref)
      blockers.push("tag_actor_not_bound_to_authority");
  }

  const approval = checkReceipt(
    input.approval,
    "release_approval_missing",
    "release approval",
    blockers,
    (value) => assertReleaseApprovalReceipt(value, { tag, releaseSha }),
  );
  if (approval) {
    evidence.approval = approval.approval_digest;
    if (approval.approved !== true) blockers.push("release_approval_not_granted");
  }

  const identityEvidence = {
    candidate_attestation_digest: evidence.candidate,
    promotion_ledger_digest: evidence.promotion,
    ownership_receipt_digest: evidence.ownership,
    ruleset_receipt_digest: evidence.ruleset,
    manifest_digest: evidence.manifest,
    artifact_sha256: evidence.artifact,
    install_smoke_digest: evidence.installSmoke,
    ancestry_digest: evidence.ancestry,
    release_diff_digest: evidence.releaseDiff,
    tag_identity_digest: evidence.tagIdentity,
  };
  const identityInputsReady =
    version &&
    tag &&
    releaseSha &&
    candidateSha &&
    baseSha &&
    authority &&
    approval &&
    Object.values(identityEvidence).every((value) => SHA256.test(value ?? ""));
  if (identityInputsReady) {
    const identity = buildReleaseIdentity({
      version,
      tag,
      releaseSha,
      candidateSha,
      baseSha,
      evidence: identityEvidence,
      authorityReceiptDigest: authority.receipt_digest,
      approvalDigest: approval.approval_digest,
      decision: blockers.length === 0 ? "ready" : "defer",
      blockers,
      observedAt,
    });
    report.identity = identity;
  } else {
    blockers.push("release_identity_incomplete");
  }

  if (blockers.length === 0) {
    report.status = "ready";
    report.decision = "ready";
  }
  return report;
}

export function readReleaseReceiptBundle(receiptDir) {
  const root = resolve(receiptDir);
  const authorityDir = join(root, "release-authority-v1");
  let authorityReceipt;
  let authorityError;
  if (!existsSync(authorityDir)) {
    authorityError = "authority directory is missing";
  } else {
    const files = readdirSync(authorityDir).filter((entry) => entry.endsWith(".json"));
    if (files.length !== 1) authorityError = "authority receipt is missing or ambiguous";
    else authorityReceipt = readJsonFile(join(authorityDir, files[0]));
  }
  const bundle = { authorityReceipt };
  for (const [key, relativePath] of Object.entries(RELEASE_RECEIPT_PATHS)) {
    bundle[key] = readJsonFile(join(root, relativePath));
  }
  if (authorityError) bundle.authorityError = authorityError;
  return bundle;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(
      "Usage: node scripts/verify-4.0-gates.mjs --receipt-dir DIR --manifest FILE --tarball FILE --tag TAG --release-sha SHA [--output FILE]\n",
    );
    return 0;
  }
  const bundle = readReleaseReceiptBundle(options.receiptDir);
  if (bundle.authorityError) bundle.authorityReceipt = undefined;
  const report = verifyReleaseGates({
    ...bundle,
    manifestPath: options.manifest,
    tarballPath: options.tarball,
    tag: options.tag,
    releaseSha: options.releaseSha,
  });
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) writeFileSync(resolve(options.output), output, "utf8");
  else process.stdout.write(output);
  return report.status === "ready" ? 0 : 2;
}

function resolveManifest(input, blockers) {
  if (input.manifestPath) {
    try {
      if (!input.tarballPath) throwGateError("artifact_missing", "tarball path is required");
      return assertArtifact(input.manifestPath, input.tarballPath);
    } catch (error) {
      blockers.push(`pack_once_artifact_invalid:${errorMessage(error)}`);
      return null;
    }
  }
  if (!input.manifest) {
    blockers.push("pack_once_manifest_missing");
    return null;
  }
  try {
    assertManifest(input.manifest);
    if (!input.tarballPath) blockers.push("pack_once_tarball_not_verified");
    else assertManifestArtifact(input.manifest, input.tarballPath);
    return input.manifest;
  } catch (error) {
    blockers.push(`pack_once_manifest_invalid:${errorMessage(error)}`);
    return null;
  }
}

function checkReceipt(value, missingCode, label, blockers, assertion) {
  if (!value) {
    blockers.push(missingCode);
    return null;
  }
  try {
    assertion(value);
    return value;
  } catch (error) {
    blockers.push(`${label.replaceAll(" ", "_")}_invalid:${errorMessage(error)}`);
    return null;
  }
}

function safeAuthorityReconciliation(receipt, blockers) {
  try {
    const result = reconcileReleaseAuthority({
      receipt,
      releaseGate: { deleted: true, actor: "candidate_release_actor" },
    });
    return result;
  } catch (error) {
    blockers.push(`release_authority_reconciliation_invalid:${errorMessage(error)}`);
    return { status: "blocked", tag_capability: "denied", credential_capability: "denied" };
  }
}

function assertManifest(manifest) {
  const keys = [
    "schema",
    "git_sha",
    "annotated_tag",
    "package_name",
    "version",
    "filename",
    "bytes",
    "sha256",
    "sha512",
    "npm_integrity",
    "creation_tool",
    "creation_tool_version",
  ];
  if (!isRecord(manifest) || Object.keys(manifest).join(",") !== keys.join(","))
    throwGateError("invalid_manifest", "manifest keys are invalid");
  if (
    manifest.schema !== "carpeos.release-artifact/v1" ||
    !SHA1.test(manifest.git_sha ?? "") ||
    !VERSION.test(manifest.version ?? "") ||
    manifest.annotated_tag !== `v${manifest.version}` ||
    manifest.package_name !== "@innocarpe/carpeos" ||
    !/^[^/]+\.tgz$/.test(manifest.filename)
  )
    throwGateError("invalid_manifest", "manifest release binding is invalid");
  if (
    !Number.isSafeInteger(manifest.bytes) ||
    manifest.bytes <= 0 ||
    !/^sha256:[0-9a-f]{64}$/.test(manifest.sha256) ||
    !/^sha512-[A-Za-z0-9+/]{86}==$/.test(manifest.sha512) ||
    manifest.sha512 !== manifest.npm_integrity ||
    manifest.creation_tool !== "npm" ||
    typeof manifest.creation_tool_version !== "string" ||
    manifest.creation_tool_version.length === 0
  )
    throwGateError("invalid_manifest", "manifest artifact hashes are invalid");
}

function assertManifestArtifact(manifest, tarballPath) {
  if (!existsSync(tarballPath) || !statSync(tarballPath).isFile())
    throwGateError("invalid_manifest", "pack-once tarball is missing");
  if (basename(tarballPath) !== manifest.filename)
    throwGateError("invalid_manifest", "tarball filename does not match manifest");
  const bytes = readFileSync(tarballPath);
  if (bytes.length !== manifest.bytes)
    throwGateError("invalid_manifest", "tarball byte count does not match manifest");
  if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== manifest.sha256)
    throwGateError("invalid_manifest", "tarball hash does not match manifest");
}
function assertInstallSmokeReceipt(value, manifest) {
  assertReceiptEnvelope(value, "product4-install-smoke-v1", "install_smoke", "install_smoke", [
    "schema_version",
    "receipt_type",
    "status",
    "package_name",
    "version",
    "manifest_digest",
    "artifact_sha256",
    "install_digest",
    "smoke_digest",
    "observed_at",
    "receipt_digest",
  ]);
  if (value.status !== "passed") throwGateError("invalid_receipt", "install smoke did not pass");
  if (value.package_name !== "@innocarpe/carpeos")
    throwGateError("invalid_receipt", "install package is invalid");
  if (
    manifest &&
    (value.version !== manifest.version || value.manifest_digest !== digestJson(manifest))
  )
    throwGateError("invalid_receipt", "install smoke is not manifest-bound");
  if (manifest && value.artifact_sha256 !== manifest.sha256.slice("sha256:".length))
    throwGateError("invalid_receipt", "install smoke artifact is not manifest-bound");
  for (const key of ["manifest_digest", "artifact_sha256", "install_digest", "smoke_digest"])
    assertSha256(value[key], `install smoke ${key}`);
}

function assertAncestryReceipt(value, { candidateSha, releaseSha }) {
  assertReceiptEnvelope(
    value,
    "product4-release-ancestry-v1",
    "release_ancestry",
    "release_ancestry",
    [
      "schema_version",
      "receipt_type",
      "status",
      "base_sha",
      "candidate_sha",
      "release_sha",
      "base_is_ancestor",
      "candidate_is_ancestor",
      "allowlist_digest",
      "observed_at",
      "receipt_digest",
    ],
  );
  if (value.status !== "verified") throwGateError("invalid_receipt", "ancestry is not verified");
  for (const [key, expected] of [
    ["candidate_sha", candidateSha],
    ["release_sha", releaseSha],
  ]) {
    if (expected && value[key] !== expected)
      throwGateError("invalid_receipt", `${key} does not match release identity`);
  }
  if (!SHA1.test(value.base_sha)) throwGateError("invalid_receipt", "base SHA is invalid");
  if (value.base_is_ancestor !== true || value.candidate_is_ancestor !== true)
    throwGateError("invalid_receipt", "C to R ancestry is not proven");
  assertSha256(value.allowlist_digest, "ancestry allowlist digest");
}

function assertReleaseDiffReceipt(value, { candidateSha, releaseSha }) {
  assertReceiptEnvelope(value, "product4-release-diff-v1", "release_diff", "release_diff", [
    "schema_version",
    "receipt_type",
    "status",
    "candidate_sha",
    "release_sha",
    "allowed_paths",
    "changed_paths",
    "allowed_paths_digest",
    "changed_paths_digest",
    "only_allowed_paths",
    "observed_at",
    "receipt_digest",
  ]);
  if (value.status !== "verified")
    throwGateError("invalid_receipt", "release diff is not verified");
  if (candidateSha && value.candidate_sha !== candidateSha)
    throwGateError("invalid_receipt", "release diff candidate does not match");
  if (releaseSha && value.release_sha !== releaseSha)
    throwGateError("invalid_receipt", "release diff release does not match");
  if (!Array.isArray(value.allowed_paths) || !Array.isArray(value.changed_paths))
    throwGateError("invalid_receipt", "release diff paths are invalid");
  if (
    value.allowed_paths.some(
      (path) => typeof path !== "string" || path.length === 0 || path.startsWith("/"),
    )
  )
    throwGateError("invalid_receipt", "release allowlist contains an invalid path");
  if (
    value.changed_paths.some(
      (path) => typeof path !== "string" || path.length === 0 || path.startsWith("/"),
    )
  )
    throwGateError("invalid_receipt", "release diff contains an invalid path");
  if (value.changed_paths.some((path) => !value.allowed_paths.includes(path)))
    throwGateError("invalid_receipt", "release diff escapes the allowlist");
  if (digestJson(value.allowed_paths) !== value.allowed_paths_digest)
    throwGateError("invalid_receipt", "release allowlist digest is invalid");
  if (digestJson(value.changed_paths) !== value.changed_paths_digest)
    throwGateError("invalid_receipt", "release diff digest is invalid");
}

function assertTagIdentityReceipt(value, { tag, version, releaseSha }) {
  assertReceiptEnvelope(value, "product4-tag-identity-v1", "tag_identity", "tag_identity", [
    "schema_version",
    "receipt_type",
    "status",
    "tag",
    "version",
    "target_sha",
    "actor_ref",
    "protected",
    "annotated",
    "observed_at",
    "receipt_digest",
  ]);
  if (value.status !== "verified")
    throwGateError("invalid_receipt", "tag identity is not verified");
  for (const [key, expected] of [
    ["tag", tag],
    ["version", version],
    ["target_sha", releaseSha],
  ]) {
    if (expected && value[key] !== expected)
      throwGateError("invalid_receipt", `${key} does not match release identity`);
  }
  if (!TAG.test(value.tag) || value.tag !== `v${value.version}` || !SHA1.test(value.target_sha))
    throwGateError("invalid_receipt", "tag identity binding is invalid");
  if (!/^[a-z][a-z0-9_-]{2,63}$/.test(value.actor_ref))
    throwGateError("invalid_receipt", "tag actor is invalid");
}

function assertReleaseApprovalReceipt(value, { tag, releaseSha }) {
  assertReceiptEnvelope(
    value,
    "product4-release-approval-v1",
    "release_approval",
    "release_approval",
    [
      "schema_version",
      "receipt_type",
      "status",
      "approved",
      "tag",
      "release_sha",
      "approval_digest",
      "observed_at",
      "receipt_digest",
    ],
  );
  if (value.status !== "approved" || value.approved !== true)
    throwGateError("invalid_receipt", "release approval is not granted");
  if (tag && value.tag !== tag) throwGateError("invalid_receipt", "approval tag does not match");
  if (releaseSha && value.release_sha !== releaseSha)
    throwGateError("invalid_receipt", "approval release does not match");
  assertSha256(value.approval_digest, "approval digest");
}

function assertReceiptEnvelope(value, schemaVersion, receiptType, label, keys) {
  if (!isRecord(value) || Object.keys(value).join(",") !== keys.join(","))
    throwGateError("invalid_receipt", `${label} keys are invalid`);
  if (value.schema_version !== schemaVersion || value.receipt_type !== receiptType)
    throwGateError("invalid_receipt", `${label} type is invalid`);
  if (!TIMESTAMP.test(value.observed_at ?? ""))
    throwGateError("invalid_receipt", `${label} timestamp is invalid`);
  assertSha256(value.receipt_digest, `${label} receipt digest`);
  const unsigned = { ...value };
  delete unsigned.receipt_digest;
  if (digestJson(unsigned) !== value.receipt_digest)
    throwGateError("invalid_receipt", `${label} receipt digest does not match`);
  assertNoForbiddenFields(value);
}

function assertSha256(value, label) {
  if (!SHA256.test(value ?? "")) throwGateError("invalid_receipt", `${label} is invalid`);
}

function requireTimestamp(value, blockers, label) {
  if (!TIMESTAMP.test(value ?? "")) blockers.push(`${label}_invalid`);
}

function assertExactKeys(value, allowed, label, errors) {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) errors.push(`${label}.${key} is not allowed`);
}

function assertNoForbiddenFields(value, path = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertNoForbiddenFields(item, `${path}[${index}]`);
    });
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) throwGateError("invalid_receipt", `${path}.${key} is not allowed`);
    assertNoForbiddenFields(child, `${path}.${key}`);
  }
}

function readJsonFile(path) {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throwGateError("invalid_json", `${basename(path)} cannot be parsed: ${errorMessage(error)}`);
  }
}

function parseArgs(argv) {
  const options = {
    receiptDir: "artifacts/receipts",
    manifest: undefined,
    tarball: undefined,
    tag: undefined,
    releaseSha: undefined,
    output: undefined,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    const name = {
      "--receipt-dir": "receiptDir",
      "--manifest": "manifest",
      "--tarball": "tarball",
      "--tag": "tag",
      "--release-sha": "releaseSha",
      "--output": "output",
    }[arg];
    if (!name || index + 1 >= argv.length) throwGateError("usage", `missing value for ${arg}`);
    options[name] = argv[++index];
  }
  return options;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function throwGateError(code, message) {
  throw new ReleaseGateError(code, message);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = error?.code === "usage" ? 1 : 2;
  }
}
