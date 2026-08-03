import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ADJUDICATION_POLICY_VERSION } from "./adjudication.js";
import { containsSecretLikeMaterial } from "./meaningful-unit-policy.js";

export const KNOWLEDGE_FORM_CORPUS_SCHEMA = "carpeos.knowledge-form-support/v1" as const;
export const KNOWLEDGE_FORM_REPORT_SCHEMA = "carpeos.knowledge-form-quality-report/v1" as const;
const CLASSES = [
  "must_observation",
  "must_claim_candidate",
  "must_reject",
  "must_insufficient_support",
] as const;
type KnowledgeFormClass = (typeof CLASSES)[number];
const PUBLIC_ID = /^kfq-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NON_PUBLIC_ID = /(?:credential|password|secret|token|private|production)/;

type SupportRef = { evidence_id: string; relation: "supports" | "derived_from" };
type Evidence = { id: string; zone: string; visible: boolean };
type Fixture = {
  id: string;
  expected_class: KnowledgeFormClass;
  statement: string;
  statement_kind: "observation" | "provisional" | "intent" | "assertion";
  zone: string;
  visible_zones: string[];
  source_id: string;
  evidence: Evidence[];
  support_refs: SupportRef[];
  required_reason_codes: string[];
  forbidden_fragments: string[];
  safety: { statement_must_be_safe: true };
  provenance: { deterministic: true };
};
type Corpus = {
  schema: typeof KNOWLEDGE_FORM_CORPUS_SCHEMA;
  corpus_version: "knowledge-form-support/v1";
  policy_version: string;
  fixtures: Fixture[];
};
type Counts = Record<KnowledgeFormClass, number>;
type Confusion = Record<KnowledgeFormClass, Counts>;
export type KnowledgeFormQualityReport = {
  schema: typeof KNOWLEDGE_FORM_REPORT_SCHEMA;
  report_version: "v1";
  corpus_version: string | null;
  policy_version: string | null;
  corpus_digest: string | null;
  valid: boolean;
  gate_passed: boolean;
  invalid_reasons: string[];
  class_counts: Counts;
  confusion: Confusion;
  accuracy: number | null;
  claim_precision: number | null;
  claim_recall: number | null;
  observation_preservation: number | null;
  reject_insufficient_denominator: number | null;
  false_candidate_count: number;
  false_candidate_rate: number | null;
  reason_assertion_failures: number;
  safety_assertion_failures: number;
  support_assertion_failures: number;
  provenance_assertion_failures: number;
  invariants: {
    allow_auto_claim: false;
    evaluation_only: true;
    automatic_claim_writes: 0;
    automatic_acceptance_decision_writes: 0;
  };
};
export type KnowledgeFormEvaluation = { report: KnowledgeFormQualityReport; exit_code: 0 | 1 | 2 };

type RubricResult = {
  classification: KnowledgeFormClass;
  reason_codes: string[];
  provenance_digest: string;
};

