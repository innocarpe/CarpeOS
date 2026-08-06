import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AnySchemaObject } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { createAjv2020 } from "../src/index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const policy = readJson("spec/product4/evaluator-policy-v1.json");
const fixture = readJson("scripts/fixtures/maintenance-study-v2.json");
const schemaNames = [
  "product4-candidate-report-v1",
  "product4-evaluator-attestation-v1",
  "product4-candidate-intent-v1",
] as const;
const schemas = Object.fromEntries(
  schemaNames.map((name) => [name, readJson(`schemas/${name}.json`)]),
) as Record<(typeof schemaNames)[number], AnySchemaObject & { $id: string }>;
const ajv = createAjv2020();
for (const schema of Object.values(schemas)) ajv.addSchema(schema);

const policySha256 = digestJson(policy);
const fixtureSha256 = digestJson(fixture);
const headSha = "a".repeat(40);
const baseSha = "b".repeat(40);
const treeSha256 = "c".repeat(64);
const externalId = `carpeos-4.0.0:${headSha}:${fixtureSha256}`;

const candidateReport = {
  schema_version: "product4-candidate-report-v1",
  report_type: "raw_candidate_report",
  repository_id: 1315097793,
  head_sha: headSha,
  base_sha: baseSha,
  tree_sha256: treeSha256,
  fixture_sha256: fixtureSha256,
  intent_policy_sha256: policySha256,
  context: "Product 4 Candidate Evidence",
  external_id: externalId,
  producer: {
    workflow_sha: "d".repeat(40),
    event: "pull_request",
    trust_level: "unprivileged",
  },
  observations: {
    commands: [
      {
        command_id: "p02_replay_a",
        invocation_digest: "e".repeat(64),
        exit_code: 0,
        stdout_sha256: "f".repeat(64),
        stderr_sha256: "0".repeat(64),
      },
    ],
    p02: {
      diagnosis: "no_analog",
      outcome: "blocked_no_apply",
      analog_available: false,
      state_transition: "none_supported",
    },
    zero_write: {
      canonical_events: 0,
      review_rows: 0,
      disposition_rows: 0,
      outbox_rows: 0,
      protected_uploads: 0,
    },
  },
};

const predicateIds = [
  "identity_bound",
  "fixture_bound",
  "policy_pinned",
  "context_pinned",
  "migration_read_oracle",
  "six_command_loop",
  "p02_truthful_no_analog",
  "zero_write",
  "state_order",
  "no_privileged_candidate_execution",
  "strict_attestation",
  "exact_c_api",
  "duplicate_refusal",
  "lost_response_reconciliation",
  "provenance_bound",
  "negative_cases",
] as const;

const evaluatorAttestation = {
  schema_version: "carpeos.product4-evaluator-attestation/v1",
  attestation_type: "strict_non_executable",
  repository_id: 1315097793,
  head_sha: headSha,
  tree_sha256: treeSha256,
  fixture_sha256: fixtureSha256,
  policy_sha256: policySha256,
  context: "Product 4 Candidate Evidence",
  external_id: externalId,
  issuer_workflow_sha: "1".repeat(40),
  predicate_results: predicateIds.map((predicate_id) => ({
    predicate_id,
    passed: true,
    evidence_digest: "2".repeat(64),
  })),
  observations: {
    p02: {
      diagnosis: "no_analog",
      outcome: "blocked_no_apply",
      analog_available: false,
      state_transition: "none_supported",
    },
    zero_write: {
      canonical_events: 0,
      review_rows: 0,
      disposition_rows: 0,
      outbox_rows: 0,
      protected_uploads: 0,
    },
    high_water: {
      canonical_events: 1,
      review_rows: 0,
      disposition_rows: 0,
      outbox_rows: 0,
      protected_uploads: 0,
    },
    candidate_execution: {
      unprivileged: true,
      isolated: true,
    },
  },
  provenance: {
    source_report_sha256: "3".repeat(64),
    base_sha: baseSha,
    evaluator_workflow_sha: "1".repeat(40),
    evaluated_at: "2026-01-02T00:00:00Z",
  },
};

const candidateIntent = {
  schema_version: "product4-candidate-intent-v1",
  repository_id: 1315097793,
  head_sha: headSha,
  tree_sha256: treeSha256,
  fixture_sha256: fixtureSha256,
  intent_policy_sha256: policySha256,
  context: "Product 4 Candidate Evidence",
  intent: true,
  state: "pending_evidence",
  scope_digest: "5".repeat(64),
  issuer_workflow_sha: "6".repeat(40),
  classification_digest: "7".repeat(64),
};

