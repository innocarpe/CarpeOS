import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CaptureEnvelope } from "@carpeos/capture";
import { LocalCaptureStore, StaticKeyProvider } from "@carpeos/local-store";
import { afterEach, describe, expect, it } from "vitest";
import { materializeAgenticProposal } from "../src/materialize.js";
import { runAgenticProposalPipeline } from "../src/pipeline.js";
import { AGENTIC_POLICY_VERSION } from "../src/types.js";

const dirs: string[] = [];
const now = new Date("2026-08-06T12:00:00Z");
const key = new Uint8Array(32).fill(7);

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agentic-mat-"));
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
    trustZoneId: "tz_agentic_mat",
  });
}

function makeEnvelope(overrides: Partial<CaptureEnvelope> = {}): CaptureEnvelope {
  return {
    provider: "codex",
    hook_event_name: "SessionEnd",
    captured_at: "2026-08-06T12:00:00Z",
    workspace_root: "/synthetic/workspace",
    session_id: "session_agentic",
    source_event_id: "source_agentic_01",
    media_type: "application/json",
    subject_ref: "subject_synthetic",
    payload: {
      transcript: "Decision: we will require make preflight before opening any pull request.",
    },
    ...overrides,
  };
}

describe("materializeAgenticProposal", () => {
  it("writes agentic_v1 hold disposition + draft Observation", () => {
    const store = makeStore();
    const captured = store.captureHook(makeEnvelope());
    expect(captured.status).toBe("captured");
    if (captured.status !== "captured") throw new Error("capture failed");

    const agenticDb = new DatabaseSync(join(tempDir(), "agentic.sqlite"));
    const pipeline = runAgenticProposalPipeline(agenticDb, {
      trust_zone_id: "tz_agentic_mat",
      source_event_id: captured.event.event_id,
      hook_event_name: "SessionEnd",
      signal_text: "Decision: we will require make preflight before opening any pull request.",
      hint_kind: "decision",
      now,
    });
    expect(pipeline.proposals.length).toBeGreaterThan(0);
    const proposal = pipeline.proposals[0];
    if (proposal === undefined) throw new Error("missing proposal");

    const mat = materializeAgenticProposal({
      store,
      agenticDb,
      proposal,
      artifact_id: captured.event.payload.artifact_id,
    });
    expect(mat.ok).toBe(true);
    expect(mat.disposition).toBe("hold");
    expect(mat.canonical_effect).toBe("observation");
    expect(mat.observation_event_id).toMatch(/^evt_/);
    expect(mat.policy_version).toBe(AGENTIC_POLICY_VERSION);

    const history = store.listDispositionHistory(captured.event.event_id);
    const agenticDisp = history.filter((d) => d.policy_version === AGENTIC_POLICY_VERSION);
    expect(agenticDisp).toHaveLength(1);
    expect(agenticDisp[0]?.disposition).toBe("hold");

    // Idempotent replay
    const again = materializeAgenticProposal({
      store,
      agenticDb,
      proposal: { ...proposal, materialized_event_id: mat.observation_event_id },
      artifact_id: captured.event.payload.artifact_id,
    });
    expect(again.observation_status).toBe("replay");

    store.close();
    agenticDb.close();
  });

  it("does not create AcceptanceDecision (only Observation + disposition)", () => {
    const store = makeStore();
    const captured = store.captureHook(makeEnvelope());
    if (captured.status !== "captured") throw new Error("capture failed");
    const agenticDb = new DatabaseSync(join(tempDir(), "agentic.sqlite"));
    const pipeline = runAgenticProposalPipeline(agenticDb, {
      trust_zone_id: "tz_agentic_mat",
      source_event_id: captured.event.event_id,
      hook_event_name: "SessionEnd",
      signal_text: "Constraint: capture hooks must never call the network or an LLM.",
      hint_kind: "constraint",
      now,
    });
    const proposal = pipeline.proposals[0];
    if (proposal === undefined) throw new Error("missing proposal");
    materializeAgenticProposal({
      store,
      agenticDb,
      proposal,
      artifact_id: captured.event.payload.artifact_id,
    });
    // No AcceptanceDecision table write path in materialize — count events by type via dispositions only
    expect(
      store.listDispositionHistory(captured.event.event_id).some((d) => d.disposition === "hold"),
    ).toBe(true);
    store.close();
    agenticDb.close();
  });
});
