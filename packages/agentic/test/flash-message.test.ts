import { describe, expect, it } from "vitest";
import {
  assertFlashUserContentMatchesView,
  buildAgenticFlashRequestBody,
  buildAgenticFlashUserContent,
  callAgenticFlash,
  createFlashSpendState,
  extractFlashMessageText,
} from "../src/flash.js";
import { packAgenticEvidence, scrubAgenticPackText } from "../src/pack.js";

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

describe("Q1′ Flash effective views (QD0)", () => {
  it("serialized user content embeds declared view without second slice", () => {
    const view = "Decision: we will require make preflight.";
    const user = buildAgenticFlashUserContent({ stage: "extract", view_text: view });
    const bind = assertFlashUserContentMatchesView({ user_content: user, view_text: view });
    expect(bind).toEqual({ ok: true });
    expect(user).toBe(
      `Pack:\n${view}\n\nExtract cited candidates. quote MUST be exact substring. Reply JSON only.`,
    );
  });

  it("request body fetch payload equals declared scrubbed view (no raw paths/uris)", async () => {
    const raw =
      "We decided to require make preflight. Path /tmp/synthetic/workspace/repo and https://example.com/docs.";
    const packed = packAgenticEvidence({
      pack_id: "pack-flash-view-01",
      body_text: raw,
      now_iso: "2026-08-07T12:00:00.000Z",
    });
    expect(packed.ok).toBe(true);
    if (!packed.ok) throw new Error("pack failed");

    const declared = packed.extract_view_text;
    expect(declared).toContain("[PATH]");
    expect(declared).toContain("[URI]");
    expect(declared).not.toMatch(/\/tmp\/synthetic/);
    expect(declared).not.toMatch(/https:\/\/example\.com/);

    let capturedBody: string | null = null;
    const fetch_impl: typeof fetch = async (_url, init) => {
      capturedBody = typeof init?.body === "string" ? init.body : null;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"candidates":[]}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const res = await callAgenticFlash({
      stage: "extract",
      view_text: declared,
      allow_network: true,
      api_key: "sk-test-synthetic-not-real",
      spend: createFlashSpendState({ max_calls: 4 }),
      fetch_impl,
    });
    expect(res.ok).toBe(true);
    expect(capturedBody).not.toBeNull();
    const parsed = JSON.parse(capturedBody!) as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMsg = parsed.messages.find((m) => m.role === "user")?.content ?? "";
    const bind = assertFlashUserContentMatchesView({
      user_content: userMsg,
      view_text: declared,
    });
    expect(bind).toEqual({ ok: true });
    // Privacy fence on the wire: no raw absolute path / https URI from source signal.
    expect(userMsg).not.toMatch(/\/tmp\/synthetic\/workspace\/repo/);
    expect(userMsg).not.toMatch(/https:\/\/example\.com\/docs/);
    expect(userMsg).toContain(scrubAgenticPackText("preflight") || "preflight");
  });

  it("refuses empty view text (no raw-signal fallback)", async () => {
    const res = await callAgenticFlash({
      stage: "triage",
      view_text: "   ",
      allow_network: true,
      api_key: "sk-test",
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected fail");
    expect(res.error).toBe("empty_view_text");
  });

  it("buildAgenticFlashRequestBody preserves declared_view_text", () => {
    const view = "Constraint: capture hooks must never call the network.";
    const body = buildAgenticFlashRequestBody({ stage: "triage", view_text: view });
    expect(body.declared_view_text).toBe(view);
    expect(body.user_content).toContain(view);
    expect(body.messages[1]?.content).toBe(body.user_content);
  });
});
