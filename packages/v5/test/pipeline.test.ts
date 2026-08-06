import { describe, expect, it } from "vitest";
import { createDraftPipelineDeps, runDraftPipeline } from "../src/pipeline.js";
import { ProviderBoundary } from "../src/provider.js";
import {
  decideM8,
  resolveFourZeroSeamRef,
  v5DraftLaneReadiness,
  verifyV5OffReleasePath,
} from "../src/integration.js";
import {
  admitAndStore,
  createLocalTelemetryStore,
  exportTelemetryStoreView,
} from "../src/telemetry-store.js";

/** Minimal valid multi-record envelope bytes for document.title = "X". */
function outerTitleX(): Uint8Array {
  // From fixture v_multi first record pattern — single title X
  const inner = Buffer.from(
    JSON.stringify({
      schema: "carpeos.redact-record/v1",
      ordinal: 0,
      kind: "document",
      field: "document.title",
      media: "text",
      visibility: "visible",
      erasure: "present",
      value_b64: Buffer.from("X", "utf8").toString("base64"),
    }),
    "utf8",
  );
  const outer = {
    schema: "carpeos.redact-envelope/v1",
    records_b64: inner.toString("base64"),
  };
  return Buffer.from(JSON.stringify(outer), "utf8");
}

describe("draft pipeline (DeepSeek primary, network off → fake)", () => {
  it("runs redact→pack→extract→reduce→eval with canonical_effect none", async () => {
    const provider = new ProviderBoundary({
      fakes: {
        extract: {
          schema: "carpeos.llm-extract/v1",
          result: "no_candidate",
          candidates: [],
          citations: [],
        },
      },
    });
    expect(provider.defaultExtractRoute().provider_id).toBe("deepseek_direct");

    const deps = createDraftPipelineDeps({ provider, v5_enabled: true });
    const result = await runDraftPipeline(
      outerTitleX(),
      {
        pack_id: "pack-pipeline-01",
        prefer_deepseek_direct: true,
        now_iso: "2026-08-06T12:00:00.000Z",
      },
      deps,
    );

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.stage).toBe("complete");
    expect(result.canonical_effect).toBe("none");
    expect(result.provider_network_used).toBe(false);
    expect(result.draft?.canonical_effect).toBe("none");
    expect(result.draft?.proposal_row.canonical_effect).toBe("none");
    expect(result.draft?.status).toBe("no_candidate");
    expect(result.pack_view?.canonical_effect).toBe("none");
    expect(result.evaluation?.pass).toBe(true);
  });

  it("blocks when V5 is not opted in", async () => {
    const deps = createDraftPipelineDeps({ v5_enabled: false });
    const result = await runDraftPipeline(
      outerTitleX(),
      {
        pack_id: "pack-off",
        v5_enabled: false,
      },
      deps,
    );
    expect(result.ok).toBe(false);
    expect(result.stage).toBe("blocked");
  });
});

describe("local TELEMETRY_DB store", () => {
  it("stores body-free admissions and exports a view", () => {
    const SPKI = "MCowBQYDK2VwAyEAA6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=";
    const store = createLocalTelemetryStore(SPKI);
    // Without a real signed snapshot, admission sheds 202 with zero vector
    const shed = admitAndStore(store, {
      snapshot: null,
      request: {
        allocation_id: "alloc_x",
        request_id: "req_x",
        client_id: "cli_x",
        send_ms: 10000,
        request_kind: "new",
        grant_expires_ms: 999999,
        fingerprint: "sha256:aa",
        body: { padding: "must-not-be-stored" },
      },
      now_ms: 10000,
    });
    expect(shed.http_status).toBe(202);
    expect(store.admissions).toHaveLength(0);
    const view = exportTelemetryStoreView(store);
    expect(view.canonical_effect).toBe("none");
    expect(view.admission_count).toBe(0);
    expect(JSON.stringify(view)).not.toContain("must-not-be-stored");
  });
});

describe("M8 and draft-lane readiness", () => {
  it("defers M8 without inventing accepted 4.0 evidence", () => {
    const off = verifyV5OffReleasePath({
      v5_enabled: false,
      provider_network_used: false,
      canonical_writes: 0,
      telemetry_db_only: true,
    });
    expect(off.pass).toBe(true);

    const seam = resolveFourZeroSeamRef({
      path: "artifacts/g008/product4-release-gate-defer-receipt.json",
      digest: null,
      accepted: false,
    });
    const m8 = decideM8({
      opt_in: true,
      v5_off_release_path_verified: true,
      four_zero_seam: seam,
    });
    // Present but not accepted → blocked on seam acceptance, not invented green
    expect(m8.status).toBe("blocked");
    expect(m8.draft_only).toBe(true);

    const m8Deferred = decideM8({
      opt_in: true,
      v5_off_release_path_verified: true,
      four_zero_seam: null,
    });
    expect(m8Deferred.status).toBe("deferred");

    const ready = v5DraftLaneReadiness({
      m0_pass: true,
      pipeline_offline_pass: true,
      deepseek_primary: true,
      telemetry_local_store_pass: true,
      v5_off_path_pass: true,
      m8: m8Deferred,
    });
    expect(ready.ready).toBe(true);
    expect(ready.m8_status).toBe("deferred");
    expect(ready.canonical_effect).toBe("none");
  });
});
