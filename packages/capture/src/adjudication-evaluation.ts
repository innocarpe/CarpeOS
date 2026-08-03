import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADJUDICATION_POLICY_VERSION,
  adjudicateKnowledgeCandidate,
  type KnowledgeCandidate,
  type KnowledgeDisposition,
} from "./adjudication.js";
import { containsSecretLikeMaterial } from "./meaningful-unit-policy.js";

export const ADJUDICATION_QUALITY_CORPUS_SCHEMA = "carpeos.adjudication-quality/v1" as const;
export const ADJUDICATION_QUALITY_REPORT_SCHEMA = "carpeos.adjudication-quality-report/v1" as const;

const DISPOSITIONS = ["promote", "hold", "reject"] as const;
const PUBLIC_FIXTURE_ID = /^adjq-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NON_PUBLIC_ID_TERM = /(?:credential|password|secret|token|private|production)/;

type QualitySafetyExpectation = {
  statement_must_be_safe: true;
  forbidden_statement_fragments: readonly string[];
};

type QualityFixture = {
  id: string;
  classification: KnowledgeDisposition;
  expected_disposition: KnowledgeDisposition;
  required_reason_codes: readonly string[];
  safety: QualitySafetyExpectation;
  candidate: KnowledgeCandidate;
};

type QualityCorpus = {
  schema: typeof ADJUDICATION_QUALITY_CORPUS_SCHEMA;
  corpus_version: "adjudication-quality/v1";
  policy_version: string;
  fixtures: readonly QualityFixture[];
};

export type AdjudicationQualityReport = {
  schema: typeof ADJUDICATION_QUALITY_REPORT_SCHEMA;
  report_version: "v1";
  corpus_version: string | null;
  policy_version: string | null;
  corpus_digest: string | null;
  valid: boolean;
  gate_passed: boolean;
  invalid_reasons: readonly string[];
  class_counts: Record<KnowledgeDisposition, number>;
  confusion: Record<KnowledgeDisposition, Record<KnowledgeDisposition, number>>;
  accuracy: number | null;
  false_promotion_count: number;
  false_promotion_rate: number | null;
  reason_assertion_failures: number;
  safety_assertion_failures: number;
  authority_writes: {
    observation_writes: 0;
    claim_writes: 0;
    acceptance_decision_writes: 0;
    total_writes: 0;
  };
};

export type AdjudicationQualityEvaluation = {
  report: AdjudicationQualityReport;
  exit_code: 0 | 1 | 2;
};

export function evaluateAdjudicationQuality(input: unknown): AdjudicationQualityEvaluation {
  const validated = validateCorpus(input);
  if (validated.ok === false) return invalidEvaluation(validated.reasons);

  const corpus = validated.corpus;
  const classCounts = emptyCounts();
  const confusion = emptyConfusion();
  let correct = 0;
  let falsePromotions = 0;
  let reasonFailures = 0;
  let safetyFailures = 0;

  for (const fixture of corpus.fixtures) {
    const result = adjudicateKnowledgeCandidate(fixture.candidate);
    classCounts[fixture.expected_disposition] += 1;
    confusion[fixture.expected_disposition][result.disposition] += 1;
    if (result.disposition === fixture.expected_disposition) correct += 1;
    if (result.disposition === "promote" && fixture.expected_disposition !== "promote") {
      falsePromotions += 1;
    }
    for (const reason of fixture.required_reason_codes) {
      if (!result.reason_codes.includes(reason)) reasonFailures += 1;
    }
    if (
      containsSecretLikeMaterial(result.statement) ||
      fixture.safety.forbidden_statement_fragments.some((fragment) =>
        result.statement.includes(fragment),
      )
    ) {
      safetyFailures += 1;
    }
  }

  const total = corpus.fixtures.length;
  const nonPromotionTotal = total - classCounts.promote;
  if (total === 0 || nonPromotionTotal === 0) {
    return invalidEvaluation(["required_denominator_missing"]);
  }

  const accuracy = correct / total;
  const falsePromotionRate = falsePromotions / nonPromotionTotal;
  const authorityWriteInvariants = authorityWrites();
  const gatePassed =
    accuracy === 1 &&
    falsePromotions === 0 &&
    reasonFailures === 0 &&
    safetyFailures === 0 &&
    authorityWriteInvariants.total_writes === 0;
  const report: AdjudicationQualityReport = {
    schema: ADJUDICATION_QUALITY_REPORT_SCHEMA,
    report_version: "v1",
    corpus_version: corpus.corpus_version,
    policy_version: corpus.policy_version,
    corpus_digest: digestCorpus(corpus),
    valid: true,
    gate_passed: gatePassed,
    invalid_reasons: [],
    class_counts: classCounts,
    confusion,
    accuracy,
    false_promotion_count: falsePromotions,
    false_promotion_rate: falsePromotionRate,
    reason_assertion_failures: reasonFailures,
    safety_assertion_failures: safetyFailures,
    authority_writes: authorityWriteInvariants,
  };
  return { report, exit_code: gatePassed ? 0 : 1 };
}

