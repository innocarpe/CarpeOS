/**
 * proposal_reduce_v1 offline oracle — draft-only, canonical_effect: none.
 */

import { auditFree, digestSha256, jcs, sha256Hex, sha256Jcs } from "./jcs.js";

export const PROPOSAL_POLICY_VERSION = "proposal_policy_v1";
export const REDUCER_VERSION = "reducer_v1";

export type AuditEnvelope = {
  created_at: string;
  updated_at: string;
  actor_ref: string | null;
  trace_ref: string | null;
};

export type CitationSpan = {
  segment_id: string;
  start: number;
  end: number;
};

export type ExtractCandidate = {
  quote_kind: "decision" | "constraint" | "risk" | "action" | "evidence";
  segment_id: string;
  start: number;
  end: number;
  text: string;
};

export type ExtractResponse =
  | {
      schema: "carpeos.llm-extract/v1";
      result: "candidates";
      candidates: ExtractCandidate[];
      citations: CitationSpan[];
    }
  | {
      schema: "carpeos.llm-extract/v1";
      result: "no_candidate";
      candidates: [];
      citations: [];
    };

export type SynthesisResponse =
  | {
      schema: "carpeos.llm-synthesize/v1";
      result: "draft";
      draft_text: string;
      citations: CitationSpan[];
    }
  | {
      schema: "carpeos.llm-synthesize/v1";
      result: "no_candidate";
      draft_text: null;
      citations: [];
    };

export type ReducerStatus = "draft" | "blocked" | "no_candidate" | "reducer_conflict";

export type ScopeCounter = {
  /** Allocate next ordinal for a run_scope_key. Key must exist before allocation. */
  nextOrdinal(run_scope_key: string): number;
  /** Replay/uniqueness: (run_scope_key, run_ordinal) must be unique. */
  has(run_scope_key: string, run_ordinal: number): boolean;
  mark(run_scope_key: string, run_ordinal: number): void;
};

/** Create run_scope_key before any ordinal allocation. */
export function createRunScopeKey(binding: {
  fixture?: string;
  pack_id: string;
  redaction_policy_id: string;
  profile_digest_binding?: string;
}): string {
  const hex = sha256Jcs({
    schema: "carpeos.run-scope/v1",
    pack_id: binding.pack_id,
    redaction_policy_id: binding.redaction_policy_id,
    profile_digest_binding: binding.profile_digest_binding ?? null,
    fixture: binding.fixture ?? null,
  }).slice(0, 16);
  return `scope_${hex}`;
}

/** Scopes must be created explicitly before ordinal allocation. */
export function createScopeCounterV2(): ScopeCounter & {
  createScope(run_scope_key: string): void;
} {
  const counters = new Map<string, number>();
  const used = new Set<string>();
  return {
    createScope(run_scope_key: string) {
      if (counters.has(run_scope_key)) {
        throw new Error(`scope already exists: ${run_scope_key}`);
      }
      counters.set(run_scope_key, 0);
    },
    nextOrdinal(run_scope_key: string) {
      if (!counters.has(run_scope_key)) {
        throw new Error("run_scope_key must be created before ordinal allocation");
      }
      const n = counters.get(run_scope_key)!;
      counters.set(run_scope_key, n + 1);
      return n;
    },
    has(run_scope_key, run_ordinal) {
      return used.has(`${run_scope_key}|${run_ordinal}`);
    },
    mark(run_scope_key, run_ordinal) {
      const key = `${run_scope_key}|${run_ordinal}`;
      if (used.has(key)) {
        throw new Error(`replay/conflict: (${run_scope_key}, ${run_ordinal}) already used`);
      }
      used.add(key);
    },
  };
}

export function formulaId(prefix: string, material: unknown): string {
  return `${prefix}${sha256Jcs(material).slice(0, 16)}`;
}

export function profileDigest(fixture: string, binding: string): string {
  return digestSha256({
    schema: "profile_digest",
    fixture,
    source: binding,
  });
}

export function packDigest(fixture: string, pack_id: string): string {
  return digestSha256({
    schema: "carpeos.pack-binding/v1",
    fixture,
    pack_id,
  });
}

