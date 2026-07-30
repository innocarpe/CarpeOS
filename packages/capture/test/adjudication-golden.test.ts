import { describe, expect, it } from "vitest";
import { adjudicateKnowledgeCandidate, containsSecretLikeMaterial } from "../src/index.js";
import { GOLDEN_ADJUDICATION_FIXTURES } from "./fixtures/adjudication-golden.js";

const fixtureClasses = ["must_promote", "must_hold", "must_reject"] as const;
const dispositionByClass = {
  must_promote: "promote",
  must_hold: "hold",
  must_reject: "reject",
} as const;

describe("golden adjudication precision", () => {
  for (const classification of fixtureClasses) {
    const fixtures = GOLDEN_ADJUDICATION_FIXTURES.filter(
      (fixture) => fixture.classification === classification,
    );

    describe(classification, () => {
      for (const fixture of fixtures) {
        it(fixture.id, () => {
          const result = adjudicateKnowledgeCandidate(fixture.candidate);

          expect(fixture.expected_disposition).toBe(dispositionByClass[classification]);
          expect(result.disposition).toBe(fixture.expected_disposition);
          expect(result.lifecycle_status).toBe(fixture.expected_lifecycle_status);
          expect(result.reason_codes.length).toBeGreaterThan(0);
          for (const reason of fixture.required_reason_codes) {
            expect(result.reason_codes, `missing reason ${reason}`).toContain(reason);
          }

          expect(containsSecretLikeMaterial(result.statement)).toBe(false);
          expect(result.statement).not.toContain("raw_payload");
          expect(result.statement).not.toContain("reasoning_content");
          expect(result.statement).not.toContain("tool_calls");
          for (const fragment of fixture.forbidden_statement_fragments ?? []) {
            expect(result.statement).not.toContain(fragment);
          }
          if (fixture.expected_statement_fragment !== undefined) {
            expect(result.statement).toContain(fixture.expected_statement_fragment);
          }
        });
      }
    });
  }

  it("keeps all three fixture classes populated", () => {
    for (const classification of fixtureClasses) {
      expect(
        GOLDEN_ADJUDICATION_FIXTURES.filter((fixture) => fixture.classification === classification)
          .length,
      ).toBeGreaterThanOrEqual(4);
    }
  });
});
