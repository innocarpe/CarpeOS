import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CanonicalEvent,
  ErasureLedgerRecord,
  ProvenanceRef,
  TrustZone,
} from "@carpeos/schema";
import { describe, expect, it } from "vitest";
import { mapEventsToOkf, renderOkfConcept } from "../src/index.js";
import type { OkfMapInputEvent } from "../src/index.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const trustZone: TrustZone = {
  trust_zone_id: "tz_local_default",
  isolation: "local_device",
};
const baseTime = "2026-01-01T00:00:00Z";
const generatedAt = "2026-07-31T12:00:00Z";
const base = {
  schema_version: "v1" as const,
  subject_ref: "subject_alpha",
  valid_time: { start: baseTime, end: null },
  lifecycle_status: "active" as const,
  trust_zone: trustZone,
  provenance: [
    { ref_type: "external", ref_id: "external_fixture", relationship: "derived_from" },
  ] satisfies ProvenanceRef[],
};

describe("mapEventsToOkf (K1)", () => {
  it("exports accepted decision + observation + referenced evidence (golden)", () => {
    const result = mapEventsToOkf(
      input([evidence(), observation(), claimAccepted(), acceptedDecision()]),
      config(),
    );

    expect(result.okfVersion).toBe("0.2");
    expect(result.projectionVersion).toBe("okf-export/v1");
    expect(result.concepts.map((c) => c.path)).toEqual([
      "decisions/claim_alpha.md",
      "evidence/art_evidence001.md",
      "observations/obs_alpha.md",
    ]);

    const bundle = materializeBundle(result);
    expect(bundle["decisions/claim_alpha.md"]).toBe(
      readFixture("minimal-accepted/decisions/claim_alpha.md"),
    );
    expect(bundle["observations/obs_alpha.md"]).toBe(
      readFixture("minimal-accepted/observations/obs_alpha.md"),
    );
    expect(bundle["evidence/art_evidence001.md"]).toBe(
      readFixture("minimal-accepted/evidence/art_evidence001.md"),
    );
    expect(bundle["index.md"]).toBe(readFixture("minimal-accepted/index.md"));
    expect(bundle["log.md"]).toBe(readFixture("minimal-accepted/log.md"));
  });

  it("excludes held/draft observations by default and includes with includeHeld", () => {
    const held = observation({
      event_id: "evt_observe_held",
      lifecycle_status: "draft",
      payload: {
        observation_id: "obs_held",
        observed_at: "2026-01-01T00:02:00Z",
        statement: "Held observation stays draft until review.",
        evidence_artifact_refs: [],
      },
    });

    const defaultResult = mapEventsToOkf(input([held]), config());
    expect(defaultResult.concepts).toEqual([]);
    expect(defaultResult.omissions).toContainEqual({
      event_id: "evt_observe_held",
      event_type: "Observation",
      reason: "held_excluded",
    });

    const included = mapEventsToOkf(input([held]), config({ includeHeld: true }));
    expect(included.concepts.map((c) => c.path)).toEqual(["drafts/obs_held.md"]);
    expect(included.concepts[0]?.frontmatter.type).toBe("Draft Observation");
    expect(included.concepts[0]?.frontmatter.status).toBe("draft");
    expect(renderOkfConcept(included.concepts[0]!)).toBe(
      readFixture("held-include/drafts/obs_held.md"),
    );
  });

  it("never exports rejected claims by default", () => {
    const result = mapEventsToOkf(input([claimRejected(), rejectedDecision()]), config());
    expect(result.concepts).toEqual([]);
    expect(result.omissions.some((o) => o.reason === "rejected")).toBe(true);
  });

  it("marks superseded accepted decisions as deprecated and exports supersession", () => {
    const result = mapEventsToOkf(
      input([
        claimAccepted(),
        acceptedDecision(),
        supersession({
          supersedes_event_id: "evt_claim001",
          replacement_event_id: "evt_claim_new",
          reason: "Replaced by a clearer decision statement.",
        }),
      ]),
      config(),
    );

    const decision = result.concepts.find((c) => c.path === "decisions/claim_alpha.md");
    expect(decision?.frontmatter.status).toBe("deprecated");
    expect(result.concepts.map((c) => c.path)).toEqual([
      "decisions/claim_alpha.md",
      "lineage/sup_alpha.md",
    ]);
    expect(renderOkfConcept(decision!)).toContain('status: "deprecated"');
    expect(renderOkfConcept(result.concepts.find((c) => c.path.startsWith("lineage/"))!)).toBe(
      readFixture("supersession/lineage/sup_alpha.md"),
    );
  });

  it("omits accepted fact when acceptance is erased", () => {
    const result = mapEventsToOkf(
      {
        events: toEvents([claimAccepted(), acceptedDecision()]),
        erasures: [
          {
            erasure_id: "era_evt_decision001",
            trust_zone_id: "tz_local_default",
            erasure: eventErasure("evt_decision001"),
          },
        ],
      },
      config(),
    );
    expect(result.concepts.some((c) => c.frontmatter.type === "Accepted Decision")).toBe(false);
    expect(result.omissions).toContainEqual({
      event_id: "evt_decision001",
      event_type: "AcceptanceDecision",
      reason: "erased",
    });
  });

  it("omits wrong trust zone and orphan evidence", () => {
    const otherZoneObs = observation({
      event_id: "evt_other_zone",
      trust_zone: { trust_zone_id: "tz_other", isolation: "local_device" },
      payload: {
        observation_id: "obs_other",
        observed_at: "2026-01-01T00:01:00Z",
        statement: "Other zone.",
        evidence_artifact_refs: [],
      },
    });
    const orphanEv = evidence();
    const result = mapEventsToOkf(input([otherZoneObs, orphanEv]), config());
    expect(result.concepts).toEqual([]);
    expect(result.omissions.map((o) => o.reason).sort()).toEqual([
      "orphan_evidence",
      "wrong_trust_zone",
    ]);
  });

  it("is path-order deterministic regardless of input order", () => {
    const a = mapEventsToOkf(
      input([claimAccepted(), acceptedDecision(), observation(), evidence()]),
      config(),
    );
    const b = mapEventsToOkf(
      input([evidence(), observation(), acceptedDecision(), claimAccepted()]),
      config(),
    );
    expect(a.concepts.map((c) => c.path)).toEqual(b.concepts.map((c) => c.path));
    expect(a.concepts.map((c) => renderOkfConcept(c))).toEqual(
      b.concepts.map((c) => renderOkfConcept(c)),
    );
  });

  it("rejects protected plaintext sentinels during map/render", () => {
    const bad = observation({
      payload: {
        observation_id: "obs_bad",
        observed_at: "2026-01-01T00:01:00Z",
        statement: "contains PRIVATE_MARKER secret",
        evidence_artifact_refs: [],
      },
    });
    // Index/log render runs inside map and refuses protected sentinels.
    expect(() => mapEventsToOkf(input([bad]), config())).toThrow(/protected plaintext/);
  });
});

