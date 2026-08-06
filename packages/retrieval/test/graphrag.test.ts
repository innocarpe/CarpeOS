import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  classifyGraphRagUnit,
  evaluateGraphRagQuerySet,
  rankGraphRagOffline,
  type GraphRagQuerySet,
} from "../src/graphrag.js";
import { buildRetrievalChunk } from "../src/chunks.js";
import { makeRetrievalDerivation } from "../src/provenance.js";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/agentic/v1/graphrag-query-set/manifest.json",
);

const sourceRecords = [
  {
    source_record_kind: "event" as const,
    source_record_id: "evt_graphrag_001",
    trust_zone_id: "tz_local_default",
    zone_sequence: 1,
    source_fingerprint: `sha-256:${"2".repeat(64)}`,
    relationship_role: "primary" as const,
    event_type: "Observation" as const,
    lifecycle_status: "active" as const,
    epistemic_authority: "observed" as const,
    valid_time: { start: "2026-08-07T00:00:00Z", end: null },
    recorded_time: { start: "2026-08-07T00:00:00Z", end: null },
  },
];

describe("GraphRAG typed unit classification (P6)", () => {
  it("classifies active claim as promoted typed unit", () => {
    const chunk = buildRetrievalChunk({
      chunkKind: "claim",
      text: "Synthetic promoted claim for GraphRAG",
      sourceRecords,
      derivation: makeRetrievalDerivation({ sourceRecords, config: {} }),
      lifecycleStatus: "active",
    });
    const features = classifyGraphRagUnit(chunk);
    expect(features.unit_class).toBe("promoted_typed_unit");
    expect(features.is_promoted_active).toBe(true);
    expect(features.typed_boost).toBeGreaterThan(0);
  });

  it("classifies evidence as residue with zero typed boost", () => {
    const chunk = buildRetrievalChunk({
      chunkKind: "evidence_excerpt",
      text: "EvidenceArtifact kind=session media_type=application/json",
      sourceRecords: [
        {
          ...sourceRecords[0]!,
          event_type: "EvidenceArtifact",
          source_record_id: "evt_evidence_001",
        },
      ],
      derivation: makeRetrievalDerivation({
        sourceRecords: [
          {
            ...sourceRecords[0]!,
            event_type: "EvidenceArtifact",
            source_record_id: "evt_evidence_001",
          },
        ],
        config: {},
      }),
      lifecycleStatus: "active",
    });
    const features = classifyGraphRagUnit(chunk);
    expect(features.unit_class).toBe("evidence_residue");
    expect(features.typed_boost).toBe(0);
  });
});

describe("GraphRAG offline ranking (P6)", () => {
  it("ranks active typed unit above evidence with shared query tokens", () => {
    const ranked = rankGraphRagOffline({
      query_text: "preflight pull request",
      candidates: [
        {
          chunk_id: "noise",
          chunk_kind: "evidence_excerpt",
          lifecycle_status: "active",
          text: "EvidenceArtifact kind=session preflight pull request metadata",
          graph_hop: 0,
        },
        {
          chunk_id: "unit",
          chunk_kind: "summary",
          lifecycle_status: "active",
          text: "Decision: we will require make preflight before opening any pull request.",
          graph_hop: 0,
        },
      ],
    });
    expect(ranked[0]?.chunk.chunk_id).toBe("unit");
    expect(ranked.map((r) => r.chunk.chunk_id)).toContain("noise");
  });

  it("prefers graph-near typed unit over far duplicate", () => {
    const ranked = rankGraphRagOffline({
      query_text: "agentic materialize hold",
      candidates: [
        {
          chunk_id: "far",
          chunk_kind: "summary",
          lifecycle_status: "active",
          text: "Decision: agentic materialize remains hold-first without automatic acceptance.",
          graph_hop: 2,
        },
        {
          chunk_id: "near",
          chunk_kind: "summary",
          lifecycle_status: "active",
          text: "Decision: agentic materialize remains hold-first without automatic acceptance.",
          graph_hop: 0,
        },
      ],
    });
    expect(ranked[0]?.chunk.chunk_id).toBe("near");
  });
});

describe("GraphRAG offline query set fixture (P6 evidence)", () => {
  it("passes the checked-in query set with hit_rate ≥ 0.90", () => {
    const querySet = JSON.parse(readFileSync(fixturePath, "utf8")) as GraphRagQuerySet;
    expect(querySet.schema).toBe("carpeos.agentic.graphrag-query-set/v1");
    expect(querySet.cases.length).toBeGreaterThanOrEqual(6);

    const report = evaluateGraphRagQuerySet(querySet, { hit_rate_min: 0.9 });
    expect(report.pass).toBe(true);
    expect(report.hit_rate).toBeGreaterThanOrEqual(0.9);
    expect(report.fail_count).toBe(0);
    expect(report.reason_codes).toContain("graphrag_query_set_pass");
  });
});
