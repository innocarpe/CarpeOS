import { describe, expect, it } from "vitest";
import { evaluateAgenticGate } from "../src/gate.js";
import type { AgenticExtractCandidate } from "../src/types.js";
import { verifyExtractCandidate } from "../src/verify.js";

const pack = "We decided to require make preflight before every PR.";

function candidate(overrides: Partial<AgenticExtractCandidate> = {}): AgenticExtractCandidate {
  return {
    kind: "decision",
    statement: "Require make preflight before every PR.",
    confidence: 0.99,
    citations: [
      {
        evidence_event_id: "evt_synthetic_1",
        segment_id: "seg_0",
        start: 0,
        end: pack.length,
        quote: "require make preflight before every PR",
      },
    ],
    ...overrides,
  };
}

describe("verifyExtractCandidate", () => {
  it("accepts quotes present in pack text", () => {
    const v = verifyExtractCandidate(candidate(), pack);
    expect(v.cite_ok).toBe(true);
    expect(v.secret_ok).toBe(true);
  });

  it("rejects missing citations", () => {
    const v = verifyExtractCandidate(candidate({ citations: [] }), pack);
    expect(v.cite_ok).toBe(false);
  });

  it("rejects secret-like statements", () => {
    const v = verifyExtractCandidate(
      candidate({ statement: "api_key sk-abcdefghijklmnopqrstuv" }),
      pack,
    );
    expect(v.secret_ok).toBe(false);
  });
});

describe("evaluateAgenticGate", () => {
  it("hold-first by default even with high model confidence", () => {
    const g = evaluateAgenticGate({
      candidate: candidate(),
      cite_ok: true,
      secret_ok: true,
    });
    expect(g.decision).toBe("hold");
    expect(g.reason_codes).toContain("hold_first_default");
    expect(g.policy_version).toBe("agentic_v1");
  });

  it("rejects when cite fails", () => {
    const g = evaluateAgenticGate({
      candidate: candidate(),
      cite_ok: false,
      secret_ok: true,
    });
    expect(g.decision).toBe("reject");
  });

  it("auto-promote only when explicitly enabled and allowlisted", () => {
    const g = evaluateAgenticGate({
      candidate: candidate(),
      cite_ok: true,
      secret_ok: true,
      allow_auto_promote: true,
    });
    expect(g.decision).toBe("promote");
  });
});
