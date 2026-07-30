import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalCaptureStore, StaticKeyProvider } from "@carpeos/local-store";
import type {
  CanonicalEvent,
  ErasureLedgerRecord,
  ProvenanceRef,
  TrustZone,
} from "@carpeos/schema";
import { validateConformance } from "@carpeos/schema";
import { afterEach, describe, expect, it } from "vitest";
import { createCarpeosMcpApplication } from "../src/server.js";
import { CARPEOS_MCP_TOOLS } from "../src/tools.js";

const trustZone: TrustZone = { trust_zone_id: "tz_mcp_synthetic", isolation: "local_device" };
const key = new Uint8Array(32).fill(12);
const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("CarpeOS MCP in-process application", () => {
  it("exposes the exact deterministic tool list", () => {
    expect(CARPEOS_MCP_TOOLS).toEqual([
      "memory_search",
      "memory_get",
      "memory_context_pack",
      "memory_trace",
      "memory_timeline",
      "memory_related",
      "memory_capture",
      "memory_propose_claim",
    ]);
  });

  it("fails closed for malformed input and hidden trust zones", async () => {
    const { app } = makeHarness();
    const malformed = await app.dispatch("memory_search", {
      visibility: visible(),
      query: "Alpha",
    });
    expect(malformed.isError).toBe(true);
    expect(malformed.structuredContent.error).toMatchObject({ code: "invalid_schema" });

    const hidden = await app.dispatch("memory_timeline", {
      schema_version: "v1",
      visibility: visible(["tz_hidden_synthetic"]),
      context_budget: budget(),
    });
    expect(hidden.isError).toBe(true);
    expect(hidden.structuredContent.error).toMatchObject({ code: "unauthorized" });
  });

  it("returns budgeted deterministic search/get/timeline/trace/related records without protected plaintext", async () => {
    const { app } = makeHarnessWithContext();
    const first = await app.dispatch("memory_search", {
      schema_version: "v1",
      visibility: visible(),
      query: "Alpha",
      context_budget: { max_items: 2, max_characters: 600 },
    });
    const second = await app.dispatch("memory_search", {
      schema_version: "v1",
      visibility: visible(),
      query: "Alpha",
      context_budget: { max_items: 2, max_characters: 600 },
    });
    expect(first.structuredContent).toEqual(second.structuredContent);
    expect(first.structuredContent.budget).toMatchObject({ truncated: true });
    expect(first.text).not.toContain("SYNTHETIC_PRIVATE_CAPTURE_SENTINEL");

    const timeline = await app.dispatch("memory_timeline", {
      schema_version: "v1",
      visibility: visible(),
      context_budget: budget(),
    });
    const repeatedTimeline = await app.dispatch("memory_timeline", {
      schema_version: "v1",
      visibility: visible(),
      context_budget: budget(),
    });
    expect(timeline.structuredContent.records).toEqual(repeatedTimeline.structuredContent.records);

    for (const tool of ["memory_get", "memory_trace", "memory_related"] as const) {
      const result = await app.dispatch(tool, {
        schema_version: "v1",
        visibility: visible(),
        record_id: "evt_claim_alpha_000000000000000001",
        context_budget: budget(),
      });
      expect(result.isError).toBe(false);
      expect(result.text).not.toContain("SYNTHETIC_PRIVATE_CAPTURE_SENTINEL");
    }
  });

  it("keeps draft Observations out of default memory_search and includes them when include_held is true", async () => {
    const { app, store } = makeHarness();
    const evidence = store.captureHook(
      {
        provider: "codex",
        hook_event_name: "SessionEnd",
        captured_at: "2026-01-01T00:00:00Z",
        workspace_root: "/synthetic/workspace",
        session_id: "session_mcp_held_search_seed",
        payload: { message: "seed evidence for held search opt-in" },
      },
      { extract: false },
    );
    const held = store.proposeObservationDraft({
      statement: "heldtoken synthetic held draft observation for opt-in search.",
      evidenceArtifactRefs: [evidence.event.payload.artifact_id],
      sourceEventId: evidence.event.event_id,
      lifecycleStatus: "draft",
    });
    store.proposeObservationDraft({
      statement: "promotetoken synthetic promoted observation for baseline search.",
      evidenceArtifactRefs: [evidence.event.payload.artifact_id],
      sourceEventId: evidence.event.event_id,
      lifecycleStatus: "active",
      idempotencyKey: "idem_mcp_promote_held_search_0001",
    });
    if (held.status !== "extracted" && held.status !== "replay") {
      throw new Error("expected held observation");
    }
    const heldEventId = held.event.event_id;

    const defaultSearch = await app.dispatch("memory_search", {
      schema_version: "v1",
      visibility: visible(),
      query: "heldtoken",
      context_budget: { max_items: 10, max_characters: 4000 },
    });
    expect(defaultSearch.isError).toBe(false);
    const defaultRecords = defaultSearch.structuredContent.records as Array<{
      record_id?: string;
      lifecycle_status?: string;
    }>;
    expect(defaultRecords.some((record) => record.record_id === heldEventId)).toBe(false);
    expect(defaultRecords.some((record) => record.lifecycle_status === "draft")).toBe(false);

    const heldSearch = await app.dispatch("memory_search", {
      schema_version: "v1",
      visibility: visible(),
      query: "heldtoken",
      include_held: true,
      context_budget: { max_items: 10, max_characters: 4000 },
    });
    expect(heldSearch.isError).toBe(false);
    const heldRecords = heldSearch.structuredContent.records as Array<{
      record_id?: string;
      lifecycle_status?: string;
    }>;
    expect(heldRecords.some((record) => record.record_id === heldEventId)).toBe(true);
    expect(heldRecords.some((record) => record.lifecycle_status === "draft")).toBe(true);

    const defaultPack = await app.dispatch("memory_context_pack", {
      schema_version: "v1",
      visibility: visible(),
      task: "heldtoken",
      context_budget: { max_items: 50, max_characters: 20_000 },
    });
    const defaultObs = defaultPack.structuredContent.observations as Array<{ record_id?: string }>;
    expect(defaultObs.some((record) => record.record_id === heldEventId)).toBe(false);

    const heldPack = await app.dispatch("memory_context_pack", {
      schema_version: "v1",
      visibility: visible(),
      task: "heldtoken",
      include_held: true,
      context_budget: { max_items: 50, max_characters: 20_000 },
    });
    const heldObs = heldPack.structuredContent.observations as Array<{ record_id?: string }>;
    expect(heldObs.some((record) => record.record_id === heldEventId)).toBe(true);
  });

  it("classifies accepted, draft, rejected, conflict, superseded, erased, and redacted context separately", async () => {
    const { app } = makeHarnessWithContext();
    const result = await app.dispatch("memory_context_pack", {
      schema_version: "v1",
      visibility: visible(undefined, "deny"),
      task: "Summarize Alpha",
      context_budget: { max_items: 50, max_characters: 20_000 },
    });
    const output = result.structuredContent;
    expect(output.accepted_facts).toEqual([
      expect.objectContaining({
        claim_event_id: "evt_claim_alpha_000000000000000001",
        acceptance_decision_event_id: "evt_accept_alpha_00000000000000001",
      }),
    ]);
    expect(output.draft_claims).toEqual([
      expect.objectContaining({ claim_event_id: "evt_claim_draft_000000000000000001" }),
    ]);
    expect(output.rejected_claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ claim_event_id: "evt_claim_reject_00000000000000001" }),
      ]),
    );
    expect(output.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ record_id: "evt_claim_conflict_0000000000000001" }),
      ]),
    );
    expect(output.supersessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ record_id: "evt_super_beta_000000000000000001" }),
      ]),
    );
    expect(output.erasures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ record_id: "era_claim_erased_00000000000000001" }),
      ]),
    );
    expect(output.redactions).toContain("protected_value:evt_claim_private_000000000000001");
    const acceptedFactIds = (output.accepted_facts as Array<{ claim_event_id: string }>).map(
      (fact) => fact.claim_event_id,
    );
    expect(acceptedFactIds).not.toEqual(
      expect.arrayContaining([
        "evt_claim_decision_erased_000000000001",
        "evt_claim_support_erased_0000000000001",
        "evt_claim_decision_super_0000000000001",
        "evt_claim_support_super_00000000000001",
        "evt_claim_contradict_0000000000000001",
        "evt_claim_unverified_0000000000000001",
      ]),
    );
    expect(output.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ record_id: "evt_claim_contradict_0000000000000001" }),
      ]),
    );
    const conformance = validateConformance("mcpApi", output);
    expect(conformance.errors).toEqual([]);
  });

  it("applies valid_time and recorded_time filters before context pack and timeline output", async () => {
    const { app } = makeHarnessWithContext();
    const outsideValid = await app.dispatch("memory_context_pack", {
      schema_version: "v1",
      visibility: visible(),
      task: "Summarize outside valid window",
      valid_time: { start: "2025-01-01T00:00:00Z", end: "2025-12-31T23:59:59Z" },
      context_budget: { max_items: 50, max_characters: 20_000 },
    });
    expect(outsideValid.structuredContent.accepted_facts).toEqual([]);
    expect(outsideValid.structuredContent.observations).toEqual([]);

    const missingDecision = await app.dispatch("memory_context_pack", {
      schema_version: "v1",
      visibility: visible(),
      task: "Summarize without accepted decision in recorded window",
      recorded_time: { start: "2026-01-01T00:03:00Z", end: "2026-01-01T00:03:30Z" },
      context_budget: { max_items: 50, max_characters: 20_000 },
    });
    expect(missingDecision.structuredContent.accepted_facts).toEqual([]);

    const timeline = await app.dispatch("memory_timeline", {
      schema_version: "v1",
      visibility: visible(),
      recorded_time: { start: "2026-01-01T00:04:00Z", end: "2026-01-01T00:04:30Z" },
      context_budget: { max_items: 50, max_characters: 20_000 },
    });
    expect(timeline.structuredContent.records).toEqual([
      expect.objectContaining({ record_id: "evt_accept_alpha_00000000000000001" }),
    ]);
  });

  it("captures idempotently and proposes draft claims without acceptance decisions", async () => {
    const { app, store } = makeHarnessWithContext();
    const captureInput = {
      schema_version: "v1",
      visibility: visible(),
      provider: "synthetic",
      hook_event_name: "Capture",
      captured_at: "2026-01-01T00:30:00Z",
      media_type: "application/json",
      subject_ref: "subject_alpha",
      payload: { note: "SYNTHETIC_PRIVATE_CAPTURE_SENTINEL" },
      idempotency_key: "idem_mcp_capture_00000001",
    };
    const captured = await app.dispatch("memory_capture", captureInput);
    const replay = await app.dispatch("memory_capture", captureInput);
    expect(captured.structuredContent.status).toBe("captured");
    expect(replay.structuredContent.status).toBe("replay");

    const proposed = await app.dispatch("memory_propose_claim", {
      schema_version: "v1",
      visibility: visible(),
      statement: "Synthetic MCP draft claim.",
      support: [
        {
          ref_type: "event",
          ref_id: "evt_observe_alpha_000000000000001",
          relationship: "supports",
        },
      ],
      idempotency_key: "idem_mcp_propose_00000001",
    });
    const proposedReplay = await app.dispatch("memory_propose_claim", {
      schema_version: "v1",
      visibility: visible(),
      statement: "Synthetic MCP draft claim.",
      support: [
        {
          ref_type: "event",
          ref_id: "evt_observe_alpha_000000000000001",
          relationship: "supports",
        },
      ],
      idempotency_key: "idem_mcp_propose_00000001",
    });
    expect(proposed.structuredContent).toMatchObject({
      status: "proposed",
      lifecycle_status: "draft",
      acceptance_decision_event_ids: [],
    });
    expect(proposedReplay.structuredContent.status).toBe("replay");
    expect(store.listCanonicalEventSnapshots({ eventTypes: ["AcceptanceDecision"] })).toHaveLength(
      10,
    );
  });

  it("returns explicit failed write errors without replay status or fake identifiers", async () => {
    const { app } = makeHarnessWithContext();
    const failedCapture = await app.dispatch("memory_capture", {
      schema_version: "v1",
      visibility: visible(["tz_hidden_synthetic"]),
      provider: "synthetic",
      hook_event_name: "Capture",
      captured_at: "2026-01-01T00:30:00Z",
      media_type: "application/json",
      subject_ref: "subject_alpha",
      payload: {},
    });
    expect(failedCapture.isError).toBe(true);
    expect(failedCapture.structuredContent).toEqual({
      schema_version: "v1",
      tool: "memory_capture",
      error: expect.objectContaining({ code: "unauthorized" }),
    });
    expect(failedCapture.structuredContent).not.toHaveProperty("status");
    expect(failedCapture.structuredContent).not.toHaveProperty("event_id");

    const failedPropose = await app.dispatch("memory_propose_claim", {
      schema_version: "v1",
      visibility: visible(),
      statement: "Synthetic unsupported claim.",
      support: [{ ref_type: "event", ref_id: "evt_missing_support", relationship: "supports" }],
    });
    expect(failedPropose.isError).toBe(true);
    expect(failedPropose.structuredContent).toEqual({
      schema_version: "v1",
      tool: "memory_propose_claim",
      error: expect.objectContaining({ code: "not_found" }),
    });
    expect(failedPropose.structuredContent).not.toHaveProperty("status");
    expect(failedPropose.structuredContent).not.toHaveProperty("event_id");
    expect(failedPropose.structuredContent).not.toHaveProperty("claim_id");
  });
});

