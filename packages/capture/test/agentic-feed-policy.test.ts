import { describe, expect, it } from "vitest";
import { isAgenticFeedHookEligible, normalizeAgenticFeedHook } from "../src/agentic-feed-policy.js";

describe("agentic feed hook policy", () => {
  it("admits lifecycle hooks under any common spelling", () => {
    expect(isAgenticFeedHookEligible("SessionEnd")).toBe(true);
    expect(isAgenticFeedHookEligible("session_end")).toBe(true);
    expect(isAgenticFeedHookEligible("Stop")).toBe(true);
    expect(isAgenticFeedHookEligible("pre_compact")).toBe(true);
    expect(isAgenticFeedHookEligible("PreCompact")).toBe(true);
  });

  it("rejects PostToolUse flood and other non-lifecycle hooks", () => {
    expect(isAgenticFeedHookEligible("PostToolUse")).toBe(false);
    expect(isAgenticFeedHookEligible("post_tool_use")).toBe(false);
    expect(isAgenticFeedHookEligible("SessionStart")).toBe(false);
    expect(isAgenticFeedHookEligible("UserPromptSubmit")).toBe(false);
    expect(isAgenticFeedHookEligible("user_prompt_submit")).toBe(false);
  });

  it("normalizes hook spellings", () => {
    expect(normalizeAgenticFeedHook("session_end")).toBe("SessionEnd");
    expect(normalizeAgenticFeedHook("post-tool-use")).toBe("PostToolUse");
  });
});
