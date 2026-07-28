import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LocalCaptureStore } from "@carpeos/local-store";
import type {
  CanonicalEvent,
  ErasureLedgerRecord,
  ProvenanceRef,
  TrustZone,
} from "@carpeos/schema";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const packageRoot = resolve(import.meta.dirname, "..");
const cliPath = join(packageRoot, "dist", "index.js");
const createdDirs: string[] = [];
const trustZone: TrustZone = { trust_zone_id: "tz_cli_retrieval", isolation: "local_device" };
const privateSentinel = "SYNTHETIC_PRIVATE_RAW_HOOK_JSON";
const subprocessTimeoutMs = 20_000;

beforeAll(() => {
  execFileSync(
    process.execPath,
    [
      resolve(packageRoot, "..", "..", "node_modules", "typescript", "bin", "tsc"),
      "-p",
      join(packageRoot, "tsconfig.json"),
    ],
    { stdio: "pipe" },
  );
});

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("retrieval CLI", () => {
  it("rebuilds idempotently, embeds with deterministic local provider, searches, and gets by chunk id", () => {
    const context = makeContext();
    seedRetrievalEvents(context);

    const first = runJson(
      ["retrieval", "rebuild", "--trust-zone", trustZone.trust_zone_id],
      context,
    );
    const second = runJson(
      ["retrieval", "rebuild", "--trust-zone", trustZone.trust_zone_id],
      context,
    );
    expect(first.status).toBe(0);
    expect(first.stdout).toMatchObject({ ok: true, command: "retrieval rebuild", chunks: 4 });
    expect(second.stdout.chunks).toBe(first.stdout.chunks);

    const embedded = runJson(
      [
        "retrieval",
        "embed",
        "--provider",
        "deterministic-local-dev",
        "--limit",
        "2",
        "--trust-zone",
        trustZone.trust_zone_id,
      ],
      context,
    );
    expect(embedded.status).toBe(0);
    expect(embedded.stdout).toMatchObject({
      ok: true,
      command: "retrieval embed",
      provider: "deterministic-local-dev",
      semantic_quality: "synthetic-dev-only",
    });

    const search = runJson(
      [
        "memory",
        "search",
        "--query",
        "Alpha deterministic",
        "--visible-trust-zone",
        trustZone.trust_zone_id,
        "--trust-zone",
        trustZone.trust_zone_id,
      ],
      context,
    );
    expect(search.status).toBe(0);
    expect(search.stdout).toMatchObject({ ok: true, command: "memory search" });
    expect(search.rawStdout).toContain("source superseded");
    expect(search.rawStdout).toContain("projection_freshness");
    expect(search.rawStdout).toContain("score");
    expect(search.rawStdout).toContain("source_records");
    expect(search.rawStdout).not.toContain(privateSentinel);
    expect(search.rawStdout).not.toContain(context.home);
    expect(search.rawStdout).not.toContain("local-aes256.key");

    const result = search.stdout.result as {
      results: Array<{ chunk_id: string; status: string }>;
    };
    const visible = result.results.find((item) => item.status === "visible");
    expect(visible).toBeDefined();
    const get = runJson(
      [
        "memory",
        "get",
        "--chunk-id",
        visible?.chunk_id ?? "",
        "--visible-trust-zone",
        trustZone.trust_zone_id,
        "--trust-zone",
        trustZone.trust_zone_id,
      ],
      context,
    );
    expect(get.status).toBe(0);
    expect(get.stdout).toMatchObject({ ok: true, command: "memory get" });
  }, 30_000);

  it("fails closed for unavailable embedding provider and malformed visibility filters", () => {
    const context = makeContext();
    seedRetrievalEvents(context);

    const provider = runJson(
      ["retrieval", "embed", "--provider", "workers-ai", "--trust-zone", trustZone.trust_zone_id],
      context,
    );
    expect(provider.status).toBe(2);
    expect(provider.stderr).toMatchObject({ ok: false, error: { code: "invalid_usage" } });

    const noVisibility = runJson(["memory", "search", "--query", "Alpha"], context);
    expect(noVisibility.status).toBe(2);
    expect(noVisibility.stderr).toMatchObject({ ok: false, error: { code: "invalid_usage" } });

    const malformed = runJson(
      ["memory", "search", "--query", "Alpha", "--visible-trust-zone", "bad_zone"],
      context,
    );
    expect(malformed.status).toBe(2);
    expect(malformed.stderr).toMatchObject({ ok: false, error: { code: "invalid_usage" } });
  });

  it("requires a valid active trust zone for every retrieval and memory command", () => {
    const context = makeContext();
    seedRetrievalEvents(context).close();
    const commands = [
      ["retrieval", "rebuild"],
      ["retrieval", "embed", "--provider", "deterministic-local-dev"],
      ["memory", "search", "--query", "Alpha", "--visible-trust-zone", trustZone.trust_zone_id],
      [
        "memory",
        "get",
        "--chunk-id",
        "chk_synthetic_missing",
        "--visible-trust-zone",
        trustZone.trust_zone_id,
      ],
    ];

    for (const command of commands) {
      const missing = runJson(command, context);
      expect(missing.status).toBe(2);
      expect(missing.stderr).toMatchObject({
        ok: false,
        error: {
          code: "invalid_usage",
          message: "--trust-zone is required for retrieval and memory commands",
        },
      });

      const malformed = runJson([...command, "--trust-zone", "bad_zone"], context);
      expect(malformed.status).toBe(2);
      expect(malformed.stderr).toMatchObject({
        ok: false,
        error: {
          code: "invalid_usage",
          message: "--trust-zone must match tz_[a-z0-9][a-z0-9_-]{2,63}",
        },
      });
    }
  });

  it("fails closed when visible trust zones do not include the active trust zone", () => {
    const context = makeContext();
    seedRetrievalEvents(context).close();

    const search = runJson(
      [
        "memory",
        "search",
        "--query",
        "Alpha",
        "--trust-zone",
        trustZone.trust_zone_id,
        "--visible-trust-zone",
        "tz_other_retrieval",
      ],
      context,
    );

    expect(search.status).toBe(2);
    expect(search.stderr).toMatchObject({
      ok: false,
      error: {
        code: "invalid_usage",
        message: "--visible-trust-zone must include the active --trust-zone",
      },
    });
  });

  it("surfaces stale freshness, supersession, and erasure without raw leaks", () => {
    const context = makeContext();
    const store = seedRetrievalEvents(context);
    store.persistSyncCursor({
      afterSequence: 9,
      now: new Date("2026-01-01T00:08:00Z"),
      trustZoneId: trustZone.trust_zone_id,
    });
    store.close();

    runJson(["retrieval", "rebuild", "--trust-zone", trustZone.trust_zone_id], context);
    const search = runJson(
      [
        "memory",
        "search",
        "--query",
        "Alpha",
        "--visible-trust-zone",
        trustZone.trust_zone_id,
        "--trust-zone",
        trustZone.trust_zone_id,
      ],
      context,
    );
    expect(search.status).toBe(0);
    expect(search.rawStdout).toContain("behind_sync_cursor");
    expect(search.rawStdout).not.toContain(privateSentinel);

    const freshContext = makeContext();
    const freshStore = seedRetrievalEvents(freshContext);
    freshStore.close();
    runJson(["retrieval", "rebuild", "--trust-zone", trustZone.trust_zone_id], freshContext);
    const superseded = runJson(
      [
        "memory",
        "search",
        "--query",
        "Alpha",
        "--visible-trust-zone",
        trustZone.trust_zone_id,
        "--trust-zone",
        trustZone.trust_zone_id,
      ],
      freshContext,
    );
    const erased = runJson(
      [
        "memory",
        "search",
        "--query",
        "claim",
        "--visible-trust-zone",
        trustZone.trust_zone_id,
        "--trust-zone",
        trustZone.trust_zone_id,
      ],
      freshContext,
    );
    expect(superseded.rawStdout).toContain("source superseded");
    expect(erased.rawStdout).toContain("erasure applies");
  });
});

