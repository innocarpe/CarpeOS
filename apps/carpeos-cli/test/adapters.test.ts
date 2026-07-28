import { describe, expect, it } from "vitest";
import { HookInputError, normalizeHookEnvelope } from "../src/adapters.js";

describe("provider hook normalization", () => {
  it("normalizes Codex and Claude snake_case lifecycle payloads", () => {
    for (const provider of ["codex", "claude"] as const) {
      const envelope = normalizeHookEnvelope({
        provider,
        raw: {
          hook_event_name: "SessionEnd",
          session_id: "session_synthetic",
          cwd: "synthetic-workspace",
          timestamp: "2026-01-01T00:00:00Z",
        },
        subjectRef: "project_synthetic",
        fallbackCapturedAt: "2026-02-01T00:00:00Z",
      });
      expect(envelope).toMatchObject({
        provider,
        hook_event_name: "SessionEnd",
        session_id: "session_synthetic",
        captured_at: "2026-01-01T00:00:00Z",
        subject_ref: "project_synthetic",
      });
    }
  });

  it("normalizes Grok camelCase lifecycle payloads", () => {
    const envelope = normalizeHookEnvelope({
      provider: "grok",
      raw: {
        hookEventName: "Stop",
        sessionId: "session_synthetic",
        workspaceRoot: "synthetic-workspace",
      },
      subjectRef: "project_synthetic",
      fallbackCapturedAt: "2026-02-01T00:00:00Z",
    });
    expect(envelope).toMatchObject({
      provider: "grok",
      hook_event_name: "Stop",
      session_id: "session_synthetic",
      captured_at: "2026-02-01T00:00:00Z",
    });
  });

  it("accepts Codex notify argv payloads and rejects missing event names", () => {
    const notify = normalizeHookEnvelope({
      provider: "codex",
      raw: {
        type: "agent-turn-complete",
        "thread-id": "thread_synthetic",
        cwd: "synthetic-workspace",
      },
      subjectRef: "project_synthetic",
      fallbackCapturedAt: "2026-02-01T00:00:00Z",
    });
    expect(notify.hook_event_name).toBe("agent-turn-complete");
    expect(notify.session_id).toBe("thread_synthetic");

    expect(() =>
      normalizeHookEnvelope({
        provider: "codex",
        raw: {},
        subjectRef: "project_synthetic",
        fallbackCapturedAt: "2026-02-01T00:00:00Z",
      }),
    ).toThrow(HookInputError);
  });
});
