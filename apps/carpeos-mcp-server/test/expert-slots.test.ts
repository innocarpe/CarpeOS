import { describe, expect, it } from "vitest";
import {
  budgetContextPackWithExpertSlots,
  CONTEXT_PACK_SECTION_ORDER,
  DEFAULT_EXPERT_SLOT_POLICY,
  type ClassifiedPackSections,
} from "../src/expert-slots.js";

function item(
  id: string,
  diversity = "subject_a",
): { diversity_key: string; value: { id: string } } {
  return { diversity_key: diversity, value: { id } };
}

function emptySections(overrides: Partial<ClassifiedPackSections> = {}): ClassifiedPackSections {
  return {
    accepted_facts: [],
    draft_claims: [],
    rejected_claims: [],
    observations: [],
    evidence_summaries: [],
    procedure_summaries: [],
    conflicts: [],
    supersessions: [],
    erasures: [],
    verification_gaps: [],
    redactions: [],
    ...overrides,
  };
}

describe("expert-slot context pack budgeting", () => {
  it("prefers accepted facts and cache-friendly section priority under a tight item budget", () => {
    const budgeted = budgetContextPackWithExpertSlots(
      emptySections({
        accepted_facts: [item("fact_1"), item("fact_2"), item("fact_3")],
        draft_claims: [item("draft_1")],
        observations: [item("obs_1"), item("obs_2")],
        conflicts: [item("conflict_1")],
      }),
      { max_items: 4, max_characters: 10_000 },
    );

    expect(budgeted.output.accepted_facts.map((value) => (value as { id: string }).id)).toEqual([
      "fact_1",
      "fact_2",
      "fact_3",
    ]);
    expect(budgeted.output.conflicts.map((value) => (value as { id: string }).id)).toEqual([
      "conflict_1",
    ]);
    expect(budgeted.output.draft_claims).toEqual([]);
    expect(budgeted.budget.used.items).toBe(4);
    expect(budgeted.budget.truncated).toBe(true);
  });

  it("enforces diversity caps so one subject cannot monopolize slots", () => {
    const budgeted = budgetContextPackWithExpertSlots(
      emptySections({
        accepted_facts: [
          item("a1", "subject_a"),
          item("a2", "subject_a"),
          item("a3", "subject_a"),
          item("a4", "subject_a"),
          item("b1", "subject_b"),
        ],
      }),
      { max_items: 10, max_characters: 10_000 },
      undefined,
      { maxPerDiversityKey: 2 },
    );

    const ids = budgeted.output.accepted_facts.map((value) => (value as { id: string }).id);
    expect(ids).toEqual(["a1", "a2", "b1"]);
    expect(budgeted.budget.omitted.items).toBe(2);
  });

  it("routes procedure summaries into evidence_summaries using procedure slot budget", () => {
    const budgeted = budgetContextPackWithExpertSlots(
      emptySections({
        procedure_summaries: [item("proc_1"), item("proc_2"), item("proc_3"), item("proc_4")],
        evidence_summaries: [item("ev_1"), item("ev_2"), item("ev_3")],
      }),
      { max_items: 20, max_characters: 20_000 },
      {
        ...DEFAULT_EXPERT_SLOT_POLICY,
        procedure_summaries: 2,
        evidence_summaries: 1,
      },
    );

    // Pass 1 takes 2 procedure + 1 evidence first; leftovers fill afterward.
    const ids = budgeted.output.evidence_summaries.map((value) => (value as { id: string }).id);
    expect(ids[0]).toBe("proc_1");
    expect(ids[1]).toBe("proc_2");
    expect(ids).toContain("ev_1");
    expect(ids.length).toBeGreaterThanOrEqual(3);
  });

  it("documents stable cache-friendly section order", () => {
    expect(CONTEXT_PACK_SECTION_ORDER[0]).toBe("accepted_facts");
    expect(CONTEXT_PACK_SECTION_ORDER.at(-1)).toBe("erasures");
  });
});