function makeHarness() {
  const runtimeDir = mkdtempSync(join(tmpdir(), "carpeos-mcp-test-"));
  createdDirs.push(runtimeDir);
  const store = new LocalCaptureStore({
    runtimeDir,
    dbPath: join(runtimeDir, "carpeos.sqlite"),
    workspaceRoot: runtimeDir,
    trustZoneId: trustZone.trust_zone_id,
    keyProvider: new StaticKeyProvider(key),
    clock: { now: () => new Date("2026-01-01T00:20:00Z") },
  });
  const app = createCarpeosMcpApplication({
    store,
    config: { visibleTrustZoneIds: [trustZone.trust_zone_id] },
  });
  return { app, store, runtimeDir };
}

function makeHarnessWithContext() {
  const harness = makeHarness();
  seedEvents(harness.store);
  return harness;
}

function seedEvents(store: LocalCaptureStore): void {
  const evidence = store.captureHook({
    provider: "synthetic",
    hook_event_name: "Source",
    captured_at: "2026-01-01T00:00:30Z",
    media_type: "application/json",
    subject_ref: "subject_alpha",
    payload: { transcript: "SYNTHETIC_PRIVATE_CAPTURE_SENTINEL" },
    idempotency_key: "idem_mcp_evidence_0000001",
  });
  store.importPulledEvent(
    observation("evt_observe_alpha_000000000000001", "obs_alpha", 2, "Alpha source observation.", [
      evidence.event.payload.artifact_id,
    ]),
  );
  store.importPulledEvent(
    claim(
      "evt_claim_alpha_000000000000000001",
      "claim_alpha",
      3,
      "Alpha accepted fact.",
      "active",
      [{ ref_type: "observation", ref_id: "obs_alpha", relationship: "supports" }],
    ),
  );
  store.importPulledEvent(
    decision("evt_accept_alpha_00000000000000001", "decision_accept_alpha", 4, "accepted", [
      "claim_alpha",
    ]),
  );
  store.importPulledEvent(
    claim("evt_claim_draft_000000000000000001", "claim_draft", 5, "Alpha draft claim.", "draft"),
  );
  store.importPulledEvent(
    claim(
      "evt_claim_reject_00000000000000001",
      "claim_reject",
      6,
      "Alpha rejected claim.",
      "active",
    ),
  );
  store.importPulledEvent(
    decision("evt_reject_alpha_00000000000000001", "decision_reject_alpha", 7, "rejected", [
      "claim_reject",
    ]),
  );
  store.importPulledEvent(
    claim(
      "evt_claim_conflict_0000000000000001",
      "claim_conflict",
      8,
      "Alpha conflicting claim.",
      "active",
    ),
  );
  store.importPulledEvent(
    decision("evt_accept_conflict_000000000000001", "decision_accept_conflict", 9, "accepted", [
      "claim_conflict",
    ]),
  );
  store.importPulledEvent(
    decision("evt_reject_conflict_000000000000001", "decision_reject_conflict", 10, "rejected", [
      "claim_conflict",
    ]),
  );
  store.importPulledEvent(
    claim(
      "evt_claim_beta_old_0000000000000001",
      "claim_beta_old",
      11,
      "Beta superseded claim.",
      "active",
    ),
  );
  store.importPulledEvent(
    supersession("evt_super_beta_000000000000000001", 12, "evt_claim_beta_old_0000000000000001"),
  );
  store.importPulledEvent(
    claim(
      "evt_claim_erased_00000000000000001",
      "claim_erased",
      13,
      "Alpha erased claim.",
      "active",
    ),
  );
  store.importPulledErasure(
    erasure("era_claim_erased_00000000000000001", 14, "evt_claim_erased_00000000000000001"),
  );
  store.importPulledEvent(
    claim(
      "evt_claim_private_000000000000001",
      "claim_private",
      15,
      "Private supported claim.",
      "active",
      [{ ref_type: "event", ref_id: evidence.event.event_id, relationship: "supports" }],
    ),
  );
  store.importPulledEvent(
    claim(
      "evt_claim_decision_erased_000000000001",
      "claim_decision_erased",
      16,
      "Decision-erased claim must not become accepted.",
      "active",
    ),
  );
  store.importPulledEvent(
    decision("evt_accept_decision_erased_000000001", "decision_accept_erased", 17, "accepted", [
      "claim_decision_erased",
    ]),
  );
  store.importPulledErasure(
    erasure("era_decision_erased_000000000000001", 18, "evt_accept_decision_erased_000000001"),
  );
  store.importPulledEvent(
    observation("evt_support_erased_000000000000001", "obs_support_erased", 19, "Erased support.", [
      evidence.event.payload.artifact_id,
    ]),
  );
  store.importPulledEvent(
    claim(
      "evt_claim_support_erased_0000000000001",
      "claim_support_erased",
      20,
      "Support-erased claim must not become accepted.",
      "active",
      [{ ref_type: "observation", ref_id: "obs_support_erased", relationship: "supports" }],
    ),
  );
  store.importPulledEvent(
    decision(
      "evt_accept_support_erased_000000001",
      "decision_accept_support_erased",
      21,
      "accepted",
      ["claim_support_erased"],
    ),
  );
  store.importPulledErasure(
    erasure("era_support_erased_000000000000001", 22, "evt_support_erased_000000000000001"),
  );
  store.importPulledEvent(
    claim(
      "evt_claim_decision_super_0000000000001",
      "claim_decision_super",
      23,
      "Decision-superseded claim must not become accepted.",
      "active",
    ),
  );
  store.importPulledEvent(
    decision("evt_accept_decision_super_000000001", "decision_accept_super", 24, "accepted", [
      "claim_decision_super",
    ]),
  );
  store.importPulledEvent(
    supersession(
      "evt_super_decision_0000000000000001",
      25,
      "evt_accept_decision_super_000000001",
      "super_decision",
    ),
  );
  store.importPulledEvent(
    observation(
      "evt_support_super_0000000000000001",
      "obs_support_super",
      26,
      "Superseded support.",
      [evidence.event.payload.artifact_id],
    ),
  );
  store.importPulledEvent(
    claim(
      "evt_claim_support_super_00000000000001",
      "claim_support_super",
      27,
      "Support-superseded claim must not become accepted.",
      "active",
      [{ ref_type: "observation", ref_id: "obs_support_super", relationship: "supports" }],
    ),
  );
  store.importPulledEvent(
    decision(
      "evt_accept_support_super_000000001",
      "decision_accept_support_super",
      28,
      "accepted",
      ["claim_support_super"],
    ),
  );
  store.importPulledEvent(
    supersession(
      "evt_super_support_0000000000000001",
      29,
      "evt_support_super_0000000000000001",
      "super_support",
    ),
  );
  store.importPulledEvent(
    claim(
      "evt_claim_contradict_0000000000000001",
      "claim_contradict",
      30,
      "Contradicting-support claim must not become accepted.",
      "active",
      [{ ref_type: "observation", ref_id: "obs_alpha", relationship: "contradicts" }],
    ),
  );
  store.importPulledEvent(
    decision("evt_accept_contradict_000000000001", "decision_accept_contradict", 31, "accepted", [
      "claim_contradict",
    ]),
  );
  store.importPulledEvent(
    claim(
      "evt_claim_unverified_0000000000000001",
      "claim_unverified",
      32,
      "Unverified claim must not become accepted.",
      "active",
      undefined,
      "unverified",
    ),
  );
  store.importPulledEvent(
    decision("evt_accept_unverified_000000000001", "decision_accept_unverified", 33, "accepted", [
      "claim_unverified",
    ]),
  );
}

