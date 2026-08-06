import { describe, expect, it } from "vitest";
import { reduceExtractToDraft } from "../src/draft-reduce.js";
import type { ExtractResponse } from "../src/reducer.js";

const baseInput = {
  pack_id: "pack-draft-reduce",
  pack_digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  attempt_id: "att_1",
  now_iso: "2026-08-06T12:00:00.000Z",
};

function noCandidate(): ExtractResponse {
  return {
    schema: "carpeos.llm-extract/v1",
    result: "no_candidate",
    candidates: [],
    citations: [],
  };
}

function withCandidate(): ExtractResponse {
  return {
    schema: "carpeos.llm-extract/v1",
    result: "candidates",
    candidates: [
      {
        quote_kind: "evidence",
        segment_id: "seg_0",
        start: 0,
        end: 1,
        text: "X",
      },
    ],
    citations: [],
  };
}

describe("reduceExtractToDraft", () => {
  it("maps no_candidate without allocating canonical effect", () => {
    const out = reduceExtractToDraft({ ...baseInput, extract: noCandidate() });
    expect(out.status).toBe("no_candidate");
    expect(out.reason_code).toBe("extract_no_candidate");
    expect(out.selected_candidate_ids).toEqual([]);
    expect(out.canonical_effect).toBe("none");
    expect(out.proposal_row.canonical_effect).toBe("none");
    expect(out.proposal_row.status).toBe("no_candidate");
    expect(out.selected_attempt_ids).toEqual(["att_1"]);
  });

  it("maps ok extract to draft status with candidate ids", () => {
    const out = reduceExtractToDraft({ ...baseInput, extract: withCandidate() });
    expect(out.status).toBe("draft");
    expect(out.reason_code).toBe("selected_primary");
    expect(out.selected_candidate_ids).toHaveLength(1);
    expect(out.selected_candidate_ids[0]).toMatch(/^cand_/);
    expect(out.canonical_effect).toBe("none");
    expect(out.extract_digest.startsWith("sha256:")).toBe(true);
  });

  it("is deterministic for the same pack and attempt", () => {
    const a = reduceExtractToDraft({ ...baseInput, extract: withCandidate() });
    const b = reduceExtractToDraft({ ...baseInput, extract: withCandidate() });
    expect(a.proposal_id).toBe(b.proposal_id);
    expect(a.run_id).toBe(b.run_id);
    expect(a.selected_candidate_ids).toEqual(b.selected_candidate_ids);
  });
});
