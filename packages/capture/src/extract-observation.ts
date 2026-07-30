/**
 * Deterministic metadata-only Observation plan for Evidence → meaning MVP.
 * Does not read encrypted transcripts; safe for chunk text after policy guards.
 */
import { createHash } from "node:crypto";
import {
  assertSafeMeaningfulUnitText,
  isHookEligibleForExtraction,
  MEANINGFUL_UNIT_POLICY_VERSION,
  recommendExtractionTarget,
  resolveMeaningfulUnitPolicy,
  type MeaningfulUnitPolicyConfig,
} from "./meaningful-unit-policy.js";

export type ExtractionMetadataInput = {
  provider: string;
  hook_event_name: string;
  kind?: string;
  media_type?: string;
  subject_ref?: string;
  artifact_id?: string;
  source_event_id?: string;
};

export type ObservationExtractionPlan =
  | {
      status: "extract";
      target: "observation";
      statement: string;
      policy_version: typeof MEANINGFUL_UNIT_POLICY_VERSION;
      hook_event_name: string;
      provider: string;
    }
  | {
      status: "skip";
      reason: string;
      hook_event_name: string;
      target: "none";
    };

/**
 * Build a stable, non-secret Observation statement from capture metadata.
 */
export function buildMetadataObservationStatement(meta: ExtractionMetadataInput): string {
  const provider = sanitizeToken(meta.provider, "unknown");
  const hook = sanitizeToken(meta.hook_event_name, "unknown");
  const kind = sanitizeToken(meta.kind ?? "transcript", "transcript");
  const media = sanitizeToken(meta.media_type ?? "application/json", "application/json");
  const subject = truncate(sanitizeSubject(meta.subject_ref ?? "project"), 120);
  const raw = `Captured ${provider} ${hook} evidence (${kind}, ${media}) for ${subject}.`;
  return assertSafeMeaningfulUnitText(raw);
}

/**
 * Plan extraction for a capture using product meaningful-unit policy.
 */
export function planObservationExtraction(
  meta: ExtractionMetadataInput,
  policyOverrides?: Partial<MeaningfulUnitPolicyConfig>,
): ObservationExtractionPlan {
  const hook = String(meta.hook_event_name ?? "").trim() || "unknown";
  const config = resolveMeaningfulUnitPolicy(policyOverrides);
  if (!isHookEligibleForExtraction(hook, config)) {
    return {
      status: "skip",
      reason: `hook ${hook} not eligible for extraction under policy ${config.policy_version}`,
      hook_event_name: hook,
      target: "none",
    };
  }
  const target = recommendExtractionTarget({ hook_event_name: hook }, config);
  if (target === "none") {
    return {
      status: "skip",
      reason: `hook ${hook} recommended target none`,
      hook_event_name: hook,
      target: "none",
    };
  }
  // MVP: Observation only (claim_draft would need allow_auto_claim path later).
  if (target === "claim_draft") {
    // Still Observation-first until claim writer is wired for auto extract.
  }
  const statement = buildMetadataObservationStatement(meta);
  return {
    status: "extract",
    target: "observation",
    statement,
    policy_version: MEANINGFUL_UNIT_POLICY_VERSION,
    hook_event_name: hook,
    provider: String(meta.provider ?? "unknown"),
  };
}

/**
 * Deterministic idempotency key for Observation extracted from one evidence event.
 */
export function extractionObservationIdempotencyKey(sourceEventId: string): string {
  const digest = createHash("sha256")
    .update(`extract_observation|${MEANINGFUL_UNIT_POLICY_VERSION}|${sourceEventId}`, "utf8")
    .digest("hex")
    .slice(0, 32);
  return `idem_${digest}`;
}

function sanitizeToken(value: string, fallback: string): string {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\w./+-]+/g, "_")
    .slice(0, 64);
  return cleaned.length > 0 ? cleaned : fallback;
}

function sanitizeSubject(value: string): string {
  return String(value ?? "")
    .trim()
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\w.:/@_+-]+/g, "_")
    .slice(0, 200);
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}
