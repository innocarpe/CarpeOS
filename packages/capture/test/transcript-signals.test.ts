import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isAllowedTranscriptPath,
  signalsFromTranscriptText,
  readTranscriptTail,
} from "../src/transcript-signals.js";
import {
  adjudicateKnowledgeCandidate,
  extractKnowledgeCandidateSpans,
} from "../src/adjudication.js";
import { homedir } from "node:os";

describe("transcript signals", () => {
  it("extracts durable user/assistant prose from Claude-style JSONL", () => {
    const text = [
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "text",
              text: "We should use local session tokens for auth and never store plaintext passwords.",
            },
          ],
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "Decision: adopt local session tokens and keep secrets out of the event stream.",
            },
          ],
        },
      }),
    ].join("\n");

    const signals = signalsFromTranscriptText(text);
    expect(signals.scoring).toMatch(/local session tokens/i);
    expect(signals.candidate).toMatch(/Decision: adopt local session tokens/i);

    const spans = extractKnowledgeCandidateSpans(signals.candidate);
    expect(spans.length).toBeGreaterThan(0);
    expect(spans[0]?.kind).toBe("decision");

    const result = adjudicateKnowledgeCandidate({
      provider: "claude",
      hook_event_name: "SessionEnd",
      signal_text: signals.scoring ?? "Decision: adopt local session tokens for durable auth.",
      spans,
    });
    expect(result.disposition).toBe("promote");
    expect(result.statement).toMatch(/Knowledge fragment \(decision\)/i);
    expect(result.statement).toMatch(/adopt local session tokens/i);
    // Metadata prefix remains for provenance; the durable fragment must be present.
    expect(result.statement).toMatch(/^Captured claude SessionEnd evidence/);
  });

  it("strips user_query wrappers from grok-style prompts", () => {
    const text = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content:
          "<user_query>\nDecide whether to merge the release branch today after CI is green.\n</user_query>",
      },
    });
    const signals = signalsFromTranscriptText(text);
    expect(signals.candidate ?? signals.scoring).toMatch(/merge the release branch/i);
    expect(signals.candidate ?? "").not.toMatch(/user_query/i);
  });

  it("allows only known host transcript roots", () => {
    expect(isAllowedTranscriptPath("/tmp/evil.jsonl")).toBe(false);
    const root = join(homedir(), ".claude", "projects");
    mkdirSync(root, { recursive: true });
    const dir = mkdtempSync(join(root, "carpeos-test-"));
    try {
      const file = join(dir, "t.jsonl");
      writeFileSync(
        file,
        `${JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "Decision: keep transcript recovery local-first only." },
            ],
          },
        })}\n`,
      );
      expect(isAllowedTranscriptPath(file)).toBe(true);
      const tail = readTranscriptTail(file);
      expect(tail).toMatch(/local-first/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
