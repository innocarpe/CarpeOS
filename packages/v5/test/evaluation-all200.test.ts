import { describe, expect, it } from "vitest";
import {
  ALL200_CASE_COUNT,
  ALL200_SEED,
  buildAll200FrozenLedger,
  runAll200Evaluation,
} from "../src/evaluation-all200.js";

describe("M7 all-200 frozen evaluation", () => {
  it("builds exactly 200 attempted cases with stable seed", () => {
    const a = buildAll200FrozenLedger();
    const b = buildAll200FrozenLedger(ALL200_SEED);
    expect(a.cases).toHaveLength(ALL200_CASE_COUNT);
    expect(a.frozen).toBe(true);
    expect(a.policy).toBe("all-200");
    expect(a.cases.every((c) => c.attempted)).toBe(true);
    // Deterministic
    expect(a.cases.map((c) => c.case_id)).toEqual(b.cases.map((c) => c.case_id));
    expect(a.cases[0]?.quality_pass).toBe(b.cases[0]?.quality_pass);
  });

  it("passes gates and keeps noneligible quality credit at zero", () => {
    const receipt = runAll200Evaluation();
    expect(receipt.case_count).toBe(200);
    expect(receipt.pass).toBe(true);
    expect(receipt.gates.denominator).toBe(200);
    expect(receipt.gates.noneligible_zero).toBe(true);
    expect(receipt.canonical_effect).toBe("none");
    expect(receipt.v5_off.capture_unblocked).toBe(true);
  });
});
