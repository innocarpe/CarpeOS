import type { ContextBudget, ContextBudgetUsage } from "@carpeos/schema";

/**
 * Default expert-slot policy inspired by sparse top-k activation (16 slots).
 * Hard ContextBudget still wins; slots only shape allocation within the budget.
 */
export const DEFAULT_EXPERT_SLOT_POLICY = {
  accepted_facts: 6,
  conflicts: 2,
  supersessions: 1,
  procedure_summaries: 3,
  observations: 2,
  evidence_summaries: 2,
  /** Remaining sections may only use leftover budget after primary slots. */
  draft_claims: 0,
  rejected_claims: 0,
  erasures: 0,
} as const;

export type ExpertSlotSection = keyof typeof DEFAULT_EXPERT_SLOT_POLICY;

/** Cache-friendly pack key order: durable accepted knowledge first, high-churn last. */
export const CONTEXT_PACK_SECTION_ORDER = [
  "accepted_facts",
  "conflicts",
  "supersessions",
  "observations",
  "evidence_summaries",
  "draft_claims",
  "rejected_claims",
  "erasures",
] as const satisfies readonly ExpertSlotSection[];

export type ExpertSlotPolicy = Record<ExpertSlotSection, number>;

export type SlottableItem = {
  /** Stable diversity key; typically subject_ref or record id. */
  diversity_key: string;
  /** Opaque payload for the pack section. */
  value: unknown;
};

export type ClassifiedPackSections = {
  accepted_facts: SlottableItem[];
  draft_claims: SlottableItem[];
  rejected_claims: SlottableItem[];
  observations: SlottableItem[];
  evidence_summaries: SlottableItem[];
  procedure_summaries: SlottableItem[];
  conflicts: SlottableItem[];
  supersessions: SlottableItem[];
  erasures: SlottableItem[];
  verification_gaps: string[];
  redactions: string[];
};

export type BudgetedContextPackSections = {
  accepted_facts: unknown[];
  draft_claims: unknown[];
  rejected_claims: unknown[];
  observations: unknown[];
  evidence_summaries: unknown[];
  conflicts: unknown[];
  supersessions: unknown[];
  erasures: unknown[];
  verification_gaps: string[];
  redactions: string[];
};

export function budgetContextPackWithExpertSlots(
  sections: ClassifiedPackSections,
  budget: ContextBudget,
  policy: ExpertSlotPolicy = { ...DEFAULT_EXPERT_SLOT_POLICY },
  options: { maxPerDiversityKey?: number } = {},
): { output: BudgetedContextPackSections; budget: ContextBudgetUsage } {
  // Soft cap within a section; single-project stores often share one subject_ref.
  const maxPerDiversityKey = options.maxPerDiversityKey ?? 8;
  /** Diversity is enforced per section so one subject can still appear across fact/observation/etc. */
  const diversityCounts = new Map<string, number>();
  let usedItems = 0;
  let usedCharacters = 0;
  let omittedItems = 0;
  let omittedCharacters = 0;

  const next: BudgetedContextPackSections = {
    accepted_facts: [],
    conflicts: [],
    supersessions: [],
    observations: [],
    evidence_summaries: [],
    draft_claims: [],
    rejected_claims: [],
    erasures: [],
    verification_gaps: [...sections.verification_gaps],
    redactions: [...sections.redactions],
  };

  const primaryQueues: Record<ExpertSlotSection, SlottableItem[]> = {
    accepted_facts: [...sections.accepted_facts],
    conflicts: [...sections.conflicts],
    supersessions: [...sections.supersessions],
    procedure_summaries: [...sections.procedure_summaries],
    observations: [...sections.observations],
    evidence_summaries: [...sections.evidence_summaries],
    draft_claims: [...sections.draft_claims],
    rejected_claims: [...sections.rejected_claims],
    erasures: [...sections.erasures],
  };

  const tryAdmit = (section: ExpertSlotSection, item: SlottableItem): boolean => {
    const characters = stableLength(item.value);
    if (usedItems + 1 > budget.max_items || usedCharacters + characters > budget.max_characters) {
      omittedItems += 1;
      omittedCharacters += characters;
      return false;
    }
    const targetSection = section === "procedure_summaries" ? "evidence_summaries" : section;
    // Diversity is per output section so one subject may appear as fact and observation.
    const diversityKey = `${targetSection}:${item.diversity_key}`;
    const usedForKey = diversityCounts.get(diversityKey) ?? 0;
    if (usedForKey >= maxPerDiversityKey) {
      omittedItems += 1;
      omittedCharacters += characters;
      return false;
    }
    (next[targetSection] as unknown[]).push(item.value);
    diversityCounts.set(diversityKey, usedForKey + 1);
    usedItems += 1;
    usedCharacters += characters;
    return true;
  };

  // Pass 1: expert-slot floors/caps in cache-friendly order.
  for (const section of CONTEXT_PACK_SECTION_ORDER) {
    if (section === "evidence_summaries") {
      // Prefer procedure summaries in the procedure slot budget, then general evidence.
      let procedureTaken = 0;
      while (
        procedureTaken < policy.procedure_summaries &&
        primaryQueues.procedure_summaries.length > 0
      ) {
        const item = primaryQueues.procedure_summaries.shift();
        if (item === undefined) {
          break;
        }
        if (tryAdmit("procedure_summaries", item)) {
          procedureTaken += 1;
        }
      }
      let evidenceTaken = 0;
      while (
        evidenceTaken < policy.evidence_summaries &&
        primaryQueues.evidence_summaries.length > 0
      ) {
        const item = primaryQueues.evidence_summaries.shift();
        if (item === undefined) {
          break;
        }
        if (tryAdmit("evidence_summaries", item)) {
          evidenceTaken += 1;
        }
      }
      continue;
    }

    const cap = policy[section];
    let taken = 0;
    while (taken < cap && primaryQueues[section].length > 0) {
      const item = primaryQueues[section].shift();
      if (item === undefined) {
        break;
      }
      if (tryAdmit(section, item)) {
        taken += 1;
      }
    }
  }

  // Pass 2: fill remaining budget from leftovers in the same order (including draft/reject/erasure).
  const leftoverOrder: ExpertSlotSection[] = [
    "accepted_facts",
    "conflicts",
    "supersessions",
    "procedure_summaries",
    "observations",
    "evidence_summaries",
    "draft_claims",
    "rejected_claims",
    "erasures",
  ];
  for (const section of leftoverOrder) {
    while (primaryQueues[section].length > 0) {
      if (usedItems >= budget.max_items) {
        // Drain remainder into omitted counts.
        for (const item of primaryQueues[section]) {
          omittedItems += 1;
          omittedCharacters += stableLength(item.value);
        }
        primaryQueues[section].length = 0;
        break;
      }
      const item = primaryQueues[section].shift();
      if (item === undefined) {
        break;
      }
      tryAdmit(section, item);
    }
  }

  return {
    output: next,
    budget: {
      used: { items: usedItems, characters: usedCharacters },
      truncated: omittedItems > 0 || omittedCharacters > 0,
      omitted: { items: omittedItems, characters: omittedCharacters },
    },
  };
}

/** Stable character length for budget accounting (sorted-key JSON). */
export function stableLength(value: unknown): number {
  return JSON.stringify(canonicalize(value)).length;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const ordered: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      ordered[key] = canonicalize(record[key]);
    }
    return ordered;
  }
  return value;
}
