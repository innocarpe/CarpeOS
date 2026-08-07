import { describe, expect, it } from "vitest";
import { extractSignalTextFromCapturePayload } from "../src/store.js";

describe("denser host adapters (agentic signal extract)", () => {
  it("reads flat Claude-style transcript", () => {
    const text = extractSignalTextFromCapturePayload({
      transcript: "Decision: we will require make preflight before opening any pull request.",
    });
    expect(text).toMatch(/preflight/i);
  });

  it("reads nested Cursor-style message.content", () => {
    const text = extractSignalTextFromCapturePayload({
      payload: {
        message: {
          content: "Decision: we will require make preflight before opening any pull request.",
        },
      },
    });
    expect(text).toMatch(/preflight/i);
  });

  it("reads Codex-style final_message / output_text aliases", () => {
    const text = extractSignalTextFromCapturePayload({
      final_message: "Constraint: capture hooks must never call the network during SessionEnd.",
    });
    expect(text).toMatch(/must never call the network/i);
    const text2 = extractSignalTextFromCapturePayload({
      data: { output_text: "Preference: we prefer make preflight over ad-hoc lint." },
    });
    expect(text2).toMatch(/prefer make preflight/i);
  });

  it("reads content block arrays", () => {
    const text = extractSignalTextFromCapturePayload({
      message: {
        content: [
          { type: "text", text: "Decision: we will require make preflight before any PR." },
          { type: "tool_use", name: "bash" },
        ],
      },
    });
    expect(text).toMatch(/preflight/i);
  });

  it("does not stringify metadata-only envelopes", () => {
    const text = extractSignalTextFromCapturePayload({
      hook_event_name: "SessionEnd",
      session_id: "sess_meta_only",
      agent_type: "claude",
    });
    expect(text).toBe("");
  });
});