export function evaluateKnowledgeFormQuality(input: unknown): KnowledgeFormEvaluation {
  const validated = validateCorpus(input);
  if (!validated.ok) return invalid(validated.reasons);
  const corpus = validated.corpus;
  const counts = emptyCounts();
  const confusion = emptyConfusion();
  let correct = 0;
  let predictedClaims = 0;
  let trueClaims = 0;
  let expectedClaims = 0;
  let expectedObservations = 0;
  let preservedObservations = 0;
  let nonCandidateTotal = 0;
  let falseCandidates = 0;
  let reasonFailures = 0;
  let safetyFailures = 0;
  let supportFailures = 0;
  let provenanceFailures = 0;

  for (const fixture of corpus.fixtures) {
    const result = applyKnowledgeFormEvaluationRubric(fixture);
    counts[fixture.expected_class] += 1;
    confusion[fixture.expected_class][result.classification] += 1;
    if (result.classification === fixture.expected_class) correct += 1;
    if (fixture.expected_class === "must_claim_candidate") {
      expectedClaims += 1;
      if (result.classification === "must_claim_candidate") trueClaims += 1;
    }
    if (result.classification === "must_claim_candidate") predictedClaims += 1;
    if (fixture.expected_class === "must_observation") {
      expectedObservations += 1;
      if (result.classification === "must_observation") preservedObservations += 1;
    }
    if (
      fixture.expected_class === "must_reject" ||
      fixture.expected_class === "must_insufficient_support"
    ) {
      nonCandidateTotal += 1;
      if (result.classification === "must_claim_candidate") falseCandidates += 1;
    }
    reasonFailures += fixture.required_reason_codes.filter(
      (reason) => !result.reason_codes.includes(reason),
    ).length;
    if (
      result.classification !== "must_reject" &&
      (containsSecretLikeMaterial(fixture.statement) ||
        fixture.forbidden_fragments.some((fragment) => fixture.statement.includes(fragment)))
    )
      safetyFailures += 1;
    if (
      fixture.expected_class === "must_claim_candidate" &&
      result.classification !== "must_claim_candidate"
    )
      supportFailures += 1;
    if (
      fixture.provenance.deterministic &&
      result.provenance_digest !== applyKnowledgeFormEvaluationRubric(fixture).provenance_digest
    )
      provenanceFailures += 1;
  }

  if (
    corpus.fixtures.length === 0 ||
    predictedClaims === 0 ||
    expectedClaims === 0 ||
    expectedObservations === 0 ||
    nonCandidateTotal === 0
  )
    return invalid(["required_denominator_missing"]);
  const invariants = authorityInvariants();
  const accuracy = correct / corpus.fixtures.length;
  const claimPrecision = trueClaims / predictedClaims;
  const claimRecall = trueClaims / expectedClaims;
  const observationPreservation = preservedObservations / expectedObservations;
  const falseCandidateRate = falseCandidates / nonCandidateTotal;
  const gatePassed =
    accuracy === 1 &&
    claimPrecision === 1 &&
    claimRecall === 1 &&
    observationPreservation === 1 &&
    falseCandidates === 0 &&
    reasonFailures === 0 &&
    safetyFailures === 0 &&
    supportFailures === 0 &&
    provenanceFailures === 0 &&
    invariants.automatic_claim_writes === 0 &&
    invariants.automatic_acceptance_decision_writes === 0;
  return {
    report: {
      schema: KNOWLEDGE_FORM_REPORT_SCHEMA,
      report_version: "v1",
      corpus_version: corpus.corpus_version,
      policy_version: corpus.policy_version,
      corpus_digest: digestCorpus(corpus),
      valid: true,
      gate_passed: gatePassed,
      invalid_reasons: [],
      class_counts: counts,
      confusion,
      accuracy,
      claim_precision: claimPrecision,
      claim_recall: claimRecall,
      observation_preservation: observationPreservation,
      reject_insufficient_denominator: nonCandidateTotal,
      false_candidate_count: falseCandidates,
      false_candidate_rate: falseCandidateRate,
      reason_assertion_failures: reasonFailures,
      safety_assertion_failures: safetyFailures,
      support_assertion_failures: supportFailures,
      provenance_assertion_failures: provenanceFailures,
      invariants,
    },
    exit_code: gatePassed ? 0 : 1,
  };
}

export function knowledgeFormQualityExitCode(input: unknown): 0 | 1 | 2 {
  return evaluateKnowledgeFormQuality(input).exit_code;
}
export function digestKnowledgeFormCorpus(input: unknown): string {
  const validated = validateCorpus(input);
  if (!validated.ok) throw new Error("invalid knowledge form corpus");
  return digestCorpus(validated.corpus);
}

