import { describe, expect, it } from "vitest";
import { extractFlashMessageText } from "../src/flash.js";

describe("extractFlashMessageText", () => {
  it("prefers content when present", () => {
    expect(
      extractFlashMessageText({
        content: '{"decision":"keep"}',
        reasoning_content: "thinking…",
      }),
    ).toBe('{"decision":"keep"}');
  });

  it("falls back to trailing JSON in reasoning when content empty", () => {
    const text = extractFlashMessageText({
      content: "",
      reasoning_content:
        'We need JSON only. Final answer: {"decision":"keep","reason_codes":["policy"]}',
    });
    expect(text).toContain('"decision":"keep"');
  });
});
