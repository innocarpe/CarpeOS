import { describe, expect, it } from "vitest";
import {
  buildRunLedgerEntry,
  completeRunLedgerEntry,
  linkEventsToRun,
} from "../src/run-ledger.js";

describe("run ledger", () => {
  it("tracks multi-round synthetic agent runs without canonical authority", () => {
    let entry = buildRunLedgerEntry({
      runId: "run_synthetic_alpha_001",
      agentId: "agent_synthetic",
      round: 0,
      startedAt: "2026-01-01T00:00:00Z",
      subjectRef: "subject_synthetic_project",
      eventIds: ["evt_claim_alpha_000000000000000001"],
    });

    expect(entry.canonical_effect).toBe("none");
    expect(entry.status).toBe("running");
    expect(entry.round).toBe(0);

    entry = linkEventsToRun(entry, [
      "evt_obs_beta_00000000000000000001",
      "evt_claim_alpha_000000000000000001",
    ]);
    expect(entry.event_ids).toEqual([
      "evt_claim_alpha_000000000000000001",
      "evt_obs_beta_00000000000000000001",
    ]);

    entry = {
      ...entry,
      round: 1,
    };
    const completed = completeRunLedgerEntry(entry, "2026-01-01T02:00:00Z");
    expect(completed.status).toBe("completed");
    expect(completed.ended_at).toBe("2026-01-01T02:00:00Z");
  });

  it("rejects invalid rounds", () => {
    expect(() =>
      buildRunLedgerEntry({
        round: -1,
        startedAt: "2026-01-01T00:00:00Z",
        subjectRef: "subject_synthetic_project",
      }),
    ).toThrow(/round/);
  });
});
