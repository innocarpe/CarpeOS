#!/usr/bin/env -S node --disable-warning=ExperimentalWarning

import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { isIdempotencyKey } from "@carpeos/capture";
import {
  IdempotencyConflictError,
  isTrustZoneId,
  LocalCaptureStore,
  runtimeDirFromEnv,
  withLocalRetrievalDatabase,
} from "@carpeos/local-store";
import { createCarpeosMcpApplication } from "@carpeos/mcp-server";
import {
  ackEmbeddingJob,
  DETERMINISTIC_LOCAL_DEV_EMBEDDING,
  deterministicLocalDevEmbedding,
  ensureEmbeddingJob,
  leaseEmbeddingJobs,
  makeEmbeddingRecord,
  rebuildLocalRetrievalIndex,
  searchLocalRetrievalIndex,
  storeLocalVector,
} from "@carpeos/retrieval";
import type { RetrievalQuery } from "@carpeos/schema";
import type { RetrievalChunk } from "@carpeos/schema";
import { OutboxSyncCoordinator, SyncHttpError, SyncHttpTransport } from "@carpeos/sync-client";
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
      case "sync":
        return await runSync(rest, env);
      case "retrieval":
        return runRetrieval(rest, env);
      case "memory":
        return await runMemory(rest, env);
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

function runRetrieval(argv: readonly string[], env: NodeJS.ProcessEnv): number {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined) {
    throw new CliUsageError("retrieval requires rebuild or embed");
  }
  const parsed = parseArgs({
    args: rest,
    allowPositionals: false,
    strict: true,
    options: {
      home: { type: "string" },
      "project-id": { type: "string" },
      "trust-zone": { type: "string" },
      provider: { type: "string", default: "deterministic-local-dev" },
      limit: { type: "string", default: "10" },
      "lease-ms": { type: "string", default: "30000" },
    },
  });
  const trustZone = requireStoreTrustZone(parsed.values["trust-zone"]);
  const store = openStore(
    compactCommonOptions(parsed.values.home, parsed.values["project-id"], trustZone),
    env,
  );
  try {
    switch (subcommand) {
      case "rebuild": {
        const rebuilt = withLocalRetrievalDatabase(store, (db) =>
          rebuildLocalRetrievalIndex(db, new Date()),
        );
        writeJson(process.stdout, {
          ok: true,
          command: "retrieval rebuild",
          chunks: rebuilt.chunks.length,
          freshness: rebuilt.freshness,
          trust_zone_id: store.trustZone.trust_zone_id,
        });
        return 0;
      }
      case "embed": {
        if (parsed.values.provider !== "deterministic-local-dev") {
          throw new CliUsageError(
            "retrieval embed requires --provider deterministic-local-dev; production embedding is not configured",
          );
        }
        const embedded = withLocalRetrievalDatabase(store, (db) => {
          const rebuilt = rebuildLocalRetrievalIndex(db, new Date());
          for (const chunk of rebuilt.chunks.filter((item) => item.status === "active")) {
            ensureEmbeddingJob(db, {
              chunkId: chunk.chunk_id,
              embeddingModel: DETERMINISTIC_LOCAL_DEV_EMBEDDING.model,
              embeddingVersion: DETERMINISTIC_LOCAL_DEV_EMBEDDING.version,
              pooling: DETERMINISTIC_LOCAL_DEV_EMBEDDING.pooling,
            });
          }
          const leased = leaseEmbeddingJobs(db, {
            limit: parseInteger(parsed.values.limit, "--limit", 1),
            leaseMs: parseInteger(parsed.values["lease-ms"], "--lease-ms", 1),
          });
          let count = 0;
          for (const item of leased) {
            const chunk = rebuilt.chunks.find(
              (candidate) => candidate.chunk_id === item.job.chunk_id,
            );
            if (chunk === undefined) {
              continue;
            }
            const vector = deterministicLocalDevEmbedding(chunk.text);
            const record = makeEmbeddingRecord({
              chunkId: chunk.chunk_id,
              vector,
              embeddingModel: DETERMINISTIC_LOCAL_DEV_EMBEDDING.model,
              embeddingVersion: DETERMINISTIC_LOCAL_DEV_EMBEDDING.version,
              pooling: DETERMINISTIC_LOCAL_DEV_EMBEDDING.pooling,
              inputTextSha256: chunk.text_digest,
              createdAt: new Date().toISOString(),
            });
            storeLocalVector(db, { record, vector });
            if (ackEmbeddingJob(db, { jobId: item.job.job_id, leaseId: item.lease_id, record })) {
              count += 1;
            }
          }
          return { leased: leased.length, embedded: count };
        });
        writeJson(process.stdout, {
          ok: true,
          command: "retrieval embed",
          provider: "deterministic-local-dev",
          semantic_quality: "synthetic-dev-only",
          ...embedded,
        });
        return 0;
      }
      default:
        throw new CliUsageError(`unknown retrieval subcommand: ${subcommand}`);
    }
  } finally {
    store.close();
  }
}