function visible(
  zones: string[] | undefined = [trustZone.trust_zone_id],
  protected_value_policy: "metadata_only" | "allow_decrypt" | "deny" = "metadata_only",
) {
  return { visible_trust_zone_ids: zones, protected_value_policy };
}

function budget() {
  return { max_items: 20, max_characters: 20_000 };
}

function base(sequence: number) {
  return {
    schema_version: "v1" as const,
    subject_ref: "subject_alpha",
    valid_time: { start: "2026-01-01T00:00:00Z", end: null },
    recorded_time: { start: `2026-01-01T00:${String(sequence).padStart(2, "0")}:00Z`, end: null },
    epistemic_authority: "derived" as const,
    trust_zone: trustZone,
    provenance: [
      { ref_type: "external", ref_id: "external_synthetic", relationship: "supports" },
    ] satisfies ProvenanceRef[],
    idempotency_key: `idem_mcp_event_${String(sequence).padStart(8, "0")}`,
    request_fingerprint: `sha-256:${String(sequence % 10).repeat(64)}`,
    zone_sequence: sequence,
  };
}

function observation(
  event_id: string,
  observation_id: string,
  sequence: number,
  statement: string,
  evidence_artifact_refs: string[],
): CanonicalEvent<"Observation"> {
  return {
    ...base(sequence),
    event_id,
    event_type: "Observation",
    lifecycle_status: "active",
    epistemic_authority: "observed",
    payload: {
      observation_id,
      observed_at: "2026-01-01T00:00:00Z",
      statement,
      evidence_artifact_refs,
    },
  };
}

