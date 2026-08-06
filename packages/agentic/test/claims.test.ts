import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CaptureEnvelope } from "@carpeos/capture";
import { LocalCaptureStore, StaticKeyProvider } from "@carpeos/local-store";
import { afterEach, describe, expect, it } from "vitest";
import { agenticKindToClaimType, materializeTargetsForKind } from "../src/claims.js";
import { materializeAgenticProposal } from "../src/materialize.js";
import { runAgenticProposalPipeline } from "../src/pipeline.js";
import { AGENTIC_POLICY_VERSION } from "../src/types.js";

const dirs: string[] = [];
const now = new Date("2026-08-07T15:00:00Z");
const key = new Uint8Array(32).fill(19);

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agentic-p5-"));
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
    trustZoneId: "tz_agentic_p5",
  });
}

function makeEnvelope(overrides: Partial<CaptureEnvelope> = {}): CaptureEnvelope {
  return {
    provider: "codex",
    hook_event_name: "SessionEnd",
    captured_at: "2026-08-07T15:00:00Z",
    workspace_root: "/synthetic/workspace",
    session_id: "session_agentic_p5",
    source_event_id: "source_agentic_p5_01",
    media_type: "application/json",
    subject_ref: "subject_p5_synthetic",
    payload: {
      transcript: "Fact: the offline density suite requires precision of at least 0.90.",
    },
    ...overrides,
  };
}

describe("P5 claim mapping", () => {
  it("maps fact_candidate and decision only", () => {
    expect(agenticKindToClaimType("fact_candidate")).toBe("factual");
    expect(agenticKindToClaimType("decision")).toBe("decision");
    expect(agenticKindToClaimType("constraint")).toBeNull();
    expect(materializeTargetsForKind("fact_candidate")).toEqual({
      observation: false,
      draft_claim: true,
    });
    expect(materializeTargetsForKind("decision")).toEqual({
      observation: true,
      draft_claim: true,
    });
    expect(materializeTargetsForKind("preference")).toEqual({
      observation: true,
      draft_claim: false,
    });
  });
});

