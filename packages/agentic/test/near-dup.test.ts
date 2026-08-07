import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { runAgenticProposalPipeline, normalizeStatementKey } from "../src/pipeline.js";

const now = new Date("2026-08-07T12:00:00Z");

describe("near-duplicate promote hold", () => {
  it("holds second identical decision within one extract pack", () => {
    const db = new DatabaseSync(":memory:");
    const quote = "Decision: we will require make preflight before opening any pull request.";
    const pack = `${quote}\n${quote}`;
    const r = runAgenticProposalPipeline(db, {
      trust_zone_id: "tz_near",
      source_event_id: "evt_near_1",
      hook_event_name: "SessionEnd",
      signal_text: pack,
      mode: "flash",
      allow_network: true,
      allow_auto_promote: true,
      agentic_enabled: true,
      now,
      flash_triage_text: JSON.stringify({
        decision: "keep",
        reason_codes: ["decision_class_signal"],
      }),
      flash_extract_text: JSON.stringify({
        candidates: [
          { kind: "decision", statement: quote, quote, confidence: 0.9 },
          { kind: "decision", statement: quote, quote, confidence: 0.88 },
        ],
      }),
    });
    const gates = r.proposals.map((p) => p.gate.decision);
    expect(gates.filter((g) => g === "promote").length).toBe(1);
    expect(gates.some((g) => g === "hold")).toBe(true);
    expect(
      r.proposals.some((p) => (p.gate.reason_codes ?? []).includes("near_duplicate_statement")),
    ).toBe(true);
    db.close();
  });

  it("normalizeStatementKey collapses case and whitespace", () => {
    expect(normalizeStatementKey("  We Will   require  ")).toBe("we will require");
  });
});

describe("cross-session near-duplicate promote hold", () => {
  it("holds when the same statement was already promoted recently in the zone", () => {
    const db = new DatabaseSync(":memory:");
    const quote = "Decision: we will require make preflight before opening any pull request.";
    const first = runAgenticProposalPipeline(db, {
      trust_zone_id: "tz_near",
      source_event_id: "evt_near_a",
      hook_event_name: "SessionEnd",
      signal_text: quote,
      mode: "flash",
      allow_network: true,
      allow_auto_promote: true,
      agentic_enabled: true,
      now,
      flash_triage_text: JSON.stringify({
        decision: "keep",
        reason_codes: ["decision_class_signal"],
      }),
      flash_extract_text: JSON.stringify({
        candidates: [{ kind: "decision", statement: quote, quote, confidence: 0.9 }],
      }),
    });
    expect(first.proposals.some((p) => p.gate.decision === "promote")).toBe(true);

    const second = runAgenticProposalPipeline(db, {
      trust_zone_id: "tz_near",
      source_event_id: "evt_near_b",
      hook_event_name: "SessionEnd",
      signal_text: quote,
      mode: "flash",
      allow_network: true,
      allow_auto_promote: true,
      agentic_enabled: true,
      now: new Date("2026-08-07T12:01:00Z"),
      flash_triage_text: JSON.stringify({
        decision: "keep",
        reason_codes: ["decision_class_signal"],
      }),
      flash_extract_text: JSON.stringify({
        candidates: [{ kind: "decision", statement: quote, quote, confidence: 0.91 }],
      }),
    });
    expect(second.proposals.some((p) => p.gate.decision === "promote")).toBe(false);
    expect(
      second.proposals.some((p) =>
        (p.gate.reason_codes ?? []).includes("near_duplicate_statement_recent"),
      ),
    ).toBe(true);
    db.close();
  });
});
