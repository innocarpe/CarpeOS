import { describe, expect, it } from "vitest";
import { buildCompactionProjection } from "../src/compaction.js";

describe("compaction projection", () => {
  it("builds a rebuildable non-authoritative summary with pointers", () => {
    const projection = buildCompactionProjection({
      trustZoneId: "tz_local_default",
      createdAt: "2026-01-01T00:00:00Z",
      items: [
        {
          eventId: "evt_claim_alpha_000000000000000001",
          chunkId: "chk_alpha",
          text: "Alpha fact summary",
        },
        {
          eventId: "evt_obs_beta_00000000000000000001",
          text: "Beta observation summary",
        },
      ],
      maxSummaryCharacters: 40,
    });

    expect(projection.record_type).toBe("compaction_projection");
    expect(projection.canonical_effect).toBe("none");
    expect(projection.source_event_ids).toEqual([
      "evt_claim_alpha_000000000000000001",
      "evt_obs_beta_00000000000000000001",
    ]);
    expect(projection.source_chunk_ids).toEqual(["chk_alpha"]);
    expect(projection.summary_text.length).toBeLessThanOrEqual(40);
    expect(projection.budget.truncated).toBe(true);
    expect(projection.compaction_id.startsWith("cmp_")).toBe(true);
  });

  it("is deterministic for identical inputs", () => {
    const input = {
      trustZoneId: "tz_local_default",
      createdAt: "2026-01-01T00:00:00Z",
      items: [{ eventId: "evt_claim_alpha_000000000000000001", text: "same" }],
    };
    expect(buildCompactionProjection(input)).toEqual(buildCompactionProjection(input));
  });
});