async function runMemory(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined) {
    throw new CliUsageError("memory requires search, get, or context-pack");
  }
  const parsed = parseArgs({
    args: rest,
    allowPositionals: false,
    strict: true,
    options: {
      home: { type: "string" },
      "project-id": { type: "string" },
      "trust-zone": { type: "string" },
      query: { type: "string" },
      "chunk-id": { type: "string" },
      task: { type: "string" },
      limit: { type: "string", default: "10" },
      "max-items": { type: "string", default: "16" },
      "max-characters": { type: "string", default: "8000" },
      "protected-value-policy": { type: "string", default: "metadata_only" },
      "visible-trust-zone": { type: "string", multiple: true },
    },
  });
  const trustZone = requireStoreTrustZone(parsed.values["trust-zone"]);
  const visibleTrustZones = requireVisibleTrustZones(
    parsed.values["visible-trust-zone"],
    trustZone,
  );
  const store = openStore(
    compactCommonOptions(parsed.values.home, parsed.values["project-id"], trustZone),
    env,
  );
  try {
    switch (subcommand) {
      case "search": {
        const queryText = requireString(parsed.values.query, "--query");
        const result = withLocalRetrievalDatabase(store, (db) =>
          searchLocalRetrievalIndex(db, {
            query: makeRetrievalQuery({
              text: queryText,
              visibleTrustZones,
              limit: parseInteger(parsed.values.limit, "--limit", 1),
            }),
          }),
        );
        writeJson(process.stdout, {
          ok: true,
          command: "memory search",
          result,
        });
        return 0;
      }
      case "get": {
        const chunkId = requireString(parsed.values["chunk-id"], "--chunk-id");
        const result = withLocalRetrievalDatabase(store, (db) => {
          const row = db
            .prepare("SELECT chunk_json FROM retrieval_chunks WHERE chunk_id = ?")
            .get(chunkId) as { chunk_json: string } | undefined;
          const chunk =
            row === undefined ? undefined : (JSON.parse(row.chunk_json) as RetrievalChunk);
          if (chunk === undefined) {
            return undefined;
          }
          return searchLocalRetrievalIndex(db, {
            query: makeRetrievalQuery({
              text: chunk.text,
              visibleTrustZones,
              limit: 100,
            }),
          });
        });
        if (result === undefined) {
          writeJson(process.stdout, {
            ok: false,
            command: "memory get",
            item: undefined,
          });
          return 2;
        }
        const item = result.results.find((candidate) => candidate.chunk_id === chunkId);
        writeJson(process.stdout, {
          ok: item !== undefined,
          command: "memory get",
          item,
          freshness: result.projection_freshness,
          filters_applied: result.filters_applied,
        });
        return item === undefined ? 2 : 0;
      }
      case "context-pack": {
        const task = requireString(parsed.values.task, "--task");
        const protectedValuePolicy = parseProtectedValuePolicy(
          parsed.values["protected-value-policy"],
        );
        const maxItems = parseInteger(parsed.values["max-items"], "--max-items", 1);
        const maxCharacters = parseInteger(parsed.values["max-characters"], "--max-characters", 1);
        const app = createCarpeosMcpApplication({
          store,
          config: { visibleTrustZoneIds: visibleTrustZones },
        });
        const result = await app.dispatch("memory_context_pack", {
          schema_version: "v1",
          visibility: {
            visible_trust_zone_ids: visibleTrustZones,
            protected_value_policy: protectedValuePolicy,
          },
          task,
          context_budget: {
            max_items: maxItems,
            max_characters: maxCharacters,
          },
        });
        writeJson(process.stdout, {
          ok: !result.isError,
          command: "memory context-pack",
          pack: result.structuredContent,
        });
        return result.isError ? 2 : 0;
      }
      default:
        throw new CliUsageError(`unknown memory subcommand: ${subcommand}`);
    }
  } finally {
    store.close();
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

async function runSync(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined) {
    throw new CliUsageError("sync requires status, push, pull, or once");
  }

  const parsed = parseArgs({
    args: rest,
    allowPositionals: false,
    strict: true,
    options: {
      home: { type: "string" },
      "project-id": { type: "string" },
      "trust-zone": { type: "string" },
      url: { type: "string" },
      "credential-file": { type: "string" },
      "sync-key-file": { type: "string" },
      limit: { type: "string", default: "1" },
      "max-pages": { type: "string", default: "1" },
      "lease-ms": { type: "string", default: "30000" },
      "retry-delay-ms": { type: "string", default: "1000" },
      "pull-limit": { type: "string", default: "100" },
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
      case "status": {
        const config = resolveSyncConfig(parsed.values, env, store.runtimeDir, false);
        const cursor = store.getSyncCursor();
        writeJson(process.stdout, {
          ok: true,
          command: "sync status",
          sync: {
            url_configured: config.urlConfigured,
            credential_file_configured: config.credentialFileConfigured,
            sync_key_file_configured: config.syncKeyFileConfigured,
          },
          local: {
            outbox: store.outboxStatus(),
            cursor,
            trust_zone_id: store.trustZone.trust_zone_id,
            client_id: store.clientId,
          },
        });
        return 0;
      }
      case "push": {
        const coordinator = createSyncCoordinator(parsed.values, env, store);
        const limit = parseInteger(parsed.values.limit, "--limit", 1);
        const results = [];
        let exitCode = 0;
        for (let index = 0; index < limit; index += 1) {
          const result = await coordinator.pushOne();
          if (result === undefined) {
            break;
          }
          results.push(redactPushResult(result));
          if (result.status !== "acked") {
            exitCode = result.status === "retried" ? Math.max(exitCode, 1) : 4;
            break;
          }
        }
        writeJson(process.stdout, {
          ok: exitCode === 0,
          command: "sync push",
          processed: results.length,
          results,
          status: store.outboxStatus(),
        });
        return exitCode;
      }
      case "pull": {
        const coordinator = createSyncCoordinator(parsed.values, env, store);
        const maxPages = parseInteger(parsed.values["max-pages"], "--max-pages", 1);
        const results = [];
        for (let index = 0; index < maxPages; index += 1) {
          const page = await coordinator.pullPage();
          results.push(page);
          if (!page.has_more) {
            break;
          }
        }
        writeJson(process.stdout, {
          ok: true,
          command: "sync pull",
          pages: results.length,
          results,
          cursor: store.getSyncCursor(),
        });
        return 0;
      }
      case "once": {
        const coordinator = createSyncCoordinator(parsed.values, env, store);
        const limit = parseInteger(parsed.values.limit, "--limit", 1);
        const maxPages = parseInteger(parsed.values["max-pages"], "--max-pages", 1);
        const pushed = [];
        let exitCode = 0;
        for (let index = 0; index < limit; index += 1) {
          const result = await coordinator.pushOne();
          if (result === undefined) {
            break;
          }
          pushed.push(redactPushResult(result));
          if (result.status !== "acked") {
            exitCode = result.status === "retried" ? Math.max(exitCode, 1) : 4;
            break;
          }
        }
        const pulled = [];
        if (exitCode === 0) {
          for (let index = 0; index < maxPages; index += 1) {
            const page = await coordinator.pullPage();
            pulled.push(page);
            if (!page.has_more) {
              break;
            }
          }
        }
        writeJson(process.stdout, {
          ok: exitCode === 0,
          command: "sync once",
          pushed,
          pulled,
          status: store.outboxStatus(),
          cursor: store.getSyncCursor(),
        });
        return exitCode;
      }
      case "credential-hash": {
        const credentialFile =
          firstConfigured(
            parsed.values["credential-file"],
            env.CARPEOS_SYNC_CREDENTIAL_FILE,
            join(store.runtimeDir, "sync-credential"),
          ) ?? join(store.runtimeDir, "sync-credential");
        const credential = readCredentialFile(credentialFile);
        writeJson(process.stdout, {
          ok: true,
          command: "sync credential-hash",
          hash_algorithm: "sha-256",
          token_hash_sha256: sha256Hex(credential),
        });
        return 0;
      }
      default:
        throw new CliUsageError(`unknown sync subcommand: ${subcommand}`);
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
      "a command is required: init, project identify, capture-hook, outbox, sync, retrieval, or memory",
    );
  }
  return { command, rest };
}

type SyncParsedValues = {
  url?: string;
  "credential-file"?: string;
  "sync-key-file"?: string;
  "lease-ms"?: string;
  "retry-delay-ms"?: string;
  "pull-limit"?: string;
};

type ResolvedSyncConfig =
  | {
      urlConfigured: boolean;
      credentialFileConfigured: boolean;
      syncKeyFileConfigured: boolean;
    }
  | {
      baseUrl: string;
      bearerCredential: string;
      trustZoneSyncKey: Uint8Array;
      urlConfigured: true;
      credentialFileConfigured: true;
      syncKeyFileConfigured: true;
    };

function createSyncCoordinator(
  values: SyncParsedValues,
  env: NodeJS.ProcessEnv,
  store: LocalCaptureStore,
): OutboxSyncCoordinator {
  const config = resolveSyncConfig(values, env, store.runtimeDir, true);
  if (!("baseUrl" in config)) {
    throw new CliUsageError("sync credentials are required");
  }
  return new OutboxSyncCoordinator({
    store,
    transport: new SyncHttpTransport({
      baseUrl: config.baseUrl,
      bearerCredential: config.bearerCredential,
      clientId: store.clientId,
      fetch: globalThis.fetch,
    }),
    trustZoneSyncKey: config.trustZoneSyncKey,
    leaseMs: parseInteger(values["lease-ms"], "--lease-ms", 1),
    retryDelayMs: parseInteger(values["retry-delay-ms"], "--retry-delay-ms", 0),
    pullLimit: parseInteger(values["pull-limit"], "--pull-limit", 1),
  });
}

function resolveSyncConfig(
  values: SyncParsedValues,
  env: NodeJS.ProcessEnv,
  runtimeDir: string,
  requireSecrets: false,
): Pick<ResolvedSyncConfig, "urlConfigured" | "credentialFileConfigured" | "syncKeyFileConfigured">;
function resolveSyncConfig(
  values: SyncParsedValues,
  env: NodeJS.ProcessEnv,
  runtimeDir: string,
  requireSecrets: true,
): ResolvedSyncConfig;
function resolveSyncConfig(
  values: SyncParsedValues,
  env: NodeJS.ProcessEnv,
  runtimeDir: string,
  requireSecrets: boolean,
): ResolvedSyncConfig {
  const url = firstConfigured(values.url, env.CARPEOS_SYNC_URL);
  const credentialFile =
    firstConfigured(
      values["credential-file"],
      env.CARPEOS_SYNC_CREDENTIAL_FILE,
      join(runtimeDir, "sync-credential"),
    ) ?? join(runtimeDir, "sync-credential");
  const syncKeyFile =
    firstConfigured(
      values["sync-key-file"],
      env.CARPEOS_SYNC_KEY_FILE,
      join(runtimeDir, "trust-zone-sync.key"),
    ) ?? join(runtimeDir, "trust-zone-sync.key");
  const baseStatus = {
    urlConfigured: url !== undefined,
    credentialFileConfigured: fileExists(credentialFile),
    syncKeyFileConfigured: fileExists(syncKeyFile),
  };
  if (!requireSecrets) {
    return baseStatus;
  }
  if (url === undefined) {
    throw new CliUsageError("sync requires --url or CARPEOS_SYNC_URL");
  }
  return {
    baseUrl: normalizeSyncUrl(url),
    bearerCredential: readCredentialFile(credentialFile),
    trustZoneSyncKey: readSyncKeyFile(syncKeyFile),
    urlConfigured: true,
    credentialFileConfigured: true,
    syncKeyFileConfigured: true,
  };
}

function readCredentialFile(path: string): string {
  assertSecretFile(path, "sync credential file");
  const credential = readFileSync(path, "utf8").trim();
  if (!/^[A-Za-z0-9._~:-]{32,512}$/.test(credential)) {
    throw new CliUsageError("sync credential file must contain one high-entropy token");
  }
  return credential;
}

function readSyncKeyFile(path: string): Uint8Array {
  assertSecretFile(path, "trust-zone sync key file");
  const raw = readFileSync(path, "utf8").trim();
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return new Uint8Array(Buffer.from(raw, "hex"));
  }
  if (/^[A-Za-z0-9_-]{43}$/.test(raw)) {
    const decoded = Buffer.from(raw, "base64url");
    if (decoded.byteLength === 32) {
      return new Uint8Array(decoded);
    }
  }
  throw new CliUsageError(
    "trust-zone sync key file must contain a 32-byte key as 64-hex or base64url",
  );
}