// Evidence-only rubric: it is intentionally private to this evaluator and has no store/runtime callsite.
function applyKnowledgeFormEvaluationRubric(fixture: Fixture): RubricResult {
  const provenance = fixture.support_refs
    .map((ref) => ({ evidence_id: ref.evidence_id, relation: ref.relation }))
    .sort((a, b) => stableJson(a).localeCompare(stableJson(b)));
  const provenance_digest = sha256(stableJson(provenance));
  const statement = fixture.statement.trim();
  if (
    !statement ||
    statement.length > 500 ||
    containsSecretLikeMaterial(statement) ||
    /(?:^|\s)\/[A-Za-z0-9_./-]+/.test(statement) ||
    /^(?:thanks|hello|acknowledged)[.!]?$/i.test(statement)
  )
    return {
      classification: "must_reject",
      reason_codes: ["unsafe_or_empty_statement"],
      provenance_digest,
    };
  if (
    fixture.statement_kind === "observation" ||
    fixture.statement_kind === "provisional" ||
    fixture.statement_kind === "intent"
  )
    return {
      classification: "must_observation",
      reason_codes: ["observation_or_intent_form"],
      provenance_digest,
    };
  const unique = new Set(
    fixture.support_refs.map((ref) => `${ref.evidence_id}\u0000${ref.relation}`),
  );
  if (unique.size !== fixture.support_refs.length || fixture.support_refs.length === 0)
    return {
      classification: "must_insufficient_support",
      reason_codes: ["support_missing_or_duplicate"],
      provenance_digest,
    };
  const evidence = new Map(fixture.evidence.map((item) => [item.id, item]));
  for (const ref of fixture.support_refs) {
    const resolved = evidence.get(ref.evidence_id);
    if (
      !resolved ||
      resolved.id === fixture.source_id ||
      !resolved.visible ||
      resolved.zone !== fixture.zone ||
      !fixture.visible_zones.includes(resolved.zone)
    )
      return {
        classification: "must_insufficient_support",
        reason_codes: ["support_unresolved_or_not_visible"],
        provenance_digest,
      };
  }
  return {
    classification: "must_claim_candidate",
    reason_codes: ["safe_assertive_supported", "deterministic_provenance"],
    provenance_digest,
  };
}

