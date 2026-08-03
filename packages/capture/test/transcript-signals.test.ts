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
  it("uses one mixed-role chronology and keeps the latest durable meaning", () => {
    const text = [
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: "Decision: use SQLite for local metadata." },
      }),
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "We prefer deterministic offline checks." },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: "Constraint: releases must have a synthetic proof.",
        },
      }),
    ].join("\n");

    const signals = signalsFromTranscriptText(text);

    expect(signals.scoring).toContain("SQLite for local metadata");
    expect(signals.scoring).toContain("deterministic offline checks");
    expect(signals.candidate).toContain("releases must have a synthetic proof");
  });

  it("blocks corrected, negated, and replaced durable prose without dropping unrelated facts", () => {
    const text = [
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "Decision: use SQLite for local metadata." },
      }),
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: "Preference: keep offline checks deterministic." },
      }),
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "Correction: replace SQLite with PostgreSQL." },
      }),
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: "Constraint: use an ephemeral cache." },
      }),
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "Correction: no longer use an ephemeral cache." },
      }),
    ].join("\n");

    const signals = signalsFromTranscriptText(text);

    expect(signals.scoring).not.toContain("Decision: use SQLite");
    expect(signals.scoring).not.toContain("Constraint: use an ephemeral cache");
    expect(signals.scoring).toContain("keep offline checks deterministic");
    expect(signals.candidate).toContain("no longer use an ephemeral cache");
  });

  it("suppresses exact normalized duplicates but preserves near-duplicate prose", () => {
    const text = [
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "Preference: keep offline checks deterministic." },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: "  preference: keep offline checks deterministic.  ",
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: "Preference: keep deterministic offline checks." },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: "Constraint: synthetic fixtures must remain public-safe.",
        },
      }),
    ].join("\n");

    const signals = signalsFromTranscriptText(text);

    expect(signals.scoring?.match(/keep offline checks deterministic/gi)).toHaveLength(1);
    expect(signals.scoring).toContain("keep deterministic offline checks");
    expect(signals.scoring).toContain("synthetic fixtures must remain public-safe");
  });

  it("admits explicit Korean durable prose but rejects future intent and generic chatter", () => {
    const future = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: "We will consider a storage choice after the next meeting.",
      },
    });
    const chatter = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: "This is a pleasant general discussion with several ordinary words.",
      },
    });
    const korean = JSON.stringify({
      type: "user",
      message: { role: "user", content: "결정: 오프라인 검증을 기본값으로 유지합니다." },
    });

    expect(signalsFromTranscriptText(future)).toEqual({});
    expect(signalsFromTranscriptText(chatter)).toEqual({});
    expect(signalsFromTranscriptText(korean).candidate).toContain("오프라인 검증");
  });

  it("fails closed for malformed JSONL, structured dumps, and secret-like input", () => {
    const text = [
      '{"type":"user","message":',
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: 'Decision: inspect {"transcript":"raw dump"}.' },
      }),
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "Decision: retain api_key=syntheticsecretvalue12345." },
      }),
    ].join("\n");

    const signals = signalsFromTranscriptText(text);

    expect(signals.scoring).toBeUndefined();
    expect(signals.candidate).toBeUndefined();
    expect(JSON.stringify(signals)).not.toMatch(/raw dump|api_key|syntheticsecret/i);
  });
});
