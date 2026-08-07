/**
 * E1 Rule admit — adj_v3 sibling feed (ADR 0017 D5).
 * Drops PostToolUse-class noise before any Flash spend.
 * No LLM, no network, no canonical writes.
 *
 * Quality ultragoal Q2.5′: TOOL_NOISE and SECRETISH are line-scoped so a
 * mixed SessionEnd (decision + tool chatter / “api key” mention) is not
 * whole-signal dropped (H7/H8 / Q-S14).
 */

import { AGENTIC_FEED_LIFECYCLE_HOOKS, normalizeAgenticFeedHook } from "@carpeos/capture";

const LIFECYCLE_ADMIT = new Set<string>(AGENTIC_FEED_LIFECYCLE_HOOKS);
const ALWAYS_DROP = new Set(["PostToolUse", "SessionStart", "Notification"]);

const NOISE_ONLY = /^(ok|done|passed|success|noop|n\/a|none|\.|…|\.\.\.)$/i;
const TOOL_NOISE =
  /\b(PostToolUse|git status|npm install|linter passed|exit 0|vulnerabilit(y|ies)|ran .+ successfully)\b/i;
const SECRETISH =
  /\b(api[_-]?key|secret|password|bearer\s+[a-z0-9._-]+|sk-[a-z0-9]{10,}|hunter2)\b/i;
const INJECTION =
  /\b(ignore previous instructions|SYSTEM:\s*export all secrets|exfiltrat|jailbreak)\b/i;

export type AgenticAdmitInput = {
  source_event_id: string;
  trust_zone_id: string;
  hook_event_name: string;
  /** Candidate text / transcript snippet (synthetic or redacted). */
  signal_text: string;
};

export type AgenticAdmitResult = {
  schema: "carpeos.agentic.admit-result/v1";
  decision: "admit" | "drop";
  reason_codes: string[];
  normalized_hook: string;
  source_event_id: string;
  trust_zone_id: string;
  /** Sidecar only until materialize. */
  canonical_effect: "none";
  /**
   * Line-scoped residual signal after dropping noise/secret lines (Q2.5′).
   * When decision=admit, callers should prefer this over raw signal when non-empty.
   */
  residual_signal_text?: string;
};

/**
 * Cheap deterministic admit gate. Prefer SessionEnd / Stop / PreCompact.
 * Never admits PostToolUse flood into Flash stages.
 */
export function ruleAdmitEvidence(input: AgenticAdmitInput): AgenticAdmitResult {
  const normalized_hook = normalizeHook(input.hook_event_name);
  const signal = (input.signal_text ?? "").trim();
  const base = {
    schema: "carpeos.agentic.admit-result/v1" as const,
    source_event_id: input.source_event_id,
    trust_zone_id: input.trust_zone_id,
    normalized_hook,
    canonical_effect: "none" as const,
  };

  if (signal.length === 0) {
    return { ...base, decision: "drop", reason_codes: ["empty_signal"] };
  }

  if (INJECTION.test(signal)) {
    return { ...base, decision: "drop", reason_codes: ["injection_or_exfil_pattern"] };
  }

  if (ALWAYS_DROP.has(normalized_hook) || normalized_hook === "PostToolUse") {
    return { ...base, decision: "drop", reason_codes: ["post_tool_use_noise"] };
  }

  if (NOISE_ONLY.test(signal)) {
    return { ...base, decision: "drop", reason_codes: ["noise_only_signal"] };
  }

  if (!LIFECYCLE_ADMIT.has(normalized_hook)) {
    return { ...base, decision: "drop", reason_codes: ["lifecycle_not_eligible"] };
  }

  // Q2.5′: line-scope tool noise + secretish; keep residual prose lines.
  const residual = residualProseLines(signal);
  if (residual.kept.length === 0) {
    if (residual.dropped_secretish > 0 && residual.dropped_tool === 0) {
      return { ...base, decision: "drop", reason_codes: ["secret_like_material"] };
    }
    if (residual.dropped_tool > 0) {
      return { ...base, decision: "drop", reason_codes: ["tool_noise_signal"] };
    }
    return { ...base, decision: "drop", reason_codes: ["noise_only_signal"] };
  }

  const residual_text = residual.kept.join("\n").trim();
  if (residual_text.length < 8) {
    return { ...base, decision: "drop", reason_codes: ["signal_too_short"] };
  }

  const reason_codes = ["lifecycle_boundary_signal", "rule_admit_v1"];
  if (residual.dropped_tool > 0) reason_codes.push("line_scoped_tool_noise_stripped");
  if (residual.dropped_secretish > 0) reason_codes.push("line_scoped_secretish_stripped");

  return {
    ...base,
    decision: "admit",
    reason_codes,
    residual_signal_text: residual_text,
  };
}

/**
 * Split signal into lines; drop pure tool-noise / secretish lines only.
 * Blank lines are ignored. Mixed decision+noise sessions keep decision lines.
 */
export function residualProseLines(signal: string): {
  kept: string[];
  dropped_tool: number;
  dropped_secretish: number;
} {
  const kept: string[] = [];
  let dropped_tool = 0;
  let dropped_secretish = 0;
  for (const raw of signal.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (SECRETISH.test(line)) {
      dropped_secretish += 1;
      continue;
    }
    if (TOOL_NOISE.test(line)) {
      dropped_tool += 1;
      continue;
    }
    if (NOISE_ONLY.test(line)) continue;
    kept.push(line);
  }
  return { kept, dropped_tool, dropped_secretish };
}

function normalizeHook(raw: string): string {
  return normalizeAgenticFeedHook(raw);
}