describe("materializeAgenticProposal draft Claims (P5)", () => {
  it("writes draft factual Claim for fact_candidate without AcceptanceDecision", () => {
    const store = makeStore();
    const captured = store.captureHook(
      makeEnvelope({
        payload: {
          transcript: "Fact: the offline density suite requires precision of at least 0.90.",
        },
      }),
    );
    expect(captured.status).toBe("captured");
    if (captured.status !== "captured") throw new Error("capture failed");

    const agenticDb = new DatabaseSync(join(tempDir(), "agentic.sqlite"));
    const pipeline = runAgenticProposalPipeline(agenticDb, {
      trust_zone_id: store.trustZone.trust_zone_id,
      source_event_id: captured.event.event_id,
      hook_event_name: "SessionEnd",
      signal_text: "Fact: the offline density suite requires precision of at least 0.90.",
      hint_kind: "fact_candidate",
      artifact_id: captured.event.payload.artifact_id,
      subject_ref: "subject_p5_synthetic",
      now,
    });
    expect(pipeline.proposals.length).toBeGreaterThan(0);
    const proposal = pipeline.proposals[0]!;
    expect(proposal.candidate.kind).toBe("fact_candidate");

    const mat = materializeAgenticProposal({
      store,
      agenticDb,
      proposal,
      artifact_id: captured.event.payload.artifact_id,
      subject_ref: "subject_p5_synthetic",
    });
    expect(mat.ok).toBe(true);
    expect(mat.observation_event_id).toBeNull();
    expect(mat.observation_status).toBe("none");
    expect(mat.claim_event_id).toMatch(/^evt_/);
    expect(mat.claim_status).toBe("created");
    expect(mat.claim_type).toBe("factual");
    expect(mat.canonical_effect).toBe("draft_claim");
    expect(mat.reason_codes).toContain("materialized_draft_claim:factual");
    expect(mat.reason_codes).toContain("no_acceptance_decision");
    expect(mat.policy_version).toBe(AGENTIC_POLICY_VERSION);

    const snaps = store.listCanonicalEventSnapshots({
      visibleTrustZoneIds: [store.trustZone.trust_zone_id],
    });
    const claim = snaps.find((s) => s.event_id === mat.claim_event_id);
    expect(claim?.event.event_type).toBe("Claim");
    expect(claim?.event.lifecycle_status).toBe("draft");
    if (claim?.event.event_type === "Claim") {
      expect(claim.event.payload.claim_type).toBe("factual");
      expect(claim.event.payload.support.length).toBeGreaterThanOrEqual(1);
    }
    expect(snaps.some((s) => s.event.event_type === "AcceptanceDecision")).toBe(false);

    // Idempotent replay
    const again = materializeAgenticProposal({
      store,
      agenticDb,
      proposal: {
        ...proposal,
        materialized_event_id: mat.claim_event_id,
        materialized_claim_event_id: mat.claim_event_id,
      },
      artifact_id: captured.event.payload.artifact_id,
    });
    expect(again.claim_status).toBe("replay");
    expect(again.ok).toBe(true);

    store.close();
    agenticDb.close();
  });

  it("writes Observation + draft decision Claim for decision kind", () => {
    const store = makeStore();
    const captured = store.captureHook(
      makeEnvelope({
        source_event_id: "source_agentic_p5_decision",
        payload: {
          transcript: "Decision: we will require make preflight before opening any pull request.",
        },
      }),
    );
    if (captured.status !== "captured") throw new Error("capture failed");

    const agenticDb = new DatabaseSync(join(tempDir(), "agentic.sqlite"));
    const pipeline = runAgenticProposalPipeline(agenticDb, {
      trust_zone_id: store.trustZone.trust_zone_id,
      source_event_id: captured.event.event_id,
      hook_event_name: "SessionEnd",
      signal_text: "Decision: we will require make preflight before opening any pull request.",
      hint_kind: "decision",
      artifact_id: captured.event.payload.artifact_id,
      subject_ref: "subject_p5_decision",
      now,
    });
    const proposal = pipeline.proposals[0]!;
    expect(proposal.candidate.kind).toBe("decision");

    const mat = materializeAgenticProposal({
      store,
      agenticDb,
      proposal,
      artifact_id: captured.event.payload.artifact_id,
      subject_ref: "subject_p5_decision",
    });
    expect(mat.ok).toBe(true);
    expect(mat.observation_event_id).toMatch(/^evt_/);
    expect(mat.claim_event_id).toMatch(/^evt_/);
    expect(mat.claim_type).toBe("decision");
    expect(mat.canonical_effect).toBe("observation_and_draft_claim");
    expect(mat.reason_codes).toContain("materialized_draft_claim:decision");
    expect(mat.reason_codes).toContain("no_acceptance_decision");

    const snaps = store.listCanonicalEventSnapshots({
      visibleTrustZoneIds: [store.trustZone.trust_zone_id],
    });
    expect(snaps.some((s) => s.event.event_type === "Observation")).toBe(true);
    expect(snaps.some((s) => s.event.event_type === "Claim")).toBe(true);
    expect(snaps.some((s) => s.event.event_type === "AcceptanceDecision")).toBe(false);

    const claim = snaps.find((s) => s.event_id === mat.claim_event_id);
    if (claim?.event.event_type === "Claim") {
      expect(claim.event.lifecycle_status).toBe("draft");
      expect(claim.event.payload.claim_type).toBe("decision");
      // Supports observation + derived_from evidence source
      expect(claim.event.payload.support.some((r) => r.ref_id === mat.observation_event_id)).toBe(
        true,
      );
      expect(
        claim.event.payload.support.some(
          (r) => r.ref_id === captured.event.event_id && r.relationship === "derived_from",
        ),
      ).toBe(true);
    }

    store.close();
    agenticDb.close();
  });

  it("keeps constraint on Observation-only path (no Claim)", () => {
    const store = makeStore();
    const captured = store.captureHook(
      makeEnvelope({
        source_event_id: "source_agentic_p5_constraint",
        payload: {
          transcript: "Constraint: capture hooks must never call the network or an LLM.",
        },
      }),
    );
    if (captured.status !== "captured") throw new Error("capture failed");

    const agenticDb = new DatabaseSync(join(tempDir(), "agentic.sqlite"));
    const pipeline = runAgenticProposalPipeline(agenticDb, {
      trust_zone_id: store.trustZone.trust_zone_id,
      source_event_id: captured.event.event_id,
      hook_event_name: "SessionEnd",
      signal_text: "Constraint: capture hooks must never call the network or an LLM.",
      hint_kind: "constraint",
      artifact_id: captured.event.payload.artifact_id,
      now,
    });
    const proposal = pipeline.proposals[0]!;
    const mat = materializeAgenticProposal({
      store,
      agenticDb,
      proposal,
      artifact_id: captured.event.payload.artifact_id,
    });
    expect(mat.ok).toBe(true);
    expect(mat.observation_event_id).toMatch(/^evt_/);
    expect(mat.claim_event_id).toBeNull();
    expect(mat.canonical_effect).toBe("observation");

    const snaps = store.listCanonicalEventSnapshots({
      visibleTrustZoneIds: [store.trustZone.trust_zone_id],
    });
    expect(snaps.some((s) => s.event.event_type === "Claim")).toBe(false);
    expect(snaps.some((s) => s.event.event_type === "AcceptanceDecision")).toBe(false);

    store.close();
    agenticDb.close();
  });
});
