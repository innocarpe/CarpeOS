import { describe, expect, it } from "vitest";
import { evaluateAgenticGate } from "../src/gate.js";
import type { AgenticExtractCandidate } from "../src/types.js";
import { verifyExtractCandidate } from "../src/verify.js";

const pack = "We decided to require make preflight before every PR.";

function candidate(overrides: Partial<AgenticExtractCandidate> = {}): AgenticExtractCandidate {
  return {
    kind: "decision",
    statement: "require make preflight before every PR",
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
  it("accepts quotes present in pack text when statement grounded", () => {
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

  it("rejects fabricated statement with real quote substring (ADR 0018 D3.1)", () => {
    const v = verifyExtractCandidate(
      candidate({
        statement: "We decided to disable the sync credential check immediately",
        citations: [
          {
            evidence_event_id: "evt_synthetic_1",
            segment_id: "seg_0",
            start: 0,
            end: 12,
            quote: "We decided",
          },
        ],
      }),
      pack,
    );
    expect(v.cite_ok).toBe(false);
    expect(v.reason_codes.some((c) => c.includes("ground") || c.includes("longer"))).toBe(true);
  });
});

describe("evaluateAgenticGate promote-when-verified", () => {
  it("promotes allowlisted verified decision by default (HITL-free)", () => {
    const g = evaluateAgenticGate({
      candidate: candidate(),
      cite_ok: true,
      secret_ok: true,
    });
    expect(g.decision).toBe("promote");
    expect(g.reason_codes).toContain("promote_when_verified");
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

  it("holds procedure (v1 hold-biased)", () => {
    const g = evaluateAgenticGate({
      candidate: candidate({ kind: "procedure" }),
      cite_ok: true,
      secret_ok: true,
    });
    expect(g.decision).toBe("hold");
    expect(g.reason_codes).toContain("procedure_hold_biased_v1");
  });

  it("holds fact_candidate (not v1 usable allowlist)", () => {
    const g = evaluateAgenticGate({
      candidate: candidate({ kind: "fact_candidate" }),
      cite_ok: true,
      secret_ok: true,
    });
    expect(g.decision).toBe("hold");
  });

  it("hold_first debug override forces hold", () => {
    const g = evaluateAgenticGate({
      candidate: candidate(),
      cite_ok: true,
      secret_ok: true,
      hold_first: true,
    });
    expect(g.decision).toBe("hold");
    expect(g.reason_codes).toContain("hold_first_debug_override");
  });
});