function makeContext(): { home: string; cwd: string } {
  const home = mkdtempSync(join(tmpdir(), "carpeos-cli-retrieval-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "carpeos-cli-retrieval-workspace-"));
  createdDirs.push(home, cwd);
  return { home, cwd };
}

function runJson(args: string[], context: { home: string; cwd: string }) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: context.cwd,
    env: { ...process.env, CARPEOS_HOME: context.home },
    encoding: "utf8",
    timeout: subprocessTimeoutMs,
  });
  if (result.error !== undefined || result.status === null) {
    const code =
      result.error !== undefined && "code" in result.error
        ? String((result.error as NodeJS.ErrnoException).code)
        : "unknown";
    throw new Error(
      `CLI subprocess failed before exit status; code=${code}; signal=${result.signal ?? "none"}; timed_out=${code === "ETIMEDOUT"}`,
    );
  }
  const rawStdout = result.stdout.trim();
  const stderrLines = result.stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"));
  return {
    status: result.status ?? -1,
    rawStdout,
    stdout: rawStdout.length === 0 ? {} : (JSON.parse(rawStdout) as Record<string, unknown>),
    stderr:
      stderrLines.length === 0
        ? {}
        : (JSON.parse(stderrLines.at(-1) ?? "{}") as Record<string, unknown>),
  };
}

