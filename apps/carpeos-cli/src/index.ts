#!/usr/bin/env -S node --disable-warning=ExperimentalWarning

import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { isIdempotencyKey } from "@carpeos/capture";
import {
  IdempotencyConflictError,
  isTrustZoneId,
  LocalCaptureStore,
  runtimeDirFromEnv,
} from "@carpeos/local-store";
import { HookInputError, isSupportedProvider, normalizeHookEnvelope } from "./adapters.js";

type JsonObject = Record<string, unknown>;

class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export async function runCli(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  let failOpen = false;

  try {
    const { command, rest } = splitCommand(argv);
    failOpen = command === "capture-hook" && rest.includes("--fail-open");
    switch (command) {
      case "init":
        return runInit(rest, env);
      case "project":
        return runProject(rest, env);
      case "capture-hook":
        return await runCaptureHook(rest, env);
      case "outbox":
        return runOutbox(rest, env);
      default:
        throw new CliUsageError(`unknown command: ${command}`);
    }
  } catch (error) {
    if (failOpen) {
      writeJson(process.stderr, {
        ok: false,
        warning: {
          code: "capture_failed_open",
          message: "CarpeOS capture failed open; the provider workflow may continue.",
        },
      });
      return 0;
    }

    const publicError = toPublicError(error);
    writeJson(process.stderr, {
      ok: false,
      error: {
        code: publicError.code,
        message: publicError.message,
      },
    });
    return publicError.exitCode;
  }
}

function runInit(argv: readonly string[], env: NodeJS.ProcessEnv): number {
  const options = parseCommonOptions(argv);
  const store = openStore(options, env);
  try {
    writeJson(process.stdout, {
      ok: true,
      command: "init",
      runtime_dir: store.runtimeDir,
      database_path: store.dbPath,
      project_id: store.projectId,
      client_id: store.clientId,
      trust_zone_id: store.trustZone.trust_zone_id,
    });
    return 0;
  } finally {
    store.close();
  }
}

function runProject(argv: readonly string[], env: NodeJS.ProcessEnv): number {
  const [subcommand, ...rest] = argv;
  if (subcommand !== "identify") {
    throw new CliUsageError("project requires the identify subcommand");
  }
  const options = parseCommonOptions(rest);
  const store = openStore(options, env);
  try {
    writeJson(process.stdout, {
      ok: true,
      command: "project identify",
      project_id: store.projectId,
      client_id: store.clientId,
      trust_zone_id: store.trustZone.trust_zone_id,
    });
    return 0;
  } finally {
    store.close();
  }
}

async function runCaptureHook(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  const parsed = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      provider: { type: "string" },
      input: { type: "string", default: "stdin" },
      "fail-open": { type: "boolean", default: false },
      quiet: { type: "boolean", default: false },
      home: { type: "string" },
      "project-id": { type: "string" },
      "trust-zone": { type: "string" },
      "idempotency-key": { type: "string" },
    },
  });
  const provider = parsed.values.provider;
  if (provider === undefined || !isSupportedProvider(provider)) {
    throw new CliUsageError("capture-hook requires --provider codex, claude, or grok");
  }
  if (parsed.values.input !== "stdin" && parsed.values.input !== "argv") {
    throw new CliUsageError("--input must be stdin or argv");
  }
  const explicitIdempotencyKey = parsed.values["idempotency-key"];
  if (explicitIdempotencyKey !== undefined && !isIdempotencyKey(explicitIdempotencyKey)) {
    throw new CliUsageError("--idempotency-key must match idem_[A-Za-z0-9_-]{16,128}");
  }

  const rawText =
    parsed.values.input === "argv" ? parseArgvInput(parsed.positionals) : await readStdin();
  const raw = parseJsonObject(rawText);
  const store = openStore(
    compactCommonOptions(
      parsed.values.home,
      parsed.values["project-id"],
      parsed.values["trust-zone"],
    ),
    env,
  );
  try {
    const envelope = normalizeHookEnvelope({
      provider,
      raw,
      subjectRef: store.projectId,
      fallbackCapturedAt: new Date().toISOString(),
      ...(explicitIdempotencyKey === undefined ? {} : { explicitIdempotencyKey }),
    });
    const result = store.captureHook(envelope);
    if (!parsed.values.quiet) {
      writeJson(process.stdout, {
        ok: true,
        command: "capture-hook",
        status: result.status,
        event_id: result.event.event_id,
        event_type: result.event.event_type,
        local_sequence: result.local_sequence,
        outbox_id: result.outbox_id,
        request_fingerprint: result.request_fingerprint,
        trust_zone_id: result.event.trust_zone.trust_zone_id,
        project_id: store.projectId,
      });
    }
    return 0;
  } finally {
    store.close();
  }
}