export function adjudicationQualityExitCode(input: unknown): 0 | 1 | 2 {
  return evaluateAdjudicationQuality(input).exit_code;
}

export function digestAdjudicationQualityCorpus(input: unknown): string {
  const validated = validateCorpus(input);
  if (validated.ok === false) throw new Error("invalid adjudication quality corpus");
  return digestCorpus(validated.corpus);
}

function validateCorpus(
  input: unknown,
): { ok: true; corpus: QualityCorpus } | { ok: false; reasons: string[] } {
  if (!isRecord(input)) return { ok: false, reasons: ["malformed_corpus"] };
  const reasons: string[] = [];
  if (!hasExactKeys(input, ["schema", "corpus_version", "policy_version", "fixtures"])) {
    reasons.push("malformed_corpus");
  }
  if (input.schema !== ADJUDICATION_QUALITY_CORPUS_SCHEMA)
    reasons.push("unsupported_corpus_schema");
  if (input.corpus_version !== "adjudication-quality/v1")
    reasons.push("unsupported_corpus_version");
  if (
    typeof input.policy_version !== "string" ||
    input.policy_version !== ADJUDICATION_POLICY_VERSION
  ) {
    reasons.push("policy_version_mismatch");
  }
  const rawFixtures = input.fixtures;
  if (!Array.isArray(rawFixtures)) {
    reasons.push("malformed_fixtures");
    return { ok: false, reasons: uniqueSorted(reasons) };
  }
  if (reasons.length > 0) return { ok: false, reasons: uniqueSorted(reasons) };

  const fixtures: QualityFixture[] = [];
  const ids = new Set<string>();
  for (const rawFixture of rawFixtures) {
    const fixture = parseFixture(rawFixture);
    if (fixture === undefined) {
      reasons.push("malformed_fixture");
      continue;
    }
    if (!PUBLIC_FIXTURE_ID.test(fixture.id) || NON_PUBLIC_ID_TERM.test(fixture.id)) {
      reasons.push("non_public_fixture_id");
    }
    if (ids.has(fixture.id)) reasons.push("duplicate_fixture_id");
    ids.add(fixture.id);
    fixtures.push(fixture);
  }
  const counts = emptyCounts();
  for (const fixture of fixtures) counts[fixture.classification] += 1;
  for (const disposition of DISPOSITIONS) {
    if (counts[disposition] < 4) reasons.push(`insufficient_${disposition}_fixtures`);
  }
  if (reasons.length > 0) return { ok: false, reasons: uniqueSorted(reasons) };
  return {
    ok: true,
    corpus: {
      schema: ADJUDICATION_QUALITY_CORPUS_SCHEMA,
      corpus_version: "adjudication-quality/v1",
      policy_version: input.policy_version as string,
      fixtures,
    },
  };
}

function parseFixture(value: unknown): QualityFixture | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "id",
      "classification",
      "expected_disposition",
      "required_reason_codes",
      "safety",
      "candidate",
    ]) ||
    !isDisposition(value.classification) ||
    !isDisposition(value.expected_disposition)
  ) {
    return undefined;
  }
  if (value.classification !== value.expected_disposition || typeof value.id !== "string")
    return undefined;
  if (
    !Array.isArray(value.required_reason_codes) ||
    !value.required_reason_codes.every(isNonEmptyString)
  ) {
    return undefined;
  }
  if (
    !isRecord(value.safety) ||
    !hasExactKeys(value.safety, ["statement_must_be_safe", "forbidden_statement_fragments"]) ||
    value.safety.statement_must_be_safe !== true
  ) {
    return undefined;
  }
  if (
    !Array.isArray(value.safety.forbidden_statement_fragments) ||
    !value.safety.forbidden_statement_fragments.every(isNonEmptyString) ||
    !isCandidate(value.candidate)
  ) {
    return undefined;
  }
  return value as unknown as QualityFixture;
}

