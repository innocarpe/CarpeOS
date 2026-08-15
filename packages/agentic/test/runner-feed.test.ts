import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CaptureEnvelope } from "@carpeos/capture";
import { LocalCaptureStore, StaticKeyProvider } from "@carpeos/local-store";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateAgenticGate } from "../src/gate.js";
import {
  listAgenticProposals,
  listUnmaterializedPromoteProposals,
  putAgenticProposal,
} from "../src/proposals.js";
import { processAgenticOnce } from "../src/runner.js";
import { AGENTIC_POLICY_VERSION } from "../src/types.js";

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
  it("enqueues feed on capture without LLM and runner materializes promote Observation", async () => {
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
    expect(
      history.some((d) => d.policy_version === "agentic_v1.1" && d.disposition === "promote"),
    ).toBe(true);
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

  it("Q1′ empty capture signal is skipped without empty-capture placeholder", async () => {
    const store = makeStore();
    // Feed row present; force empty signal (H0 JSON.stringify of envelope is Q3′).
    // Pre-Q1′ runner substituted "(empty capture …)" which admitted and spent.
    const captured = store.captureHook(envelope({ source_event_id: "source_empty_signal" }), {
      extract: false,
    });
    expect(captured.status).toBe("captured");
    store.readCaptureSignalText = () => "";
    const agenticDb = new DatabaseSync(join(tempDir(), "agentic-empty.sqlite"));
    const report = await processAgenticOnce({
      store,
      agenticDb,
      materialize: true,
      allow_network: false,
      now,
    });
    expect(report.feed_seen).toBe(1);
    expect(report.feed_skipped).toBe(1);
    expect(report.feed_done).toBe(0);
    expect(report.materializations).toBe(0);
    expect(report.flash_calls).toBe(0);
    const pipeline = report.pipelines[0];
    expect(pipeline?.admit_decision).toBe("drop");
    expect(pipeline?.reason_codes).toContain("empty_signal");
    // No synthetic placeholder ever entered the pipeline as admit-worthy body.
    expect(JSON.stringify(report)).not.toMatch(/\(empty capture /);
    store.close();
    agenticDb.close();
  });

  it("PostToolUse never enters agentic feed (lifecycle-only enqueue)", async () => {
    const store = makeStore();
    const captured = store.captureHook(
      envelope({
        source_event_id: "source_noise",
        hook_event_name: "PostToolUse",
        payload: { transcript: "PostToolUse: ran git status successfully with exit 0." },
      }),
      { extract: false },
    );
    expect(captured.status).toBe("captured");
    // Product path: noise hooks are not queued for Flash at all.
    expect(store.listAgenticCaptureFeed({ state: "pending" })).toHaveLength(0);
    const agenticDb = new DatabaseSync(join(tempDir(), "agentic.sqlite"));
    const report = await processAgenticOnce({
      store,
      agenticDb,
      materialize: true,
      now,
    });
    expect(report.feed_seen).toBe(0);
    expect(report.reason_codes).toContain("feed_empty");
    expect(listAgenticProposals(agenticDb)).toHaveLength(0);
    store.close();
    agenticDb.close();
  });

  it("HITL-free: materializes unmaterialized promote backlog without human review", async () => {
    const store = makeStore();
    const captured = store.captureHook(
      envelope({
        source_event_id: "source_backlog_promote",
        payload: {
          transcript: "Decision: we decided default search is promoted active units only.",
        },
      }),
      { extract: false },
    );
    expect(captured.status).toBe("captured");
    const sourceId = captured.event.event_id;
    const artifactId = captured.event.payload.artifact_id;
    const agenticDb = new DatabaseSync(join(tempDir(), "agentic-backlog.sqlite"));

    const statement = "we decided default search is promoted active units only";
    const candidate = {
      kind: "decision" as const,
      statement,
      confidence: 0.8,
      citations: [
        {
          evidence_event_id: sourceId,
          segment_id: "seg_agentic_body",
          start: 0,
          end: statement.length,
          quote: statement,
        },
      ],
    };
    const gate = evaluateAgenticGate({
      candidate,
      cite_ok: true,
      secret_ok: true,
      allow_auto_promote: true,
    });
    expect(gate.decision).toBe("promote");
    putAgenticProposal(agenticDb, {
      trust_zone_id: "tz_runner_loop",
      source_event_id: sourceId,
      pack_digest: "sha256:synthetic_backlog_pack",
      candidate,
      cite_ok: true,
      secret_ok: true,
      verify_reason_codes: ["cite_ok"],
      gate,
      edges: [
        {
          kind: "derived_from",
          from_ref: "unit",
          to_ref: artifactId,
          note: "evidence_artifact",
        },
      ],
      now,
    });
    expect(listUnmaterializedPromoteProposals(agenticDb)).toHaveLength(1);

    // Finish feed without runner so only backlog drain runs (feed empty).
    store.finishAgenticCaptureFeed({ source_event_id: sourceId, state: "done" });

    const report = await processAgenticOnce({
      store,
      agenticDb,
      materialize: true,
      allow_network: false,
      now,
    });
    expect(report.feed_seen).toBe(0);
    expect(report.backlog_materializations).toBeGreaterThanOrEqual(1);
    expect(report.reason_codes).toContain("promote_backlog_materialized");
    expect(listUnmaterializedPromoteProposals(agenticDb)).toHaveLength(0);
    const history = store.listDispositionHistory(sourceId);
    expect(
      history.some(
        (d) => d.policy_version === AGENTIC_POLICY_VERSION && d.disposition === "promote",
      ),
    ).toBe(true);

    store.close();
    agenticDb.close();
  });
});