describe("Product 4 M0 contracts", () => {
  it("pins the deterministic policy and fixture identities", () => {
    expect(policy.policy_id).toBe("P4_0");
    expect(policy.context).toBe("Product 4 Candidate Evidence");
    expect(policySha256).toBe("3da2700b19734b2c62eedf75a52c3947ac7ea17573a829eab4270cff6416e83e");
    expect(fixtureSha256).toBe("0c7f7e3d849d6ab77558cfb24027c03ef6f6236051d5b0a1f05e86ec959fa60f");
    expect(fixture.command_line).toBe(
      "carpeos adjudicate reconcile-policy --from-policy adj_v1 --to-policy adj_v3 --trust-zone tz_synthetic --limit 100",
    );
    expect(fixture.expected).toMatchObject({
      diagnosis: "no_analog",
      outcome: "blocked_no_apply",
      analog_available: false,
      state_transition: "none_supported",
      zero_write: true,
    });
  });

  it("accepts valid report, attestation, and immutable intent samples", () => {
    for (const [name, sample] of [
      ["product4-candidate-report-v1", candidateReport],
      ["product4-evaluator-attestation-v1", evaluatorAttestation],
      ["product4-candidate-intent-v1", candidateIntent],
    ] as const) {
      const validate = ajv.getSchema(schemas[name].$id);
      expect(validate, name).toBeDefined();
      expect(validate?.(sample), JSON.stringify(validate?.errors)).toBe(true);
    }
  });

  it("rejects unknown, unsafe, executable, and private fields at every contract boundary", () => {
    const cases = [
      ["product4-candidate-report-v1", candidateReport, "token"],
      ["product4-candidate-report-v1", candidateReport, "command"],
      ["product4-evaluator-attestation-v1", evaluatorAttestation, "script"],
      ["product4-evaluator-attestation-v1", evaluatorAttestation, "private_path"],
      ["product4-candidate-intent-v1", candidateIntent, "candidate_success"],
      ["product4-candidate-intent-v1", candidateIntent, "url"],
    ] as const;

    for (const [name, sample, field] of cases) {
      const invalid = structuredClone(sample) as Record<string, unknown>;
      invalid[field] = "forbidden";
      const validate = ajv.getSchema(schemas[name].$id);
      expect(validate?.(invalid), `${name} accepts ${field}`).toBe(false);
    }
  });

  it("rejects invalid SHAs, alternate policy identities, and context replacement", () => {
    const reportValidator = ajv.getSchema(schemas["product4-candidate-report-v1"].$id);
    const attestationValidator = ajv.getSchema(schemas["product4-evaluator-attestation-v1"].$id);
    const intentValidator = ajv.getSchema(schemas["product4-candidate-intent-v1"].$id);

    const invalidHead = structuredClone(candidateReport);
    invalidHead.head_sha = "not-a-sha";
    expect(reportValidator?.(invalidHead)).toBe(false);

    const inactivePolicy = structuredClone(candidateIntent);
    inactivePolicy.intent_policy_sha256 = "8".repeat(64);
    expect(intentValidator?.(inactivePolicy)).toBe(false);

    const replacedContext = structuredClone(evaluatorAttestation);
    replacedContext.context = "Product 4 Candidate Evidence v2";
    expect(attestationValidator?.(replacedContext)).toBe(false);
  });
  it("rejects duplicate predicates, malformed identities, and undocumented wrappers", () => {
    const validator = ajv.getSchema(schemas["product4-evaluator-attestation-v1"].$id);
    expect(schemas["product4-evaluator-attestation-v1"].$id).toBe(
      "https://spec.carpeos.org/product4/schemas/product4-evaluator-attestation-v1.json",
    );
    expect(evaluatorAttestation.schema_version).toBe("carpeos.product4-evaluator-attestation/v1");

    const duplicatePredicate = structuredClone(evaluatorAttestation);
    const duplicatePredicateItem = duplicatePredicate.predicate_results[15];
    expect(duplicatePredicateItem).toBeDefined();
    if (duplicatePredicateItem !== undefined)
      duplicatePredicateItem.predicate_id = "identity_bound";
    expect(validator?.(duplicatePredicate)).toBe(false);
    const reorderedPredicates = structuredClone(evaluatorAttestation);
    const firstPredicate = reorderedPredicates.predicate_results[0];
    const secondPredicate = reorderedPredicates.predicate_results[1];
    expect(firstPredicate).toBeDefined();
    expect(secondPredicate).toBeDefined();
    if (firstPredicate !== undefined && secondPredicate !== undefined) {
      [reorderedPredicates.predicate_results[0], reorderedPredicates.predicate_results[1]] = [
        secondPredicate,
        firstPredicate,
      ];
    }
    expect(validator?.(reorderedPredicates)).toBe(false);

    const malformedHead = structuredClone(evaluatorAttestation);
    malformedHead.head_sha = `${"b".repeat(39)}z`;
    expect(validator?.(malformedHead)).toBe(false);

    const undocumentedWrapper = { attestation: structuredClone(evaluatorAttestation) };
    expect(validator?.(undocumentedWrapper)).toBe(false);
  });
});

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(repoRoot, relativePath), "utf8"));
}

function digestJson(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(sortKeys(value)))
    .digest("hex");
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
  );
}