function claim(
  event_id: string,
  claim_id: string,
  sequence: number,
  statement: string,
  lifecycle_status: "active" | "draft",
  support: ProvenanceRef[] = [
    { ref_type: "external", ref_id: "external_synthetic", relationship: "supports" },
  ],
  epistemic_authority: CanonicalEvent["epistemic_authority"] = "derived",
): CanonicalEvent<"Claim"> {
  return {
    ...base(sequence),
    event_id,
    event_type: "Claim",
    lifecycle_status,
    epistemic_authority,
    payload: { claim_id, statement, claim_type: "inference", support },
  };
}

function decision(
  event_id: string,
  decision_id: string,
  sequence: number,
  decisionValue: "accepted" | "rejected",
  claim_refs: string[],
): CanonicalEvent<"AcceptanceDecision"> {
  return {
    ...base(sequence),
    event_id,
    event_type: "AcceptanceDecision",
    lifecycle_status: "active",
    epistemic_authority: "verified",
    payload: {
      decision_id,
      claim_refs,
      decision: decisionValue,
      decided_by: "actor_synthetic",
      decided_at: "2026-01-01T00:00:00Z",
    },
  };
}

function supersession(
  event_id: string,
  sequence: number,
  supersedes_event_id: string,
  supersession_id = "super_beta",
): CanonicalEvent<"Supersession"> {
  return {
    ...base(sequence),
    event_id,
    event_type: "Supersession",
    lifecycle_status: "active",
    payload: {
      supersession_id,
      supersedes_event_id,
      reason: "synthetic replacement",
    },
  };
}

function erasure(erasure_id: string, sequence: number, target_id: string): ErasureLedgerRecord {
  return {
    schema_version: "v1",
    erasure_id,
    requested_at: "2026-01-01T00:00:00Z",
    completed_at: "2026-01-01T00:00:01Z",
    actor_ref: "actor_synthetic",
    trust_zone: trustZone,
    zone_sequence: sequence,
    evidence_refs: [{ ref_type: "external", ref_id: "external_erasure", relationship: "supports" }],
    method: "tombstone",
    target_ref: { target_kind: "event", target_id, reason: "synthetic erasure" },
  };
}