export function canonicalInputDigest(
  fixture: string,
  pack_id: string,
  redaction_policy_id: string,
): string {
  return digestSha256({
    schema: "carpeos.canonical-input/v1",
    fixture,
    pack_id,
    redaction_policy_id,
  });
}

export function resultDigest(result: unknown): string {
  return digestSha256({
    schema: "carpeos.llm-attempt-result/v1",
    result,
  });
}

export function candidateDigest(candidateWithoutDigest: unknown): string {
  return digestSha256({
    schema: "carpeos.local-candidate/v1",
    candidate_without_candidate_digest: candidateWithoutDigest,
  });
}

export function synthesisDigest(synthesisWithoutDigest: unknown): string {
  return digestSha256({
    schema: "carpeos.local-synthesis/v1",
    synthesis_without_synthesis_digest: synthesisWithoutDigest,
  });
}

export function outputSha256(output: unknown): string {
  return sha256Hex(jcs(auditFree(output)));
}

export type Span = { segment_id: string; start: number; end: number };

export function spansOverlap(a: Span, b: Span): "none" | "duplicate" | "containment" | "crossing" {
  if (a.segment_id !== b.segment_id) return "none";
  if (a.start === b.start && a.end === b.end) return "duplicate";
  if (a.start >= b.end || b.start >= a.end) return "none";
  if ((a.start <= b.start && a.end >= b.end) || (b.start <= a.start && b.end >= a.end)) {
    return "containment";
  }
  return "crossing";
}

export type ReducerFixtureBundle = {
  fixture: string;
  fixture_input: Record<string, unknown>;
  run_record: Record<string, unknown>;
  attempt_records: Array<Record<string, unknown>>;
  candidates: Array<Record<string, unknown>> | null;
  synthesis: Record<string, unknown> | null;
  prior: Record<string, unknown> | null;
  output: Record<string, unknown>;
  expected: { output_sha256: string };
};

/**
 * Validate a frozen reducer fixture bundle:
 * - recomputes audit-free output hash
 * - checks formula digests declared on the fixture
 * - never materializes canonical authority
 */
export function validateReducerFixture(bundle: ReducerFixtureBundle): {
  pass: boolean;
  computed_output_sha256: string;
  expected_output_sha256: string;
  errors: string[];
} {
  const errors: string[] = [];
  const computed = outputSha256(bundle.output);
  const expected = bundle.expected.output_sha256.replace(/^sha256:/, "");
  if (computed !== expected) {
    errors.push(`output hash mismatch: computed=${computed} expected=${expected}`);
  }
  if (bundle.output.canonical_effect !== undefined && bundle.output.canonical_effect !== "none") {
    // proposal_row carries canonical_effect
  }
  const row = bundle.output.proposal_row as Record<string, unknown> | undefined;
  if (row && row.canonical_effect !== "none") {
    errors.push("proposal_row.canonical_effect must be none");
  }

  // Audit timestamp mutation invariant
  const mutated = structuredClone(bundle.output) as Record<string, unknown>;
  const pr = mutated.proposal_row as Record<string, unknown> | undefined;
  if (pr?.audit_envelope && typeof pr.audit_envelope === "object") {
    (pr.audit_envelope as Record<string, unknown>).updated_at = "2099-01-01T00:00:00Z";
  }
  if (outputSha256(mutated) !== computed) {
    errors.push("audit timestamp mutation altered output hash");
  }

  return {
    pass: errors.length === 0,
    computed_output_sha256: computed,
    expected_output_sha256: expected,
    errors,
  };
}

/**
 * Project draft-only reducer output from a validated intermediate bundle.
 * Uses the fixture's semantic selection; IDs remain formula-derived in fixtures.
 */
export function reduceFromBundle(bundle: ReducerFixtureBundle): {
  output: Record<string, unknown>;
  output_sha256: string;
  canonical_effect: "none";
} {
  const validation = validateReducerFixture(bundle);
  if (!validation.pass) {
    throw new Error(`reducer fixture invalid: ${validation.errors.join("; ")}`);
  }
  return {
    output: bundle.output,
    output_sha256: validation.computed_output_sha256,
    canonical_effect: "none",
  };
}
