import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertEvaluatorAttestation, attestationDigest } from "./evaluator.mjs";
import { assertEvaluatorResult } from "./evaluator-runner.mjs";
import { PRODUCT4_CONTEXT, PRODUCT4_REPOSITORY_ID } from "./policy-identity.mjs";
import { publishAttestation } from "./publisher.mjs";

export const PUBLISHER_RESULT_SCHEMA = "product4-publisher-result-v1";
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export function publishEvaluatorResult({ evaluatorResult, publisherWorkflowSha, expectedHeadSha }) {
  assertPublisherInput(evaluatorResult, { expectedHeadSha });
  if (!SHA1.test(publisherWorkflowSha ?? "")) throw new Error("publisher workflow is invalid");
  if (evaluatorResult.status !== "trusted" || evaluatorResult.success !== true)
    throw new Error("publisher refuses a non-trusted evaluator result");
  const publication = publishAttestation({
    attestation: evaluatorResult.attestation,
    dataSink: (payload) => ({
      status: "dry_run_data_only",
      external_id: payload.external_id,
      context: payload.context,
      attestation_digest: evaluatorResult.attestation_digest,
    }),
  });
  const result = {
    schema_version: PUBLISHER_RESULT_SCHEMA,
    result_type: "base_owned_data_only_publication",
    status: "blocked_no_live_authority",
    repository_id: evaluatorResult.repository_id,
    head_sha: evaluatorResult.head_sha,
    tree_sha256: evaluatorResult.tree_sha256,
    context: PRODUCT4_CONTEXT,
    attestation_digest: evaluatorResult.attestation_digest,
    publisher_workflow_sha: publisherWorkflowSha,
    publication_status: publication.status,
    live_write: "not_attempted",
    blockers: ["ownership_unknown", "activation_not_authorized"],
  };
  return assertPublisherResult(result);
}
export function assertPublisherInput(evaluatorResult, { expectedHeadSha } = {}) {
  assertEvaluatorResult(evaluatorResult);
  if (expectedHeadSha !== undefined) {
    if (!SHA1.test(expectedHeadSha)) throw new Error("publisher expected head is invalid");
    if (evaluatorResult.head_sha !== expectedHeadSha)
      throw new Error("publisher input head is not bound to triggering workflow C");
  }
  if (evaluatorResult.attestation === null)
    throw new Error("publisher input must contain the exact evaluator attestation boundary");
  const attestation = assertEvaluatorAttestation(evaluatorResult.attestation);
  const identityFields = [
    "repository_id",
    "head_sha",
    "tree_sha256",
    "fixture_sha256",
    "policy_sha256",
    "context",
  ];
  for (const field of identityFields) {
    if (attestation[field] !== evaluatorResult[field])
      throw new Error(`publisher input attestation ${field} is not bound to evaluator result`);
  }
  const expectedExternalId = `carpeos-4.0.0:${evaluatorResult.head_sha}:${evaluatorResult.fixture_sha256}`;
  if (attestation.external_id !== expectedExternalId)
    throw new Error("publisher input external_id is not bound to evaluator C and fixture");
  const expectedDigest = attestationDigest(attestation);
  if (evaluatorResult.attestation_digest !== expectedDigest)
    throw new Error("publisher input attestation digest does not match attestation");
  return evaluatorResult;
}

export function assertPublisherResult(result) {
  if (result === null || typeof result !== "object" || Array.isArray(result))
    throw new Error("invalid publisher result");
  const keys = [
    "schema_version",
    "result_type",
    "status",
    "repository_id",
    "head_sha",
    "tree_sha256",
    "context",
    "attestation_digest",
    "publisher_workflow_sha",
    "publication_status",
    "live_write",
    "blockers",
  ];
  if (Object.keys(result).some((key) => !keys.includes(key)))
    throw new Error("publisher result contains unsupported fields");
  if (result.schema_version !== PUBLISHER_RESULT_SCHEMA)
    throw new Error("publisher result schema is invalid");
  if (result.result_type !== "base_owned_data_only_publication")
    throw new Error("publisher result type is invalid");
  if (result.status !== "blocked_no_live_authority") throw new Error("publisher status is invalid");
  if (result.context !== PRODUCT4_CONTEXT) throw new Error("publisher context is invalid");
  if (result.repository_id !== PRODUCT4_REPOSITORY_ID)
    throw new Error("publisher repository is invalid");
  if (!SHA1.test(result.head_sha ?? "")) throw new Error("publisher head is invalid");
  if (!SHA256.test(result.tree_sha256 ?? "")) throw new Error("publisher tree is invalid");
  if (!SHA256.test(result.attestation_digest ?? ""))
    throw new Error("publisher attestation digest is invalid");
  if (!SHA1.test(result.publisher_workflow_sha ?? ""))
    throw new Error("publisher workflow is invalid");
  if (result.publication_status !== "published_data_only")
    throw new Error("publisher did not consume data-only attestation");
  if (result.live_write !== "not_attempted") throw new Error("publisher attempted a live write");
  if (!Array.isArray(result.blockers) || result.blockers.length === 0)
    throw new Error("publisher blockers are required");
  return result;
}

function parseArgs(argv) {
  const values = {};
  const allowed = new Set(["--evaluator-result", "--workflow-sha", "--head-sha", "--output"]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!allowed.has(flag)) throw new Error(`${flag} is not supported`);
    const value = argv[index + 1];
    if (typeof value !== "string" || value.length === 0 || values[flag] !== undefined)
      throw new Error(`${flag} requires one non-empty value and cannot repeat`);
    values[flag] = value;
    index += 1;
  }
  for (const flag of ["--evaluator-result", "--workflow-sha", "--output"])
    if (values[flag] === undefined) throw new Error(`${flag} is required`);
  return values;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = publishEvaluatorResult({
      evaluatorResult: JSON.parse(readFileSync(resolve(args["--evaluator-result"]), "utf8")),
      publisherWorkflowSha: args["--workflow-sha"],
      expectedHeadSha: args["--head-sha"],
    });
    writeFileSync(resolve(args["--output"]), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