function seedRetrievalEvents(context: { home: string; cwd: string }): LocalCaptureStore {
  const store = new LocalCaptureStore({
    runtimeDir: context.home,
    workspaceRoot: context.cwd,
    trustZoneId: trustZone.trust_zone_id,
  });
  for (const event of [observation, claimAlpha, claimBeta, supersession, rejectedDecision]) {
    store.importPulledEvent(event, new Date(event.recorded_time.start));
  }
  store.importPulledErasure(erasure, new Date("2026-01-01T00:07:00Z"));
  return store;
}

const base = {
  schema_version: "v1",
  subject_ref: "subject_alpha",
  valid_time: { start: "2026-01-01T00:00:00Z", end: null },
  lifecycle_status: "active",
  trust_zone: trustZone,
  provenance: [
    { ref_type: "external", ref_id: "external_fixture", relationship: "derived_from" },
  ] satisfies ProvenanceRef[],
} as const;

const observation: CanonicalEvent<"Observation"> = {
  ...base,
  event_id: "evt_observe001",
  event_type: "Observation",
  recorded_time: { start: "2026-01-01T00:01:00Z", end: null },
  epistemic_authority: "observed",
  idempotency_key: "idem_observe0010000000",
  request_fingerprint: `sha-256:${"1".repeat(64)}`,
  zone_sequence: 1,
  payload: {
    observation_id: "obs_alpha",
    observed_at: "2026-01-01T00:01:00Z",
    statement: "Alpha observation from protected source.",
    evidence_artifact_refs: ["art_alpha_source"],
  },
};

const claimAlpha: CanonicalEvent<"Claim"> = {
  ...base,
  event_id: "evt_claim001",
  event_type: "Claim",
  recorded_time: { start: "2026-01-01T00:02:00Z", end: null },
  epistemic_authority: "derived",
  idempotency_key: "idem_claim00100000000",
  request_fingerprint: `sha-256:${"2".repeat(64)}`,
  zone_sequence: 2,
  payload: {
    claim_id: "claim_alpha",
    statement: "Alpha retrieval is deterministic.",
    claim_type: "inference",
    support: [{ ref_type: "observation", ref_id: "obs_alpha", relationship: "supports" }],
  },
};

const claimBeta: CanonicalEvent<"Claim"> = {
  ...base,
  event_id: "evt_claim002",
  event_type: "Claim",
  recorded_time: { start: "2026-01-01T00:03:00Z", end: null },
  epistemic_authority: "derived",
  idempotency_key: "idem_claim00200000000",
  request_fingerprint: `sha-256:${"3".repeat(64)}`,
  zone_sequence: 3,
  payload: {
    claim_id: "claim_beta",
    statement: "Beta replacement retrieval is current.",
    claim_type: "inference",
    support: [{ ref_type: "observation", ref_id: "obs_alpha", relationship: "supports" }],
  },
};

const supersession: CanonicalEvent<"Supersession"> = {
  ...base,
  event_id: "evt_super001",
  event_type: "Supersession",
  recorded_time: { start: "2026-01-01T00:04:00Z", end: null },
  epistemic_authority: "verified",
  idempotency_key: "idem_super00100000000",
  request_fingerprint: `sha-256:${"4".repeat(64)}`,
  zone_sequence: 4,
  payload: {
    supersession_id: "sup_alpha",
    supersedes_event_id: "evt_claim001",
    replacement_event_id: "evt_claim002",
    reason: "Synthetic replacement.",
  },
};

const rejectedDecision: CanonicalEvent<"AcceptanceDecision"> = {
  ...base,
  event_id: "evt_decision001",
  event_type: "AcceptanceDecision",
  recorded_time: { start: "2026-01-01T00:05:00Z", end: null },
  epistemic_authority: "verified",
  idempotency_key: "idem_decision001000000",
  request_fingerprint: `sha-256:${"5".repeat(64)}`,
  zone_sequence: 5,
  payload: {
    decision_id: "decision_beta",
    claim_refs: ["claim_beta"],
    decision: "rejected",
    decided_by: "actor_reviewer",
    decided_at: "2026-01-01T00:05:00Z",
  },
};

const erasure: ErasureLedgerRecord = {
  schema_version: "v1",
  erasure_id: "era_cli_retrieval01",
  target_ref: { target_kind: "event", target_id: "evt_claim002", reason: "synthetic erasure" },
  requested_at: "2026-01-01T00:06:00Z",
  completed_at: "2026-01-01T00:06:30Z",
  method: "tombstone",
  actor_ref: "actor_synthetic",
  trust_zone: trustZone,
  evidence_refs: [{ ref_type: "external", ref_id: "external_erasure", relationship: "supports" }],
  zone_sequence: 6,
};
