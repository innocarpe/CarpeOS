import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CanonicalEvent,
  ErasureLedgerRecord,
  ObsidianProjectionNote,
  ProvenanceRef,
  TrustZone,
} from "@carpeos/schema";
import { validateConformance } from "@carpeos/schema";
import type {
  LocalCanonicalEventSnapshot,
  LocalErasureSnapshot,
  LocalRetrievalInputSnapshot,
} from "@carpeos/local-store";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildManifest,
  rebuildObsidianProjection,
  renderMarkdown,
  renderYaml,
} from "../src/index.js";

const dirs: string[] = [];
const trustZone: TrustZone = {
  trust_zone_id: "tz_local_default",
  isolation: "local_device",
};
const baseTime = "2026-01-01T00:00:00Z";
const base = {
  schema_version: "v1",
  subject_ref: "subject_alpha",
  valid_time: { start: baseTime, end: null },
  lifecycle_status: "active",
  trust_zone: trustZone,
  provenance: [
    { ref_type: "external", ref_id: "external_fixture", relationship: "derived_from" },
  ] satisfies ProvenanceRef[],
} as const;

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Obsidian projection rebuild", () => {
  it("rebuilds byte-stable notes and manifest with deterministic ordering", () => {
    const outputRoot = tempDir();
    const first = rebuildObsidianProjection({
      snapshot: snapshot([claimAccepted(), acceptedDecision(), observation(), evidence()]),
      config: config(outputRoot),
    });
    const firstBytes = readAllGenerated(outputRoot, first.written);
    const firstManifest = readFileSync(first.manifestPath, "utf8");
    const second = rebuildObsidianProjection({
      snapshot: snapshot([evidence(), observation(), acceptedDecision(), claimAccepted()]),
      config: config(outputRoot),
    });

    expect(second.manifestStatus).toBe("valid");
    expect(readFileSync(second.manifestPath, "utf8")).toBe(firstManifest);
    expect(readAllGenerated(outputRoot, second.written)).toEqual(firstBytes);
    expect(second.written).toEqual([...second.written].sort());
    expect(JSON.parse(firstManifest).files.map((file: { path: string }) => file.path)).toEqual(
      second.written,
    );
  });

  it("separates accepted facts from draft and rejected claims with required lineage", () => {
    const outputRoot = tempDir();
    const result = rebuildObsidianProjection({
      snapshot: snapshot([
        observation(),
        claimAccepted(),
        acceptedDecision(),
        claimDraft(),
        claimRejected(),
        rejectedDecision(),
      ]),
      config: config(outputRoot),
    });
    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8")) as {
      files: Array<{
        path: string;
        category: string;
        source_lineage: Array<{ relationship: string }>;
      }>;
    };

    expect(manifest.files.some((file) => file.category === "accepted_fact")).toBe(true);
    expect(manifest.files.some((file) => file.category === "proposed_claim")).toBe(true);
    expect(manifest.files.some((file) => file.category === "rejected_claim")).toBe(true);
    for (const file of manifest.files) {
      const relationships = file.source_lineage.map((item) => item.relationship);
      if (file.category === "accepted_fact") {
        expect(relationships).toContain("acceptance");
      }
      if (file.category === "proposed_claim") {
        expect(file.path).not.toContain("accepted_fact");
        expect(relationships).toContain("primary");
      }
      if (file.category === "rejected_claim") {
        expect(relationships).toContain("rejection");
      }
    }
  });

  it("does not promote erased acceptance or erased support lineage", () => {
    const outputRoot = tempDir();
    const erasedAcceptance = rebuildObsidianProjection({
      snapshot: snapshot(
        [observation(), claimAccepted(), acceptedDecision()],
        [eventErasure("evt_decision001")],
      ),
      config: config(outputRoot),
    });
    const erasedAcceptanceCategories = generatedCategories(outputRoot, erasedAcceptance.written);

    expect(erasedAcceptanceCategories).not.toContain("accepted_fact");
    expect(erasedAcceptanceCategories).not.toContain("proposed_claim");
    expect(erasedAcceptanceCategories).toContain("conflict");

    const outputRootWithErasedSupport = tempDir();
    const erasedSupport = rebuildObsidianProjection({
      snapshot: snapshot(
        [observation(), claimAccepted(), acceptedDecision()],
        [eventErasure("evt_observe001")],
      ),
      config: config(outputRootWithErasedSupport),
    });
    const erasedSupportCategories = generatedCategories(
      outputRootWithErasedSupport,
      erasedSupport.written,
    );

    expect(erasedSupportCategories).not.toContain("accepted_fact");
    expect(erasedSupportCategories).not.toContain("proposed_claim");
    expect(erasedSupportCategories).toContain("conflict");
  });

  it("renders accepted plus rejected decisions and contradiction lineage as conflict", () => {
    const outputRoot = tempDir();
    const result = rebuildObsidianProjection({
      snapshot: snapshot([
        observation(),
        claimAccepted(),
        acceptedDecision(),
        decision(
          "evt_decision_conflict_reject",
          "decision_conflict_reject",
          "claim_alpha",
          "rejected",
          10,
        ),
        claimConflict(),
      ]),
      config: config(outputRoot),
    });
    const categories = generatedCategories(outputRoot, result.written);

    expect(categories).toContain("conflict");
    expect(categories).not.toContain("accepted_fact");
    expect(result.written.filter((path) => path.startsWith("conflict/"))).toHaveLength(2);
  });

  it("does not render superseded accepted or draft claims as accepted facts or proposals", () => {
    const outputRoot = tempDir();
    const result = rebuildObsidianProjection({
      snapshot: snapshot([
        observation(),
        claimAccepted(),
        acceptedDecision(),
        claimDraft(),
        supersession({
          event_id: "evt_super_accepted001",
          supersession_id: "sup_accepted",
          supersedes_event_id: "evt_claim001",
          replacement_event_id: "evt_claim_replacement001",
          zone_sequence: 11,
        }),
        supersession({
          event_id: "evt_super_draft001",
          supersession_id: "sup_draft",
          supersedes_event_id: "evt_claim_draft001",
          replacement_event_id: "evt_claim_replacement002",
          zone_sequence: 12,
        }),
      ]),
      config: config(outputRoot),
    });
    const categories = generatedCategories(outputRoot, result.written);

    expect(categories).not.toContain("accepted_fact");
    expect(categories).not.toContain("proposed_claim");
    expect(categories).toContain("supersession");
  });

  it("does not promote superseded support or superseded acceptance lineage", () => {
    const outputRoot = tempDir();
    const result = rebuildObsidianProjection({
      snapshot: snapshot([
        observation(),
        claimAccepted(),
        acceptedDecision(),
        supersession({
          event_id: "evt_super_support001",
          supersession_id: "sup_support",
          supersedes_event_id: "evt_observe001",
          replacement_event_id: "evt_observe002",
          zone_sequence: 13,
        }),
        supersession({
          event_id: "evt_super_decision001",
          supersession_id: "sup_decision",
          supersedes_event_id: "evt_decision001",
          replacement_event_id: "evt_decision002",
          zone_sequence: 14,
        }),
      ]),
      config: config(outputRoot),
    });
    const categories = generatedCategories(outputRoot, result.written);

    expect(categories).not.toContain("accepted_fact");
    expect(categories).not.toContain("proposed_claim");
    expect(categories).toContain("conflict");
    expect(categories).toContain("supersession");
  });

  it("renders conflict and erasure notes without protected plaintext", () => {
    const outputRoot = tempDir();
    const result = rebuildObsidianProjection({
      snapshot: snapshot(
        [claimConflict(), evidence("protected_plaintext_marker")],
        [eventErasure("evt_observe001")],
      ),
      config: config(outputRoot),
    });
    const allBytes = readAllGenerated(outputRoot, result.written).join("\n");

    expect(result.written.some((path) => path.startsWith("conflict/"))).toBe(true);
    expect(result.written.some((path) => path.startsWith("erasure/"))).toBe(true);
    expect(allBytes).not.toContain("protected_plaintext_marker");
    expect(allBytes).toContain("Generated non-authoritative CarpeOS projection");
  });

  it("uses erasure records to remove affected generated files on the next valid-manifest rebuild", () => {
    const outputRoot = tempDir();
    const first = rebuildObsidianProjection({
      snapshot: snapshot([observation()]),
      config: config(outputRoot),
    });
    const observationPath = first.written.find((path) => path.startsWith("observation/"));
    expect(observationPath).toBeDefined();
    if (observationPath === undefined) {
      throw new Error("missing observation path");
    }

    const second = rebuildObsidianProjection({
      snapshot: snapshot([observation()], [eventErasure("evt_observe001")]),
      config: config(outputRoot),
    });

    expect(second.deleted).toContain(observationPath);
    expect(() => readFileSync(join(outputRoot, observationPath), "utf8")).toThrow();
    expect(second.written.some((path) => path.startsWith("erasure/"))).toBe(true);
  });

  it("preserves unmanaged notes and avoids deletion when the previous manifest is corrupt", () => {
    const outputRoot = tempDir();
    mkdirSync(join(outputRoot, "personal"), { recursive: true });
    writeFileSync(join(outputRoot, "personal/note.md"), "human note\n");
    const first = rebuildObsidianProjection({
      snapshot: snapshot([observation()]),
      config: config(outputRoot),
    });
    const oldGenerated = first.written.find((path) => path.startsWith("observation/"));
    writeFileSync(first.manifestPath, "{not-json");

    const second = rebuildObsidianProjection({
      snapshot: snapshot([]),
      config: config(outputRoot),
    });

    expect(second.manifestStatus).toBe("corrupt");
    expect(second.preservedDeletionBecauseManifestCorrupt).toBe(true);
    expect(readFileSync(join(outputRoot, "personal/note.md"), "utf8")).toBe("human note\n");
    if (oldGenerated !== undefined) {
      expect(readFileSync(join(outputRoot, oldGenerated), "utf8")).toContain("Observation");
    }
  });

  it("rejects traversal, unsafe symlink-adjacent paths, and file collisions", () => {
    const outputRoot = tempDir();
    const unsafe = observation({ subject_ref: "../escape" });

    expect(() =>
      rebuildObsidianProjection({
        snapshot: snapshot([unsafe]),
        config: config(outputRoot),
      }),
    ).toThrow(/unsafe path segment/);

    const note = noteFixture("indexes/types/claim.md", "index");
    expect(() =>
      buildManifest({
        outputRoot,
        config: {
          ...config(outputRoot),
          projectionVersion: "obsidian/v1",
          pathPolicy: "delete_missing",
          generatedAtPolicy: "fixed_input",
          nonAuthoritativeMarker: "marker",
        },
        notes: [
          { note, content: renderMarkdown(note, "# one") },
          {
            note: { ...note, category: "observation" },
            content: renderMarkdown(
              {
                ...note,
                category: "observation",
                front_matter: { ...note.front_matter, category: "observation" },
              },
              "# two",
            ),
          },
        ],
      }),
    ).toThrow(/path collision/);
  });

  it("rejects writes through an existing symlink directory and leaves external files unchanged", () => {
    const outputRoot = tempDir();
    const externalRoot = tempDir();
    const externalSentinel = join(externalRoot, "sentinel.md");
    writeFileSync(externalSentinel, "external unchanged\n");
    symlinkSync(externalRoot, join(outputRoot, "observation"), "dir");

    expect(() =>
      rebuildObsidianProjection({
        snapshot: snapshot([observation()]),
        config: config(outputRoot),
      }),
    ).toThrow(/symlink/);
    expect(readFileSync(externalSentinel, "utf8")).toBe("external unchanged\n");
  });

  it("rejects manifest cleanup when a previous generated file is now a symlink", () => {
    const outputRoot = tempDir();
    const externalRoot = tempDir();
    const externalSentinel = join(externalRoot, "sentinel.md");
    writeFileSync(externalSentinel, "external unchanged\n");
    const first = rebuildObsidianProjection({
      snapshot: snapshot([observation()]),
      config: config(outputRoot),
    });
    const observationPath = first.written.find((path) => path.startsWith("observation/"));
    if (observationPath === undefined) {
      throw new Error("missing generated observation");
    }
    rmSync(join(outputRoot, observationPath));
    symlinkSync(externalSentinel, join(outputRoot, observationPath));

    expect(() =>
      rebuildObsidianProjection({
        snapshot: snapshot([]),
        config: config(outputRoot),
      }),
    ).toThrow(/symlink/);
    expect(readFileSync(externalSentinel, "utf8")).toBe("external unchanged\n");
    expect(existsSync(join(outputRoot, observationPath))).toBe(true);
  });

  it("serializes YAML safely and emits vault-root forward-slash links", () => {
    const outputRoot = tempDir();
    const result = rebuildObsidianProjection({
      snapshot: snapshot([observation({ subject_ref: "subject with spaces" })]),
      config: config(outputRoot),
    });
    const content = readAllGenerated(outputRoot, result.written).join("\n");

    expect(renderYaml({ z: ["a:b", "bracket ] pipe |"], a: true })).toBe(
      'a: true\nz: \n  - "a:b"\n  - "bracket ] pipe |"\n',
    );
    expect(content).toMatch(/^---\n/s);
    expect(content).toContain("[[/indexes/subjects/");
    expect(content).toContain("|subject with spaces]]");
  });

  it("validates generated notes and manifests against the schema enum", () => {
    const outputRoot = tempDir();
    const result = rebuildObsidianProjection({
      snapshot: snapshot([
        claimAccepted(),
        acceptedDecision(),
        observation(),
        evidence(),
        supersession(),
      ]),
      config: config(outputRoot),
    });
    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
    expect(validateConformance("obsidianProjection", manifest)).toEqual({
      valid: true,
      errors: [],
    });
    expect(new Set(manifest.files.map((file: { category: string }) => file.category))).toEqual(
      new Set(["accepted_fact", "evidence_summary", "index", "observation", "supersession"]),
    );
  });
});

