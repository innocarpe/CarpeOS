import type { CaptureEnvelope } from "@carpeos/capture";

export type SupportedProvider = "codex" | "claude" | "grok";

export type NormalizeHookInput = {
  provider: SupportedProvider;
  raw: Record<string, unknown>;
  subjectRef: string;
  fallbackCapturedAt: string;
  explicitIdempotencyKey?: string;
};

export class HookInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HookInputError";
  }
}

export function normalizeHookEnvelope(input: NormalizeHookInput): CaptureEnvelope {
  const eventName = firstString(
    input.provider === "grok" ? input.raw.hookEventName : input.raw.hook_event_name,
    input.raw.type,
  );
  if (eventName === undefined) {
    throw new HookInputError("provider payload must include a lifecycle event name");
  }

  const capturedAt = normalizeSourceTimestamp(
    firstString(input.raw.timestamp, input.raw.created_at, input.raw.createdAt),
    input.fallbackCapturedAt,
  );
  const workspaceRoot = firstString(
    input.provider === "grok" ? input.raw.workspaceRoot : input.raw.workspace_root,
    input.raw.cwd,
  );
  const sessionId = firstString(
    input.provider === "grok" ? input.raw.sessionId : input.raw.session_id,
    input.raw["thread-id"],
  );
  const sourceEventId = firstString(
    input.provider === "grok" ? input.raw.turnId : input.raw.turn_id,
    input.raw["turn-id"],
    input.raw.tool_use_id,
  );

  return {
    provider: input.provider,
    hook_event_name: eventName,
    captured_at: capturedAt,
    payload: input.raw,
    subject_ref: input.subjectRef,
    media_type: "application/json",
    ...(workspaceRoot === undefined ? {} : { workspace_root: workspaceRoot }),
    ...(sessionId === undefined ? {} : { session_id: sessionId }),
    ...(sourceEventId === undefined ? {} : { source_event_id: sourceEventId }),
    ...(input.explicitIdempotencyKey === undefined
      ? {}
      : { idempotency_key: input.explicitIdempotencyKey }),
  };
}

export function isSupportedProvider(value: string): value is SupportedProvider {
  return value === "codex" || value === "claude" || value === "grok";
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function normalizeSourceTimestamp(value: string | undefined, fallback: string): string {
  if (value === undefined) {
    return fallback;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }
  return parsed.toISOString().replace(".000Z", "Z");
}
