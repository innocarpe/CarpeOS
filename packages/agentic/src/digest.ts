/**
 * Stage identity digests for agentic jobs (ADR 0017 D9).
 * Digests must include pack, prompt, model id, policy, and schema versions.
 */

import { createHash } from "node:crypto";
import {
  type AGENTIC_FLASH_MODEL_ID,
  AGENTIC_POLICY_VERSION,
  AGENTIC_PROMPT_VERSIONS,
  type AgenticStageId,
} from "./types.js";

export const AGENTIC_STAGE_SCHEMA_VERSION = "carpeos.agentic.stage-digest/v1" as const;

export type StageDigestInput = {
  stage: AgenticStageId;
  source_event_id: string;
  trust_zone_id: string;
  pack_digest?: string | null;
  prompt_version?: string;
  model_id: typeof AGENTIC_FLASH_MODEL_ID | "fake";
  policy_version?: typeof AGENTIC_POLICY_VERSION | string;
  schema_version?: string;
  prev_output_digest?: string | null;
  /** Extra stage-specific binding (stable object; sorted keys via stableJson). */
  extra?: Record<string, unknown> | null;
};

export function stableJson(value: unknown): string {
  return JSON.stringify(toStableJsonValue(value));
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/** `sha256:<hex>` form for pack/output digests. */
export function digestSha256(value: unknown): `sha256:${string}` {
  return `sha256:${sha256Hex(stableJson(value))}`;
}

/**
 * Deterministic job / stage input digest.
 * Same inputs always yield the same digest (idempotent enqueue key material).
 */
export function computeStageInputDigest(input: StageDigestInput): `sha256:${string}` {
  const prompt_version = input.prompt_version ?? AGENTIC_PROMPT_VERSIONS[input.stage];
  const policy_version = input.policy_version ?? AGENTIC_POLICY_VERSION;
  const schema_version = input.schema_version ?? AGENTIC_STAGE_SCHEMA_VERSION;
  return digestSha256({
    schema: AGENTIC_STAGE_SCHEMA_VERSION,
    stage: input.stage,
    source_event_id: input.source_event_id,
    trust_zone_id: input.trust_zone_id,
    pack_digest: input.pack_digest ?? null,
    prompt_version,
    model_id: input.model_id,
    policy_version,
    schema_version,
    prev_output_digest: input.prev_output_digest ?? null,
    extra: input.extra ?? null,
  });
}

/** Job primary key from stage identity material. */
export function makeAgenticJobId(input: StageDigestInput): string {
  const digest = computeStageInputDigest(input);
  return `agj_${sha256Hex(digest).slice(0, 40)}`;
}

function toStableJsonValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toStableJsonValue);
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const v = obj[key];
    if (v !== undefined) {
      out[key] = toStableJsonValue(v);
    }
  }
  return out;
}