function config(outputRoot: string) {
  return {
    outputRoot,
    visibleTrustZoneIds: ["tz_local_default"],
  };
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "carpeos-obsidian-projection-"));
  dirs.push(dir);
  return dir;
}

function readAllGenerated(outputRoot: string, paths: readonly string[]): string[] {
  return paths.map((path) => readFileSync(join(outputRoot, path), "utf8"));
}

function generatedCategories(outputRoot: string, paths: readonly string[]): string[] {
  return [
    ...new Set(
      readAllGenerated(outputRoot, paths)
        .map((content) => content.match(/^category: "([^"]+)"/m)?.[1])
        .filter((category): category is string => category !== undefined),
    ),
  ].sort();
}

function snapshot(
  events: readonly CanonicalEvent[],
  erasures: readonly ErasureLedgerRecord[] = [],
): LocalRetrievalInputSnapshot {
  return {
    trust_zone_id: "tz_local_default",
    visible_trust_zone_ids: ["tz_local_default"],
    events: events.map((event, index) => eventSnapshot(event, index + 1)),
    erasures: erasures.map((erasure, index) => erasureSnapshot(erasure, index + 1)),
    sync_cursor: { trust_zone_id: "tz_local_default", after_sequence: events.length, cursor: null },
  };
}

function eventSnapshot(event: CanonicalEvent, index: number): LocalCanonicalEventSnapshot {
  return {
    source: "canonical",
    local_sequence: index,
    event_id: event.event_id,
    event_type: event.event_type,
    trust_zone_id: event.trust_zone.trust_zone_id,
    zone_sequence: event.zone_sequence ?? index,
    protected_value_id: event.event_type === "EvidenceArtifact" ? "pv_fixture" : null,
    event,
  };
}

