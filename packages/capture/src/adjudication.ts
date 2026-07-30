/**
 * Knowledge adjudication MVP — rule-based promote | hold | reject.
 * Pure functions; store/CLI wire disposition writes separately.
 * @see docs/adr/0012-knowledge-adjudication.md
 */
import {
  assertSafeMeaningfulUnitText,
  containsSecretLikeMaterial,
  isHookEligibleForExtraction,
  type MeaningfulUnitPolicyConfig,
} from "./meaningful-unit-policy.js";
import { buildMetadataObservationStatement } from "./extract-observation.js";

export const ADJUDICATION_POLICY_VERSION = "adj_v1" as const;

export type KnowledgeDisposition = "promote" | "hold" | "reject";

export type KnowledgeCandidateKind = "decision" | "preference" | "constraint" | "procedure";

export type KnowledgeEvidenceRef = {
  ref_type: "source_event" | "artifact";
  ref_id: string;
};

export type KnowledgeCandidateSpan = {
  /** Offsets refer to the normalized, bounded signal text. */
  start: number;
  end: number;
  kind: KnowledgeCandidateKind;
  text: string;
  evidence_refs: readonly KnowledgeEvidenceRef[];
};

export type KnowledgeCandidate = {
  provider: string;
  hook_event_name: string;
  kind?: string;
  media_type?: string;
  subject_ref?: string;
  artifact_id?: string;
  source_event_id?: string;
  /** Optional short text for rules (never required; secrets must fail closed). */
  signal_text?: string;
  /** Bounded, sanitized candidate spans; never raw transcript or tool payload dumps. */
  spans?: readonly KnowledgeCandidateSpan[];
  evidence_refs?: readonly KnowledgeEvidenceRef[];
};

export type AdjudicationScores = {
  value: number;
  durability: number;
  risk: number;
  noise: number;
};

export type AdjudicationResult = {
  disposition: KnowledgeDisposition;
  reason_codes: string[];
  scores: AdjudicationScores;
  policy_version: typeof ADJUDICATION_POLICY_VERSION;
  /** Statement used if promote/hold creates an Observation. */
  statement: string;
  lifecycle_status: "active" | "draft";
};

const PROMOTE_HOOKS = new Set(["Stop", "SessionEnd", "PreCompact"]);
const HOLD_HOOKS = new Set(["UserPromptSubmit"]);

const VALUE_TERMS =
  /\b(decid(e|ed|ing|es|ion)|must|should|always|never|prefer|preference|constraint|because|instead|migrate|breaking|ship|release|approve|reject|policy|default|require|forbidden|todo|fix|bug)\b/i;

const NOISE_ONLY =
  /^(ok(ay)?|thanks|thank you|lgtm|nit|wip|test|hello|hi|ping|pong|yes|no|yep|nah|cool|nice|lol|…|\.+|👍|✅)$/i;

const CANDIDATE_SOURCE_MAX = 1_200;
const CANDIDATE_SPAN_MAX = 240;
const CANDIDATE_SPAN_LIMIT = 3;
const STRUCTURED_DUMP =
  /[{}[\]]|\b(?:reasoning_content|tool_calls?|raw_payload|transcript)\s*[:=]/i;
const CANDIDATE_KIND_PATTERNS: readonly [KnowledgeCandidateKind, RegExp][] = [
  ["decision", /\b(decid(?:e|ed|ing|es)|decision|adopt(?:ed)?|chose|choose|selected?|default)\b/i],
  ["preference", /\b(prefer(?:red|s|ring)?|preference|would rather|favor(?:ed|s)?)\b/i],
  ["constraint", /\b(must(?: not)?|should not|never|always|required?|forbidden|constraint)\b/i],
  ["procedure", /\b(procedure|steps?|first|then|next|finally|run|verify|check|before|after)\b/i],
];

/**
 * Build an Observation statement from safe candidate text plus capture metadata.
 * Only bounded, label-bearing spans are eligible; raw transcripts and structured
 * payload dumps remain protected evidence.
 */
