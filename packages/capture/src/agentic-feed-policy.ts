/**
 * Shared policy for what may enter the agentic_capture_feed.
 * Aligns with E1 rule admit lifecycle allowlist — never enqueue PostToolUse flood.
 * No LLM. Used by local-store insert and CLI claim/prefer.
 */

/** Hooks that may enter the post-capture agentic brain (Flash path). */
export const AGENTIC_FEED_LIFECYCLE_HOOKS = ["SessionEnd", "Stop", "PreCompact"] as const;

export type AgenticFeedLifecycleHook = (typeof AGENTIC_FEED_LIFECYCLE_HOOKS)[number];

const LIFECYCLE = new Set<string>(AGENTIC_FEED_LIFECYCLE_HOOKS);

/**
 * Normalize provider hook spellings to canonical lifecycle names.
 * Same map as agentic E1 admit (keep in sync).
 */
export function normalizeAgenticFeedHook(raw: string): string {
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

/** True when this hook should be inserted into agentic_capture_feed. */
export function isAgenticFeedHookEligible(hookEventName: string): boolean {
  return LIFECYCLE.has(normalizeAgenticFeedHook(hookEventName));
}

/**
 * SQL CASE expression fragment for prefer-lifecycle ORDER BY (hook_event_name column).
 * Lower rank = claimed first.
 */
export function agenticFeedHookPreferRankSql(column = "hook_event_name"): string {
  // SessionEnd first, then Stop, PreCompact, then everything else.
  return `CASE
    WHEN lower(replace(replace(${column}, '_', ''), '-', '')) IN ('sessionend') THEN 0
    WHEN lower(replace(replace(${column}, '_', ''), '-', '')) IN ('stop') THEN 1
    WHEN lower(replace(replace(${column}, '_', ''), '-', '')) IN ('precompact') THEN 2
    ELSE 9
  END`;
}
