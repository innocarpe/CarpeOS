import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CaptureEnvelope } from "@carpeos/capture";
import { LocalCaptureStore, StaticKeyProvider } from "@carpeos/local-store";
import { buildGraphProjection } from "@carpeos/retrieval";
import { afterEach, describe, expect, it } from "vitest";
import { computeGraphDensityMetrics, evaluateGraphDensityUplift } from "../src/graph-metrics.js";
import { materializeAgenticProposal } from "../src/materialize.js";
import { runAgenticProposalPipeline } from "../src/pipeline.js";
import { structureAgenticLinks } from "../src/structure.js";

const dirs: string[] = [];
const now = new Date("2026-08-07T12:00:00Z");
const key = new Uint8Array(32).fill(11);

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agentic-p4-"));
  dirs.push(dir);
  return dir;
}

function makeStore(): LocalCaptureStore {
  const runtimeDir = tempDir();
  return new LocalCaptureStore({
    runtimeDir,
    workspaceRoot: runtimeDir,
    keyProvider: new StaticKeyProvider(key),
    clock: { now: () => now },
    trustZoneId: "tz_agentic_p4",
  });
}

function makeEnvelope(overrides: Partial<CaptureEnvelope> = {}): CaptureEnvelope {
  return {
    provider: "codex",
    hook_event_name: "SessionEnd",
    captured_at: "2026-08-07T12:00:00Z",
    workspace_root: "/synthetic/workspace",
    session_id: "session_agentic_p4",
    source_event_id: "source_agentic_p4_01",
    media_type: "application/json",
    subject_ref: "subject_p4_synthetic",
    payload: {
      transcript:
        "Decision: we will densify meaning_unit graphs via provenance edges at materialize time.",
    },
    ...overrides,
  };
}

describe("structureAgenticLinks (P4 E6)", () => {
  it("emits required derived_from + about edges", () => {
    const result = structureAgenticLinks({
      unit_ref: "agp_test",
      source_event_id: "evt_source_1",
      artifact_id: "art_evidence_1",
      subject_ref: "proj_p4",
      candidate: {
        kind: "decision",
        statement: "Ship P4 link density.",
        confidence: 0.9,
        citations: [
          {
            evidence_event_id: "evt_source_1",
            segment_id: null,
            start: 0,
            end: 10,
            quote: "Ship P4",
          },
        ],
      },
    });
    expect(result.edges.some((e) => e.kind === "derived_from" && e.to_ref === "evt_source_1")).toBe(
      true,
    );
    expect(
      result.edges.some((e) => e.kind === "derived_from" && e.to_ref === "art_evidence_1"),
    ).toBe(true);
    expect(result.edges.some((e) => e.kind === "about" && e.to_ref === "proj_p4")).toBe(true);
    expect(result.reason_codes).toContain("edge_derived_from_source");
    expect(result.reason_codes).toContain("edge_about_subject");
  });
});

describe("graph density uplift after agentic materialize (P4)", () => {
  it("rebuilds denser meaning_unit graph with derived_from + about", () => {
    const store = makeStore();
    const subjectRef = "subject_p4_density";
    const captured = store.captureHook(makeEnvelope({ subject_ref: subjectRef }));
    expect(captured.status).toBe("captured");
    if (captured.status !== "captured") throw new Error("capture failed");

    const eventsBefore = store
      .listCanonicalEventSnapshots({
        visibleTrustZoneIds: [store.trustZone.trust_zone_id],
      })
      .map((row) => row.event);
    const beforeSnap = buildGraphProjection({
      events: eventsBefore,
      origins: new Map(),
    });
    const beforeMetrics = computeGraphDensityMetrics(beforeSnap);
    expect(beforeMetrics.meaning_unit_count).toBe(0);
    expect(beforeMetrics.evidence_count).toBeGreaterThanOrEqual(1);

    const agenticDb = new DatabaseSync(join(tempDir(), "agentic.sqlite"));
    const pipeline = runAgenticProposalPipeline(agenticDb, {
      trust_zone_id: store.trustZone.trust_zone_id,
      source_event_id: captured.event.event_id,
      hook_event_name: "SessionEnd",
      signal_text:
        "Decision: we will densify meaning_unit graphs via provenance edges at materialize time.",
      hint_kind: "decision",
      artifact_id: captured.event.payload.artifact_id,
      subject_ref: subjectRef,
      now,
    });
    expect(pipeline.structure_edge_count).toBeGreaterThanOrEqual(2);
    expect(pipeline.proposals.length).toBeGreaterThan(0);
    const proposal = pipeline.proposals[0]!;
    expect(proposal.edges.length).toBeGreaterThanOrEqual(2);
    expect(proposal.edges.some((e) => e.kind === "derived_from")).toBe(true);
    expect(proposal.edges.some((e) => e.kind === "about")).toBe(true);

    const mat = materializeAgenticProposal({
      store,
      agenticDb,
      proposal,
      artifact_id: captured.event.payload.artifact_id,
      subject_ref: subjectRef,
    });
    expect(mat.ok).toBe(true);
    expect(mat.provenance_ref_count).toBeGreaterThanOrEqual(1);
    expect(mat.subject_ref).toBe(subjectRef);
    expect(mat.observation_event_id).toMatch(/^evt_/);

    const eventsAfter = store
      .listCanonicalEventSnapshots({
        visibleTrustZoneIds: [store.trustZone.trust_zone_id],
      })
      .map((row) => row.event);
    const afterSnap = buildGraphProjection({
      events: eventsAfter,
      origins: new Map(),
    });
    const uplift = evaluateGraphDensityUplift({
      before: beforeSnap,
      after: afterSnap,
      min_new_meaning_units: 1,
      require_all_derived: true,
      require_all_about: true,
    });

    expect(uplift.pass).toBe(true);
    expect(uplift.delta.meaning_unit_count).toBeGreaterThanOrEqual(1);
    expect(uplift.after.derived_from_count).toBeGreaterThanOrEqual(1);
    expect(uplift.after.about_count).toBeGreaterThanOrEqual(1);
    expect(uplift.after.all_meaning_units_derived).toBe(true);
    expect(uplift.after.all_meaning_units_about).toBe(true);
    expect(uplift.after.mean_meaning_unit_degree).toBeGreaterThan(0);
    expect(uplift.reason_codes).toContain("graph_density_uplift_ok");

    store.close();
    agenticDb.close();
  });
});