function runOutbox(argv: readonly string[], env: NodeJS.ProcessEnv): number {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined) {
    throw new CliUsageError("outbox requires status, lease, ack, or retry");
  }

  const parsed = parseArgs({
    args: rest,
    allowPositionals: false,
    strict: true,
    options: {
      home: { type: "string" },
      "project-id": { type: "string" },
      "trust-zone": { type: "string" },
      limit: { type: "string", default: "10" },
      "lease-ms": { type: "string", default: "30000" },
      "outbox-id": { type: "string" },
      "lease-id": { type: "string" },
      "delay-ms": { type: "string", default: "1000" },
      error: { type: "string", default: "retry requested by operator" },
    },
  });
  const store = openStore(
    compactCommonOptions(
      parsed.values.home,
      parsed.values["project-id"],
      parsed.values["trust-zone"],
    ),
    env,
  );
  try {
    switch (subcommand) {
      case "status":
        writeJson(process.stdout, {
          ok: true,
          command: "outbox status",
          status: store.outboxStatus(),
        });
        return 0;
      case "lease": {
        const lease = store.leaseOutbox(
          parseInteger(parsed.values.limit, "--limit", 1),
          parseInteger(parsed.values["lease-ms"], "--lease-ms", 1),
        );
        writeJson(process.stdout, {
          ok: true,
          command: "outbox lease",
          lease,
        });
        return 0;
      }
      case "ack": {
        const outboxId = parseRequiredInteger(parsed.values["outbox-id"], "--outbox-id");
        const leaseId = requireString(parsed.values["lease-id"], "--lease-id");
        const acknowledged = store.ackOutbox(outboxId, leaseId);
        writeJson(process.stdout, {
          ok: acknowledged,
          command: "outbox ack",
          acknowledged,
          outbox_id: outboxId,
        });
        return acknowledged ? 0 : 2;
      }
      case "retry": {
        const outboxId = parseRequiredInteger(parsed.values["outbox-id"], "--outbox-id");
        const leaseId = requireString(parsed.values["lease-id"], "--lease-id");
        const scheduled = store.retryOutbox(
          outboxId,
          leaseId,
          parseInteger(parsed.values["delay-ms"], "--delay-ms", 0),
          parsed.values.error ?? "retry requested by operator",
        );
        writeJson(process.stdout, {
          ok: scheduled,
          command: "outbox retry",
          scheduled,
          outbox_id: outboxId,
        });
        return scheduled ? 0 : 2;
      }
      default:
        throw new CliUsageError(`unknown outbox subcommand: ${subcommand}`);
    }
  } finally {
    store.close();
  }
}

type CommonOptions = {
  home?: string;
  projectId?: string;
  trustZone?: string;
};

function parseCommonOptions(argv: readonly string[]): CommonOptions {
  const parsed = parseArgs({
    args: [...argv],
    allowPositionals: false,
    strict: true,
    options: {
      home: { type: "string" },
      "project-id": { type: "string" },
      "trust-zone": { type: "string" },
    },
  });
  return compactCommonOptions(
    parsed.values.home,
    parsed.values["project-id"],
    parsed.values["trust-zone"],
  );
}

function compactCommonOptions(
  home: string | undefined,
  projectId: string | undefined,
  trustZone: string | undefined,
): CommonOptions {
  return {
    ...(home === undefined ? {} : { home }),
    ...(projectId === undefined ? {} : { projectId }),
    ...(trustZone === undefined ? {} : { trustZone }),
  };
}

function openStore(options: CommonOptions, env: NodeJS.ProcessEnv): LocalCaptureStore {
  const runtimeDir = options.home ?? runtimeDirFromEnv(env);
  if (options.trustZone !== undefined && !isTrustZoneId(options.trustZone)) {
    throw new CliUsageError("--trust-zone must match tz_[a-z0-9][a-z0-9_-]{2,63}");
  }
  return new LocalCaptureStore({
    runtimeDir,
    workspaceRoot: process.cwd(),
    ...(options.projectId === undefined ? {} : { explicitProjectId: options.projectId }),
    ...(options.trustZone === undefined ? {} : { trustZoneId: options.trustZone }),
  });
}

function splitCommand(argv: readonly string[]): { command: string; rest: readonly string[] } {
  const [command, ...rest] = argv;
  if (command === undefined) {
    throw new CliUsageError(
      "a command is required: init, project identify, capture-hook, or outbox",
    );
  }
  return { command, rest };
}

function parseArgvInput(positionals: readonly string[]): string {
  if (positionals.length !== 1) {
    throw new CliUsageError("--input argv requires exactly one JSON positional argument");
  }
  return positionals[0] ?? "";
}

function parseJsonObject(value: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new HookInputError("provider input must be valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HookInputError("provider input must be a JSON object");
  }
  return parsed as JsonObject;
}

async function readStdin(): Promise<string> {
  process.stdin.setEncoding("utf8");
  let value = "";
  for await (const chunk of process.stdin) {
    value += chunk;
  }
  return value;
}

function parseRequiredInteger(value: string | undefined, name: string): number {
  if (value === undefined) {
    throw new CliUsageError(`${name} is required`);
  }
  return parseInteger(value, name, 1);
}

function parseInteger(value: string | undefined, name: string, minimum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new CliUsageError(`${name} must be an integer greater than or equal to ${minimum}`);
  }
  return parsed;
}

function requireString(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new CliUsageError(`${name} is required`);
  }
  return value;
}

function toPublicError(error: unknown): { code: string; message: string; exitCode: number } {
  if (error instanceof IdempotencyConflictError) {
    return {
      code: "idempotency_conflict",
      message: "The idempotency key was already used for different logical content.",
      exitCode: 3,
    };
  }
  if (error instanceof CliUsageError) {
    return { code: "invalid_usage", message: error.message, exitCode: 2 };
  }
  if (error instanceof HookInputError) {
    return { code: "invalid_provider_input", message: error.message, exitCode: 2 };
  }
  if (isParseArgsError(error)) {
    return { code: "invalid_usage", message: "The command options are invalid.", exitCode: 2 };
  }
  return {
    code: "internal_error",
    message: "The local CarpeOS operation failed.",
    exitCode: 1,
  };
}

function isParseArgsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    (error as { code: string }).code.startsWith("ERR_PARSE_ARGS_")
  );
}

function writeJson(stream: NodeJS.WriteStream, value: unknown): void {
  stream.write(`${JSON.stringify(value)}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli();
}
