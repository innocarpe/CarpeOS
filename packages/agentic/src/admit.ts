/**
 * E1 Rule admit — adj_v3 sibling feed (ADR 0017 D5).
 * Drops PostToolUse-class noise before any Flash spend.
 * No LLM, no network, no canonical writes.
 */

const LIFECYCLE_ADMIT = new Set(["SessionEnd", "Stop", "PreCompact"]);
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

  if (SECRETISH.test(signal)) {
    return { ...base, decision: "drop", reason_codes: ["secret_like_material"] };
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

  // Tool chatter must never reach Flash — even on lifecycle hooks (SessionEnd dumps).
  if (TOOL_NOISE.test(signal)) {
    return { ...base, decision: "drop", reason_codes: ["tool_noise_signal"] };
  }

  if (!LIFECYCLE_ADMIT.has(normalized_hook)) {
    // Non-lifecycle hooks: drop by default for Flash cost control (slice-1).
    return { ...base, decision: "drop", reason_codes: ["lifecycle_not_eligible"] };
  }

  if (signal.length < 8) {
    return { ...base, decision: "drop", reason_codes: ["signal_too_short"] };
  }

  return {
    ...base,
    decision: "admit",
    reason_codes: ["lifecycle_boundary_signal", "rule_admit_v1"],
  };
}

function normalizeHook(raw: string): string {
  const t = raw.trim();
  if (t.length === 0) return "unknown";
  const key = t.toLowerCase().replace(/[\s_-]+/g, "");
  const map: Record<string, string> = {
    sessionend: "SessionEnd",
    stop: "Stop",
    precompact: "PreCompact",
    posttooluse: "PostToolUse",
    sessionstart: "SessionStart",
    notification: "Notification",
    userpromptsubmit: "UserPromptSubmit",
  };
  return map[key] ?? t;
}
