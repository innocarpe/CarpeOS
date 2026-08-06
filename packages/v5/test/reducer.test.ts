import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createRunScopeKey,
  createScopeCounterV2,
  reduceFromBundle,
  validateReducerFixture,
  type ReducerFixtureBundle,
} from "../src/reducer.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const FIX = join(ROOT, "fixtures/v5/m0");

const NAMES = [
  "reorder_v1",
  "duplicate_overlap_v1",
  "no_candidate_v1",
  "prior_reviewable_v1",
] as const;

const EXPECTED: Record<(typeof NAMES)[number], string> = {
  reorder_v1: "ee7f8e42019cb4f0e3318869cfa7dd9263b7fa5e2a0a7613b882bd06994dc8ea",
  duplicate_overlap_v1: "1ab98680ead8df03baa1e16c863261993cfeff63e22d16f68d047b42b7fd9d23",
  no_candidate_v1: "93325460c5072d00f25a1b2dc02a148dcf31f7bc63e3b89b128004d8476fe156",
  prior_reviewable_v1: "7358225464e3defec3adba8d6b92316e3b3fea02d155667a5a71132ea4cba7f0",
};

describe("proposal_reduce_v1 fixtures", () => {
  for (const name of NAMES) {
    it(`validates ${name} output hash`, () => {
      const bundle = JSON.parse(
        readFileSync(join(FIX, `reducer_${name}.json`), "utf8"),
      ) as ReducerFixtureBundle;
      const result = validateReducerFixture(bundle);
      expect(result.errors).toEqual([]);
      expect(result.pass).toBe(true);
      expect(result.computed_output_sha256).toBe(EXPECTED[name]);
      const reduced = reduceFromBundle(bundle);
      expect(reduced.canonical_effect).toBe("none");
      expect(reduced.output_sha256).toBe(EXPECTED[name]);
    });
  }

  it("requires run_scope_key before ordinal allocation", () => {
    const counter = createScopeCounterV2();
    expect(() => counter.nextOrdinal("scope_missing")).toThrow(/before ordinal/);
    const key = createRunScopeKey({
      pack_id: "pack-test",
      redaction_policy_id: "redact_v1",
    });
    counter.createScope(key);
    expect(counter.nextOrdinal(key)).toBe(0);
    expect(counter.nextOrdinal(key)).toBe(1);
    counter.mark(key, 0);
    expect(() => counter.mark(key, 0)).toThrow(/replay/);
  });
});
