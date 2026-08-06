import type { CaptureEnvelope } from "@carpeos/capture";

/**
 * First-class capture providers.
 * JSON lifecycle hosts: claude, codex, grok, deepseek_build
 * Plugin/TS hook hosts: gjc
 * MCP-primary hosts (hooks optional/future): deepcode, reasonix
 */
export type SupportedProvider =
  | "codex"
  | "claude"
  | "grok"
  | "gjc"
  | "deepcode"
  | "reasonix"
  | "deepseek_build";

export const SUPPORTED_PROVIDERS: readonly SupportedProvider[] = [
  "codex",
  "claude",
  "grok",
  "gjc",
  "deepcode",
  "reasonix",
  "deepseek_build",
] as const;

/** Aliases accepted on --provider / host specs. */
const PROVIDER_ALIASES: Record<string, SupportedProvider> = {
  codex: "codex",
  claude: "claude",
  grok: "grok",
  gjc: "gjc",
  gajae: "gjc",
  "gajae-code": "gjc",
  deepcode: "deepcode",
  "deep-code": "deepcode",
  reasonix: "reasonix",
  deepseek_build: "deepseek_build",
  "deepseek-build": "deepseek_build",
  dsb: "deepseek_build",
};

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

/** Providers that commonly send camelCase lifecycle fields (Grok Build family). */
function prefersCamelCase(provider: SupportedProvider): boolean {
  return provider === "grok" || provider === "deepseek_build";
}

export function normalizeHookEnvelope(input: NormalizeHookInput): CaptureEnvelope {
  const camel = prefersCamelCase(input.provider);
  const eventName = firstString(
    camel ? input.raw.hookEventName : input.raw.hook_event_name,
    input.raw.hook_event_name,
    input.raw.hookEventName,
    input.raw.type,
    input.raw.event,
    input.raw.event_name,
  );
  if (eventName === undefined) {
    throw new HookInputError("provider payload must include a lifecycle event name");
  }

  const capturedAt = normalizeSourceTimestamp(
    firstString(input.raw.timestamp, input.raw.created_at, input.raw.createdAt),
    input.fallbackCapturedAt,
  );
  const workspaceRoot = firstString(
    camel ? input.raw.workspaceRoot : input.raw.workspace_root,
    input.raw.workspace_root,
    input.raw.workspaceRoot,
    input.raw.cwd,
  );
  const sessionId = firstString(
    camel ? input.raw.sessionId : input.raw.session_id,
    input.raw.session_id,
    input.raw.sessionId,
    input.raw["thread-id"],
  );
  const sourceEventId = firstString(
    camel ? input.raw.turnId : input.raw.turn_id,
    input.raw.turn_id,
    input.raw.turnId,
    input.raw["turn-id"],
    input.raw.tool_use_id,
    input.raw.toolCallId,
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
  return normalizeProviderId(value) !== undefined;
}

export function normalizeProviderId(value: string): SupportedProvider | undefined {
  const key = value.trim().toLowerCase();
  return PROVIDER_ALIASES[key];
}

export function supportedProviderHelpList(): string {
  return "codex | claude | grok | gjc | deepcode | reasonix | deepseek_build (aliases: gajae, dsb)";
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