export function buildCandidateStatement(candidate: KnowledgeCandidate): string {
  const metadata = buildMetadataObservationStatement({
    provider: candidate.provider,
    hook_event_name: candidate.hook_event_name,
    ...(candidate.kind === undefined ? {} : { kind: candidate.kind }),
    ...(candidate.media_type === undefined ? {} : { media_type: candidate.media_type }),
    ...(candidate.subject_ref === undefined ? {} : { subject_ref: candidate.subject_ref }),
    ...(candidate.artifact_id === undefined ? {} : { artifact_id: candidate.artifact_id }),
    ...(candidate.source_event_id === undefined
      ? {}
      : { source_event_id: candidate.source_event_id }),
  });
  const spans = candidate.spans ?? [];
  const primary = spans[0];
  if (primary === undefined) {
    return metadata;
  }
  const fragment = String(primary.text ?? "")
    .trim()
    .slice(0, CANDIDATE_SPAN_MAX);
  const kind = classifyCandidateKind(fragment);
  if (fragment.length === 0 || STRUCTURED_DUMP.test(fragment) || kind !== primary.kind) {
    throw new Error("candidate span must be bounded, safe, and kind-labelled");
  }
  return assertSafeMeaningfulUnitText(`${metadata} Knowledge fragment (${kind}): ${fragment}`);
}

/**
 * Extract up to three durable, sentence-sized candidate spans from a bounded signal.
 * Precision is intentional: unlabelled chatter, secrets, and structured dumps yield no spans.
 */
export function extractKnowledgeCandidateSpans(
  signalText: string | undefined,
  refs: readonly KnowledgeEvidenceRef[] = [],
): KnowledgeCandidateSpan[] {
  const normalized = String(signalText ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CANDIDATE_SOURCE_MAX);
  if (
    normalized.length === 0 ||
    NOISE_ONLY.test(normalized) ||
    containsSecretLikeMaterial(normalized) ||
    STRUCTURED_DUMP.test(normalized)
  ) {
    return [];
  }

  const evidence = normalizeEvidenceRefs(refs);
  const spans: KnowledgeCandidateSpan[] = [];
  const sentences = normalized.matchAll(/.+?(?:[.!?]+(?=\s|$)|$)/g);
  for (const match of sentences) {
    if (spans.length >= CANDIDATE_SPAN_LIMIT) break;
    const raw = match[0];
    const text = raw.trim();
    const kind = classifyCandidateKind(text);
    if (kind === undefined || text.length < 12 || STRUCTURED_DUMP.test(text)) continue;
    const start = (match.index ?? 0) + raw.indexOf(text);
    const bounded = text.slice(0, CANDIDATE_SPAN_MAX).trim();
    if (bounded.length === 0 || containsSecretLikeMaterial(bounded)) continue;
    spans.push({
      start,
      end: start + bounded.length,
      kind,
      text: assertSafeMeaningfulUnitText(bounded),
      evidence_refs: evidence,
    });
  }
  return spans;
}

/**
 * Rule adjudicator (precision-first).
 */
