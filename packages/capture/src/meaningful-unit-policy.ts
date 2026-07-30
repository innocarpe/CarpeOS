/**
 * Meaningful-unit extraction policy (product 1.0 MVP defaults).
 *
 * Capture may store encrypted EvidenceArtifact for many lifecycle hooks.
 * This module decides which hooks may feed **extraction** into Observation
 * and/or draft Claim, and which text is safe for chunk / statement bodies.
 *
 * Future extractors MUST import these helpers rather than inventing defaults.
 * See docs/adr/0011-meaningful-unit-extraction-policy.md.
 */

export const MEANINGFUL_UNIT_POLICY_VERSION = "v1" as const;

/** Known host lifecycle hook names from adapters/* templates. */
export const KNOWN_CAPTURE_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PostToolUse",
  "PreCompact",
  "Stop",
  "SessionEnd",
] as const;

export type CaptureHookEventName = (typeof KNOWN_CAPTURE_HOOK_EVENTS)[number];

/**
 * Default hooks that may feed extraction under the product MVP.
 * Lifecycle-heavy; intentionally excludes PostToolUse and SessionStart.
 */
export const DEFAULT_EXTRACTION_HOOK_EVENTS = [
  "Stop",
  "SessionEnd",
  "PreCompact",
  "UserPromptSubmit",
] as const satisfies readonly CaptureHookEventName[];

/**
 * Hooks excluded from extraction by default (evidence capture may still run).
 */
export const DEFAULT_EXTRACTION_EXCLUDED_HOOK_EVENTS = [
  "PostToolUse",
  "SessionStart",
] as const satisfies readonly CaptureHookEventName[];

/** Codex notify path is not a general lifecycle hook but may yield a unit. */
export const OPTIONAL_EXTRACTION_NOTIFY_EVENTS = ["agent-turn-complete"] as const;

export type ExtractionTargetKind = "none" | "observation" | "claim_draft";

export type PostToolUseExtractionMode = "off" | "on";

export type MeaningfulUnitPolicyConfig = {
  policy_version: typeof MEANINGFUL_UNIT_POLICY_VERSION;
  /** Hook event names eligible for extraction (case-sensitive host names). */
  enabled_hook_events: readonly string[];
  /**
   * PostToolUse extraction. Default `"off"` — tool I/O is noisy; evidence may
   * still be stored encrypted when capture templates fire PostToolUse.
   */
  post_tool_use: PostToolUseExtractionMode;
  /**
   * When false (default), eligible hooks recommend Observation only.
   * When true, high-confidence structured assertions may become claim_draft.
   */
  allow_auto_claim: boolean;
  /**
   * Minimum confidence [0,1] required for claim_draft when allow_auto_claim.
   * Default 0.85. Below threshold always Observation.
   */
  auto_claim_min_confidence: number;
};

export const DEFAULT_MEANINGFUL_UNIT_POLICY: MeaningfulUnitPolicyConfig = {
  policy_version: MEANINGFUL_UNIT_POLICY_VERSION,
  enabled_hook_events: DEFAULT_EXTRACTION_HOOK_EVENTS,
  post_tool_use: "off",
  allow_auto_claim: false,
  auto_claim_min_confidence: 0.85,
};

/**
 * Stable config object for digests / derivation records.
 * Callers should not mutate the returned object.
 */
export function resolveMeaningfulUnitPolicy(
  overrides?: Partial<MeaningfulUnitPolicyConfig>,
): MeaningfulUnitPolicyConfig {
  const base = DEFAULT_MEANINGFUL_UNIT_POLICY;
  return {
    policy_version: MEANINGFUL_UNIT_POLICY_VERSION,
    enabled_hook_events: overrides?.enabled_hook_events ?? base.enabled_hook_events,
    post_tool_use: overrides?.post_tool_use ?? base.post_tool_use,
    allow_auto_claim: overrides?.allow_auto_claim ?? base.allow_auto_claim,
    auto_claim_min_confidence:
      overrides?.auto_claim_min_confidence ?? base.auto_claim_min_confidence,
  };
}

/**
 * Whether a captured lifecycle (or notify) event may feed extraction.
 */
