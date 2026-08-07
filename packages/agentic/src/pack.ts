/**
 * E2 Redact + EvidencePack for agentic stages (reuse @carpeos/v5 primitives).
 * No LLM, no network, canonical_effect always "none".
 */

import {
  buildEvidencePack,
  buildProfileBinding,
  DEFAULT_PROFILE_LIMITS,
  type EvidencePack,
  type EvidencePackView,
  type ProfileLimits,
  type RedactOk,
  redactEnvelope,
  serializeEvidencePackView,
} from "@carpeos/v5";
import { digestSha256, sha256Hex } from "./digest.js";

/**
 * Real SessionEnd transcripts are far larger than V5 draft-lane segment defaults
 * (segment_scalars: 240). Agentic pack needs room for full session signal text.
 */
export const AGENTIC_PACK_LIMITS: ProfileLimits = {
  ...DEFAULT_PROFILE_LIMITS,
  field_utf8_bytes: 200_000,
  field_scalars: 80_000,
  pack_utf8_bytes: 220_000,
  pack_scalars: 100_000,
  field_count: 8,
  segment_count: 32,
  segment_scalars: 80_000,
  segment_utf8_bytes: 200_000,
};

export type AgenticPackInput = {
  pack_id: string;
  /** Plain UTF-8 body to pack (public-safe / already filtered text). */
  body_text: string;
  title?: string;
  profile_id?: string;
  consent_id?: string;
  now_iso?: string;
  limits?: ProfileLimits;
};

export type AgenticPackOk = {
  ok: true;
  pack: EvidencePack;
  pack_view: EvidencePackView;
  /** Concatenated redacted body/title text for cite checks and fake stages. */
  pack_text: string;
  pack_digest: string;
  canonical_effect: "none";
};

export type AgenticPackFail = {
  ok: false;
  error_code: string;
  detail: string;
  canonical_effect: "none";
};

export type AgenticPackResult = AgenticPackOk | AgenticPackFail;

/**
 * Build a V5 EvidencePack from plain text via redact envelope + buildEvidencePack.
 * Pack digest is stable for identical body/title/limits bindings.
 *
 * Real session transcripts almost always contain absolute paths / URIs. V5
 * redactEnvelope fail-closes on those; for agentic E2 we soft-scrub them first
 * so Flash can still extract meaning. Secrets still fail closed.
 */
export function packAgenticEvidence(input: AgenticPackInput): AgenticPackResult {
  const body = scrubAgenticPackText(input.body_text.trim());
  if (body.length === 0) {
    return {
      ok: false,
      error_code: "empty_body",
      detail: "body_text is empty",
      canonical_effect: "none",
    };
  }

  const limits = input.limits ?? AGENTIC_PACK_LIMITS;
  const outer = buildPlainTextRedactOuter({
    body,
    title: scrubAgenticPackText(input.title ?? "agentic.evidence"),
  });

  const redaction = redactEnvelope(outer, limits, {
    packId: input.pack_id,
    segmentIdPrefix: "seg_agentic_",
  });
  if (!redaction.ok) {
    return {
      ok: false,
      error_code: redaction.error.code,
      detail: `redact failed at record ${redaction.error.record_index ?? "null"}`,
      canonical_effect: "none",
    };
  }

  const profile_id = input.profile_id ?? "agentic_redact_v1";
  const consent_id = input.consent_id ?? "consent_agentic_local_v1";
  const now = input.now_iso ?? new Date().toISOString();
  const profile = buildProfileBinding({
    profile_id,
    profile_digest_binding: `binding:${profile_id}`,
    limits,
  });

  let pack: EvidencePack;
  try {
    pack = buildEvidencePack({
      pack_id: input.pack_id,
      profile,
      consent: {
        consent_id,
        profile_id,
        granted_at: now,
        expires_at: null,
        scopes: ["extract"],
      },
      redaction: redaction as RedactOk,
    });
  } catch (e) {
    return {
      ok: false,
      error_code: "pack_build_failed",
      detail: e instanceof Error ? e.message : String(e),
      canonical_effect: "none",
    };
  }

  if (pack.canonical_effect !== "none") {
    return {
      ok: false,
      error_code: "canonical_effect_not_none",
      detail: "EvidencePack must remain draft-only for agentic E2",
      canonical_effect: "none",
    };
  }

  const pack_text = packTextFromRedaction(redaction as RedactOk);
  return {
    ok: true,
    pack,
    pack_view: serializeEvidencePackView(pack),
    pack_text,
    pack_digest: pack.pack_digest,
    canonical_effect: "none",
  };
}

/** Stable pack_id helper from source identity. */
export function makeAgenticPackId(input: {
  trust_zone_id: string;
  source_event_id: string;
  body_text: string;
}): string {
  return `pack_ag_${sha256Hex(
    digestSha256({
      schema: "carpeos.agentic.pack-id/v1",
      trust_zone_id: input.trust_zone_id,
      source_event_id: input.source_event_id,
      body: input.body_text.trim(),
    }),
  ).slice(0, 24)}`;
}

function buildPlainTextRedactOuter(input: { body: string; title: string }): Uint8Array {
  const records = [
    {
      schema: "carpeos.redact-record/v1",
      ordinal: 0,
      kind: "document",
      field: "document.title",
      media: "text",
      visibility: "visible",
      erasure: "present",
      value_b64: Buffer.from(input.title, "utf8").toString("base64"),
    },
    {
      schema: "carpeos.redact-record/v1",
      ordinal: 1,
      kind: "document",
      field: "document.body",
      media: "text",
      visibility: "visible",
      erasure: "present",
      value_b64: Buffer.from(input.body, "utf8").toString("base64"),
    },
  ];
  // records_b64 is NDJSON of records (see V5 multi-record fixtures / pipeline tests)
  const inner = Buffer.from(records.map((r) => JSON.stringify(r)).join("\n"), "utf8");
  const outer = {
    schema: "carpeos.redact-envelope/v1",
    records_b64: inner.toString("base64"),
  };
  return Buffer.from(JSON.stringify(outer), "utf8");
}

function packTextFromRedaction(redaction: RedactOk): string {
  return redaction.records
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((r) => r.normalized)
    .filter((s) => s.length > 0)
    .join("\n");
}

/**
 * Soft-scrub path/URI shapes that would make V5 redactEnvelope fail-close.
 * Does not claim to be a full secret redactor — secret detectors still run.
 */
export function scrubAgenticPackText(text: string): string {
  return text
    .replace(/https?:\/\/[^\s"'`<>]+/gi, "[URI]")
    .replace(/file:\/\/[^\s"'`<>]+/gi, "[URI]")
    .replace(/(?:^|[\s"'`])(\/(?:tmp|var|home|Users|etc)\/[^\s"'`]+)/g, " [PATH]")
    .replace(/(?:^|[\s"'`])([A-Za-z]:\\[^\s"'`]+)/g, " [PATH]")
    .replace(/(?:^|[\s"'`])(~\/[^\s"'`]+)/g, " [PATH]");
}