function config(overrides: { includeHeld?: boolean } = {}) {
  return {
    visibleTrustZoneIds: ["tz_local_default"],
    generatedAt,
    exportNote: "Synthetic K1 fixture export",
    ...overrides,
  };
}

function input(events: readonly CanonicalEvent[]) {
  return { events: toEvents(events) };
}

function toEvents(events: readonly CanonicalEvent[]): OkfMapInputEvent[] {
  return events.map((event) => ({
    event_id: event.event_id,
    event_type: event.event_type,
    trust_zone_id: event.trust_zone.trust_zone_id,
    event,
  }));
}

function materializeBundle(result: ReturnType<typeof mapEventsToOkf>): Record<string, string> {
  const bundle: Record<string, string> = {
    "index.md": result.indexMarkdown,
    "log.md": result.logMarkdown,
  };
  for (const concept of result.concepts) {
    bundle[concept.path] = renderOkfConcept(concept);
  }
  return bundle;
}

function readFixture(relativePath: string): string {
  return readFileSync(join(fixturesDir, relativePath), "utf8");
}

function digest(value: string): string {
  return `sha-256:${createHash("sha256").update(value).digest("hex")}`;
}

function claimAccepted(): CanonicalEvent<"Claim"> {
  return claim({
    event_id: "evt_claim001",
    claim_id: "claim_alpha",
    statement: "Example Alpha retrieval is deterministic and accepted.",
    lifecycle_status: "active",
    zone_sequence: 2,
  });
}

function claimRejected(): CanonicalEvent<"Claim"> {
  return claim({
    event_id: "evt_claim_rejected001",
    claim_id: "claim_rejected",
    statement: "Example Rejected remains rejected lineage.",
    lifecycle_status: "active",
    zone_sequence: 4,
  });
}

function claim(
  overrides: Partial<CanonicalEvent<"Claim">> & {
    claim_id: string;
    statement: string;
    zone_sequence: number;
    support?: ProvenanceRef[];
  },
): CanonicalEvent<"Claim"> {
  return {
    ...base,
    event_id: overrides.event_id ?? `evt_${overrides.claim_id}`,
    event_type: "Claim",
    recorded_time: { start: minuteTime(overrides.zone_sequence), end: null },
    lifecycle_status: overrides.lifecycle_status ?? "active",
    epistemic_authority: "derived",
    idempotency_key: `idem_${overrides.claim_id}_fixture`,
    request_fingerprint: digest(overrides.claim_id),
    zone_sequence: overrides.zone_sequence,
    payload: {
      claim_id: overrides.claim_id,
      statement: overrides.statement,
      claim_type: "inference",
      support: overrides.support ?? [
        { ref_type: "observation", ref_id: "obs_alpha", relationship: "supports" },
      ],
    },
  };
}

function acceptedDecision(): CanonicalEvent<"AcceptanceDecision"> {
  return decision("evt_decision001", "decision_alpha", "claim_alpha", "accepted", 6);
}