function validateCorpus(
  value: unknown,
): { ok: true; corpus: Corpus } | { ok: false; reasons: string[] } {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schema", "corpus_version", "policy_version", "fixtures"])
  )
    return { ok: false, reasons: ["malformed_corpus"] };
  const reasons: string[] = [];
  if (value.schema !== KNOWLEDGE_FORM_CORPUS_SCHEMA) reasons.push("unsupported_corpus_schema");
  if (value.corpus_version !== "knowledge-form-support/v1")
    reasons.push("unsupported_corpus_version");
  if (typeof value.policy_version !== "string")
    return { ok: false, reasons: unique([...reasons, "policy_version_mismatch"]) };
  if (value.policy_version !== ADJUDICATION_POLICY_VERSION) reasons.push("policy_version_mismatch");
  const rawFixtures = value.fixtures;
  if (!Array.isArray(rawFixtures))
    return { ok: false, reasons: unique([...reasons, "malformed_fixtures"]) };
  const fixtures: Fixture[] = [];
  const ids = new Set<string>();
  for (const raw of rawFixtures) {
    const fixture = parseFixture(raw);
    if (!fixture) {
      reasons.push("malformed_fixture");
      continue;
    }
    if (!PUBLIC_ID.test(fixture.id) || NON_PUBLIC_ID.test(fixture.id))
      reasons.push("non_public_fixture_id");
    if (ids.has(fixture.id)) reasons.push("duplicate_fixture_id");
    ids.add(fixture.id);
    fixtures.push(fixture);
  }
  const counts = emptyCounts();
  for (const fixture of fixtures) counts[fixture.expected_class] += 1;
  for (const classification of CLASSES)
    if (counts[classification] < 4) reasons.push(`insufficient_${classification}_fixtures`);
  return reasons.length
    ? { ok: false, reasons: unique(reasons) }
    : {
        ok: true,
        corpus: {
          schema: KNOWLEDGE_FORM_CORPUS_SCHEMA,
          corpus_version: "knowledge-form-support/v1",
          policy_version: value.policy_version,
          fixtures,
        },
      };
}
function parseFixture(value: unknown): Fixture | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "id",
      "expected_class",
      "statement",
      "statement_kind",
      "zone",
      "visible_zones",
      "source_id",
      "evidence",
      "support_refs",
      "required_reason_codes",
      "forbidden_fragments",
      "safety",
      "provenance",
    ])
  )
    return undefined;
  if (
    typeof value.id !== "string" ||
    !isClass(value.expected_class) ||
    typeof value.statement !== "string" ||
    !isKind(value.statement_kind) ||
    typeof value.zone !== "string" ||
    typeof value.source_id !== "string" ||
    !strings(value.visible_zones) ||
    !strings(value.required_reason_codes) ||
    !strings(value.forbidden_fragments) ||
    !Array.isArray(value.evidence) ||
    !value.evidence.every(isEvidence) ||
    !Array.isArray(value.support_refs) ||
    !value.support_refs.every(isSupport) ||
    !isRecord(value.safety) ||
    value.safety.statement_must_be_safe !== true ||
    !isRecord(value.provenance) ||
    value.provenance.deterministic !== true
  )
    return undefined;
  return value as unknown as Fixture;
}
function isEvidence(value: unknown): value is Evidence {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["id", "zone", "visible"]) &&
    typeof value.id === "string" &&
    typeof value.zone === "string" &&
    typeof value.visible === "boolean"
  );
}
function isSupport(value: unknown): value is SupportRef {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["evidence_id", "relation"]) &&
    typeof value.evidence_id === "string" &&
    (value.relation === "supports" || value.relation === "derived_from")
  );
}
function isKind(value: unknown): value is Fixture["statement_kind"] {
  return (
    value === "observation" ||
    value === "provisional" ||
    value === "intent" ||
    value === "assertion"
  );
}
function isClass(value: unknown): value is KnowledgeFormClass {
  return typeof value === "string" && (CLASSES as readonly string[]).includes(value);
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}
function digestCorpus(corpus: Corpus): string {
  return sha256(
    stableJson({
      schema: corpus.schema,
      corpus_version: corpus.corpus_version,
      policy_version: corpus.policy_version,
      fixtures: [...corpus.fixtures]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((fixture) => ({
          id: fixture.id,
          expected_class: fixture.expected_class,
          statement_kind: fixture.statement_kind,
          zone: fixture.zone,
          visible_zones: [...fixture.visible_zones].sort(),
          source_id: fixture.source_id,
          statement_digest: sha256(fixture.statement),
          evidence_digest: sha256(
            stableJson(
              [...fixture.evidence].sort((a, b) => stableJson(a).localeCompare(stableJson(b))),
            ),
          ),
          support_digest: sha256(
            stableJson(
              [...fixture.support_refs].sort((a, b) => stableJson(a).localeCompare(stableJson(b))),
            ),
          ),
          forbidden_fragment_digest: sha256(stableJson([...fixture.forbidden_fragments].sort())),
          required_reason_codes: [...fixture.required_reason_codes].sort(),
          safety: fixture.safety,
          provenance: fixture.provenance,
        })),
    }),
  );
}
function invalid(reasons: string[]): KnowledgeFormEvaluation {
  return {
    report: {
      schema: KNOWLEDGE_FORM_REPORT_SCHEMA,
      report_version: "v1",
      corpus_version: null,
      policy_version: null,
      corpus_digest: null,
      valid: false,
      gate_passed: false,
      invalid_reasons: unique(reasons),
      class_counts: emptyCounts(),
      confusion: emptyConfusion(),
      accuracy: null,
      claim_precision: null,
      claim_recall: null,
      observation_preservation: null,
      reject_insufficient_denominator: null,
      false_candidate_count: 0,
      false_candidate_rate: null,
      reason_assertion_failures: 0,
      safety_assertion_failures: 0,
      support_assertion_failures: 0,
      provenance_assertion_failures: 0,
      invariants: authorityInvariants(),
    },
    exit_code: 2,
  };
}
function emptyCounts(): Counts {
  return {
    must_observation: 0,
    must_claim_candidate: 0,
    must_reject: 0,
    must_insufficient_support: 0,
  };
}
function emptyConfusion(): Confusion {
  return {
    must_observation: emptyCounts(),
    must_claim_candidate: emptyCounts(),
    must_reject: emptyCounts(),
    must_insufficient_support: emptyCounts(),
  };
}
function authorityInvariants(): KnowledgeFormQualityReport["invariants"] {
  return {
    allow_auto_claim: false,
    evaluation_only: true,
    automatic_claim_writes: 0,
    automatic_acceptance_decision_writes: 0,
  };
}
function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}
function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
function stableJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number")
    return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"));
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  throw new Error("unsupported corpus value");
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length > 1) {
    process.stderr.write("usage: knowledge-form-evaluation [corpus-path]\n");
    process.exitCode = 2;
    return;
  }
  try {
    const path =
      args[0] ??
      resolve(
        fileURLToPath(new URL(".", import.meta.url)),
        "../test/fixtures/knowledge-form-support-v1.json",
      );
    const result = evaluateKnowledgeFormQuality(JSON.parse(await readFile(path, "utf8")));
    process.stdout.write(`${JSON.stringify(result.report)}\n`);
    process.exitCode = result.exit_code;
  } catch {
    const result = invalid(["malformed_corpus"]);
    process.stdout.write(`${JSON.stringify(result.report)}\n`);
    process.exitCode = 2;
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) void main();
