import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyCircuitBreaker,
  buildFrozenLedger,
  evaluateGates,
  v5OffFallback,
} from "../src/evaluation.js";
import { decideM8, verifyV5OffReleasePath } from "../src/integration.js";
import {
  admitTelemetry,
  createTelemetryRuntime,
  runNormativeTelemetryGenerator,
  ZERO_VECTOR,
} from "../src/telemetry.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const FIX = join(ROOT, "fixtures/v5/m0");
const SPKI = "MCowBQYDK2VwAyEAA6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=";

describe("telemetry admission", () => {
  it("reproduces allocation manifest and verifies snapshot admission branches", async () => {
    const src = readFileSync(join(FIX, "telemetry_generator_normative.js"), "utf8");
    const gen = await runNormativeTelemetryGenerator(src);
    expect(gen.allocation_manifest).toBe(
      "sha256:e525906cc32b62d7e5c5c1657a947eee32b172d77aac2b81b5215c196394256a",
    );
    expect(gen.ALLOCATIONS).toHaveLength(96);
    expect(gen.REQUESTS).toHaveLength(576);
    expect(gen.SNAPSHOTS).toHaveLength(30);

    const runtime = createTelemetryRuntime(SPKI);
    const snap = gen.SNAPSHOTS[0]!;
    const now = Date.parse(snap.issued_at) + 1000;

    // Find a new request that has a grant in this snapshot window
    const req = gen.REQUESTS.find((r) => r.request_kind === "new" && r.send_ms < 240000)!;
    const ok = admitTelemetry({
      runtime,
      snapshot: snap,
      request: req,
      now_ms: now,
    });
    expect(ok.http_status).toBe(200);
    if (ok.http_status === 200) {
      expect(ok.vector.rows).toBe(25);
      expect(ok.d1_statements).toBeGreaterThan(0);
    }

    // Expired grant shed → 202 zero vector
    const expired = gen.REQUESTS.find((r) => r.request_kind === "expired")!;
    const shed = admitTelemetry({
      runtime,
      snapshot: snap,
      request: expired,
      now_ms: now,
    });
    expect(shed.http_status).toBe(202);
    if (shed.http_status === 202) {
      expect(shed.vector).toEqual(ZERO_VECTOR);
      expect(shed.d1_statements).toBe(0);
    }

    // Missing snapshot
    const missing = admitTelemetry({
      runtime,
      snapshot: null,
      request: req,
      now_ms: now,
    });
    expect(missing.http_status).toBe(202);

    // Post-first-statement failure disables telemetry (must still resolve a grant first)
    const runtime2 = createTelemetryRuntime(SPKI);
    const fail = admitTelemetry({
      runtime: runtime2,
      snapshot: snap,
      request: req,
      now_ms: now,
      post_first_statement_failure: true,
    });
    expect(fail.http_status).toBe(503);
    expect(runtime2.telemetry_disabled).toBe(true);
  }, 60_000);
});

describe("evaluation gates", () => {
  it("keeps all attempted cases in denominators and supports V5-off fallback", () => {
    const ledger = buildFrozenLedger([
      {
        case_id: "c1",
        attempted: true,
        eligible: true,
        quality_pass: true,
        reviewer_pass: true,
        baseline_pass: true,
        novel: false,
        latency_ms: 100,
        cost_units: 1,
        identity_stable: true,
      },
      {
        case_id: "c2",
        attempted: true,
        eligible: false,
        quality_pass: false,
        reviewer_pass: true,
        baseline_pass: true,
        novel: false,
        latency_ms: 120,
        cost_units: 1,
        identity_stable: true,
      },
      {
        case_id: "c3",
        attempted: false,
        eligible: true,
        quality_pass: true,
        reviewer_pass: true,
        baseline_pass: true,
        novel: true,
        latency_ms: 0,
        cost_units: 0,
        identity_stable: true,
      },
    ]);
    const gates = evaluateGates(ledger, {
      min_quality_rate: 0.4,
      min_reviewer_rate: 0.9,
      min_baseline_rate: 0.9,
      max_novel_rate: 0.5,
      max_p95_latency_ms: 500,
      max_total_cost_units: 10,
      max_identity_drift_rate: 0.1,
    });
    expect(gates.denominator).toBe(2);
    expect(gates.pass).toBe(true);

    const breaker = applyCircuitBreaker(
      {
        provider_disabled: false,
        telemetry_disabled: false,
        budget_exceeded: false,
        v5_enabled: true,
      },
      { force_v5_off: true, provider_fault: true },
    );
    expect(breaker.v5_enabled).toBe(false);
    expect(breaker.provider_disabled).toBe(true);
    expect(v5OffFallback(breaker).capture_unblocked).toBe(true);
  });
});

describe("M8 integration seam", () => {
  it("defers when accepted 4.0 body-free evidence is missing", () => {
    const off = verifyV5OffReleasePath({
      v5_enabled: false,
      provider_network_used: false,
      canonical_writes: 0,
      telemetry_db_only: true,
    });
    expect(off.pass).toBe(true);
    const decision = decideM8({
      opt_in: true,
      v5_off_release_path_verified: true,
      four_zero_seam: null,
    });
    expect(decision.status).toBe("deferred");
    expect(decision.draft_only).toBe(true);
    expect(decision.canonical_effect).toBe("none");
  });
});
