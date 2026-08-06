/**
 * Bounded EvidencePack + view serialization (draft-only, canonical_effect: none).
 * No network calls.
 */

import { digestSha256, jcs, sha256Jcs } from "./jcs.js";
import type { RedactOk, RedactRecordResult } from "./redaction.js";

export type ConsentBinding = {
  consent_id: string;
  profile_id: string;
  granted_at: string;
  expires_at: string | null;
  scopes: string[];
};

export type ProfileBinding = {
  profile_id: string;
  profile_digest_binding: string;
  redaction_policy_id: "redact_v1";
  limits_digest: string;
};

export type EvidencePack = {
  schema: "carpeos.evidence-pack/v1";
  pack_id: string;
  profile: ProfileBinding;
  consent: ConsentBinding;
  redaction: RedactOk;
  pack_digest: string;
  canonical_effect: "none";
};

export type EvidencePackView = {
  schema: "carpeos.evidence-pack-view/v1";
  pack_id: string;
  profile_id: string;
  consent_id: string;
  field_count: number;
  scalar_count: number;
  utf8_bytes: number;
  pack_digest: string;
  records: Array<{
    field: string;
    kind: string;
    ordinal: number;
    segment_count: number;
  }>;
  canonical_effect: "none";
};

export function buildProfileBinding(input: {
  profile_id: string;
  profile_digest_binding: string;
  limits: Record<string, unknown>;
}): ProfileBinding {
  return {
    profile_id: input.profile_id,
    profile_digest_binding: input.profile_digest_binding,
    redaction_policy_id: "redact_v1",
    limits_digest: digestSha256({
      schema: "carpeos.profile-limits/v1",
      limits: input.limits,
    }),
  };
}

export function buildEvidencePack(input: {
  pack_id: string;
  profile: ProfileBinding;
  consent: ConsentBinding;
  redaction: RedactOk;
}): EvidencePack {
  // Preflight equality: consent must bind the same profile
  if (input.consent.profile_id !== input.profile.profile_id) {
    throw new Error("preflight: consent.profile_id !== profile.profile_id");
  }
  const pack_digest = digestSha256({
    schema: "carpeos.pack-binding/v1",
    pack_id: input.pack_id,
    profile_id: input.profile.profile_id,
    consent_id: input.consent.consent_id,
    records: input.redaction.records.map(recordFingerprint),
  });
  return {
    schema: "carpeos.evidence-pack/v1",
    pack_id: input.pack_id,
    profile: input.profile,
    consent: input.consent,
    redaction: input.redaction,
    pack_digest,
    canonical_effect: "none",
  };
}

function recordFingerprint(record: RedactRecordResult): unknown {
  return {
    field: record.field,
    kind: record.kind,
    ordinal: record.ordinal,
    normalized_sha256: sha256Jcs(record.normalized),
    segments: record.segments.map((s) => ({
      id: s.id,
      start: s.start,
      end: s.end,
      scalar_count: s.scalar_count,
      bytes_b64: s.bytes_b64,
    })),
  };
}

export function serializeEvidencePackView(pack: EvidencePack): EvidencePackView {
  return {
    schema: "carpeos.evidence-pack-view/v1",
    pack_id: pack.pack_id,
    profile_id: pack.profile.profile_id,
    consent_id: pack.consent.consent_id,
    field_count: pack.redaction.pack.field_count,
    scalar_count: pack.redaction.pack.scalar_count,
    utf8_bytes: pack.redaction.pack.utf8_bytes,
    pack_digest: pack.pack_digest,
    records: pack.redaction.records.map((r) => ({
      field: r.field,
      kind: r.kind,
      ordinal: r.ordinal,
      segment_count: r.segments.length,
    })),
    canonical_effect: "none",
  };
}

export function preflightEqual(a: unknown, b: unknown): boolean {
  return jcs(a) === jcs(b);
}