export function adjudicateKnowledgeCandidate(
  candidate: KnowledgeCandidate,
  policyOverrides?: Partial<MeaningfulUnitPolicyConfig>,
): AdjudicationResult {
  const reasons: string[] = [];
  const hook = String(candidate.hook_event_name ?? "").trim();
  let statement: string;
  try {
    statement = buildCandidateStatement(candidate);
  } catch {
    return {
      disposition: "reject",
      reason_codes: ["unsafe_or_empty_statement"],
      scores: { value: 0, durability: 0, risk: 1, noise: 1 },
      policy_version: ADJUDICATION_POLICY_VERSION,
      statement: "",
      lifecycle_status: "draft",
    };
  }

  const signal = (candidate.signal_text ?? "").trim();
  let value = 0.25;
  let durability = 0.3;
  let risk = 0.1;
  let noise = 0.4;

  if (containsSecretLikeMaterial(statement) || containsSecretLikeMaterial(signal)) {
    return finish(
      "reject",
      ["secret_like_material"],
      {
        value: 0,
        durability: 0,
        risk: 1,
        noise: 0.5,
      },
      statement,
    );
  }

  // Explicit tool-noise before generic lifecycle gate (clearer reason codes).
  if (hook === "PostToolUse") {
    return finish(
      "reject",
      ["post_tool_use_noise"],
      {
        value: 0.1,
        durability: 0.1,
        risk: 0.2,
        noise: 0.95,
      },
      statement,
    );
  }

  if (!isHookEligibleForExtraction(hook, policyOverrides)) {
    reasons.push("lifecycle_not_eligible");
    noise += 0.4;
    return finish(
      "reject",
      reasons,
      { value, durability, risk, noise: Math.min(1, noise) },
      statement,
    );
  }

  if (signal.length > 0 && NOISE_ONLY.test(signal)) {
    return finish(
      "reject",
      ["noise_only_signal"],
      {
        value: 0.05,
        durability: 0.05,
        risk: 0.1,
        noise: 0.95,
      },
      statement,
    );
  }

  if (PROMOTE_HOOKS.has(hook)) {
    value += 0.35;
    durability += 0.35;
    reasons.push("lifecycle_boundary_signal");
  }

  if (HOLD_HOOKS.has(hook)) {
    value += 0.15;
    durability += 0.1;
    noise += 0.15;
    reasons.push("user_prompt_needs_review");
  }

  if (VALUE_TERMS.test(statement) || VALUE_TERMS.test(signal)) {
    value += 0.3;
    durability += 0.2;
    reasons.push("value_terms");
  }

  if (signal.length >= 40) {
    value += 0.1;
    durability += 0.1;
    reasons.push("signal_length");
  } else if (signal.length > 0 && signal.length < 12) {
    noise += 0.25;
    reasons.push("short_signal");
  }

  // Metadata-only candidates (no signal) are weak knowledge — hold, not promote.
  if (signal.length === 0) {
    noise += 0.2;
    value = Math.min(value, 0.45);
    reasons.push("metadata_only_weak");
  }

  value = clamp01(value);
  durability = clamp01(durability);
  risk = clamp01(risk);
  noise = clamp01(noise);

  const promoteScore = value * 0.5 + durability * 0.4 - noise * 0.35 - risk * 0.5;

  if (
    promoteScore >= 0.45 &&
    value >= 0.5 &&
    noise < 0.55 &&
    PROMOTE_HOOKS.has(hook) &&
    signal.length >= 20
  ) {
    reasons.push("promote_threshold");
    return finish("promote", reasons, { value, durability, risk, noise }, statement);
  }

  if (promoteScore >= 0.2 || HOLD_HOOKS.has(hook) || PROMOTE_HOOKS.has(hook)) {
    reasons.push("hold_for_review");
    return finish("hold", reasons, { value, durability, risk, noise }, statement);
  }

  reasons.push("below_hold_threshold");
  return finish("reject", reasons, { value, durability, risk, noise }, statement);
}

function finish(
  disposition: KnowledgeDisposition,
  reason_codes: string[],
  scores: AdjudicationScores,
  statement: string,
): AdjudicationResult {
  return {
    disposition,
    reason_codes: [...new Set(reason_codes)],
    scores,
    policy_version: ADJUDICATION_POLICY_VERSION,
    statement,
    lifecycle_status: disposition === "promote" ? "active" : "draft",
  };
}

function classifyCandidateKind(text: string): KnowledgeCandidateKind | undefined {
  for (const [kind, pattern] of CANDIDATE_KIND_PATTERNS) {
    if (pattern.test(text)) return kind;
  }
  return undefined;
}

function normalizeEvidenceRefs(refs: readonly KnowledgeEvidenceRef[]): KnowledgeEvidenceRef[] {
  const seen = new Set<string>();
  const normalized: KnowledgeEvidenceRef[] = [];
  for (const ref of refs) {
    const refId = String(ref.ref_id ?? "").trim();
    if (refId.length === 0) continue;
    const key = `${ref.ref_type}:${refId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ ref_type: ref.ref_type, ref_id: refId });
  }
  return normalized;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function adjudicationIdempotencyKey(sourceEventId: string): string {
  // Distinct from extractionObservationIdempotencyKey material
  return `adj:${ADJUDICATION_POLICY_VERSION}:${sourceEventId}`;
}
