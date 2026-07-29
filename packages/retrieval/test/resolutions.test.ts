import { describe, expect, it } from "vitest";
import { looksLikeRawHookJson, resolveLatentUnit, type LatentUnit } from "../src/resolutions.js";

const unit: LatentUnit = {
  record_id: "evt_claim_alpha_000000000000000001",
  record_kind: "claim",
  summary_text: "Alpha is accepted.",
  full_text: "Alpha is accepted with extended rationale and citations.",
  embedding_ref: "emb_alpha",
  protected_value_id: "pv_alpha",
};

describe("latent resolution ladder", () => {
  it("defaults to R2 summary text", () => {
    const resolved = resolveLatentUnit(unit);
    expect(resolved.level).toBe("R2");
    expect(resolved.text).toBe("Alpha is accepted.");
  });

  it("escalates to R3 full text when allowed", () => {
    const resolved = resolveLatentUnit(unit, { maxLevel: "R3" });
    expect(resolved.level).toBe("R3");
    expect(resolved.text).toContain("extended rationale");
  });

  it("falls back to R0 when only identifiers are requested", () => {
    const resolved = resolveLatentUnit(unit, { maxLevel: "R0" });
    expect(resolved).toEqual({
      level: "R0",
      record_id: unit.record_id,
      record_kind: unit.record_kind,
    });
  });

  it("detects raw hook JSON that must not be used as R2 text", () => {
    expect(
      looksLikeRawHookJson(
        JSON.stringify({
          hook_event_name: "SessionEnd",
          payload: { raw: "secret" },
        }),
      ),
    ).toBe(true);
    expect(looksLikeRawHookJson("Alpha is accepted.")).toBe(false);
  });
});
