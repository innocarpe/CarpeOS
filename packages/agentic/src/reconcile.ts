/**
 * E10 Periodic reconcile — dedupe + contradict proposals (ADR 0017 D5).
 * Deterministic, offline, no LLM. Never auto-accepts or auto-supersedes.
 * Human hold path only: emits reason-coded proposal actions for operator review.
 */

import type { CanonicalEvent } from "@carpeos/schema";
import { digestSha256, stableJson } from "./digest.js";
import type { SqlDatabase } from "./sql.js";
import { AGENTIC_POLICY_VERSION } from "./types.js";

export type ReconcileUnit = {
  event_id: string;
  event_type: "Observation" | "Claim";
  statement: string;
  lifecycle_status: string;
  subject_ref: string;
  kind_hint: string | null;
};

export type ReconcileAction =
  | {
      action: "hold_duplicate";
      group_id: string;
      keep_event_id: string;
      duplicate_event_ids: string[];
      normalized_statement: string;
      reason_codes: string[];
    }
  | {
      action: "hold_contradiction";
      group_id: string;
      left_event_id: string;
      right_event_id: string;
      reason_codes: string[];
      note: string;
    };

export type ReconcileReport = {
  schema: "carpeos.agentic.reconcile-report/v1";
  policy_version: typeof AGENTIC_POLICY_VERSION;
  ok: boolean;
  unit_count: number;
  action_count: number;
  duplicate_groups: number;
  contradiction_pairs: number;
  actions: ReconcileAction[];
  reason_codes: string[];
  /** Digest of actions for job idempotency / audit. */
  output_digest: `sha256:${string}`;
};

export type ReconcileInput = {
  units: readonly ReconcileUnit[];
  /** Max actions to emit (default 100). */
  limit?: number;
};

/**
 * Run deterministic E10 reconcile over meaning units.
 */
export function reconcileAgenticUnits(input: ReconcileInput): ReconcileReport {
  const limit = input.limit ?? 100;
  const actions: ReconcileAction[] = [];
  const reason_codes: string[] = [];

  const units = input.units
    .map((u) => ({
      ...u,
      statement: u.statement.trim(),
      norm: normalizeStatement(u.statement),
    }))
    .filter((u) => u.norm.length >= 8)
    .sort((a, b) => a.event_id.localeCompare(b.event_id));

  // --- Dedupe by normalized statement + subject ---
  const byKey = new Map<string, typeof units>();
  for (const u of units) {
    const key = `${u.subject_ref.trim().toLowerCase()}|${u.norm}`;
    const list = byKey.get(key) ?? [];
    list.push(u);
    byKey.set(key, list);
  }

  let duplicate_groups = 0;
  for (const [key, group] of [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (group.length < 2) continue;
    if (actions.length >= limit) break;
    duplicate_groups += 1;
    // Prefer active over draft; then earliest event_id as keep.
    const ranked = [...group].sort((a, b) => {
      const life =
        lifecycleRank(a.lifecycle_status) - lifecycleRank(b.lifecycle_status) ||
        a.event_id.localeCompare(b.event_id);
      return life;
    });
    const keep = ranked[0]!;
    const dups = ranked.slice(1).map((u) => u.event_id);
    actions.push({
      action: "hold_duplicate",
      group_id: `dup_${digestSha256({ key }).slice("sha256:".length, "sha256:".length + 16)}`,
      keep_event_id: keep.event_id,
      duplicate_event_ids: dups,
      normalized_statement: keep.norm,
      reason_codes: ["e10_duplicate_statement", "human_hold_path"],
    });
  }

  // --- Contradict heuristic pairs under same subject ---
  let contradiction_pairs = 0;
  const bySubject = new Map<string, typeof units>();
  for (const u of units) {
    const s = u.subject_ref.trim().toLowerCase() || "unknown";
    const list = bySubject.get(s) ?? [];
    list.push(u);
    bySubject.set(s, list);
  }

  for (const [, group] of [...bySubject.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        if (actions.length >= limit) break;
        const left = group[i]!;
        const right = group[j]!;
        const pair = detectContradiction(left.statement, right.statement);
        if (pair === null) continue;
        // Skip if same normalized statement (already covered by dedupe).
        if (left.norm === right.norm) continue;
        contradiction_pairs += 1;
        actions.push({
          action: "hold_contradiction",
          group_id: `ctr_${digestSha256({
            a: left.event_id,
            b: right.event_id,
          }).slice("sha256:".length, "sha256:".length + 16)}`,
          left_event_id: left.event_id,
          right_event_id: right.event_id,
          reason_codes: ["e10_contradiction_heuristic", "human_hold_path", pair.code],
          note: pair.note,
        });
      }
    }
  }

  if (actions.length === 0) reason_codes.push("reconcile_clean");
  else reason_codes.push("reconcile_actions_emitted");
  reason_codes.push("no_auto_acceptance_decision");
  reason_codes.push("no_llm_supersession");

  const output_digest = digestSha256({
    schema: "carpeos.agentic.reconcile-output/v1",
    actions,
  });

  return {
    schema: "carpeos.agentic.reconcile-report/v1",
    policy_version: AGENTIC_POLICY_VERSION,
    ok: true,
    unit_count: units.length,
    action_count: actions.length,
    duplicate_groups,
    contradiction_pairs,
    actions: actions.slice(0, limit),
    reason_codes,
    output_digest,
  };
}