function assertSecretFile(path: string, label: string): void {
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(path);
  } catch {
    throw new CliUsageError(`${label} is required`);
  }
  if (!stat.isFile()) {
    throw new CliUsageError(`${label} must be a regular file`);
  }
  if ((stat.mode & 0o777) !== 0o600) {
    throw new CliUsageError(`${label} must use mode 0600`);
  }
}

function normalizeSyncUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CliUsageError("sync URL must be an absolute http or https URL");
  }
  if (url.protocol === "https:") {
    return url.toString().replace(/\/+$/, "");
  }
  if (url.protocol === "http:" && isLoopbackHost(url.hostname)) {
    return url.toString().replace(/\/+$/, "");
  }
  throw new CliUsageError("sync URL must use https except for loopback local development");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function requireStoreTrustZone(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) {
    throw new CliUsageError("--trust-zone is required for retrieval and memory commands");
  }
  if (!isTrustZoneId(value)) {
    throw new CliUsageError("--trust-zone must match tz_[a-z0-9][a-z0-9_-]{2,63}");
  }
  return value;
}

function requireVisibleTrustZones(
  values: readonly string[] | undefined,
  storeTrustZone: string,
): string[] {
  if (values === undefined || values.length === 0) {
    throw new CliUsageError("memory commands require --visible-trust-zone");
  }
  for (const trustZoneId of values) {
    if (!isTrustZoneId(trustZoneId)) {
      throw new CliUsageError("--visible-trust-zone must match tz_[a-z0-9][a-z0-9_-]{2,63}");
    }
  }
  if (!values.includes(storeTrustZone)) {
    throw new CliUsageError("--visible-trust-zone must include the active --trust-zone");
  }
  return [...values];
}