export function isHookEligibleForExtraction(
  hookEventName: string,
  overrides?: Partial<MeaningfulUnitPolicyConfig>,
): boolean {
  const name = String(hookEventName ?? "").trim();
  if (!name) {
    return false;
  }
  const config = resolveMeaningfulUnitPolicy(overrides);

  if (name === "PostToolUse") {
    return config.post_tool_use === "on";
  }

  if (config.enabled_hook_events.includes(name)) {
    return true;
  }

  // Optional notify events are on when explicitly listed in enabled_hook_events
  // or when using defaults extended by caller — not auto-on for bare defaults.
  return false;
}

/**
 * MVP target kind for an eligible hook.
 * Never returns an acceptance decision path — extractors must not invent facts.
 */
export function recommendExtractionTarget(
  input: {
    hook_event_name: string;
    /** Optional model confidence for claim_draft gate [0,1]. */
    confidence?: number;
  },
  overrides?: Partial<MeaningfulUnitPolicyConfig>,
): ExtractionTargetKind {
  const config = resolveMeaningfulUnitPolicy(overrides);
  if (!isHookEligibleForExtraction(input.hook_event_name, config)) {
    return "none";
  }

  if (!config.allow_auto_claim) {
    return "observation";
  }

  const confidence = input.confidence;
  if (
    typeof confidence === "number" &&
    Number.isFinite(confidence) &&
    confidence >= config.auto_claim_min_confidence
  ) {
    return "claim_draft";
  }

  return "observation";
}

/**
 * Patterns that must not appear as plaintext in Observation/Claim statement
 * text or retrieval chunk bodies derived from extraction.
 * Complements retrieval `containsProtectedRawPayload` (protected-field names).
 */
const SECRET_LIKE_PATTERNS: readonly RegExp[] = [
  // Protected-value / crypto field names (align with retrieval chunks guard)
  /\b(?:ciphertext|plaintext|raw_payload|transcript_secret|local-aes256\.key)\b/i,
  // Common credential shapes (synthetic fixtures only in tests)
  /\bsk-[a-zA-Z0-9]{8,}\b/,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/,
  /\b(?:api[_-]?key|access[_-]?token|secret[_-]?key|client[_-]?secret|password|passwd|passphrase)\s*[:=]\s*\S+/i,
  /\b-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
];

/**
 * True when text looks like it embeds secrets or protected raw fields.
 * Extractors MUST refuse to write such text into statement/chunk bodies.
 */
export function containsSecretLikeMaterial(text: string): boolean {
  if (typeof text !== "string" || text.length === 0) {
    return false;
  }
  return SECRET_LIKE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Validate candidate meaningful-unit text for storage/projection.
 * @throws Error when text is empty or contains secret-like material
 */
export function assertSafeMeaningfulUnitText(text: string): string {
  if (typeof text !== "string") {
    throw new Error("meaningful unit text must be a string");
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error("meaningful unit text must be non-empty");
  }
  if (containsSecretLikeMaterial(trimmed)) {
    throw new Error("meaningful unit text must not contain secret-like or protected raw material");
  }
  return trimmed;
}

/**
 * Observation vs Claim MVP rules (documentation + machine-readable summary).
 * Extractors and docs should treat this as the product default.
 */
export const OBSERVATION_VS_CLAIM_MVP = {
  observation: {
    meaning: "Bounded statement derived from evidence; not an accepted fact",
    required_links: "evidence_artifact_refs (≥1)",
    epistemic_authority_hint: "observed",
    lifecycle: "active or draft; never implies AcceptanceDecision",
    when_to_prefer: "Default for all auto-extraction under product 1.0; uncertain summaries",
  },
  claim_draft: {
    meaning: "Assertive statement with support provenance; still not accepted",
    required_links: "support ProvenanceRef (≥1)",
    claim_type: "factual | inference | decision",
    epistemic_authority_hint: "self_reported or derived (never verified by extractor)",
    lifecycle: "draft until human/MCP AcceptanceDecision",
    when_to_prefer: "Only when allow_auto_claim and confidence ≥ auto_claim_min_confidence",
  },
  never_from_extractor: [
    "AcceptanceDecision",
    "Supersession that accepts a claim as verified",
    "Marking Claim as accepted by mutating the Claim row",
  ],
} as const;

/** JSON-stable snapshot of defaults for tests and future derivation digests. */
export function defaultMeaningfulUnitPolicySnapshot(): string {
  return JSON.stringify(DEFAULT_MEANINGFUL_UNIT_POLICY);
}
