/**
 * Deterministic front-end gate (ultragoal DF1).
 *
 * Runs before any Flash / LLM spend. Shared SSOT for:
 * - agentic E1 admit
 * - agentic_capture_feed enqueue (skip vs pending)
 *
 * No network, no canonical writes, no LLM.
 */

import {
  AGENTIC_FEED_LIFECYCLE_HOOKS,
  normalizeAgenticFeedHook,
} from "./agentic-feed-policy.js";

const LIFECYCLE_ADMIT = new Set<string>(AGENTIC_FEED_LIFECYCLE_HOOKS);
/** Noise hooks that never enter Flash even if lifecycle map changes. */
const POST_TOOL_NOISE_HOOKS = new Set(["PostToolUse"]);

/** Whole-signal noise (short acks / harness pings). */
const NOISE_ONLY =
  /^(ok|okay|done|passed|success|noop|n\/a|none|thanks?|thank you|lgtm|wip|test|ping|pong|yes|no|y|n|\.|…|\.\.\.)$/i;

/**
 * Tool / CI *output* lines — keep decision prose that merely *mentions* a command
 * (e.g. "require make preflight before PR") by anchoring common chatter patterns.
 */
const TOOL_NOISE =
  /^(?:PostToolUse|git status|npm install|pnpm (?:install|test|check)|PREFLIGHT PASS|make preflight(?:-fix|-quick)?)\s*$/i;
const TOOL_NOISE_INLINE =
  /\b(linter passed|exit 0|vulnerabilit(y|ies)|ran .+ successfully)\b/i;
const SECRETISH =
  /\b(api[_-]?key|secret|password|bearer\s+[a-z0-9._-]+|sk-[a-z0-9]{10,}|hunter2)\b/i;

const INJECTION =
  /\b(ignore previous instructions|SYSTEM:\s*export all secrets|exfiltrat|jailbreak)\b/i;

/** Session plumbing / telemetry-only lines (no load-bearing prose). */
const TELEMETRY_LINE =
  /\b(hook_event_name|session_id|agent_type|cache_evidence|prefix_epoch|model_used|tool_count|mcp_wait_ms|elapsed_since_turn_start)\b/i;

export const DETERMINISTIC_FRONT_POLICY_VERSION = "front_v1" as const;

export type DeterministicFrontInput = {
  hook_event_name: string;
  /** Candidate text / transcript snippet (synthetic or redacted). */
  signal_text: string;
  /**
   * When true (default), non-lifecycle hooks drop (feed + Flash path).
   * Set false only for callers that already filtered hooks.
   */
  require_lifecycle_hook?: boolean;
};

export type DeterministicFrontDecision = "pass" | "drop";

export type DeterministicFrontResult = {
  schema: "carpeos.deterministic-front-result/v1";
  policy_version: typeof DETERMINISTIC_FRONT_POLICY_VERSION;
  decision: DeterministicFrontDecision;
  reason_codes: string[];
  normalized_hook: string;
  /**
   * Line-scoped residual after dropping tool/secret/telemetry lines.
   * Prefer this over raw signal when decision=pass and non-empty.
   */
  residual_signal_text?: string;
};

/**
 * Cheap deterministic front evaluation. Precision-first drop of obvious garbage.
 */
export function evaluateDeterministicFront(input: DeterministicFrontInput): DeterministicFrontResult {
  const normalized_hook = normalizeAgenticFeedHook(input.hook_event_name);
  const signal = (input.signal_text ?? "").trim();
  const requireLifecycle = input.require_lifecycle_hook !== false;
  const base = {
    schema: "carpeos.deterministic-front-result/v1" as const,
    policy_version: DETERMINISTIC_FRONT_POLICY_VERSION,
    normalized_hook,
  };

  if (signal.length === 0) {
    return { ...base, decision: "drop", reason_codes: ["empty_signal"] };
  }

  if (INJECTION.test(signal)) {
    return { ...base, decision: "drop", reason_codes: ["injection_or_exfil_pattern"] };
  }

  if (POST_TOOL_NOISE_HOOKS.has(normalized_hook) || normalized_hook === "PostToolUse") {
    return { ...base, decision: "drop", reason_codes: ["post_tool_use_noise"] };
  }

  if (NOISE_ONLY.test(signal)) {
    return { ...base, decision: "drop", reason_codes: ["noise_only_signal"] };
  }

  if (requireLifecycle && !LIFECYCLE_ADMIT.has(normalized_hook)) {
    return { ...base, decision: "drop", reason_codes: ["lifecycle_not_eligible"] };
  }

  const residual = residualProseLines(signal);
  if (residual.kept.length === 0) {
    if (residual.dropped_secretish > 0 && residual.dropped_tool === 0 && residual.dropped_telemetry === 0) {
      return { ...base, decision: "drop", reason_codes: ["secret_like_material"] };
    }
    if (residual.dropped_tool > 0 || residual.dropped_telemetry > 0) {
      return {
        ...base,
        decision: "drop",
        reason_codes:
          residual.dropped_telemetry > 0 && residual.dropped_tool === 0
            ? ["telemetry_only_signal"]
            : ["tool_noise_signal"],
      };
    }
    return { ...base, decision: "drop", reason_codes: ["noise_only_signal"] };
  }

  const residual_text = residual.kept.join("\n").trim();
  if (residual_text.length < 8) {
    return { ...base, decision: "drop", reason_codes: ["signal_too_short"] };
  }

  // Entire residual is still just ack-like tokens.
  if (NOISE_ONLY.test(residual_text)) {
    return { ...base, decision: "drop", reason_codes: ["noise_only_signal"] };
  }

  const reason_codes = ["lifecycle_boundary_signal", "front_v1_pass"];
  if (residual.dropped_tool > 0) reason_codes.push("line_scoped_tool_noise_stripped");
  if (residual.dropped_secretish > 0) reason_codes.push("line_scoped_secretish_stripped");
  if (residual.dropped_telemetry > 0) reason_codes.push("line_scoped_telemetry_stripped");

  return {
    ...base,
    decision: "pass",
    reason_codes,
    residual_signal_text: residual_text,
  };
}

/**
 * Split signal into lines; drop pure tool-noise / secretish / telemetry lines.
 * Blank lines ignored. Mixed decision+noise sessions keep decision lines.
 */
export function residualProseLines(signal: string): {
  kept: string[];
  dropped_tool: number;
  dropped_secretish: number;
  dropped_telemetry: number;
} {
  const kept: string[] = [];
  let dropped_tool = 0;
  let dropped_secretish = 0;
  let dropped_telemetry = 0;
  for (const raw of signal.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (SECRETISH.test(line)) {
      dropped_secretish += 1;
      continue;
    }
    if (TOOL_NOISE.test(line) || TOOL_NOISE_INLINE.test(line)) {
      dropped_tool += 1;
      continue;
    }
    if (TELEMETRY_LINE.test(line) && line.length < 200) {
      dropped_telemetry += 1;
      continue;
    }
    if (NOISE_ONLY.test(line)) continue;
    kept.push(line);
  }
  return { kept, dropped_tool, dropped_secretish, dropped_telemetry };
}

/** Map front result to legacy admit decision string. */
export function frontDecisionToAdmit(decision: DeterministicFrontDecision): "admit" | "drop" {
  return decision === "pass" ? "admit" : "drop";
}
