import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CaptureEnvelope } from "@carpeos/capture";
import { LocalCaptureStore, StaticKeyProvider } from "@carpeos/local-store";
import { afterEach, describe, expect, it } from "vitest";
import { listAgenticProposals } from "../src/proposals.js";
import { processAgenticOnce } from "../src/runner.js";

const dirs: string[] = [];
const now = new Date("2026-08-06T15:00:00Z");
const key = new Uint8Array(32).fill(11);

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agentic-runner-"));
  dirs.push(dir);
  return dir;
}

function makeStore(): LocalCaptureStore {
  const runtimeDir = tempDir();
  return new LocalCaptureStore({
    runtimeDir,
    workspaceRoot: runtimeDir,
    keyProvider: new StaticKeyProvider(key),
    clock: { now: () => now },
    trustZoneId: "tz_runner_loop",
  });
}

function envelope(overrides: Partial<CaptureEnvelope> = {}): CaptureEnvelope {
  return {
    provider: "codex",
    hook_event_name: "SessionEnd",
    captured_at: "2026-08-06T15:00:00Z",
    workspace_root: "/synthetic/workspace",
    session_id: "session_runner",
    source_event_id: "source_runner_01",
    media_type: "application/json",
    subject_ref: "subject_synthetic",
    payload: {
      transcript: "Decision: we will require make preflight before opening any pull request.",
    },
    ...overrides,
  };
}

describe("product loop: capture feed → runner → materialize", () => {
  it("enqueues feed on capture without LLM and runner materializes hold Observation", async () => {
    const store = makeStore();
    const captured = store.captureHook(envelope(), { extract: false });
    expect(captured.status).toBe("captured");

    const pending = store.listAgenticCaptureFeed({ state: "pending" });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.source_event_id).toBe(captured.event.event_id);

    const agenticDb = new DatabaseSync(join(tempDir(), "agentic.sqlite"));
    const report = await processAgenticOnce({
      store,
      agenticDb,
      materialize: true,
      allow_network: false,
      now,
    });
    expect(report.feed_seen).toBe(1);
    expect(report.feed_done + report.feed_skipped).toBe(1);
    expect(report.network_used).toBe(false);
    expect(report.materializations).toBeGreaterThanOrEqual(1);

    const history = store.listDispositionHistory(captured.event.event_id);
    expect(history.some((d) => d.policy_version === "agentic_v1" && d.disposition === "hold")).toBe(
      true,
    );
    expect(store.listAgenticCaptureFeed({ state: "pending" })).toHaveLength(0);

    // Replay runner is idle
    const again = await processAgenticOnce({ store, agenticDb, materialize: true, now });
    expect(again.feed_seen).toBe(0);

    store.close();
    agenticDb.close();
  });

  it("does not write feed when agentic_feed is false (capture stays dumb)", () => {
    const store = makeStore();
    store.captureHook(envelope({ source_event_id: "source_off" }), {
      extract: false,
      agentic_feed: false,
    });
    expect(store.listAgenticCaptureFeed({ state: "pending" })).toHaveLength(0);
    store.close();
  });

  it("PostToolUse noise is feed-drained as skipped without active meaning", async () => {
    const store = makeStore();
    const captured = store.captureHook(
      envelope({
        source_event_id: "source_noise",
        hook_event_name: "PostToolUse",
        payload: { transcript: "PostToolUse: ran git status successfully with exit 0." },
      }),
      { extract: false },
    );
    const agenticDb = new DatabaseSync(join(tempDir(), "agentic.sqlite"));
    const report = await processAgenticOnce({
      store,
      agenticDb,
      materialize: true,
      now,
    });
    expect(report.feed_skipped).toBe(1);
    expect(
      listAgenticProposals(agenticDb).filter((p) => p.gate.decision !== "reject"),
    ).toHaveLength(0);
    expect(store.listDispositionHistory(captured.event.event_id)).toHaveLength(0);
    store.close();
    agenticDb.close();
  });
});