function rejectedDecision(): CanonicalEvent<"AcceptanceDecision"> {
  return decision("evt_decision_rejected001", "decision_rejected", "claim_rejected", "rejected", 7);
}

function minuteTime(sequence: number): string {
  return `2026-01-01T00:${String(sequence).padStart(2, "0")}:00Z`;
}

function decision(
  eventId: string,
  decisionId: string,
  claimRef: string,
  decisionValue: "accepted" | "rejected" | "needs_review",
  sequence: number,
): CanonicalEvent<"AcceptanceDecision"> {
  return {
    ...base,
    event_id: eventId,
    event_type: "AcceptanceDecision",
    recorded_time: { start: minuteTime(sequence), end: null },
    epistemic_authority: "verified",
    idempotency_key: `idem_${decisionId}_fixture`,
    request_fingerprint: digest(decisionId),
    zone_sequence: sequence,
    payload: {
      decision_id: decisionId,
      claim_refs: [claimRef],
      decision: decisionValue,
      decided_by: "actor_reviewer",
      decided_at: minuteTime(sequence),
    },
  };
}

function observation(
  overrides: Partial<CanonicalEvent<"Observation">> & {
    payload?: CanonicalEvent<"Observation">["payload"];
  } = {},
): CanonicalEvent<"Observation"> {
  const { payload: payloadOverride, ...rest } = overrides;
  return {
    ...base,
    ...rest,
    event_id: overrides.event_id ?? "evt_observe001",
    event_type: "Observation",
    recorded_time: overrides.recorded_time ?? { start: "2026-01-01T00:01:00Z", end: null },
    epistemic_authority: overrides.epistemic_authority ?? "observed",
    idempotency_key: overrides.idempotency_key ?? "idem_observation_fixture",
    request_fingerprint: overrides.request_fingerprint ?? digest("observation"),
    zone_sequence: overrides.zone_sequence ?? 1,
    lifecycle_status: overrides.lifecycle_status ?? "active",
    trust_zone: overrides.trust_zone ?? trustZone,
    payload: payloadOverride ?? {
      observation_id: "obs_alpha",
      observed_at: "2026-01-01T00:01:00Z",
      statement: "Example Alpha uses a deterministic projection.",
      evidence_artifact_refs: ["art_evidence001"],
    },
  };
}

function evidence(): CanonicalEvent<"EvidenceArtifact"> {
  return {
    ...base,
    event_id: "evt_evidence001",
    event_type: "EvidenceArtifact",
    recorded_time: { start: "2026-01-01T00:00:30Z", end: null },
    epistemic_authority: "imported",
    idempotency_key: "idem_evidence_fixture",
    request_fingerprint: digest("evidence"),
    zone_sequence: 1,
    payload: {
      artifact_id: "art_evidence001",
      kind: "message",
      media_type: "application/json",
      content_ref: {
        ref_type: "protected_value",
        protected_value_id: "pv_protected_fixture",
        vault_ref: "vault_local",
        key_ref: "key_local_active",
        encrypted_blob: {
          algorithm: "aes-256-gcm",
          nonce_ref: "nonce_fixture",
          tag_ref: "tag_fixture",
          digest: { algorithm: "sha-256", value: "a".repeat(64) },
          size_bytes: 128,
        },
      },
    },
  };
}

function supersession(
  overrides: Partial<CanonicalEvent<"Supersession">["payload"]> &
    Partial<Pick<CanonicalEvent<"Supersession">, "event_id" | "zone_sequence">> = {},
): CanonicalEvent<"Supersession"> {
  const supersessionId = overrides.supersession_id ?? "sup_alpha";
  const sequence = overrides.zone_sequence ?? 8;
  return {
    ...base,
    event_id: overrides.event_id ?? "evt_super001",
    event_type: "Supersession",
    recorded_time: { start: minuteTime(sequence), end: null },
    epistemic_authority: "verified",
    idempotency_key: `idem_${supersessionId}_fixture`,
    request_fingerprint: digest(supersessionId),
    zone_sequence: sequence,
    payload: {
      supersession_id: supersessionId,
      supersedes_event_id: overrides.supersedes_event_id ?? "evt_claim_old",
      replacement_event_id: overrides.replacement_event_id ?? "evt_claim001",
      reason: overrides.reason ?? "Synthetic replacement.",
    },
  };
}

function eventErasure(eventId: string): ErasureLedgerRecord {
  return {
    schema_version: "v1",
    erasure_id: `era_${eventId}`,
    method: "tombstone",
    target_ref: { target_kind: "event", target_id: eventId },
    requested_at: "2026-01-01T00:09:00Z",
    completed_at: "2026-01-01T00:09:10Z",
    actor_ref: "actor_operator",
    trust_zone: trustZone,
    zone_sequence: 9,
    evidence_refs: [{ ref_type: "event", ref_id: eventId, relationship: "redacts" }],
  };
}
