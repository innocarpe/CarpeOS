/**
 * E2 Redact + EvidencePack for agentic stages (reuse @carpeos/v5 primitives).
 * No LLM, no network, canonical_effect always "none".
 *
 * Quality ultragoal Q1′ (QD0): prepare pack once, derive bounded effective
 * model-visible views (triage_view / extract_view). Flash never sees raw signal.
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
import { AGENTIC_POLICY_VERSION } from "./types.js";

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

/** Triage view bound (QD3): head+tail style prefilter — not full 220 KB packs. */
export const AGENTIC_TRIAGE_VIEW_MAX_CHARS = 8_000;
/** Extract view bound: model-visible body Flash extract + E5 cite bind against. */
export const AGENTIC_EXTRACT_VIEW_MAX_CHARS = 12_000;

/**
 * Known scrub residuals deliberately *not* rewritten yet (emails, IPs, hostnames).
 * Path roots below are scrubbed in Q1′; residual classes stay documented for Q9′.
 */
export const AGENTIC_SCRUB_RESIDUAL_CLASSES = [
  "email_addresses",
  "ipv4_ipv6",
  "bare_hostnames",
] as const;

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

/** Effective model-visible views derived from a prepared scrubbed pack_text. */
export type AgenticEffectiveViews = {
  /** Full scrubbed pack text (digest material; may exceed Flash body bounds). */
  pack_text: string;
  /** Bounded triage input (head+tail when long). */
  triage_view_text: string;
  /** Bounded extract input (prefix). Verifier/cite bind against this string. */
  extract_view_text: string;
  /** sha256 of pack_text (full scrubbed). */
  pack_text_digest: `sha256:${string}`;
  /** sha256 of extract_view_text (effective model-visible extract body). */
  effective_view_digest: `sha256:${string}`;
  policy_version: typeof AGENTIC_POLICY_VERSION;
};

export type AgenticPackOk = {
  ok: true;
  pack: EvidencePack;
  pack_view: EvidencePackView;
  /** Concatenated redacted body/title text for cite checks and fake stages. */
  pack_text: string;
  pack_digest: string;
  /** Prepared-once effective views (QD0). */
  triage_view_text: string;
  extract_view_text: string;
  pack_text_digest: `sha256:${string}`;
  effective_view_digest: `sha256:${string}`;
  policy_version: typeof AGENTIC_POLICY_VERSION;
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
 *
 * QD0: pack is prepared once; triage/extract views are derived from scrubbed
 * pack_text and must be the only strings sent to Flash.
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
  const views = deriveAgenticEffectiveViews(pack_text);
  return {
    ok: true,
    pack,
    pack_view: serializeEvidencePackView(pack),
    pack_text,
    pack_digest: pack.pack_digest,
    triage_view_text: views.triage_view_text,
    extract_view_text: views.extract_view_text,
    pack_text_digest: views.pack_text_digest,
    effective_view_digest: views.effective_view_digest,
    policy_version: AGENTIC_POLICY_VERSION,
    canonical_effect: "none",
  };
}

/**
 * Derive bounded effective views from already-scrubbed pack text.
 * Pure; safe to call after packAgenticEvidence or on a scrubbed string.
 */
export function deriveAgenticEffectiveViews(pack_text: string): AgenticEffectiveViews {
  const text = pack_text;
  const triage_view_text = boundHeadTailView(text, AGENTIC_TRIAGE_VIEW_MAX_CHARS);
  const extract_view_text = boundPrefixView(text, AGENTIC_EXTRACT_VIEW_MAX_CHARS);
  return {
    pack_text: text,
    triage_view_text,
    extract_view_text,
    pack_text_digest: digestSha256({ schema: "carpeos.agentic.pack-text/v1", pack_text: text }),
    effective_view_digest: digestSha256({
      schema: "carpeos.agentic.effective-view/v1",
      stage: "extract",
      view_text: extract_view_text,
    }),
    policy_version: AGENTIC_POLICY_VERSION,
  };
}

/** Prefix-only bound (extract): quotes remain exact substrings of the view. */
export function boundPrefixView(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

/**
 * Head+tail bound (triage): preserves start context and end decisions without
 * shipping the full pack. Inserts a fixed ellipsis marker when truncated.
 */
export function boundHeadTailView(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const marker = "\n…[truncated]…\n";
  const budget = maxChars - marker.length;
  if (budget < 32) return text.slice(0, maxChars);
  const headLen = Math.floor(budget / 2);
  const tailLen = budget - headLen;
  return `${text.slice(0, headLen)}${marker}${text.slice(text.length - tailLen)}`;
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
 * Soft-scrub path/URI shapes that would make V5 redactEnvelope fail-close
 * and that must not appear in Flash request bodies (QD0 privacy fence).
 * Does not claim to be a full secret redactor — secret detectors still run.
 *
 * Q1′ broadened roots: tmp/var/home/Users/etc plus opt/private/Volumes/mnt/srv.
 * Residual (documented, not scrubbed): emails, bare IPs, bare hostnames.
 */
export function scrubAgenticPackText(text: string): string {
  return text
    .replace(/https?:\/\/[^\s"'`<>]+/gi, "[URI]")
    .replace(/file:\/\/[^\s"'`<>]+/gi, "[URI]")
    .replace(
      /(?:^|[\s"'`])(\/(?:tmp|var|home|Users|etc|opt|private|Volumes|mnt|srv)\/[^\s"'`]+)/g,
      " [PATH]",
    )
    .replace(/(?:^|[\s"'`])([A-Za-z]:\\[^\s"'`]+)/g, " [PATH]")
    .replace(/(?:^|[\s"'`])(~\/[^\s"'`]+)/g, " [PATH]");
}
