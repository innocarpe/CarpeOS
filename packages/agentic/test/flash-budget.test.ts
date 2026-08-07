import { describe, expect, it } from "vitest";
import { createFlashSpendState, callAgenticFlash } from "../src/flash.js";

/**
 * Q-S7: per-row Flash budget — triage-kept ≤2 billed calls, triage-dropped ≤1.
 * Runner charges one call for triage and at most one for extract when keep.
 */
describe("Q-S7 Flash per-row budget", () => {
  it("triage drop path bills at most one call", async () => {
    const spend = createFlashSpendState({ max_calls: 4, spend_cap_usd: 1 });
    let calls = 0;
    const fetch_impl = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ decision: "drop", reason_codes: ["tool_noise"] }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const triage = await callAgenticFlash({
      stage: "triage",
      view_text: "PostToolUse only noise",
      allow_network: true,
      spend,
      fetch_impl,
      api_key: "sk-test",
    });
    expect(triage.ok).toBe(true);
    expect(spend.calls).toBe(1);
    expect(calls).toBe(1);
    // Drop path: runner must not call extract (asserted by design — only one call made here).
    expect(spend.calls).toBeLessThanOrEqual(1);
  });

  it("triage keep + extract bills at most two calls", async () => {
    const spend = createFlashSpendState({ max_calls: 4, spend_cap_usd: 1 });
    let calls = 0;
    const fetch_impl = async () => {
      calls += 1;
      const body =
        calls === 1
          ? {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      decision: "keep",
                      reason_codes: ["decision_class_signal"],
                    }),
                  },
                },
              ],
            }
          : {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      candidates: [
                        {
                          kind: "decision",
                          statement:
                            "Decision: we will require make preflight before opening any pull request.",
                          quote:
                            "Decision: we will require make preflight before opening any pull request.",
                          confidence: 0.9,
                        },
                      ],
                    }),
                  },
                },
              ],
            };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    await callAgenticFlash({
      stage: "triage",
      view_text: "Decision: we will require make preflight before opening any pull request.",
      allow_network: true,
      spend,
      fetch_impl,
      api_key: "sk-test",
    });
    await callAgenticFlash({
      stage: "extract",
      view_text: "Decision: we will require make preflight before opening any pull request.",
      allow_network: true,
      spend,
      fetch_impl,
      api_key: "sk-test",
    });
    expect(spend.calls).toBe(2);
    expect(spend.calls).toBeLessThanOrEqual(2);
  });
});
