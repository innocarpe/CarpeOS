import { describe, expect, it } from "vitest";
import {
  buildMetadataObservationStatement,
  extractionObservationIdempotencyKey,
  planObservationExtraction,
} from "../src/extract-observation.js";

describe("extract-observation", () => {
  it("builds safe metadata statements without secrets", () => {
    const statement = buildMetadataObservationStatement({
      provider: "claude",
      hook_event_name: "SessionEnd",
      kind: "transcript",
      media_type: "application/json",
      subject_ref: "subject_demo",
    });
    expect(statement).toContain("claude");
    expect(statement).toContain("SessionEnd");
    expect(statement).toContain("subject_demo");
    expect(statement).not.toContain("sk-");
  });

  it("plans Observation for eligible hooks and skips PostToolUse", () => {
    const plan = planObservationExtraction({
      provider: "codex",
      hook_event_name: "Stop",
      kind: "transcript",
      media_type: "application/json",
      subject_ref: "proj",
    });
    expect(plan.status).toBe("extract");
    if (plan.status === "extract") {
      expect(plan.target).toBe("observation");
      expect(plan.statement.length).toBeGreaterThan(0);
    }

    const skip = planObservationExtraction({
      provider: "codex",
      hook_event_name: "PostToolUse",
      kind: "transcript",
      media_type: "application/json",
      subject_ref: "proj",
    });
    expect(skip.status).toBe("skip");
  });

  it("derives stable idempotency keys per source event", () => {
    const a = extractionObservationIdempotencyKey("evt_abc1234567890");
    const b = extractionObservationIdempotencyKey("evt_abc1234567890");
    const c = extractionObservationIdempotencyKey("evt_other00000000");
    expect(a).toMatch(/^idem_[a-f0-9]{32}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