/**
 * Build reconcile units from canonical event snapshots (Observation + Claim only).
 */
export function unitsFromCanonicalEvents(events: readonly CanonicalEvent[]): ReconcileUnit[] {
  const out: ReconcileUnit[] = [];
  for (const event of events) {
    if (event.event_type === "Observation") {
      out.push({
        event_id: event.event_id,
        event_type: "Observation",
        statement: event.payload.statement,
        lifecycle_status: event.lifecycle_status,
        subject_ref: event.subject_ref,
        kind_hint: null,
      });
    } else if (event.event_type === "Claim") {
      out.push({
        event_id: event.event_id,
        event_type: "Claim",
        statement: event.payload.statement,
        lifecycle_status: event.lifecycle_status,
        subject_ref: event.subject_ref,
        kind_hint: event.payload.claim_type,
      });
    }
  }
  return out;
}

/** Persist last reconcile receipt in agentic sidecar (audit only). */
export function putReconcileReceipt(
  db: SqlDatabase,
  report: ReconcileReport,
  trust_zone_id: string,
  now = new Date(),
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agentic_reconcile_receipts (
      receipt_id TEXT PRIMARY KEY,
      trust_zone_id TEXT NOT NULL,
      output_digest TEXT NOT NULL,
      receipt_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agentic_reconcile_zone
      ON agentic_reconcile_receipts (trust_zone_id, created_at);
  `);
  const receipt_id = `rc_${report.output_digest.slice("sha256:".length, "sha256:".length + 24)}`;
  db.prepare(
    `
      INSERT OR IGNORE INTO agentic_reconcile_receipts (
        receipt_id, trust_zone_id, output_digest, receipt_json, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `,
  ).run(receipt_id, trust_zone_id, report.output_digest, stableJson(report), now.toISOString());
}

function normalizeStatement(statement: string): string {
  return statement
    .toLowerCase()
    .replace(/[“”"'`]/g, "")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lifecycleRank(status: string): number {
  // Lower is better (keep first).
  if (status === "active") return 0;
  if (status === "draft") return 1;
  return 2;
}

function detectContradiction(left: string, right: string): { code: string; note: string } | null {
  const a = left.toLowerCase();
  const b = right.toLowerCase();

  // never X vs always/must X (shared content token)
  const neverA = /\bnever\b/.test(a) || /\bmust never\b/.test(a) || /\bmust not\b/.test(a);
  const neverB = /\bnever\b/.test(b) || /\bmust never\b/.test(b) || /\bmust not\b/.test(b);
  const alwaysA = /\balways\b/.test(a) || /\bmust\b/.test(a);
  const alwaysB = /\balways\b/.test(b) || /\bmust\b/.test(b);
  if ((neverA && alwaysB) || (neverB && alwaysA)) {
    const tokensA = new Set(tokenize(a).filter((t) => t.length > 3 && !NEGATION.has(t)));
    const tokensB = new Set(tokenize(b).filter((t) => t.length > 3 && !NEGATION.has(t)));
    let shared = 0;
    for (const t of tokensA) if (tokensB.has(t)) shared += 1;
    if (shared >= 2) {
      return {
        code: "polarity_never_vs_must",
        note: "Subject-scoped never/must polarity conflict (heuristic)",
      };
    }
  }

  // allow X vs forbid/ban/prohibit X
  const forbid = /\b(forbid|forbidden|prohibit|ban|disallow)\b/;
  const allow = /\b(allow|allowed|permit|permitted)\b/;
  if ((forbid.test(a) && allow.test(b)) || (forbid.test(b) && allow.test(a))) {
    const tokensA = new Set(tokenize(a).filter((t) => t.length > 3));
    const tokensB = new Set(tokenize(b).filter((t) => t.length > 3));
    let shared = 0;
    for (const t of tokensA) if (tokensB.has(t)) shared += 1;
    if (shared >= 2) {
      return {
        code: "allow_vs_forbid",
        note: "Subject-scoped allow/forbid polarity conflict (heuristic)",
      };
    }
  }

  return null;
}

const NEGATION = new Set([
  "never",
  "not",
  "must",
  "always",
  "will",
  "shall",
  "should",
  "allow",
  "forbid",
]);

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