function isCandidate(value: unknown): value is KnowledgeCandidate {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "provider",
      "hook_event_name",
      "kind",
      "media_type",
      "subject_ref",
      "artifact_id",
      "source_event_id",
      "signal_text",
      "spans",
      "evidence_refs",
    ]) ||
    typeof value.provider !== "string" ||
    typeof value.hook_event_name !== "string"
  ) {
    return false;
  }
  for (const field of [
    "kind",
    "media_type",
    "subject_ref",
    "artifact_id",
    "source_event_id",
    "signal_text",
  ] as const) {
    if (value[field] !== undefined && typeof value[field] !== "string") return false;
  }
  if (
    value.spans !== undefined &&
    (!Array.isArray(value.spans) || !value.spans.every(isCandidateSpan))
  ) {
    return false;
  }
  return (
    value.evidence_refs === undefined ||
    (Array.isArray(value.evidence_refs) && value.evidence_refs.every(isEvidenceRef))
  );
}

function isCandidateSpan(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ["start", "end", "kind", "text", "evidence_refs"])) {
    return false;
  }
  const { start, end, kind, text, evidence_refs: evidenceRefs } = value;
  return (
    typeof start === "number" &&
    Number.isSafeInteger(start) &&
    typeof end === "number" &&
    Number.isSafeInteger(end) &&
    start >= 0 &&
    end >= start &&
    (kind === "decision" ||
      kind === "preference" ||
      kind === "constraint" ||
      kind === "procedure") &&
    typeof text === "string" &&
    Array.isArray(evidenceRefs) &&
    evidenceRefs.every(isEvidenceRef)
  );
}

function isEvidenceRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["ref_type", "ref_id"]) &&
    (value.ref_type === "source_event" || value.ref_type === "artifact") &&
    isNonEmptyString(value.ref_id)
  );
}

function digestCorpus(corpus: QualityCorpus): string {
  const fixtures = [...corpus.fixtures]
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .map((fixture) => ({
      metadata: {
        id: fixture.id,
        classification: fixture.classification,
        expected_disposition: fixture.expected_disposition,
        required_reason_codes: [...fixture.required_reason_codes].sort(),
        safety: {
          statement_must_be_safe: fixture.safety.statement_must_be_safe,
          forbidden_statement_fragments: [...fixture.safety.forbidden_statement_fragments].sort(),
        },
      },
      content_digest: sha256(stableJson(fixture.candidate)),
    }));
  return sha256(
    stableJson({
      schema: corpus.schema,
      corpus_version: corpus.corpus_version,
      policy_version: corpus.policy_version,
      fixtures,
    }),
  );
}

function invalidEvaluation(reasons: string[]): AdjudicationQualityEvaluation {
  return {
    report: {
      schema: ADJUDICATION_QUALITY_REPORT_SCHEMA,
      report_version: "v1",
      corpus_version: null,
      policy_version: null,
      corpus_digest: null,
      valid: false,
      gate_passed: false,
      invalid_reasons: uniqueSorted(reasons),
      class_counts: emptyCounts(),
      confusion: emptyConfusion(),
      accuracy: null,
      false_promotion_count: 0,
      false_promotion_rate: null,
      reason_assertion_failures: 0,
      safety_assertion_failures: 0,
      authority_writes: authorityWrites(),
    },
    exit_code: 2,
  };
}

function emptyCounts(): Record<KnowledgeDisposition, number> {
  return { promote: 0, hold: 0, reject: 0 };
}

function emptyConfusion(): Record<KnowledgeDisposition, Record<KnowledgeDisposition, number>> {
  return {
    promote: emptyCounts(),
    hold: emptyCounts(),
    reject: emptyCounts(),
  };
}

function authorityWrites(): AdjudicationQualityReport["authority_writes"] {
  return { observation_writes: 0, claim_writes: 0, acceptance_decision_writes: 0, total_writes: 0 };
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"));
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite corpus value");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key.normalize("NFC"))}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error("unsupported corpus value");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function hasExactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isDisposition(value: unknown): value is KnowledgeDisposition {
  return typeof value === "string" && DISPOSITIONS.includes(value as KnowledgeDisposition);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

async function main(): Promise<void> {
  const [inputPath, ...extra] = process.argv.slice(2);
  if (extra.length > 0) {
    process.stderr.write("Usage: eval:adjudication [corpus-path]\n");
    process.exitCode = 2;
    return;
  }
  let input: unknown;
  try {
    input = JSON.parse(
      await readFile(inputPath ?? "test/fixtures/adjudication-quality-v1.json", "utf8"),
    );
  } catch {
    input = undefined;
  }
  const evaluation = evaluateAdjudicationQuality(input);
  process.stdout.write(`${JSON.stringify(evaluation.report)}\n`);
  process.exitCode = evaluation.exit_code;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