function erasureSnapshot(erasure: ErasureLedgerRecord, index: number): LocalErasureSnapshot {
  return {
    source: "inbox",
    erasure_id: erasure.erasure_id,
    trust_zone_id: erasure.trust_zone.trust_zone_id,
    zone_sequence: erasure.zone_sequence ?? index,
    erasure,
    imported_at: "2026-01-01T00:10:00Z",
  };
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

function claimDraft(): CanonicalEvent<"Claim"> {
  return claim({
    event_id: "evt_claim_draft001",
    claim_id: "claim_draft",
    statement: "Example Draft remains proposed.",
    lifecycle_status: "draft",
    zone_sequence: 3,
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

function claimConflict(): CanonicalEvent<"Claim"> {
  return claim({
    event_id: "evt_claim_conflict001",
    claim_id: "claim_conflict",
    statement: "Example Conflict has contradiction lineage.",
    lifecycle_status: "active",
    zone_sequence: 5,
    support: [{ ref_type: "claim", ref_id: "claim_alpha", relationship: "contradicts" }],
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
    recorded_time: { start: `2026-01-01T00:0${overrides.zone_sequence}:00Z`, end: null },
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
    recorded_time: { start: `2026-01-01T00:${sequence}:00Z`, end: null },
    epistemic_authority: "verified",
    idempotency_key: `idem_${decisionId}_fixture`,
    request_fingerprint: digest(decisionId),
    zone_sequence: sequence,
    payload: {
      decision_id: decisionId,
      claim_refs: [claimRef],
      decision: decisionValue,
      decided_by: "actor_reviewer",
      decided_at: `2026-01-01T00:${sequence}:00Z`,
    },
  };
}

function observation(
  overrides: Partial<CanonicalEvent<"Observation">> = {},
): CanonicalEvent<"Observation"> {
  return {
    ...base,
    ...overrides,
    event_id: overrides.event_id ?? "evt_observe001",
    event_type: "Observation",
    recorded_time: { start: "2026-01-01T00:01:00Z", end: null },
    epistemic_authority: "observed",
    idempotency_key: "idem_observation_fixture",
    request_fingerprint: digest("observation"),
    zone_sequence: 1,
    payload: {
      observation_id: "obs_alpha",
      observed_at: "2026-01-01T00:01:00Z",
      statement: "Example Alpha uses a deterministic projection.",
      evidence_artifact_refs: ["art_evidence001"],
    },
  };
}

function evidence(_protectedMarker = ""): CanonicalEvent<"EvidenceArtifact"> {
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
    recorded_time: { start: `2026-01-01T00:${sequence}:00Z`, end: null },
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

function noteFixture(
  path: string,
  category: ObsidianProjectionNote["category"],
): ObsidianProjectionNote {
  return {
    schema_version: "v1",
    note_type: "obsidian_projection_note",
    path,
    category,
    source_lineage: [
      {
        source_kind: "config",
        source_id: "obsidian/v1",
        trust_zone_id: "tz_local_default",
        zone_sequence: 1,
        source_fingerprint: digest("config"),
        relationship: "config",
      },
    ],
    front_matter: {
      carpeos_projection: true,
      category,
      source_ids: ["obsidian/v1"],
      canonical_effect: "none",
    },
  };
}

function digest(seed: string): string {
  return `sha-256:${createHash("sha256").update(seed).digest("hex")}`;
}