function makeRetrievalQuery(input: {
  text: string;
  visibleTrustZones: readonly string[];
  limit: number;
}): RetrievalQuery {
  return {
    schema_version: "v1",
    record_type: "retrieval_query",
    query_id: `query_${sha256Hex(input.text).slice(0, 24)}`,
    query_text: input.text,
    filters: {
      visible_trust_zone_ids: [...input.visibleTrustZones],
      lifecycle_status: ["active"],
      epistemic_authority: ["observed", "derived", "verified"],
      protected_value_policy: "metadata_only",
      conflict_policy: "surface_conflicts",
    },
    ranking: { mode: "hybrid", weights: { structured: 1, fts: 1, semantic: 1, recency: 0.1 } },
    limit: input.limit,
  };
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function firstConfigured(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value !== undefined && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function redactPushResult(result: Awaited<ReturnType<OutboxSyncCoordinator["pushOne"]>>): unknown {
  if (result === undefined) {
    return undefined;
  }
  if (result.status === "acked") {
    return {
      status: result.status,
      outbox_id: result.outbox_id,
      remote_status: result.remote_status,
      accepted_event_ids: result.result.accepted_event_ids,
      accepted_erasure_ids: result.result.accepted_erasure_ids,
    };
  }
  if (result.status === "retried") {
    return { status: result.status, outbox_id: result.outbox_id, error: result.error };
  }
  return {
    status: result.status,
    outbox_id: result.outbox_id,
    reason: result.reason,
    remote_status: result.result?.status,
    conflict_with: result.result?.conflict_with,
  };
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

function parseProtectedValuePolicy(
  value: string | undefined,
): "metadata_only" | "allow_decrypt" | "deny" {
  const policy = value ?? "metadata_only";
  if (policy === "metadata_only" || policy === "allow_decrypt" || policy === "deny") {
    return policy;
  }
  throw new CliUsageError("--protected-value-policy must be metadata_only, allow_decrypt, or deny");
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
  if (error instanceof SyncHttpError) {
    return {
      code: error.retryable ? "sync_retryable_failure" : "sync_blocked",
      message: "The remote sync request failed without exposing the server response body.",
      exitCode: error.retryable ? 1 : 4,
    };
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
